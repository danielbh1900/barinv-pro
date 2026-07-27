-- BARINV PRO
-- Persistent server-side jobs for large Events Accept/Reject operations.
--
-- LOCAL AUTHORING ONLY.
-- Do not apply to production without a separately approved migration step.
--
-- Properties:
--   * Matching Event IDs are snapshotted at job creation.
--   * Processing is performed in bounded server-side batches.
--   * Job state survives browser refresh, navigation, or network interruption.
--   * Each Event is processed independently.
--   * Failed Events can be retried without repeating successful Events.
--   * Only PENDING Events belonging to the authorized Venue may transition.

BEGIN;

CREATE TABLE IF NOT EXISTS public.event_review_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  venue_id          uuid NOT NULL
    REFERENCES public.venues(id) ON DELETE CASCADE,

  target_status     text NOT NULL
    CHECK (target_status IN ('APPROVED', 'REJECTED')),

  reason            text,

  selection_mode    text NOT NULL
    CHECK (selection_mode IN ('explicit_ids', 'all_matching')),

  filters           jsonb NOT NULL DEFAULT '{}'::jsonb,

  requested_by      uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,

  requested_count   integer NOT NULL DEFAULT 0
    CHECK (requested_count >= 0),

  total_count       integer NOT NULL DEFAULT 0
    CHECK (total_count >= 0),

  processed_count   integer NOT NULL DEFAULT 0
    CHECK (processed_count >= 0),

  updated_count     integer NOT NULL DEFAULT 0
    CHECK (updated_count >= 0),

  skipped_count     integer NOT NULL DEFAULT 0
    CHECK (skipped_count >= 0),

  failed_count      integer NOT NULL DEFAULT 0
    CHECK (failed_count >= 0),

  status            text NOT NULL DEFAULT 'queued'
    CHECK (
      status IN (
        'queued',
        'running',
        'completed',
        'completed_with_errors',
        'cancelled',
        'failed'
      )
    ),

  last_error        text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_review_job_items (
  job_id            uuid NOT NULL
    REFERENCES public.event_review_jobs(id) ON DELETE CASCADE,

  -- Deliberately not an FK. The UUID snapshot remains available even if
  -- the original Event is deleted before the job reaches it.
  event_id          uuid NOT NULL,

  state             text NOT NULL DEFAULT 'queued'
    CHECK (
      state IN (
        'queued',
        'processing',
        'updated',
        'skipped',
        'failed'
      )
    ),

  attempt_count     integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),

  error_message     text,
  processed_at      timestamptz,

  PRIMARY KEY (job_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_review_jobs_venue_created
  ON public.event_review_jobs(venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_review_jobs_status
  ON public.event_review_jobs(venue_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_review_job_items_queue
  ON public.event_review_job_items(job_id, state, event_id);

ALTER TABLE public.event_review_jobs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_review_job_items
  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'event_review_jobs'
      AND policyname = 'event_review_jobs_select_v'
  ) THEN
    CREATE POLICY event_review_jobs_select_v
      ON public.event_review_jobs
      FOR SELECT
      TO authenticated
      USING (public.has_venue_access(venue_id, 'manager'));
  END IF;
END
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'event_review_job_items'
      AND policyname = 'event_review_job_items_select_v'
  ) THEN
    CREATE POLICY event_review_job_items_select_v
      ON public.event_review_job_items
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.event_review_jobs AS j
          WHERE j.id = event_review_job_items.job_id
            AND public.has_venue_access(j.venue_id, 'manager')
        )
      );
  END IF;
END
$$ LANGUAGE plpgsql;

REVOKE ALL ON public.event_review_jobs
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.event_review_job_items
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.event_review_jobs
  TO authenticated;

GRANT SELECT ON public.event_review_job_items
  TO authenticated;

GRANT ALL ON public.event_review_jobs
  TO service_role;

GRANT ALL ON public.event_review_job_items
  TO service_role;


-- ------------------------------------------------------------------
-- Create a durable job and snapshot the eligible PENDING Event IDs.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_create_event_review_job(
  p_venue_id uuid,
  p_target_status text,
  p_event_ids uuid[] DEFAULT NULL,
  p_night_id uuid DEFAULT NULL,
  p_bar_id uuid DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id uuid;
  v_target_status text :=
    upper(trim(COALESCE(p_target_status, '')));

  v_reason text :=
    NULLIF(trim(COALESCE(p_reason, '')), '');

  v_selection_mode text;
  v_requested integer := 0;
  v_total integer := 0;
  v_initial_skipped integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  IF NOT public.has_venue_access(p_venue_id, 'manager') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Manager access required for this venue';
  END IF;

  IF v_target_status NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Target status must be APPROVED or REJECTED';
  END IF;

  IF v_target_status = 'REJECTED' AND v_reason IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A rejection reason is required';
  END IF;

  IF p_night_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A Night selection is required for a bulk review job';
  END IF;

  IF p_event_ids IS NULL THEN
    v_selection_mode := 'all_matching';
  ELSE
    v_selection_mode := 'explicit_ids';

    SELECT count(DISTINCT supplied_id)
      INTO v_requested
    FROM unnest(p_event_ids) AS supplied(supplied_id);

    IF v_requested > 100000 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'A maximum of 100000 explicit Event IDs is allowed';
    END IF;
  END IF;

  INSERT INTO public.event_review_jobs (
    venue_id,
    target_status,
    reason,
    selection_mode,
    filters,
    requested_by
  ) VALUES (
    p_venue_id,
    v_target_status,
    v_reason,
    v_selection_mode,
    jsonb_build_object(
      'night_id', p_night_id,
      'bar_id', p_bar_id,
      'action', p_action,
      'staff_id', p_staff_id
    ),
    auth.uid()
  )
  RETURNING id INTO v_job_id;

  INSERT INTO public.event_review_job_items (
    job_id,
    event_id
  )
  SELECT
    v_job_id,
    e.id
  FROM public.events AS e
  WHERE e.venue_id = p_venue_id
    AND e.status = 'PENDING'
    AND (
      p_event_ids IS NULL
      OR e.id = ANY(p_event_ids)
    )
    AND (
      p_night_id IS NULL
      OR e.night_id = p_night_id
    )
    AND (
      p_bar_id IS NULL
      OR e.bar_id = p_bar_id
    )
    AND (
      p_action IS NULL
      OR e.action = p_action
    )
    AND (
      p_staff_id IS NULL
      OR e.staff_id = p_staff_id
    )
  ON CONFLICT (job_id, event_id) DO NOTHING;

  GET DIAGNOSTICS v_total = ROW_COUNT;

  IF v_selection_mode = 'all_matching' THEN
    v_requested := v_total;
  END IF;

  v_initial_skipped :=
    GREATEST(v_requested - v_total, 0);

  IF v_total <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'No eligible PENDING Events matched this review job';
  END IF;

  UPDATE public.event_review_jobs
     SET requested_count = v_requested,
         total_count = v_total,
         skipped_count = v_initial_skipped,
         updated_at = now()
   WHERE id = v_job_id;

  RETURN jsonb_build_object(
    'job_id', v_job_id,
    'status', 'queued',
    'selection_mode', v_selection_mode,
    'requested', v_requested,
    'total', v_total,
    'processed', 0,
    'updated', 0,
    'skipped', v_initial_skipped,
    'failed', 0
  );
END;
$$;


-- ------------------------------------------------------------------
-- Process one bounded batch.
--
-- One Event failure does not abort the other Events in the batch.
-- A transaction-level advisory lock prevents duplicate processors.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_process_event_review_job(
  p_job_id uuid,
  p_batch_size integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.event_review_jobs%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_item record;

  v_batch_size integer :=
    LEAST(GREATEST(COALESCE(p_batch_size, 250), 1), 500);

  v_queued integer := 0;
  v_processing integer := 0;
  v_updated integer := 0;
  v_item_skipped integer := 0;
  v_failed integer := 0;
  v_processed integer := 0;
  v_initial_skipped integer := 0;

  v_status text;
  v_last_error text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  SELECT j.*
    INTO v_job
  FROM public.event_review_jobs AS j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Event review job not found';
  END IF;

  IF NOT public.has_venue_access(v_job.venue_id, 'manager') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Manager access required for this review job';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_job_id::text, 0)
  );

  SELECT j.*
    INTO v_job
  FROM public.event_review_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_job.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'job_id', v_job.id,
      'status', v_job.status,
      'requested', v_job.requested_count,
      'total', v_job.total_count,
      'processed', v_job.processed_count,
      'updated', v_job.updated_count,
      'skipped', v_job.skipped_count,
      'failed', v_job.failed_count
    );
  END IF;

  UPDATE public.event_review_jobs
     SET status = 'running',
         started_at = COALESCE(started_at, now()),
         completed_at = NULL,
         updated_at = now()
   WHERE id = p_job_id;

  FOR v_item IN
    SELECT i.event_id
    FROM public.event_review_job_items AS i
    WHERE i.job_id = p_job_id
      AND i.state = 'queued'
    ORDER BY i.event_id
    LIMIT v_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.event_review_job_items
       SET state = 'processing',
           attempt_count = attempt_count + 1,
           error_message = NULL,
           processed_at = NULL
     WHERE job_id = p_job_id
       AND event_id = v_item.event_id;

    BEGIN
      SELECT e.*
        INTO v_event
      FROM public.events AS e
      WHERE e.id = v_item.event_id
        AND e.venue_id = v_job.venue_id
      FOR UPDATE;

      IF NOT FOUND THEN
        UPDATE public.event_review_job_items
           SET state = 'skipped',
               error_message = 'Event no longer exists in this Venue',
               processed_at = now()
         WHERE job_id = p_job_id
           AND event_id = v_item.event_id;

      ELSIF v_event.status <> 'PENDING' THEN
        UPDATE public.event_review_job_items
           SET state = 'skipped',
               error_message =
                 'Event is no longer PENDING; current status=' ||
                 COALESCE(v_event.status, 'NULL'),
               processed_at = now()
         WHERE job_id = p_job_id
           AND event_id = v_item.event_id;

      ELSE
        PERFORM set_config(
          'barinv.review_source',
          'manual_bulk',
          true
        );

        PERFORM set_config(
          'barinv.review_reason',
          COALESCE(v_job.reason, ''),
          true
        );

        PERFORM set_config(
          'barinv.review_metadata',
          jsonb_build_object(
            'job_id', v_job.id,
            'selection_mode', v_job.selection_mode,
            'filters', v_job.filters
          )::text,
          true
        );

        UPDATE public.events
           SET status = v_job.target_status
         WHERE id = v_event.id
           AND venue_id = v_job.venue_id
           AND status = 'PENDING';

        IF NOT FOUND THEN
          UPDATE public.event_review_job_items
             SET state = 'skipped',
                 error_message =
                   'Event changed before its review transition',
                 processed_at = now()
           WHERE job_id = p_job_id
             AND event_id = v_item.event_id;
        ELSE
          UPDATE public.event_review_job_items
             SET state = 'updated',
                 error_message = NULL,
                 processed_at = now()
           WHERE job_id = p_job_id
             AND event_id = v_item.event_id;
        END IF;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.event_review_job_items
         SET state = 'failed',
             error_message = left(SQLERRM, 1000),
             processed_at = now()
       WHERE job_id = p_job_id
         AND event_id = v_item.event_id;
    END;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE state = 'queued'),
    count(*) FILTER (WHERE state = 'processing'),
    count(*) FILTER (WHERE state = 'updated'),
    count(*) FILTER (WHERE state = 'skipped'),
    count(*) FILTER (WHERE state = 'failed'),
    min(error_message) FILTER (WHERE state = 'failed')
  INTO
    v_queued,
    v_processing,
    v_updated,
    v_item_skipped,
    v_failed,
    v_last_error
  FROM public.event_review_job_items
  WHERE job_id = p_job_id;

  v_processed :=
    v_updated + v_item_skipped + v_failed;

  v_initial_skipped :=
    GREATEST(v_job.requested_count - v_job.total_count, 0);

  v_status :=
    CASE
      WHEN v_queued = 0
       AND v_processing = 0
       AND v_failed = 0
        THEN 'completed'

      WHEN v_queued = 0
       AND v_processing = 0
       AND v_failed > 0
        THEN 'completed_with_errors'

      ELSE 'running'
    END;

  UPDATE public.event_review_jobs
     SET processed_count = v_processed,
         updated_count = v_updated,
         skipped_count = v_initial_skipped + v_item_skipped,
         failed_count = v_failed,
         status = v_status,
         last_error = v_last_error,
         completed_at =
           CASE
             WHEN v_status IN (
               'completed',
               'completed_with_errors'
             )
             THEN now()
             ELSE NULL
           END,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'status', v_status,
    'requested', v_job.requested_count,
    'total', v_job.total_count,
    'processed', v_processed,
    'updated', v_updated,
    'skipped', v_initial_skipped + v_item_skipped,
    'failed', v_failed,
    'remaining', v_queued + v_processing,
    'last_error', v_last_error
  );
END;
$$;


-- ------------------------------------------------------------------
-- Read persistent job progress and a bounded failure sample.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_get_event_review_job(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.event_review_jobs%ROWTYPE;
  v_failed_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  SELECT j.*
    INTO v_job
  FROM public.event_review_jobs AS j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Event review job not found';
  END IF;

  IF NOT public.has_venue_access(v_job.venue_id, 'manager') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Manager access required for this review job';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event_id', failures.event_id,
        'attempt_count', failures.attempt_count,
        'error', failures.error_message
      )
      ORDER BY failures.event_id
    ),
    '[]'::jsonb
  )
  INTO v_failed_rows
  FROM (
    SELECT
      i.event_id,
      i.attempt_count,
      i.error_message
    FROM public.event_review_job_items AS i
    WHERE i.job_id = p_job_id
      AND i.state = 'failed'
    ORDER BY i.event_id
    LIMIT 25
  ) AS failures;

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'venue_id', v_job.venue_id,
    'target_status', v_job.target_status,
    'selection_mode', v_job.selection_mode,
    'filters', v_job.filters,
    'status', v_job.status,
    'requested', v_job.requested_count,
    'total', v_job.total_count,
    'processed', v_job.processed_count,
    'updated', v_job.updated_count,
    'skipped', v_job.skipped_count,
    'failed', v_job.failed_count,
    'remaining',
      GREATEST(
        v_job.total_count - v_job.processed_count,
        0
      ),
    'last_error', v_job.last_error,
    'created_at', v_job.created_at,
    'started_at', v_job.started_at,
    'completed_at', v_job.completed_at,
    'failed_rows', v_failed_rows
  );
END;
$$;


-- ------------------------------------------------------------------
-- Retry only failed items. Updated and skipped items are untouched.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_retry_event_review_job_failures(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.event_review_jobs%ROWTYPE;
  v_requeued integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  SELECT j.*
    INTO v_job
  FROM public.event_review_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Event review job not found';
  END IF;

  IF NOT public.has_venue_access(v_job.venue_id, 'manager') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Manager access required for this review job';
  END IF;

  UPDATE public.event_review_job_items
     SET state = 'queued',
         error_message = NULL,
         processed_at = NULL
   WHERE job_id = p_job_id
     AND state = 'failed';

  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  UPDATE public.event_review_jobs
     SET status =
           CASE
             WHEN v_requeued > 0 THEN 'queued'
             ELSE status
           END,
         processed_count =
           CASE
             WHEN v_requeued > 0
             THEN GREATEST(processed_count - v_requeued, 0)
             ELSE processed_count
           END,
         failed_count =
           CASE
             WHEN v_requeued > 0 THEN 0
             ELSE failed_count
           END,
         last_error =
           CASE
             WHEN v_requeued > 0 THEN NULL
             ELSE last_error
           END,
         completed_at =
           CASE
             WHEN v_requeued > 0 THEN NULL
             ELSE completed_at
           END,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'requeued', v_requeued,
    'status',
      CASE
        WHEN v_requeued > 0 THEN 'queued'
        ELSE v_job.status
      END
  );
END;
$$;


REVOKE ALL ON FUNCTION public.barinv_create_event_review_job(
  uuid, text, uuid[], uuid, uuid, text, uuid, text
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.barinv_process_event_review_job(
  uuid, integer
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.barinv_get_event_review_job(
  uuid
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.barinv_retry_event_review_job_failures(
  uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.barinv_create_event_review_job(
  uuid, text, uuid[], uuid, uuid, text, uuid, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_process_event_review_job(
  uuid, integer
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_get_event_review_job(
  uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_retry_event_review_job_failures(
  uuid
) TO authenticated;

COMMENT ON TABLE public.event_review_jobs IS
  'Persistent progress and authorization scope for large Events Accept/Reject operations.';

COMMENT ON TABLE public.event_review_job_items IS
  'Immutable Event-ID snapshot and independent per-Event processing state for an Event review job.';

COMMENT ON FUNCTION public.barinv_process_event_review_job(
  uuid, integer
) IS
  'Processes up to 500 queued Event review items independently and returns durable progress.';

COMMIT;

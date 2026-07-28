-- BARINV PRO
-- Durable, manager-scoped CSV import jobs for Admin Events.
--
-- LOCAL AUTHORING ONLY.
-- Do not apply to production without a separately approved migration step.
--
-- Properties:
--   * CSV imports never choose APPROVED/REJECTED directly.
--   * Venue/Night scope is supplied by the authenticated Admin selection and
--     enforced again by the database.
--   * Preview is separate from processing and survives browser refresh.
--   * Processing is bounded to 500 rows per call and idempotent by
--     client_event_id.

BEGIN;

CREATE TABLE IF NOT EXISTS public.event_csv_import_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  venue_id           uuid NOT NULL
    REFERENCES public.venues(id) ON DELETE CASCADE,

  night_id           uuid NOT NULL
    REFERENCES public.nights(id) ON DELETE CASCADE,

  original_filename  text,

  created_by         uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'previewed'
    CHECK (
      status IN (
        'previewed',
        'queued',
        'running',
        'completed',
        'completed_with_errors',
        'failed',
        'cancelled'
      )
    ),

  total_rows         integer NOT NULL DEFAULT 0
    CHECK (total_rows >= 0),

  valid_rows         integer NOT NULL DEFAULT 0
    CHECK (valid_rows >= 0),

  invalid_rows       integer NOT NULL DEFAULT 0
    CHECK (invalid_rows >= 0),

  duplicate_rows     integer NOT NULL DEFAULT 0
    CHECK (duplicate_rows >= 0),

  skipped_rows       integer NOT NULL DEFAULT 0
    CHECK (skipped_rows >= 0),

  processed_rows     integer NOT NULL DEFAULT 0
    CHECK (processed_rows >= 0),

  inserted_rows      integer NOT NULL DEFAULT 0
    CHECK (inserted_rows >= 0),

  failed_rows        integer NOT NULL DEFAULT 0
    CHECK (failed_rows >= 0),

  action_counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  bar_counts         jsonb NOT NULL DEFAULT '[]'::jsonb,
  station_counts     jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_sample       jsonb NOT NULL DEFAULT '[]'::jsonb,

  last_error         text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_csv_import_rows (
  batch_id           uuid NOT NULL
    REFERENCES public.event_csv_import_batches(id) ON DELETE CASCADE,

  row_number         integer NOT NULL
    CHECK (row_number > 0),

  row_data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized         jsonb NOT NULL DEFAULT '{}'::jsonb,

  client_event_id    text,

  state              text NOT NULL
    CHECK (
      state IN (
        'queued',
        'processing',
        'inserted',
        'skipped',
        'invalid',
        'duplicate',
        'failed'
      )
    ),

  validation_code    text,
  validation_message text,

  attempt_count      integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),

  event_id           uuid,
  processed_at       timestamptz,

  PRIMARY KEY (batch_id, row_number)
);

DROP INDEX IF EXISTS public.idx_event_csv_import_rows_batch_client;

CREATE INDEX IF NOT EXISTS idx_event_csv_import_rows_batch_client
  ON public.event_csv_import_rows(batch_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_csv_import_batches_venue_created
  ON public.event_csv_import_batches(venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_csv_import_batches_status
  ON public.event_csv_import_batches(venue_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_csv_import_rows_queue
  ON public.event_csv_import_rows(batch_id, state, row_number);

ALTER TABLE public.event_csv_import_batches
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_csv_import_rows
  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'event_csv_import_batches'
      AND policyname = 'event_csv_import_batches_select_manager'
  ) THEN
    CREATE POLICY event_csv_import_batches_select_manager
      ON public.event_csv_import_batches
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
      AND tablename = 'event_csv_import_rows'
      AND policyname = 'event_csv_import_rows_select_manager'
  ) THEN
    CREATE POLICY event_csv_import_rows_select_manager
      ON public.event_csv_import_rows
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.event_csv_import_batches AS b
          WHERE b.id = event_csv_import_rows.batch_id
            AND public.has_venue_access(b.venue_id, 'manager')
        )
      );
  END IF;
END
$$ LANGUAGE plpgsql;

REVOKE ALL ON public.event_csv_import_batches
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.event_csv_import_rows
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.event_csv_import_batches
  TO authenticated;

GRANT SELECT ON public.event_csv_import_rows
  TO authenticated;

GRANT ALL ON public.event_csv_import_batches
  TO service_role;

GRANT ALL ON public.event_csv_import_rows
  TO service_role;


-- ------------------------------------------------------------------
-- Internal summary helper.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_event_csv_import_summary(
  p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.event_csv_import_batches%ROWTYPE;
  v_queued integer := 0;
  v_processing integer := 0;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_invalid integer := 0;
  v_duplicate integer := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  SELECT b.*
    INTO v_batch
  FROM public.event_csv_import_batches AS b
  WHERE b.id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'CSV import batch not found';
  END IF;

  SELECT
    count(*) FILTER (WHERE r.state = 'queued'),
    count(*) FILTER (WHERE r.state = 'processing'),
    count(*) FILTER (WHERE r.state = 'inserted'),
    count(*) FILTER (WHERE r.state = 'skipped'),
    count(*) FILTER (WHERE r.state = 'failed'),
    count(*) FILTER (WHERE r.state = 'invalid'),
    count(*) FILTER (WHERE r.state = 'duplicate')
  INTO
    v_queued,
    v_processing,
    v_inserted,
    v_skipped,
    v_failed,
    v_invalid,
    v_duplicate
  FROM public.event_csv_import_rows AS r
  WHERE r.batch_id = p_batch_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'row_number', e.row_number,
        'validation_code', e.validation_code,
        'validation_message', e.validation_message,
        'row', e.row_data
      )
      ORDER BY e.row_number
    ),
    '[]'::jsonb
  )
  INTO v_errors
  FROM (
    SELECT
      r.row_number,
      r.validation_code,
      r.validation_message,
      r.row_data
    FROM public.event_csv_import_rows AS r
    WHERE r.batch_id = p_batch_id
      AND r.state IN ('invalid', 'duplicate', 'failed', 'skipped')
    ORDER BY r.row_number
    LIMIT 50
  ) AS e;

  RETURN jsonb_build_object(
    'batch_id', v_batch.id,
    'venue_id', v_batch.venue_id,
    'night_id', v_batch.night_id,
    'status', v_batch.status,
    'total_rows', v_batch.total_rows,
    'valid_rows', v_batch.valid_rows,
    'invalid_rows', v_invalid,
    'duplicate_rows', v_duplicate,
    'skipped_rows', v_duplicate + v_skipped,
    'processed_rows', v_inserted + v_skipped + v_failed,
    'inserted_rows', v_inserted,
    'failed_rows', v_failed,
    'queued_rows', v_queued,
    'processing_rows', v_processing,
    'process_total', v_batch.valid_rows,
    'can_confirm', v_batch.valid_rows > 0
      AND v_batch.status IN ('previewed', 'queued', 'running', 'completed_with_errors'),
    'action_counts', v_batch.action_counts,
    'bar_counts', v_batch.bar_counts,
    'station_counts', v_batch.station_counts,
    'error_rows', v_errors,
    'last_error', v_batch.last_error,
    'created_at', v_batch.created_at,
    'started_at', v_batch.started_at,
    'completed_at', v_batch.completed_at,
    'updated_at', v_batch.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.barinv_event_csv_import_summary(uuid)
  FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------------
-- Create preview batch.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_create_event_csv_import_batch(
  p_venue_id uuid,
  p_night_id uuid,
  p_rows jsonb,
  p_original_filename text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total integer := 0;
  v_batch_id uuid;
  v_row record;
  v_row_data jsonb;

  v_status text;
  v_code text;
  v_message text;
  v_normalized jsonb;

  v_uuid_re text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_qty_re text := '^[0-9]+([.][0-9]+)?$';

  v_action text;
  v_qty_text text;
  v_qty numeric;
  v_bar_id_text text;
  v_station_id_text text;
  v_item_id_text text;
  v_staff_id_text text;
  v_session_id_text text;
  v_client_event_id text;
  v_notes text;
  v_submitted_by text;
  v_reason_code text;
  v_qty_basis text;
  v_source text;
  v_supplied_status text;
  v_event_id_text text;
  v_venue_id_text text;
  v_night_id_text text;

  v_bar_id uuid;
  v_station_id uuid;
  v_item_id uuid;
  v_staff_id uuid;
  v_session_id uuid;
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

  IF p_night_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.nights AS n
       WHERE n.id = p_night_id
         AND n.venue_id = p_venue_id
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A valid Night from this Venue is required';
  END IF;

  IF p_rows IS NULL
     OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CSV rows must be supplied as a JSON array';
  END IF;

  v_total := jsonb_array_length(p_rows);

  IF v_total > 5000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CSV imports support at most 5000 data rows';
  END IF;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'batch_id', NULL,
      'venue_id', p_venue_id,
      'night_id', p_night_id,
      'status', 'empty',
      'total_rows', 0,
      'valid_rows', 0,
      'invalid_rows', 0,
      'duplicate_rows', 0,
      'skipped_rows', 0,
      'processed_rows', 0,
      'inserted_rows', 0,
      'failed_rows', 0,
      'queued_rows', 0,
      'processing_rows', 0,
      'process_total', 0,
      'can_confirm', false,
      'action_counts', '{}'::jsonb,
      'bar_counts', '[]'::jsonb,
      'station_counts', '[]'::jsonb,
      'error_rows', '[]'::jsonb,
      'message', 'No data rows found'
    );
  END IF;

  INSERT INTO public.event_csv_import_batches (
    venue_id,
    night_id,
    original_filename,
    created_by,
    total_rows
  ) VALUES (
    p_venue_id,
    p_night_id,
    NULLIF(left(COALESCE(p_original_filename, ''), 240), ''),
    auth.uid(),
    v_total
  )
  RETURNING id INTO v_batch_id;

  FOR v_row IN
    SELECT
      value AS row_data,
      ordinality::integer AS row_number
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    v_row_data := COALESCE(v_row.row_data, '{}'::jsonb);
    v_status := 'queued';
    v_code := NULL;
    v_message := NULL;
    v_normalized := '{}'::jsonb;

    IF jsonb_typeof(v_row_data) <> 'object' THEN
      v_status := 'invalid';
      v_code := 'row_not_object';
      v_message := 'CSV row must be an object';
    END IF;

    v_action := upper(btrim(COALESCE(v_row_data ->> 'action', '')));
    v_qty_text := btrim(COALESCE(v_row_data ->> 'qty', ''));
    v_bar_id_text := NULLIF(btrim(COALESCE(v_row_data ->> 'bar_id', '')), '');
    v_station_id_text := NULLIF(btrim(COALESCE(v_row_data ->> 'station_id', '')), '');
    v_item_id_text := NULLIF(btrim(COALESCE(v_row_data ->> 'item_id', '')), '');
    v_staff_id_text := NULLIF(btrim(COALESCE(v_row_data ->> 'staff_id', '')), '');
    v_session_id_text := NULLIF(btrim(COALESCE(v_row_data ->> 'session_id', '')), '');
    v_client_event_id := NULLIF(btrim(COALESCE(v_row_data ->> 'client_event_id', '')), '');
    v_notes := NULLIF(btrim(COALESCE(v_row_data ->> 'notes', '')), '');
    v_submitted_by := NULLIF(btrim(COALESCE(v_row_data ->> 'submitted_by', '')), '');
    v_reason_code := NULLIF(btrim(COALESCE(v_row_data ->> 'reason_code', '')), '');
    v_qty_basis := NULLIF(lower(btrim(COALESCE(v_row_data ->> 'qty_basis', ''))), '');
    v_source := NULLIF(btrim(COALESCE(v_row_data ->> 'source', '')), '');
    v_supplied_status := NULLIF(btrim(COALESCE(v_row_data ->> 'status', '')), '');
    v_event_id_text := NULLIF(btrim(COALESCE(v_row_data ->> 'event_id', '')), '');
    v_venue_id_text := NULLIF(btrim(COALESCE(v_row_data ->> 'venue_id', '')), '');
    v_night_id_text := NULLIF(btrim(COALESCE(v_row_data ->> 'night_id', '')), '');

    v_bar_id := NULL;
    v_station_id := NULL;
    v_item_id := NULL;
    v_staff_id := NULL;
    v_session_id := NULL;
    v_qty := NULL;

    IF v_status = 'queued' AND v_event_id_text IS NOT NULL THEN
      v_status := 'invalid';
      v_code := 'event_id_not_allowed';
      v_message := 'CSV import cannot update existing Events';
    ELSIF v_status = 'queued' AND v_source IS NOT NULL THEN
      v_status := 'invalid';
      v_code := 'source_not_allowed';
      v_message := 'CSV import source is assigned by the server';
    ELSIF v_status = 'queued' AND v_supplied_status IS NOT NULL THEN
      v_status := 'invalid';
      v_code := 'status_not_allowed';
      v_message := 'CSV import always creates PENDING Events';
    ELSIF v_status = 'queued'
          AND v_venue_id_text IS NOT NULL
          AND v_venue_id_text <> p_venue_id::text THEN
      v_status := 'invalid';
      v_code := 'cross_venue';
      v_message := 'CSV row Venue does not match the selected Venue';
    ELSIF v_status = 'queued'
          AND v_night_id_text IS NOT NULL
          AND v_night_id_text <> p_night_id::text THEN
      v_status := 'invalid';
      v_code := 'cross_night';
      v_message := 'CSV row Night does not match the selected Night';
    ELSIF v_status = 'queued'
          AND v_action NOT IN (
            'REQUEST',
            'DELIVERED',
            'RETURNED',
            'ADJUSTMENT',
            'COMP',
            'SHOT',
            'PROMO',
            'WASTE',
            'BREAKAGE'
          ) THEN
      v_status := 'invalid';
      v_code := 'invalid_action';
      v_message := 'Action is not supported by BARINV Events';
    ELSIF v_status = 'queued'
          AND (
            v_qty_text = ''
            OR v_qty_text !~ v_qty_re
          ) THEN
      v_status := 'invalid';
      v_code := 'invalid_qty';
      v_message := 'Quantity must be a positive decimal number';
    END IF;

    IF v_status = 'queued' THEN
      v_qty := v_qty_text::numeric;
      IF v_qty <= 0 OR v_qty > 1000000 THEN
        v_status := 'invalid';
        v_code := 'invalid_qty';
        v_message := 'Quantity must be greater than 0 and at most 1000000';
      END IF;
    END IF;

    IF v_status = 'queued'
       AND v_qty_basis IS NOT NULL
       AND v_qty_basis NOT IN ('shot', 'item_unit') THEN
      v_status := 'invalid';
      v_code := 'invalid_qty_basis';
      v_message := 'qty_basis must be shot or item_unit';
    END IF;

    IF v_status = 'queued'
       AND (
         COALESCE(v_notes, '') ~ '^[[:space:]]*[=+@-]'
         OR COALESCE(v_submitted_by, '') ~ '^[[:space:]]*[=+@-]'
         OR COALESCE(v_reason_code, '') ~ '^[[:space:]]*[=+@-]'
       ) THEN
      v_status := 'invalid';
      v_code := 'dangerous_text';
      v_message := 'Text fields cannot begin with =, +, -, or @';
    END IF;

    IF v_status = 'queued'
       AND (
         length(COALESCE(v_notes, '')) > 1000
         OR length(COALESCE(v_submitted_by, '')) > 160
         OR length(COALESCE(v_reason_code, '')) > 80
         OR length(COALESCE(v_client_event_id, '')) > 200
       ) THEN
      v_status := 'invalid';
      v_code := 'text_too_long';
      v_message := 'One or more text fields exceeds the CSV import limit';
    END IF;

    IF v_status = 'queued'
       AND (
         v_bar_id_text IS NULL
         OR v_bar_id_text !~ v_uuid_re
       ) THEN
      v_status := 'invalid';
      v_code := 'invalid_bar_id';
      v_message := 'bar_id must be a valid UUID';
    ELSIF v_status = 'queued' THEN
      v_bar_id := v_bar_id_text::uuid;
      IF NOT EXISTS (
        SELECT 1
        FROM public.bars AS b
        JOIN public.night_bars AS nb
          ON nb.bar_id = b.id
         AND nb.night_id = p_night_id
        WHERE b.id = v_bar_id
          AND b.venue_id = p_venue_id
          AND COALESCE(b.active, true) IS TRUE
      ) THEN
        v_status := 'invalid';
        v_code := 'cross_night_bar';
        v_message := 'bar_id must belong to the selected Venue and Night';
      END IF;
    END IF;

    IF v_status = 'queued'
       AND (
         v_item_id_text IS NULL
         OR v_item_id_text !~ v_uuid_re
       ) THEN
      v_status := 'invalid';
      v_code := 'invalid_item_id';
      v_message := 'item_id must be a valid UUID';
    ELSIF v_status = 'queued' THEN
      v_item_id := v_item_id_text::uuid;
      IF NOT EXISTS (
        SELECT 1
        FROM public.items AS i
        WHERE i.id = v_item_id
          AND i.venue_id = p_venue_id
          AND COALESCE(i.active, true) IS TRUE
      ) THEN
        v_status := 'invalid';
        v_code := 'cross_venue_item';
        v_message := 'item_id must belong to the selected Venue';
      END IF;
    END IF;

    IF v_status = 'queued' AND v_station_id_text IS NOT NULL THEN
      IF v_station_id_text !~ v_uuid_re THEN
        v_status := 'invalid';
        v_code := 'invalid_station_id';
        v_message := 'station_id must be a valid UUID';
      ELSE
        v_station_id := v_station_id_text::uuid;
        IF NOT EXISTS (
          SELECT 1
          FROM public.stations AS s
          WHERE s.id = v_station_id
            AND s.venue_id = p_venue_id
            AND s.bar_id = v_bar_id
            AND COALESCE(s.active, true) IS TRUE
        ) THEN
          v_status := 'invalid';
          v_code := 'cross_venue_station';
          v_message := 'station_id must belong to the selected Venue and Bar';
        END IF;
      END IF;
    END IF;

    IF v_status = 'queued' AND v_staff_id_text IS NOT NULL THEN
      IF v_staff_id_text !~ v_uuid_re THEN
        v_status := 'invalid';
        v_code := 'invalid_staff_id';
        v_message := 'staff_id must be a valid UUID';
      ELSE
        v_staff_id := v_staff_id_text::uuid;
        IF NOT EXISTS (
          SELECT 1
          FROM public.staff AS st
          WHERE st.id = v_staff_id
            AND st.venue_id = p_venue_id
            AND COALESCE(st.active, true) IS TRUE
        ) THEN
          v_status := 'invalid';
          v_code := 'cross_venue_staff';
          v_message := 'staff_id must belong to the selected Venue';
        END IF;
      END IF;
    END IF;

    IF v_status = 'queued' AND v_session_id_text IS NOT NULL THEN
      IF v_session_id_text !~ v_uuid_re THEN
        v_status := 'invalid';
        v_code := 'invalid_session_id';
        v_message := 'session_id must be a valid UUID';
      ELSE
        v_session_id := v_session_id_text::uuid;
        IF NOT EXISTS (
          SELECT 1
          FROM public.barback_sessions AS bs
          WHERE bs.id = v_session_id
            AND bs.venue_id = p_venue_id
            AND bs.night_id = p_night_id
        ) THEN
          v_status := 'invalid';
          v_code := 'cross_scope_session';
          v_message := 'session_id must belong to the selected Venue and Night';
        END IF;
      END IF;
    END IF;

    IF v_status = 'queued' AND v_client_event_id IS NULL THEN
      v_client_event_id :=
        'admin_csv_import:' ||
        md5(
          jsonb_build_object(
            'venue_id', p_venue_id,
            'night_id', p_night_id,
            'row_number', v_row.row_number,
            'bar_id', v_bar_id,
            'station_id', v_station_id,
            'item_id', v_item_id,
            'staff_id', v_staff_id,
            'session_id', v_session_id,
            'action', v_action,
            'qty', v_qty_text,
            'qty_basis', v_qty_basis,
            'reason_code', v_reason_code,
            'notes', v_notes,
            'submitted_by', v_submitted_by
          )::text
        );
    END IF;

    IF v_status = 'queued'
       AND EXISTS (
         SELECT 1
         FROM public.event_csv_import_rows AS r
         WHERE r.batch_id = v_batch_id
           AND r.client_event_id = v_client_event_id
           AND r.state = 'queued'
       ) THEN
      v_status := 'duplicate';
      v_code := 'duplicate_in_file';
      v_message := 'client_event_id appears more than once in this CSV';
    ELSIF v_status = 'queued'
          AND EXISTS (
            SELECT 1
            FROM public.events AS e
            WHERE e.client_event_id = v_client_event_id
          ) THEN
      v_status := 'duplicate';
      v_code := 'duplicate_existing';
      v_message := 'client_event_id already exists; row will be skipped';
    END IF;

    IF v_status = 'queued' THEN
      v_normalized := jsonb_build_object(
        'venue_id', p_venue_id,
        'night_id', p_night_id,
        'bar_id', v_bar_id,
        'station_id', v_station_id,
        'item_id', v_item_id,
        'staff_id', v_staff_id,
        'session_id', v_session_id,
        'client_event_id', v_client_event_id,
        'action', v_action,
        'qty', v_qty_text,
        'qty_basis', v_qty_basis,
        'reason_code', v_reason_code,
        'notes', v_notes,
        'submitted_by', v_submitted_by
      );
    END IF;

    INSERT INTO public.event_csv_import_rows (
      batch_id,
      row_number,
      row_data,
      normalized,
      client_event_id,
      state,
      validation_code,
      validation_message
    ) VALUES (
      v_batch_id,
      v_row.row_number,
      v_row_data,
      v_normalized,
      v_client_event_id,
      v_status,
      v_code,
      v_message
    );
  END LOOP;

  WITH counts AS (
    SELECT
      count(*) FILTER (WHERE state = 'queued') AS valid_count,
      count(*) FILTER (WHERE state = 'invalid') AS invalid_count,
      count(*) FILTER (WHERE state = 'duplicate') AS duplicate_count
    FROM public.event_csv_import_rows
    WHERE batch_id = v_batch_id
  ),
  actions AS (
    SELECT COALESCE(jsonb_object_agg(action, row_count), '{}'::jsonb) AS action_counts
    FROM (
      SELECT normalized ->> 'action' AS action, count(*) AS row_count
      FROM public.event_csv_import_rows
      WHERE batch_id = v_batch_id
        AND state = 'queued'
      GROUP BY normalized ->> 'action'
    ) AS grouped
  ),
  bars AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'bar_id', grouped.bar_id,
        'bar_name', b.name,
        'rows', grouped.row_count
      )
      ORDER BY b.name
    ), '[]'::jsonb) AS bar_counts
    FROM (
      SELECT (normalized ->> 'bar_id')::uuid AS bar_id, count(*) AS row_count
      FROM public.event_csv_import_rows
      WHERE batch_id = v_batch_id
        AND state = 'queued'
      GROUP BY normalized ->> 'bar_id'
    ) AS grouped
    JOIN public.bars AS b
      ON b.id = grouped.bar_id
  ),
  stations AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'station_id', grouped.station_id,
        'station_name', COALESCE(s.name, 'No Station'),
        'rows', grouped.row_count
      )
      ORDER BY COALESCE(s.name, 'No Station')
    ), '[]'::jsonb) AS station_counts
    FROM (
      SELECT NULLIF(normalized ->> 'station_id', '')::uuid AS station_id,
             count(*) AS row_count
      FROM public.event_csv_import_rows
      WHERE batch_id = v_batch_id
        AND state = 'queued'
      GROUP BY NULLIF(normalized ->> 'station_id', '')::uuid
    ) AS grouped
    LEFT JOIN public.stations AS s
      ON s.id = grouped.station_id
  ),
  errors AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'row_number', e.row_number,
        'validation_code', e.validation_code,
        'validation_message', e.validation_message,
        'row', e.row_data
      )
      ORDER BY e.row_number
    ), '[]'::jsonb) AS error_sample
    FROM (
      SELECT
        row_number,
        validation_code,
        validation_message,
        row_data
      FROM public.event_csv_import_rows
      WHERE batch_id = v_batch_id
        AND state IN ('invalid', 'duplicate')
      ORDER BY row_number
      LIMIT 50
    ) AS e
  )
  UPDATE public.event_csv_import_batches AS b
     SET valid_rows = counts.valid_count,
         invalid_rows = counts.invalid_count,
         duplicate_rows = counts.duplicate_count,
         skipped_rows = counts.duplicate_count,
         action_counts = actions.action_counts,
         bar_counts = bars.bar_counts,
         station_counts = stations.station_counts,
         error_sample = errors.error_sample,
         status = CASE
           WHEN counts.valid_count > 0 THEN 'previewed'
           ELSE 'completed_with_errors'
         END,
         updated_at = now()
    FROM counts, actions, bars, stations, errors
   WHERE b.id = v_batch_id;

  RETURN public.barinv_event_csv_import_summary(v_batch_id);
END;
$$;


-- ------------------------------------------------------------------
-- Process one bounded import batch.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_process_event_csv_import_batch(
  p_batch_id uuid,
  p_batch_size integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.event_csv_import_batches%ROWTYPE;
  v_item record;
  v_norm jsonb;
  v_event_id uuid;
  v_batch_size integer :=
    LEAST(GREATEST(COALESCE(p_batch_size, 250), 1), 500);
  v_queued integer := 0;
  v_processing integer := 0;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_status text;
  v_last_error text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  SELECT b.*
    INTO v_batch
  FROM public.event_csv_import_batches AS b
  WHERE b.id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'CSV import batch not found';
  END IF;

  IF NOT public.has_venue_access(v_batch.venue_id, 'manager') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Manager access required for this import batch';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_batch_id::text, 17)
  );

  SELECT b.*
    INTO v_batch
  FROM public.event_csv_import_batches AS b
  WHERE b.id = p_batch_id
  FOR UPDATE;

  IF v_batch.status IN ('completed', 'cancelled') THEN
    RETURN public.barinv_event_csv_import_summary(p_batch_id);
  END IF;

  IF v_batch.valid_rows <= 0 THEN
    UPDATE public.event_csv_import_batches
       SET status = 'completed_with_errors',
           completed_at = COALESCE(completed_at, now()),
           updated_at = now()
     WHERE id = p_batch_id;

    RETURN public.barinv_event_csv_import_summary(p_batch_id);
  END IF;

  UPDATE public.event_csv_import_batches
     SET status = 'running',
         started_at = COALESCE(started_at, now()),
         completed_at = NULL,
         updated_at = now()
   WHERE id = p_batch_id;

  FOR v_item IN
    SELECT
      r.row_number,
      r.normalized,
      r.client_event_id
    FROM public.event_csv_import_rows AS r
    WHERE r.batch_id = p_batch_id
      AND r.state = 'queued'
    ORDER BY r.row_number
    LIMIT v_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.event_csv_import_rows
       SET state = 'processing',
           attempt_count = attempt_count + 1,
           validation_code = NULL,
           validation_message = NULL,
           processed_at = NULL
     WHERE batch_id = p_batch_id
       AND row_number = v_item.row_number;

    BEGIN
      v_norm := v_item.normalized;
      v_event_id := NULL;

      SELECT e.id
        INTO v_event_id
      FROM public.events AS e
      WHERE e.client_event_id = v_item.client_event_id
      LIMIT 1;

      IF v_event_id IS NOT NULL THEN
        UPDATE public.event_csv_import_rows
           SET state = 'skipped',
               event_id = v_event_id,
               validation_code = 'duplicate_existing',
               validation_message = 'client_event_id already exists; row skipped',
               processed_at = now()
         WHERE batch_id = p_batch_id
           AND row_number = v_item.row_number;
      ELSE
        INSERT INTO public.events (
          venue_id,
          night_id,
          bar_id,
          station_id,
          item_id,
          staff_id,
          session_id,
          client_event_id,
          submitted_by,
          action,
          qty,
          status,
          notes,
          reason_code,
          qty_basis,
          source
        ) VALUES (
          v_batch.venue_id,
          v_batch.night_id,
          (v_norm ->> 'bar_id')::uuid,
          NULLIF(v_norm ->> 'station_id', '')::uuid,
          (v_norm ->> 'item_id')::uuid,
          NULLIF(v_norm ->> 'staff_id', '')::uuid,
          NULLIF(v_norm ->> 'session_id', '')::uuid,
          v_item.client_event_id,
          COALESCE(
            NULLIF(v_norm ->> 'submitted_by', ''),
            NULLIF(auth.jwt() ->> 'email', ''),
            'CSV Import'
          ),
          v_norm ->> 'action',
          (v_norm ->> 'qty')::numeric,
          'PENDING',
          NULLIF(v_norm ->> 'notes', ''),
          NULLIF(v_norm ->> 'reason_code', ''),
          NULLIF(v_norm ->> 'qty_basis', ''),
          'admin_csv_import'
        )
        RETURNING id INTO v_event_id;

        UPDATE public.event_csv_import_rows
           SET state = 'inserted',
               event_id = v_event_id,
               processed_at = now()
         WHERE batch_id = p_batch_id
           AND row_number = v_item.row_number;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT e.id
          INTO v_event_id
        FROM public.events AS e
        WHERE e.client_event_id = v_item.client_event_id
        LIMIT 1;

        UPDATE public.event_csv_import_rows
           SET state = 'skipped',
               event_id = v_event_id,
               validation_code = 'duplicate_existing',
               validation_message = 'client_event_id already exists; row skipped',
               processed_at = now()
         WHERE batch_id = p_batch_id
           AND row_number = v_item.row_number;

      WHEN OTHERS THEN
        UPDATE public.event_csv_import_rows
           SET state = 'failed',
               validation_code = 'insert_failed',
               validation_message = left(SQLERRM, 240),
               processed_at = now()
         WHERE batch_id = p_batch_id
           AND row_number = v_item.row_number;
    END;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE r.state = 'queued'),
    count(*) FILTER (WHERE r.state = 'processing'),
    count(*) FILTER (WHERE r.state = 'inserted'),
    count(*) FILTER (WHERE r.state = 'skipped'),
    count(*) FILTER (WHERE r.state = 'failed')
  INTO
    v_queued,
    v_processing,
    v_inserted,
    v_skipped,
    v_failed
  FROM public.event_csv_import_rows AS r
  WHERE r.batch_id = p_batch_id;

  v_status := CASE
    WHEN v_queued + v_processing > 0 THEN 'running'
    WHEN v_failed > 0 THEN 'completed_with_errors'
    ELSE 'completed'
  END;

  SELECT left(r.validation_message, 240)
    INTO v_last_error
  FROM public.event_csv_import_rows AS r
  WHERE r.batch_id = p_batch_id
    AND r.state = 'failed'
  ORDER BY r.row_number
  LIMIT 1;

  UPDATE public.event_csv_import_batches
     SET status = v_status,
         processed_rows = v_inserted + v_skipped + v_failed,
         inserted_rows = v_inserted,
         skipped_rows = duplicate_rows + v_skipped,
         failed_rows = v_failed,
         last_error = v_last_error,
         completed_at = CASE
           WHEN v_status IN ('completed', 'completed_with_errors')
             THEN COALESCE(completed_at, now())
           ELSE NULL
         END,
         updated_at = now()
   WHERE id = p_batch_id;

  RETURN public.barinv_event_csv_import_summary(p_batch_id);
END;
$$;


-- ------------------------------------------------------------------
-- Read import batch.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_get_event_csv_import_batch(
  p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.event_csv_import_batches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  SELECT b.*
    INTO v_batch
  FROM public.event_csv_import_batches AS b
  WHERE b.id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'CSV import batch not found';
  END IF;

  IF NOT public.has_venue_access(v_batch.venue_id, 'manager') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Manager access required for this import batch';
  END IF;

  RETURN public.barinv_event_csv_import_summary(p_batch_id);
END;
$$;


-- ------------------------------------------------------------------
-- Retry only failed rows.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_retry_event_csv_import_failures(
  p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch public.event_csv_import_batches%ROWTYPE;
  v_requeued integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  SELECT b.*
    INTO v_batch
  FROM public.event_csv_import_batches AS b
  WHERE b.id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'CSV import batch not found';
  END IF;

  IF NOT public.has_venue_access(v_batch.venue_id, 'manager') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Manager access required for this import batch';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_batch_id::text, 17)
  );

  UPDATE public.event_csv_import_rows
     SET state = 'queued',
         validation_code = NULL,
         validation_message = NULL,
         processed_at = NULL
   WHERE batch_id = p_batch_id
     AND state = 'failed';

  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  UPDATE public.event_csv_import_batches
     SET status = CASE
           WHEN v_requeued > 0 THEN 'queued'
           ELSE status
         END,
         failed_rows = GREATEST(failed_rows - v_requeued, 0),
         processed_rows = GREATEST(processed_rows - v_requeued, 0),
         last_error = CASE
           WHEN v_requeued > 0 THEN NULL
           ELSE last_error
         END,
         completed_at = CASE
           WHEN v_requeued > 0 THEN NULL
           ELSE completed_at
         END,
         updated_at = now()
   WHERE id = p_batch_id;

  RETURN public.barinv_event_csv_import_summary(p_batch_id)
    || jsonb_build_object('requeued', v_requeued);
END;
$$;


-- ------------------------------------------------------------------
-- Export one safely bounded CSV page with exact numeric text.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_export_events_csv_page(
  p_venue_id uuid,
  p_night_id uuid,
  p_bar_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_event_ids uuid[] DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text := NULLIF(upper(btrim(COALESCE(p_status, ''))), '');
  v_action text := NULLIF(upper(btrim(COALESCE(p_action, ''))), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_requested integer := 0;
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

  IF p_night_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.nights AS n
       WHERE n.id = p_night_id
         AND n.venue_id = p_venue_id
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A valid Night from this Venue is required';
  END IF;

  IF v_status IS NOT NULL
     AND v_status NOT IN ('PENDING', 'APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Status filter is not supported';
  END IF;

  IF v_action IS NOT NULL
     AND v_action NOT IN (
       'REQUEST',
       'DELIVERED',
       'RETURNED',
       'ADJUSTMENT',
       'COMP',
       'SHOT',
       'PROMO',
       'WASTE',
       'BREAKAGE'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Action filter is not supported';
  END IF;

  IF p_event_ids IS NOT NULL THEN
    SELECT count(DISTINCT supplied_id)
      INTO v_requested
    FROM unnest(p_event_ids) AS supplied(supplied_id);

    IF v_requested > 5000 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'A maximum of 5000 explicit Event IDs is allowed for CSV export';
    END IF;
  END IF;

  WITH matched AS (
    SELECT e.id
    FROM public.events AS e
    WHERE e.venue_id = p_venue_id
      AND e.night_id = p_night_id
      AND (
        p_event_ids IS NULL
        OR e.id = ANY(p_event_ids)
      )
      AND (
        p_bar_id IS NULL
        OR e.bar_id = p_bar_id
      )
      AND (
        v_status IS NULL
        OR e.status = v_status
      )
      AND (
        v_action IS NULL
        OR e.action = v_action
      )
  )
  SELECT count(*)
    INTO v_total
  FROM matched;

  WITH matched AS (
    SELECT e.*
    FROM public.events AS e
    WHERE e.venue_id = p_venue_id
      AND e.night_id = p_night_id
      AND (
        p_event_ids IS NULL
        OR e.id = ANY(p_event_ids)
      )
      AND (
        p_bar_id IS NULL
        OR e.bar_id = p_bar_id
      )
      AND (
        v_status IS NULL
        OR e.status = v_status
      )
      AND (
        v_action IS NULL
        OR e.action = v_action
      )
    ORDER BY e.created_at DESC, e.id
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event_id', m.id,
        'created_at', m.created_at,
        'venue_id', m.venue_id,
        'venue_name', v.name,
        'night_id', m.night_id,
        'night_name', n.name,
        'bar_id', m.bar_id,
        'bar_name', b.name,
        'station_id', m.station_id,
        'station_name', s.name,
        'item_id', m.item_id,
        'item_name', i.name,
        'action', m.action,
        'qty', m.qty::text,
        'status', m.status,
        'reason_code', m.reason_code,
        'qty_basis', m.qty_basis,
        'notes', m.notes,
        'submitted_by', m.submitted_by,
        'staff_id', m.staff_id,
        'staff_name', st.name,
        'session_id', m.session_id,
        'source', m.source,
        'client_event_id', m.client_event_id
      )
      ORDER BY m.created_at DESC, m.id
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM matched AS m
  JOIN public.venues AS v
    ON v.id = m.venue_id
  JOIN public.nights AS n
    ON n.id = m.night_id
  LEFT JOIN public.bars AS b
    ON b.id = m.bar_id
  LEFT JOIN public.stations AS s
    ON s.id = m.station_id
  LEFT JOIN public.items AS i
    ON i.id = m.item_id
  LEFT JOIN public.staff AS st
    ON st.id = m.staff_id;

  RETURN jsonb_build_object(
    'total_rows', v_total,
    'returned_rows', jsonb_array_length(v_rows),
    'limit', v_limit,
    'offset', v_offset,
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.barinv_create_event_csv_import_batch(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.barinv_process_event_csv_import_batch(uuid, integer)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.barinv_get_event_csv_import_batch(uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.barinv_retry_event_csv_import_failures(uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.barinv_export_events_csv_page(uuid, uuid, uuid, text, text, uuid[], integer, integer)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.barinv_create_event_csv_import_batch(uuid, uuid, jsonb, text)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_process_event_csv_import_batch(uuid, integer)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_get_event_csv_import_batch(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_retry_event_csv_import_failures(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_export_events_csv_page(uuid, uuid, uuid, text, text, uuid[], integer, integer)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_create_event_csv_import_batch(uuid, uuid, jsonb, text)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.barinv_process_event_csv_import_batch(uuid, integer)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.barinv_get_event_csv_import_batch(uuid)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.barinv_retry_event_csv_import_failures(uuid)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.barinv_export_events_csv_page(uuid, uuid, uuid, text, text, uuid[], integer, integer)
  TO service_role;

COMMENT ON TABLE public.event_csv_import_batches IS
  'Durable manager-scoped preview/process state for Admin Events CSV imports.';

COMMENT ON TABLE public.event_csv_import_rows IS
  'Per-row CSV import validation and processing state. Successful rows insert PENDING Events only.';

COMMENT ON FUNCTION public.barinv_create_event_csv_import_batch(uuid, uuid, jsonb, text) IS
  'Validates Admin Events CSV rows and creates a durable preview batch. Does not insert Events.';

COMMENT ON FUNCTION public.barinv_process_event_csv_import_batch(uuid, integer) IS
  'Processes at most 500 queued CSV import rows into PENDING Events.';

COMMENT ON FUNCTION public.barinv_retry_event_csv_import_failures(uuid) IS
  'Requeues only failed CSV import rows for a previously created batch.';

COMMENT ON FUNCTION public.barinv_export_events_csv_page(uuid, uuid, uuid, text, text, uuid[], integer, integer) IS
  'Returns one manager-authorized, Venue/Night-scoped Events export page with quantity preserved as text.';

NOTIFY pgrst, 'reload schema';

COMMIT;

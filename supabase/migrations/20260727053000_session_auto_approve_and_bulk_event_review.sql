-- BARINV PRO
-- Session-controlled Auto-Approve + audited bulk event review
--
-- LOCAL AUTHORING ONLY.
-- Do not apply to production without a separately approved migration step.
--
-- Safety:
--   * Barback clients still submit PENDING.
--   * Server trigger decides whether a valid session may auto-approve.
--   * Manual single/bulk review uses one manager-authorized RPC.
--   * Only PENDING rows can transition.
--   * All transitions are recorded in event_review_audit.

BEGIN;

ALTER TABLE public.barback_sessions
  ADD COLUMN IF NOT EXISTS auto_approve_events boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.barback_sessions.auto_approve_events IS
  'When true, valid Barback Link events belonging to this active session are changed from PENDING to APPROVED by the database before insert.';

CREATE TABLE IF NOT EXISTS public.event_review_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid
    REFERENCES public.events(id) ON DELETE SET NULL,
  venue_id        uuid NOT NULL
    REFERENCES public.venues(id) ON DELETE CASCADE,
  night_id        uuid,
  session_id      uuid,
  previous_status text,
  new_status      text NOT NULL
    CHECK (new_status IN ('APPROVED', 'REJECTED')),
  review_source   text NOT NULL
    CHECK (review_source IN (
      'session_auto',
      'manual_single',
      'manual_bulk',
      'manual_direct'
    )),
  reviewed_by     uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  reason          text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_review_audit_event
  ON public.event_review_audit(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_review_audit_venue
  ON public.event_review_audit(venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_review_scope
  ON public.events(
    venue_id,
    status,
    night_id,
    bar_id,
    action,
    created_at DESC
  );

ALTER TABLE public.event_review_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'event_review_audit'
      AND policyname = 'event_review_audit_select_v'
  ) THEN
    CREATE POLICY event_review_audit_select_v
      ON public.event_review_audit
      FOR SELECT
      TO authenticated
      USING (public.has_venue_access(venue_id, 'viewer'));
  END IF;
END
$$ LANGUAGE plpgsql;

REVOKE ALL ON public.event_review_audit
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.event_review_audit TO authenticated;
GRANT ALL ON public.event_review_audit TO service_role;


-- ------------------------------------------------------------------
-- Server-authoritative insert normalization
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_events_apply_session_auto_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.barback_sessions%ROWTYPE;
  v_request_role text := COALESCE(auth.role(), '');
BEGIN
  IF NEW.source IN ('barback_web_link', 'barback_live_pilot')
     AND NEW.session_id IS NOT NULL THEN

    -- A client must never be able to choose APPROVED by submitting it.
    NEW.status := 'PENDING';

    -- Auto-Approve is valid only for the actual Barback Link JWT role.
    -- Authenticated Admin/Staff clients cannot impersonate this pathway by
    -- supplying source/session_id fields.
    IF v_request_role <> 'barback_user' THEN
      RETURN NEW;
    END IF;

    IF NEW.staff_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT s.*
      INTO v_session
    FROM public.barback_sessions AS s
    WHERE s.id = NEW.session_id
      AND s.venue_id = NEW.venue_id
      AND s.night_id = NEW.night_id
    FOR SHARE;

    IF FOUND
       AND v_session.auto_approve_events IS TRUE
       AND v_session.revoked_at IS NULL
       AND v_session.expires_at > now()
       AND NEW.staff_id = ANY(v_session.allowed_staff)
       AND NEW.bar_id IS NOT NULL
       AND (
         NEW.bar_id = v_session.bar_id
         OR NEW.bar_id = ANY(
           COALESCE(v_session.allowed_bars, ARRAY[]::uuid[])
         )
       ) THEN
      NEW.status := 'APPROVED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_session_auto_approve
  ON public.events;

CREATE TRIGGER trg_events_session_auto_approve
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.barinv_events_apply_session_auto_approve();


CREATE OR REPLACE FUNCTION public.barinv_events_audit_session_auto_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'barback_user'
     AND NEW.status = 'APPROVED'
     AND NEW.source IN ('barback_web_link', 'barback_live_pilot')
     AND NEW.session_id IS NOT NULL
     AND NEW.staff_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.barback_sessions AS s
       WHERE s.id = NEW.session_id
         AND s.venue_id = NEW.venue_id
         AND s.night_id = NEW.night_id
         AND s.auto_approve_events IS TRUE
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND NEW.staff_id = ANY(s.allowed_staff)
         AND NEW.bar_id IS NOT NULL
         AND (
           NEW.bar_id = s.bar_id
           OR NEW.bar_id = ANY(
             COALESCE(s.allowed_bars, ARRAY[]::uuid[])
           )
         )
     ) THEN

    INSERT INTO public.event_review_audit (
      event_id,
      venue_id,
      night_id,
      session_id,
      previous_status,
      new_status,
      review_source,
      reviewed_by,
      reason,
      metadata
    ) VALUES (
      NEW.id,
      NEW.venue_id,
      NEW.night_id,
      NEW.session_id,
      'PENDING',
      'APPROVED',
      'session_auto',
      NULL,
      'Session Auto-Approve enabled',
      jsonb_build_object(
        'source', NEW.source,
        'staff_id', NEW.staff_id,
        'action', NEW.action,
        'bar_id', NEW.bar_id,
        'station_id', NEW.station_id,
        'item_id', NEW.item_id,
        'qty', NEW.qty,
        'submitted_by', NEW.submitted_by,
        'event_created_at', NEW.created_at
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_audit_session_auto_approve
  ON public.events;

CREATE TRIGGER trg_events_audit_session_auto_approve
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.barinv_events_audit_session_auto_approve();



-- ------------------------------------------------------------------
-- Existing-Event Status transition firewall
--
-- Inserts of operational Events may still begin APPROVED.
-- This guard applies only when the status of an existing row changes.
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_events_guard_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Event Venue cannot change during Status review';
  END IF;

  IF OLD.status IS DISTINCT FROM 'PENDING'
     OR NEW.status NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE =
        'Only PENDING Events may transition to APPROVED or REJECTED';
  END IF;

  IF NEW.status = 'REJECTED'
     AND NULLIF(
       current_setting('barinv.review_reason', true),
       ''
     ) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A rejection reason is required';
  END IF;

  -- Trusted server maintenance remains possible.
  IF v_role = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL
     OR NOT public.has_venue_access(OLD.venue_id, 'manager') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Manager access is required to approve or reject Events';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_guard_status_update
  ON public.events;

CREATE TRIGGER trg_events_guard_status_update
  BEFORE UPDATE OF status ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.barinv_events_guard_status_update();


CREATE OR REPLACE FUNCTION public.barinv_events_audit_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text :=
    NULLIF(
      current_setting(
        'barinv.review_source',
        true
      ),
      ''
    );

  v_reason text :=
    NULLIF(
      current_setting(
        'barinv.review_reason',
        true
      ),
      ''
    );

  v_metadata_text text :=
    NULLIF(
      current_setting(
        'barinv.review_metadata',
        true
      ),
      ''
    );

  v_metadata jsonb := '{}'::jsonb;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF v_source IS NULL
     OR v_source NOT IN (
    'manual_single',
    'manual_bulk',
    'manual_direct'
  ) THEN
    v_source := 'manual_direct';
  END IF;

  IF v_metadata_text IS NOT NULL THEN
    BEGIN
      v_metadata := v_metadata_text::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_metadata := jsonb_build_object(
        'invalid_context_metadata',
        left(v_metadata_text, 500)
      );
    END;
  END IF;

  v_metadata :=
    COALESCE(v_metadata, '{}'::jsonb)
    ||
    jsonb_build_object(
      'action', NEW.action,
      'bar_id', NEW.bar_id,
      'station_id', NEW.station_id,
      'staff_id', NEW.staff_id,
      'item_id', NEW.item_id,
      'qty', NEW.qty,
      'submitted_by', NEW.submitted_by,
      'event_created_at', NEW.created_at,
      'client_role', COALESCE(auth.role(), ''),
      'legacy_direct', v_source = 'manual_direct'
    );

  INSERT INTO public.event_review_audit (
    event_id,
    venue_id,
    night_id,
    session_id,
    previous_status,
    new_status,
    review_source,
    reviewed_by,
    reason,
    metadata
  ) VALUES (
    NEW.id,
    NEW.venue_id,
    NEW.night_id,
    NEW.session_id,
    OLD.status,
    NEW.status,
    v_source,
    auth.uid(),
    v_reason,
    v_metadata
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_audit_status_update
  ON public.events;

CREATE TRIGGER trg_events_audit_status_update
  AFTER UPDATE OF status ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.barinv_events_audit_status_update();

-- ------------------------------------------------------------------
-- Bulk/single review preview
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_preview_event_review(
  p_venue_id uuid,
  p_event_ids uuid[] DEFAULT NULL,
  p_night_id uuid DEFAULT NULL,
  p_bar_id uuid DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
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

  IF p_event_ids IS NULL AND p_night_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A Night selection is required for all-matching review';
  END IF;

  IF p_event_ids IS NOT NULL
     AND cardinality(p_event_ids) > 1
     AND p_night_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A Night selection is required for multi-event review';
  END IF;

  WITH scoped AS MATERIALIZED (
    SELECT
      e.id,
      e.action,
      e.bar_id,
      e.station_id
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
  )
  SELECT jsonb_build_object(
    'total',
    (SELECT count(*) FROM scoped),

    'action_counts',
    COALESCE((
      SELECT jsonb_object_agg(action, event_count)
      FROM (
        SELECT
          COALESCE(action, 'UNKNOWN') AS action,
          count(*) AS event_count
        FROM scoped
        GROUP BY COALESCE(action, 'UNKNOWN')
      ) AS action_summary
    ), '{}'::jsonb),

    'bar_counts',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', bar_id,
          'label', label,
          'count', event_count
        )
        ORDER BY event_count DESC, label
      )
      FROM (
        SELECT
          s.bar_id,
          COALESCE(b.name, 'No Bar') AS label,
          count(*) AS event_count
        FROM scoped AS s
        LEFT JOIN public.bars AS b
          ON b.id = s.bar_id
        GROUP BY s.bar_id, COALESCE(b.name, 'No Bar')
        ORDER BY event_count DESC
        LIMIT 25
      ) AS bar_summary
    ), '[]'::jsonb),

    'station_counts',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', station_id,
          'label', label,
          'count', event_count
        )
        ORDER BY event_count DESC, label
      )
      FROM (
        SELECT
          s.station_id,
          COALESCE(st.name, 'No Station') AS label,
          count(*) AS event_count
        FROM scoped AS s
        LEFT JOIN public.stations AS st
          ON st.id = s.station_id
        GROUP BY s.station_id, COALESCE(st.name, 'No Station')
        ORDER BY event_count DESC
        LIMIT 25
      ) AS station_summary
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;


-- ------------------------------------------------------------------
-- Shared idempotent single/bulk transition
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.barinv_review_events(
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
  v_target_status text := upper(trim(COALESCE(p_target_status, '')));
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_requested integer := 0;
  v_eligible integer := 0;
  v_updated integer := 0;
  v_audited integer := 0;
  v_review_source text;
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

  IF p_event_ids IS NOT NULL
     AND cardinality(p_event_ids) > 5000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A maximum of 5000 explicit event IDs may be reviewed at once';
  END IF;

  IF p_event_ids IS NULL AND p_night_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A Night selection is required for all-matching review';
  END IF;

  IF p_event_ids IS NOT NULL
     AND cardinality(p_event_ids) > 1
     AND p_night_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A Night selection is required for multi-event review';
  END IF;

  IF p_event_ids IS NULL THEN
    SELECT count(*)
      INTO v_requested
    FROM public.events AS e
    WHERE e.venue_id = p_venue_id
      AND e.status = 'PENDING'
      AND (p_night_id IS NULL OR e.night_id = p_night_id)
      AND (p_bar_id IS NULL OR e.bar_id = p_bar_id)
      AND (p_action IS NULL OR e.action = p_action)
      AND (p_staff_id IS NULL OR e.staff_id = p_staff_id);

    v_review_source := 'manual_bulk';
  ELSE
    SELECT count(DISTINCT event_id)
      INTO v_requested
    FROM unnest(p_event_ids) AS event_id;

    v_review_source := CASE
      WHEN v_requested = 1 THEN 'manual_single'
      ELSE 'manual_bulk'
    END;
  END IF;

  PERFORM set_config(
    'barinv.review_source',
    v_review_source,
    true
  );

  PERFORM set_config(
    'barinv.review_reason',
    COALESCE(v_reason, ''),
    true
  );

  PERFORM set_config(
    'barinv.review_metadata',
    jsonb_build_object(
      'filter_mode',
        CASE
          WHEN p_event_ids IS NULL
          THEN 'all_matching'
          ELSE 'explicit_ids'
        END,
      'night_filter', p_night_id,
      'bar_filter', p_bar_id,
      'action_filter', p_action,
      'staff_filter', p_staff_id
    )::text,
    true
  );

  WITH candidates AS MATERIALIZED (
    SELECT
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
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.events AS e
       SET status = v_target_status
      FROM candidates AS c
     WHERE e.id = c.id
    RETURNING e.id
  )
  SELECT
    (SELECT count(*) FROM candidates),
    (SELECT count(*) FROM updated),
    (SELECT count(*) FROM updated)
  INTO
    v_eligible,
    v_updated,
    v_audited;

  RETURN jsonb_build_object(
    'requested', v_requested,
    'eligible', v_eligible,
    'updated', v_updated,
    'audited', v_audited,
    'skipped', GREATEST(v_requested - v_updated, 0),
    'failed', 0,
    'target_status', v_target_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.barinv_preview_event_review(
  uuid, uuid[], uuid, uuid, text, uuid
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.barinv_review_events(
  uuid, text, uuid[], uuid, uuid, text, uuid, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.barinv_preview_event_review(
  uuid, uuid[], uuid, uuid, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.barinv_review_events(
  uuid, text, uuid[], uuid, uuid, text, uuid, text
) TO authenticated;

COMMENT ON FUNCTION public.barinv_review_events(
  uuid, text, uuid[], uuid, uuid, text, uuid, text
) IS
  'Manager-only idempotent transition of PENDING events to APPROVED or REJECTED with one audit row per event.';

COMMIT;

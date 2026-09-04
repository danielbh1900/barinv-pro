-- BARINV PRO: transactional selected-event voiding.
-- Allows PENDING or APPROVED -> REJECTED only for this RPC.

BEGIN;

CREATE OR REPLACE FUNCTION public.barinv_events_guard_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_void_source text := NULLIF(current_setting('barinv.void_source', true), '');
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Event Venue cannot change during Status review';
  END IF;

  IF NOT (
    OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED')
  ) AND NOT (
    OLD.status = 'APPROVED' AND NEW.status = 'REJECTED' AND v_void_source = 'event_void'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only PENDING Events may transition to APPROVED or REJECTED, except approved-event voiding';
  END IF;

  IF NEW.status = 'REJECTED'
     AND NULLIF(current_setting('barinv.review_reason', true), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A rejection reason is required';
  END IF;

  IF v_role = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.has_venue_access(OLD.venue_id, 'manager') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Manager access is required to approve or reject Events';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.barinv_void_events(
  p_venue_id uuid,
  p_event_ids uuid[],
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_requested integer := 0;
  v_found integer := 0;
  v_allowed integer := 0;
  v_updated integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
  END IF;
  IF NOT public.has_venue_access(p_venue_id, 'manager') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Manager access required for this venue';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A void reason is required';
  END IF;
  SELECT count(*) INTO v_requested
  FROM (SELECT DISTINCT event_id FROM unnest(p_event_ids) AS event_id) AS requested;
  IF v_requested = 0 OR v_requested > 5000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Provide between 1 and 5000 selected event IDs';
  END IF;

  WITH requested AS (
    SELECT DISTINCT event_id FROM unnest(p_event_ids) AS event_id
  ), locked AS MATERIALIZED (
    SELECT e.id, e.status
    FROM public.events AS e
    JOIN requested AS r ON r.event_id = e.id
    WHERE e.venue_id = p_venue_id
    FOR UPDATE
  )
  SELECT count(*), count(*) FILTER (WHERE status IN ('PENDING', 'APPROVED'))
    INTO v_found, v_allowed
  FROM locked;

  IF v_found <> v_requested OR v_allowed <> v_found THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Void blocked: every selected event must exist in this venue and be PENDING or APPROVED';
  END IF;

  PERFORM set_config('barinv.review_source', 'manual_bulk', true);
  PERFORM set_config('barinv.review_reason', v_reason, true);
  PERFORM set_config('barinv.void_source', 'event_void', true);
  PERFORM set_config('barinv.review_metadata', jsonb_build_object(
    'operation', 'EVENT_VOID', 'filter_mode', 'explicit_ids', 'event_ids', p_event_ids
  )::text, true);

  UPDATE public.events AS e
     SET status = 'REJECTED'
   WHERE e.venue_id = p_venue_id
     AND e.id = ANY(p_event_ids)
     AND e.status IN ('PENDING', 'APPROVED');
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> v_requested THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Void could not update every selected event';
  END IF;

  RETURN jsonb_build_object('requested', v_requested, 'updated', v_updated, 'audited', v_updated, 'target_status', 'REJECTED');
END;
$$;

REVOKE ALL ON FUNCTION public.barinv_void_events(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.barinv_void_events(uuid, uuid[], text) TO authenticated;

COMMENT ON FUNCTION public.barinv_void_events(uuid, uuid[], text) IS
  'Manager-only transactional void of explicitly selected PENDING or APPROVED events; sets REJECTED and relies on the status audit trigger.';

COMMIT;

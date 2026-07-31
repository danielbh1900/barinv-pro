-- BARINV PRO P0-01
--
-- Submitted Events are inventory history. Normal API clients must not rewrite
-- their identity, scope, item/action/quantity, attribution, source/session, or
-- submission timestamp. Existing status review remains governed by
-- barinv_events_guard_status_update() and the approved manager RPC/job paths.
-- Manager-only note corrections remain compatible with the existing workflow.

CREATE OR REPLACE FUNCTION public.barinv_events_guard_protected_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
BEGIN
  IF ROW(
    NEW.id,
    NEW.venue_id,
    NEW.night_id,
    NEW.bar_id,
    NEW.station_id,
    NEW.item_id,
    NEW.staff_id,
    NEW.submitted_by,
    NEW.qty,
    NEW.action,
    NEW.reason_code,
    NEW.qty_basis,
    NEW.client_event_id,
    NEW.source,
    NEW.session_id,
    NEW.created_at
  ) IS NOT DISTINCT FROM ROW(
    OLD.id,
    OLD.venue_id,
    OLD.night_id,
    OLD.bar_id,
    OLD.station_id,
    OLD.item_id,
    OLD.staff_id,
    OLD.submitted_by,
    OLD.qty,
    OLD.action,
    OLD.reason_code,
    OLD.qty_basis,
    OLD.client_event_id,
    OLD.source,
    OLD.session_id,
    OLD.created_at
  ) THEN
    RETURN NEW;
  END IF;

  -- Trusted service-role maintenance remains possible. SECURITY DEFINER
  -- review functions only update status, so they need no broader bypass.
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE =
      'Submitted Event protected fields are immutable; use an approved server workflow';
END;
$$;

REVOKE ALL ON FUNCTION
  public.barinv_events_guard_protected_update()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.barinv_events_guard_protected_update()
  TO service_role;

COMMENT ON FUNCTION
  public.barinv_events_guard_protected_update()
  IS 'P0-01 defense-in-depth guard preventing normal clients from rewriting submitted Event inventory fields.';

DROP TRIGGER IF EXISTS trg_events_guard_protected_update
  ON public.events;

CREATE TRIGGER trg_events_guard_protected_update
  BEFORE UPDATE OF
    id,
    venue_id,
    night_id,
    bar_id,
    station_id,
    item_id,
    staff_id,
    submitted_by,
    qty,
    action,
    reason_code,
    qty_basis,
    client_event_id,
    source,
    session_id,
    created_at
  ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.barinv_events_guard_protected_update();

COMMENT ON TRIGGER trg_events_guard_protected_update
  ON public.events
  IS 'P0-01 blocks non-maintenance mutation of protected submitted Event fields.';

-- Remove the historical table-wide UPDATE grant. Authenticated managers keep
-- only the columns used by the existing audited review and note-correction
-- behavior. Scoped staff cannot satisfy the manager-only RLS policy.
REVOKE UPDATE ON TABLE public.events
  FROM PUBLIC, anon, authenticated, barback_user;

GRANT UPDATE (status, notes) ON public.events
  TO authenticated;

DROP POLICY IF EXISTS events_update_v
  ON public.events;

CREATE POLICY events_update_v
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (public.has_venue_access(venue_id, 'manager'))
  WITH CHECK (public.has_venue_access(venue_id, 'manager'));

COMMENT ON POLICY events_update_v
  ON public.events
  IS 'P0-01 manager-only direct UPDATE scope; column grants and Event guards enforce the permitted status/notes contract.';

NOTIFY pgrst, 'reload schema';

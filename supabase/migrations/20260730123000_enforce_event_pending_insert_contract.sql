-- BARINV PRO P0-02
--
-- Normal clients must submit Events into manager review as PENDING. The only
-- client-facing exception is Barback Link, whose input is normalized to
-- PENDING here before the existing session auto-approval trigger makes its
-- independent server-authoritative decision.
--
-- Existing non-scoped manager operational APPROVED inserts are retained only
-- for the source values currently used by Admin. REJECTED inserts must always
-- use the review workflow. service_role and direct database maintenance remain
-- available for controlled server operations.

CREATE OR REPLACE FUNCTION
  public.barinv_events_enforce_pending_insert_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_is_scoped_staff boolean := false;
  v_is_manager boolean := false;
BEGIN
  -- Trusted server and direct database maintenance are not client inserts.
  IF v_role = 'service_role'
     OR (
       v_role = ''
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RETURN NEW;
  END IF;

  -- Barback clients never choose final status. This trigger name sorts before
  -- trg_events_session_auto_approve, which may subsequently approve only a
  -- valid active session with auto_approve_events enabled.
  IF v_role = 'barback_user' THEN
    NEW.status := 'PENDING';
    RETURN NEW;
  END IF;

  -- Supplying a Barback source from any other client cannot impersonate the
  -- session auto-approval path.
  IF NEW.source IN ('barback_web_link', 'barback_live_pilot') THEN
    NEW.status := 'PENDING';
    RETURN NEW;
  END IF;

  IF v_role = 'authenticated' AND auth.uid() IS NOT NULL THEN
    v_is_scoped_staff := public.auth_is_scoped_staff();
    v_is_manager :=
      NOT v_is_scoped_staff
      AND public.has_venue_access(NEW.venue_id, 'manager');
  END IF;

  IF v_is_manager THEN
    IF NEW.status = 'REJECTED' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE =
          'Managers must use the Event review workflow to reject Events';
    END IF;

    IF NEW.status NOT IN ('PENDING', 'APPROVED') THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE =
          'Manager Event inserts must use PENDING or an approved operational APPROVED path';
    END IF;

    IF NEW.status = 'APPROVED'
       AND NEW.source IS NOT NULL
       AND NEW.source <> 'admin_adjustment' THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE =
          'This Event source cannot create an immediately APPROVED Event';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Client Event inserts must begin with PENDING status';
  END IF;

  IF NEW.source IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Client Event source must be empty outside an approved server workflow';
  END IF;

  IF NEW.session_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Client Event session_id must be empty outside Barback Link';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
  public.barinv_events_enforce_pending_insert_contract()
  FROM PUBLIC, anon, authenticated, barback_user;

GRANT EXECUTE ON FUNCTION
  public.barinv_events_enforce_pending_insert_contract()
  TO service_role;

COMMENT ON FUNCTION
  public.barinv_events_enforce_pending_insert_contract()
  IS 'P0-02 enforces PENDING client Event inserts before server-authoritative Barback auto-approval.';

DROP TRIGGER IF EXISTS trg_events_00_enforce_pending_insert
  ON public.events;

CREATE TRIGGER trg_events_00_enforce_pending_insert
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION
    public.barinv_events_enforce_pending_insert_contract();

COMMENT ON TRIGGER trg_events_00_enforce_pending_insert
  ON public.events
  IS 'P0-02 first insert guard; normalizes Barback input and rejects unauthorized final-status client Events.';

-- Defense in depth for authenticated staff policies. Manager operational
-- inserts remain subject to the trigger's explicit status/source allowlist.
ALTER POLICY events_insert_v
  ON public.events
  WITH CHECK (
    public.has_venue_access(venue_id, 'staff')
    AND (
      action NOT IN ('COMP', 'SHOT', 'PROMO', 'WASTE', 'BREAKAGE')
      OR public.has_venue_access(venue_id, 'manager')
    )
    AND (
      (
        NOT public.auth_is_scoped_staff()
        AND public.has_venue_access(venue_id, 'manager')
      )
      OR (
        status = 'PENDING'
        AND source IS NULL
        AND session_id IS NULL
      )
    )
  );

ALTER POLICY events_staff_insert
  ON public.events
  WITH CHECK (
    public.auth_is_scoped_staff()
    AND venue_id = public.auth_scoped_venue()
    AND night_id = public.auth_scoped_night()
    AND bar_id = ANY(public.auth_scoped_bar_ids())
    AND action NOT IN ('COMP', 'SHOT', 'PROMO', 'WASTE', 'BREAKAGE')
    AND status = 'PENDING'
    AND source IS NULL
    AND session_id IS NULL
  );

COMMENT ON POLICY events_insert_v
  ON public.events
  IS 'P0-02 normal staff inserts must be PENDING without reserved source/session fields; manager operational inserts remain trigger-gated.';

COMMENT ON POLICY events_staff_insert
  ON public.events
  IS 'P0-02 scoped staff inserts must be PENDING and cannot impersonate Barback/server source or session context.';

NOTIFY pgrst, 'reload schema';

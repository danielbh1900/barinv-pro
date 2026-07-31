-- BARINV PRO P0-02 SAFETY ROLLBACK
--
-- WARNING: Restoring insert policies that permit staff-selected final status,
-- source, or session context would reopen a critical review/audit bypass.
-- This safety rollback intentionally retains the P0-02 trigger and restrictive
-- policies. Use a forward corrective migration for any Production incident.
-- Broadening this contract requires explicit owner/security approval.

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

COMMENT ON FUNCTION
  public.barinv_events_enforce_pending_insert_contract()
  IS 'P0-02 safety rollback retained the Event insert review contract; removal requires a forward owner-approved migration.';

COMMENT ON TRIGGER trg_events_00_enforce_pending_insert
  ON public.events
  IS 'P0-02 safety rollback retained the first client insert guard.';

COMMENT ON POLICY events_insert_v
  ON public.events
  IS 'P0-02 safety rollback retained the normal staff PENDING/source/session contract.';

COMMENT ON POLICY events_staff_insert
  ON public.events
  IS 'P0-02 safety rollback retained scoped staff PENDING/source/session enforcement.';

NOTIFY pgrst, 'reload schema';

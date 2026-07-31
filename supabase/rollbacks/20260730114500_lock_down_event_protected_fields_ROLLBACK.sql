-- BARINV PRO P0-01 SAFETY ROLLBACK
--
-- WARNING: Restoring the historical table-wide authenticated UPDATE grant or
-- the staff-level events_update_v policy would reopen a critical inventory
-- integrity vulnerability. This safety rollback intentionally retains the
-- hardened policy, column grants, and trigger.
--
-- For a real incident, use a forward corrective migration. Removing the guard
-- or broadening Event UPDATE access requires explicit owner/security approval.

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
  IS 'P0-01 safety rollback retained manager-only direct UPDATE scope; broad staff access is intentionally not restored.';

COMMENT ON FUNCTION
  public.barinv_events_guard_protected_update()
  IS 'P0-01 safety rollback retained the protected Event field guard; removal requires a forward owner-approved migration.';

COMMENT ON TRIGGER trg_events_guard_protected_update
  ON public.events
  IS 'P0-01 safety rollback retained protected Event immutability.';

NOTIFY pgrst, 'reload schema';

-- Phase B1: first real DB-side mutation enforcement on Department Access.
-- Pure additive — adds 4 new policies + 1 helper. All pre-existing policies
-- are byte-identical post-migration (RESTRICTIVE policies AND with permissive
-- ones; the new vptf_dept_update is permissive but adds a NEW grant where
-- scoped sessions today have only SELECT, so it cannot weaken any existing
-- policy).

CREATE OR REPLACE FUNCTION public.auth_scoped_dept_or_legacy(dept text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $fn$
  SELECT
    auth_is_scoped_staff()
    AND (
      -- legacy session: no departments claim or empty array
      jsonb_array_length(COALESCE(auth.jwt() -> 'app_metadata' -> 'departments', '[]'::jsonb)) = 0
      OR
      -- portal session with the named department
      ((auth.jwt() -> 'app_metadata' -> 'departments') ? dept)
    );
$fn$;

GRANT EXECUTE ON FUNCTION public.auth_scoped_dept_or_legacy(text) TO authenticated;

-- events INSERT: scoped sessions need 'dispatch' (legacy/manager pass-through)
DROP POLICY IF EXISTS events_dept_restrictive ON public.events;
CREATE POLICY events_dept_restrictive ON public.events
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT auth_is_scoped_staff()
    OR auth_scoped_dept_or_legacy('dispatch')
  );

-- vip_tables INSERT + UPDATE: scoped sessions need 'vip_tables'
DROP POLICY IF EXISTS vip_tables_dept_restrictive_insert ON public.vip_tables;
CREATE POLICY vip_tables_dept_restrictive_insert ON public.vip_tables
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT auth_is_scoped_staff()
    OR auth_scoped_dept_or_legacy('vip_tables')
  );

DROP POLICY IF EXISTS vip_tables_dept_restrictive_update ON public.vip_tables;
CREATE POLICY vip_tables_dept_restrictive_update ON public.vip_tables
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    NOT auth_is_scoped_staff()
    OR auth_scoped_dept_or_legacy('vip_tables')
  )
  WITH CHECK (
    NOT auth_is_scoped_staff()
    OR auth_scoped_dept_or_legacy('vip_tables')
  );

-- vip_pos_fulfillment_tasks UPDATE: NEW grant for portal sessions with
-- 'liquor_room' or 'vip_tables' dept. Phase A0 CHECK constraint excludes
-- DELIVERED/DISPATCHED/VOIDED states, so portal sessions cannot reach
-- inventory-affecting transitions via this grant — those arrive with
-- Phase B2 SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS vptf_dept_update ON public.vip_pos_fulfillment_tasks;
CREATE POLICY vptf_dept_update ON public.vip_pos_fulfillment_tasks
  FOR UPDATE TO authenticated
  USING (
    auth_is_scoped_staff()
    AND venue_id = auth_scoped_venue()
    AND night_id = auth_scoped_night()
    AND (
      auth_scoped_has_department('liquor_room')
      OR auth_scoped_has_department('vip_tables')
    )
  )
  WITH CHECK (
    auth_is_scoped_staff()
    AND venue_id = auth_scoped_venue()
    AND night_id = auth_scoped_night()
    AND (
      auth_scoped_has_department('liquor_room')
      OR auth_scoped_has_department('vip_tables')
    )
  );;

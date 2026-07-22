
-- ────────────────────────────────────────────────────────────────────
-- venue_members: the single source of truth for user ↔ venue ↔ role.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.venue_members (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id   UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','manager','staff','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  PRIMARY KEY (user_id, venue_id)
);
CREATE INDEX venue_members_venue_idx ON public.venue_members (venue_id);
CREATE INDEX venue_members_user_idx  ON public.venue_members (user_id);

ALTER TABLE public.venue_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_members FROM anon;

COMMENT ON TABLE public.venue_members IS
  'User → venue memberships with role. Read-gated per-row; writes require admin+.';

-- ────────────────────────────────────────────────────────────────────
-- Role rank helper (internal).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._role_rank(r TEXT)
RETURNS INT
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE r
    WHEN 'viewer'  THEN 1
    WHEN 'staff'   THEN 2
    WHEN 'manager' THEN 3
    WHEN 'admin'   THEN 4
    WHEN 'owner'   THEN 5
    ELSE 0
  END
$$;
REVOKE ALL ON FUNCTION public._role_rank(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._role_rank(TEXT) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────
-- has_venue_access: THE canonical authorization check.
-- Called by every venue-scoped RLS policy. SECURITY DEFINER so it
-- bypasses RLS on venue_members itself while checking membership.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_venue_access(vid UUID, min_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_members vm
    WHERE vm.user_id = auth.uid()
      AND vm.venue_id = vid
      AND public._role_rank(vm.role) >= public._role_rank(min_role)
  )
$$;
REVOKE ALL ON FUNCTION public.has_venue_access(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_venue_access(UUID, TEXT) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────
-- Trigger: when a venue is created by an authenticated user, grant
-- them `owner` automatically.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_venue_creator_owner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.venue_members (user_id, venue_id, role, created_by)
    VALUES (auth.uid(), NEW.id, 'owner', auth.uid())
    ON CONFLICT (user_id, venue_id) DO UPDATE SET role = 'owner';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_venue_creator_owner() FROM PUBLIC;

CREATE TRIGGER venues_auto_grant_owner
AFTER INSERT ON public.venues
FOR EACH ROW EXECUTE FUNCTION public.grant_venue_creator_owner();

-- ────────────────────────────────────────────────────────────────────
-- Trigger: prevent removing the last owner from a venue.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_last_owner_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.role = 'owner' THEN
    IF (SELECT count(*) FROM public.venue_members
        WHERE venue_id = OLD.venue_id AND role = 'owner') <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner of venue %', OLD.venue_id;
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER venue_members_prevent_last_owner
BEFORE DELETE ON public.venue_members
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_delete();

-- ────────────────────────────────────────────────────────────────────
-- venue_members RLS policies.
--   • User can always read their own memberships.
--   • Admin+ of a venue can read/manage all memberships for it.
--   • Only owner can create/modify rows with role='owner'.
--   • Last-owner protection via BEFORE DELETE trigger above.
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY vm_select_member ON public.venue_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_venue_access(venue_id, 'admin')
  );

CREATE POLICY vm_insert_admin ON public.venue_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_venue_access(venue_id, 'admin')
    AND (role <> 'owner' OR public.has_venue_access(venue_id, 'owner'))
  );

CREATE POLICY vm_update_admin ON public.venue_members
  FOR UPDATE TO authenticated
  USING (public.has_venue_access(venue_id, 'admin'))
  WITH CHECK (
    public.has_venue_access(venue_id, 'admin')
    AND (role <> 'owner' OR public.has_venue_access(venue_id, 'owner'))
  );

CREATE POLICY vm_delete_admin ON public.venue_members
  FOR DELETE TO authenticated
  USING (
    public.has_venue_access(venue_id, 'admin')
    AND (role <> 'owner' OR public.has_venue_access(venue_id, 'owner'))
  );

-- ────────────────────────────────────────────────────────────────────
-- SEED: assign every existing profile as admin on every existing venue
-- (per explicit instruction for v2.3.0 rollout).
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_members (user_id, venue_id, role, created_by)
SELECT p.id, v.id, 'admin', p.id
FROM public.profiles p
CROSS JOIN public.venues v
ON CONFLICT (user_id, venue_id) DO NOTHING;
;

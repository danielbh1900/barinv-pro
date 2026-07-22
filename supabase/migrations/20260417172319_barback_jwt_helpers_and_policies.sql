
-- ────────────────────────────────────────────────────────────────────
-- Barback JWT claim accessors. Reads app_metadata (server-managed,
-- tamper-proof) from the caller's bearer token.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_is_barback()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'barback',
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.auth_barback_night()
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'night_id', '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.auth_barback_venue()
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'venue_id', '')::uuid
$$;

REVOKE ALL ON FUNCTION public.auth_is_barback()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_barback_night() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_barback_venue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_is_barback()    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_barback_night() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_barback_venue() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────
-- Barback-scoped RLS (permissive, OR'd with has_venue_access policies).
-- Gated on auth_is_barback() so regular users are unaffected.
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY bars_barback_select ON public.bars
  FOR SELECT TO authenticated
  USING (public.auth_is_barback() AND venue_id = public.auth_barback_venue());

CREATE POLICY stations_barback_select ON public.stations
  FOR SELECT TO authenticated
  USING (public.auth_is_barback() AND venue_id = public.auth_barback_venue());

CREATE POLICY items_barback_select ON public.items
  FOR SELECT TO authenticated
  USING (public.auth_is_barback() AND venue_id = public.auth_barback_venue());

CREATE POLICY staff_barback_select ON public.staff
  FOR SELECT TO authenticated
  USING (public.auth_is_barback() AND venue_id = public.auth_barback_venue());

CREATE POLICY placements_barback_select ON public.placements
  FOR SELECT TO authenticated
  USING (public.auth_is_barback() AND venue_id = public.auth_barback_venue());

-- Nights: only their specific night (not siblings at the same venue)
CREATE POLICY nights_barback_select ON public.nights
  FOR SELECT TO authenticated
  USING (public.auth_is_barback() AND id = public.auth_barback_night());

-- Events: read + insert only within their night+venue. No UPDATE, no DELETE.
CREATE POLICY events_barback_select ON public.events
  FOR SELECT TO authenticated
  USING (
    public.auth_is_barback()
    AND night_id = public.auth_barback_night()
    AND venue_id = public.auth_barback_venue()
  );

CREATE POLICY events_barback_insert ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_is_barback()
    AND night_id = public.auth_barback_night()
    AND venue_id = public.auth_barback_venue()
  );
;

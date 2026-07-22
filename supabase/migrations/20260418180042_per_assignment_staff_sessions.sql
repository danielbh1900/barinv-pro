-- ═══════════════════════════════════════════════════════════════════
-- v2.4.1 — Per-assignment scoped staff sessions
--
-- Replaces the shared-night-code barback system (v2.3.3) with a
-- per-(night, staff, role) assignment model. Each assignment has its
-- own access code and a list of allowed_bar_ids. Login returns a JWT
-- whose app_metadata carries { venue_id, night_id, role, allowed_bar_ids,
-- scope:'staff_session', assignment_id, staff_id, staff_name }.
-- RLS enforces allowed_bar_ids on every bar-scoped table, giving hard
-- isolation: the scoped user sees ONLY their assigned bars.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Assignment table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.night_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  night_id uuid NOT NULL REFERENCES public.nights(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('bartender','barback')),
  allowed_bar_ids uuid[] NOT NULL DEFAULT '{}',
  access_code text NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nsa_one_per_role UNIQUE (night_id, staff_id, role),
  CONSTRAINT nsa_code_unique  UNIQUE (access_code)
);
CREATE INDEX IF NOT EXISTS idx_nsa_venue ON public.night_staff_assignments(venue_id);
CREATE INDEX IF NOT EXISTS idx_nsa_night ON public.night_staff_assignments(night_id);
CREATE INDEX IF NOT EXISTS idx_nsa_code_active
  ON public.night_staff_assignments(access_code) WHERE NOT revoked;

-- 2. Access-code generator + auto-fill + updated_at trigger -----------
CREATE OR REPLACE FUNCTION public.gen_assignment_code() RETURNS text
LANGUAGE sql VOLATILE AS $fn$
  -- 10-char Crockford-ish alphabet (no ambiguous 0/O/1/I): ~50 bits entropy.
  SELECT string_agg(
    substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
           1 + (get_byte(gen_random_bytes(1), 0) % 32)::int, 1),
    ''
  ) FROM generate_series(1, 10);
$fn$;

CREATE OR REPLACE FUNCTION public._nsa_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.access_code IS NULL OR NEW.access_code = '' THEN
    NEW.access_code := public.gen_assignment_code();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS nsa_set_code ON public.night_staff_assignments;
CREATE TRIGGER nsa_set_code
  BEFORE INSERT ON public.night_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public._nsa_before_insert();

CREATE OR REPLACE FUNCTION public._nsa_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

DROP TRIGGER IF EXISTS nsa_touch_updated ON public.night_staff_assignments;
CREATE TRIGGER nsa_touch_updated
  BEFORE UPDATE ON public.night_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public._nsa_touch_updated_at();

-- 3. New auth helpers -------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_is_scoped_staff() RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'scope') = 'staff_session',
    false
  )
$fn$;

CREATE OR REPLACE FUNCTION public.auth_scoped_assignment_id() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'assignment_id', '')::uuid
$fn$;

CREATE OR REPLACE FUNCTION public.auth_scoped_night() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'night_id', '')::uuid
$fn$;

CREATE OR REPLACE FUNCTION public.auth_scoped_venue() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'venue_id', '')::uuid
$fn$;

CREATE OR REPLACE FUNCTION public.auth_scoped_staff_id() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'staff_id', '')::uuid
$fn$;

CREATE OR REPLACE FUNCTION public.auth_scoped_role() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role'
$fn$;

CREATE OR REPLACE FUNCTION public.auth_scoped_bar_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(
    ARRAY(
      SELECT (jsonb_array_elements_text(
        auth.jwt() -> 'app_metadata' -> 'allowed_bar_ids'
      ))::uuid
    ),
    ARRAY[]::uuid[]
  )
$fn$;

-- 4. RLS on night_staff_assignments -----------------------------------
ALTER TABLE public.night_staff_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nsa_mgr_all     ON public.night_staff_assignments;
DROP POLICY IF EXISTS nsa_staff_self  ON public.night_staff_assignments;

CREATE POLICY nsa_mgr_all ON public.night_staff_assignments
  FOR ALL TO authenticated
  USING (public.has_venue_access(venue_id, 'manager'))
  WITH CHECK (public.has_venue_access(venue_id, 'manager'));

CREATE POLICY nsa_staff_self ON public.night_staff_assignments
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND id = public.auth_scoped_assignment_id());

-- 5. Drop old barback-only policies -----------------------------------
DROP POLICY IF EXISTS bars_barback_select       ON public.bars;
DROP POLICY IF EXISTS events_barback_select     ON public.events;
DROP POLICY IF EXISTS events_barback_insert     ON public.events;
DROP POLICY IF EXISTS items_barback_select      ON public.items;
DROP POLICY IF EXISTS nights_barback_select     ON public.nights;
DROP POLICY IF EXISTS placements_barback_select ON public.placements;
DROP POLICY IF EXISTS staff_barback_select      ON public.staff;
DROP POLICY IF EXISTS stations_barback_select   ON public.stations;

-- 6. New scoped-staff policies ----------------------------------------
-- bars: hard-isolate to allowed_bar_ids only
CREATE POLICY bars_staff_select ON public.bars
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND venue_id = public.auth_scoped_venue()
         AND id = ANY(public.auth_scoped_bar_ids()));

-- events: SELECT + INSERT for assigned bars in their night only
CREATE POLICY events_staff_select ON public.events
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND venue_id = public.auth_scoped_venue()
         AND night_id = public.auth_scoped_night()
         AND bar_id  = ANY(public.auth_scoped_bar_ids()));

CREATE POLICY events_staff_insert ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_scoped_staff()
              AND venue_id = public.auth_scoped_venue()
              AND night_id = public.auth_scoped_night()
              AND bar_id  = ANY(public.auth_scoped_bar_ids()));

-- stations: only stations on assigned bars
CREATE POLICY stations_staff_select ON public.stations
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND venue_id = public.auth_scoped_venue()
         AND bar_id = ANY(public.auth_scoped_bar_ids()));

-- placements: via stations
CREATE POLICY placements_staff_select ON public.placements
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND venue_id = public.auth_scoped_venue()
         AND EXISTS (
           SELECT 1 FROM public.stations s
           WHERE s.id = placements.station_id
             AND s.bar_id = ANY(public.auth_scoped_bar_ids())
         ));

-- items: venue-wide read (scoped user needs the item catalog)
CREATE POLICY items_staff_select ON public.items
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND venue_id = public.auth_scoped_venue());

-- nights: only the night they're logged into
CREATE POLICY nights_staff_select ON public.nights
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND id = public.auth_scoped_night());

-- staff: venue-wide read (for UI display of bartenders/barbacks)
CREATE POLICY staff_staff_select ON public.staff
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND venue_id = public.auth_scoped_venue());

-- Bar-scoped snapshot/mapping tables: restrict to allowed_bar_ids
CREATE POLICY bar_close_summaries_staff_select ON public.bar_close_summaries
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND bar_id = ANY(public.auth_scoped_bar_ids()));

CREATE POLICY bids_staff_select ON public.bar_item_dispatch_snapshots
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND bar_id = ANY(public.auth_scoped_bar_ids()));

CREATE POLICY biss_staff_select ON public.bar_item_shot_snapshots
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND bar_id = ANY(public.auth_scoped_bar_ids()));

CREATE POLICY pbs_staff_select ON public.pos_bar_snapshots
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND bar_id = ANY(public.auth_scoped_bar_ids()));

CREATE POLICY pbps_staff_select ON public.pos_bar_product_snapshots
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND bar_id = ANY(public.auth_scoped_bar_ids()));

CREATE POLICY pbm_staff_select ON public.pos_bar_mappings
  FOR SELECT TO authenticated
  USING (public.auth_is_scoped_staff()
         AND bar_id = ANY(public.auth_scoped_bar_ids()));

-- 7. Drop old barback helpers (no live sessions exist yet) ------------
DROP FUNCTION IF EXISTS public.auth_is_barback();
DROP FUNCTION IF EXISTS public.auth_barback_night();
DROP FUNCTION IF EXISTS public.auth_barback_venue();

-- 8. Notify PostgREST to reload schema --------------------------------
NOTIFY pgrst, 'reload schema';;

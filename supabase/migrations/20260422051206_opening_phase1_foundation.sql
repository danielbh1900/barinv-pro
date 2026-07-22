-- Opening Workflow — Phase 1 foundation
-- Tables, RLS, seed default profile per venue. No RPCs. No event emission.

CREATE TABLE IF NOT EXISTS opening_par_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS opening_par_profiles_one_active_default_per_venue
  ON opening_par_profiles (venue_id)
  WHERE is_default = true AND active = true;

CREATE TABLE IF NOT EXISTS opening_par_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES opening_par_profiles(id) ON DELETE CASCADE,
  bar_id      UUID NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty         NUMERIC NOT NULL CHECK (qty >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, bar_id, item_id)
);
CREATE INDEX IF NOT EXISTS opening_par_items_profile_bar_idx
  ON opening_par_items (profile_id, bar_id);

CREATE TABLE IF NOT EXISTS opening_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  night_id       UUID NOT NULL REFERENCES nights(id) ON DELETE CASCADE,
  bar_id         UUID NOT NULL REFERENCES bars(id) ON DELETE RESTRICT,
  profile_id     UUID NOT NULL REFERENCES opening_par_profiles(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','ISSUED','RECEIVED','CANCELLED')),
  has_exception  BOOLEAN NOT NULL DEFAULT false,
  notes          TEXT,
  cancel_reason  TEXT,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  prepared_by    UUID REFERENCES auth.users(id),
  prepared_at    TIMESTAMPTZ,
  issued_by      UUID REFERENCES auth.users(id),
  issued_at      TIMESTAMPTZ,
  received_by    UUID REFERENCES auth.users(id),
  received_at    TIMESTAMPTZ,
  cancelled_by   UUID REFERENCES auth.users(id),
  cancelled_at   TIMESTAMPTZ,
  UNIQUE (night_id, bar_id, profile_id)
);
CREATE INDEX IF NOT EXISTS opening_runs_venue_night_status_idx
  ON opening_runs (venue_id, night_id, status);
CREATE INDEX IF NOT EXISTS opening_runs_night_bar_idx
  ON opening_runs (night_id, bar_id);

CREATE TABLE IF NOT EXISTS opening_run_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES opening_runs(id) ON DELETE CASCADE,
  item_id        UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  par_qty        NUMERIC NOT NULL,
  issued_qty     NUMERIC,
  received_qty   NUMERIC,
  exception_note TEXT,
  UNIQUE (run_id, item_id)
);
CREATE INDEX IF NOT EXISTS opening_run_items_run_idx
  ON opening_run_items (run_id);

-- RLS
ALTER TABLE opening_par_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_par_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_run_items    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opening_par_profiles_select_v ON opening_par_profiles;
CREATE POLICY opening_par_profiles_select_v ON opening_par_profiles
  FOR SELECT USING (has_venue_access(venue_id, 'viewer'));
DROP POLICY IF EXISTS opening_par_profiles_insert_v ON opening_par_profiles;
CREATE POLICY opening_par_profiles_insert_v ON opening_par_profiles
  FOR INSERT WITH CHECK (has_venue_access(venue_id, 'manager'));
DROP POLICY IF EXISTS opening_par_profiles_update_v ON opening_par_profiles;
CREATE POLICY opening_par_profiles_update_v ON opening_par_profiles
  FOR UPDATE USING (has_venue_access(venue_id, 'manager'));
DROP POLICY IF EXISTS opening_par_profiles_delete_v ON opening_par_profiles;
CREATE POLICY opening_par_profiles_delete_v ON opening_par_profiles
  FOR DELETE USING (has_venue_access(venue_id, 'admin'));

DROP POLICY IF EXISTS opening_par_items_select_v ON opening_par_items;
CREATE POLICY opening_par_items_select_v ON opening_par_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM opening_par_profiles p
     WHERE p.id = opening_par_items.profile_id
       AND has_venue_access(p.venue_id, 'viewer')
  ));
DROP POLICY IF EXISTS opening_par_items_insert_v ON opening_par_items;
CREATE POLICY opening_par_items_insert_v ON opening_par_items
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM opening_par_profiles p
     WHERE p.id = opening_par_items.profile_id
       AND has_venue_access(p.venue_id, 'manager')
  ));
DROP POLICY IF EXISTS opening_par_items_update_v ON opening_par_items;
CREATE POLICY opening_par_items_update_v ON opening_par_items
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM opening_par_profiles p
     WHERE p.id = opening_par_items.profile_id
       AND has_venue_access(p.venue_id, 'manager')
  ));
DROP POLICY IF EXISTS opening_par_items_delete_v ON opening_par_items;
CREATE POLICY opening_par_items_delete_v ON opening_par_items
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM opening_par_profiles p
     WHERE p.id = opening_par_items.profile_id
       AND has_venue_access(p.venue_id, 'manager')
  ));

DROP POLICY IF EXISTS opening_runs_select_v ON opening_runs;
CREATE POLICY opening_runs_select_v ON opening_runs
  FOR SELECT USING (has_venue_access(venue_id, 'viewer'));
DROP POLICY IF EXISTS opening_runs_insert_v ON opening_runs;
CREATE POLICY opening_runs_insert_v ON opening_runs
  FOR INSERT WITH CHECK (has_venue_access(venue_id, 'admin'));
DROP POLICY IF EXISTS opening_runs_update_v ON opening_runs;
CREATE POLICY opening_runs_update_v ON opening_runs
  FOR UPDATE USING (has_venue_access(venue_id, 'admin'));

DROP POLICY IF EXISTS opening_run_items_select_v ON opening_run_items;
CREATE POLICY opening_run_items_select_v ON opening_run_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM opening_runs r
     WHERE r.id = opening_run_items.run_id
       AND has_venue_access(r.venue_id, 'viewer')
  ));
DROP POLICY IF EXISTS opening_run_items_insert_v ON opening_run_items;
CREATE POLICY opening_run_items_insert_v ON opening_run_items
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM opening_runs r
     WHERE r.id = opening_run_items.run_id
       AND has_venue_access(r.venue_id, 'admin')
  ));
DROP POLICY IF EXISTS opening_run_items_update_v ON opening_run_items;
CREATE POLICY opening_run_items_update_v ON opening_run_items
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM opening_runs r
     WHERE r.id = opening_run_items.run_id
       AND has_venue_access(r.venue_id, 'admin')
  ));

CREATE OR REPLACE FUNCTION opening_par_items_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opening_par_items_set_updated_at ON opening_par_items;
CREATE TRIGGER opening_par_items_set_updated_at
  BEFORE UPDATE ON opening_par_items
  FOR EACH ROW EXECUTE FUNCTION opening_par_items_touch_updated_at();

INSERT INTO opening_par_profiles (venue_id, name, is_default)
SELECT v.id, 'Standard', true
  FROM venues v
 WHERE NOT EXISTS (
         SELECT 1 FROM opening_par_profiles p
          WHERE p.venue_id = v.id
            AND p.is_default = true
            AND p.active = true
       );;

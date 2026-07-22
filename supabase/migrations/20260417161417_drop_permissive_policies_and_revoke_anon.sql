
-- ────────────────────────────────────────────────────────────────────
-- 1. Drop EVERY existing policy on public.* EXCEPT the ones we just
--    created for pos_credentials and venue_members. With RLS enabled
--    and no policies, the default becomes deny-all — good baseline.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename NOT IN ('pos_credentials', 'venue_members')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 2. Revoke ALL privileges on every base table from anon.
--    No anonymous access to any data, anywhere. Period.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.table_name);
  END LOOP;
END $$;

-- Revoke anon from future tables created in public.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ────────────────────────────────────────────────────────────────────
-- 3. Ensure RLS is enabled on every public base table. Idempotent.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
  END LOOP;
END $$;
;

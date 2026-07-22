-- BARINV — barback_user role + INSERT policy on public.events
-- Approved 2026-06-05. Additive, idempotent, reversible.
-- Purpose: PostgREST receives a barback JWT with role="barback_user",
-- but that role did not exist, so every save returned
-- role "barback_user" does not exist. This migration is the minimum
-- DDL to make those saves land under strict claim-scoped RLS.

-- 1) Create role idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'barback_user'
  ) THEN
    CREATE ROLE barback_user NOLOGIN;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2) Let PostgREST switch into barback_user via authenticator.
GRANT barback_user TO authenticator;

-- 3) Schema + table privilege (INSERT only — no SELECT/UPDATE/DELETE).
GRANT USAGE  ON SCHEMA public TO barback_user;
GRANT INSERT ON public.events TO barback_user;

-- 4) Strict claim-scoped INSERT policy, idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'events'
      AND policyname = 'events_barback_insert'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY events_barback_insert
      ON public.events
      FOR INSERT
      TO barback_user
      WITH CHECK (
             venue_id   = (auth.jwt() ->> 'venue_id')::uuid
         AND night_id   = (auth.jwt() ->> 'night_id')::uuid
         AND staff_id   = (auth.jwt() ->> 'staff_id')::uuid
         AND session_id = (auth.jwt() ->> 'session_id')::uuid
         AND source     IN ('barback_web_link', 'barback_live_pilot')
         AND (
               bar_id IS NULL
            OR bar_id = NULLIF(auth.jwt() ->> 'bar_id', '')::uuid
            OR bar_id::text = ANY(string_to_array(auth.jwt() ->> 'allowed_bars', ','))
         )
      )
    $policy$;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 5) Force PostgREST schema cache reload so the new role + policy
--    are picked up immediately.
NOTIFY pgrst, 'reload schema';;

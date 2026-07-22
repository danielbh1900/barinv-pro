-- ════════════════════════════════════════════════════════════════════
-- APPLY CANDIDATE — 20260602_create_terminal_access_grants.sql
-- ────────────────────────────────────────────────────────────────────
-- ⚠️  OWNER APPROVAL REQUIRED BEFORE EXECUTION. NOT YET APPLIED.
--
-- This is the reviewed apply artifact for the terminal_access_grants
-- migration. The SQL body below is byte-identical to the proposal;
-- ONLY this banner was prepended (no logic changed).
--   Source of truth : sql/proposals/DRAFT_terminal_access_grants.sql
--   Generated on    : 2026-06-02 (from clean working tree)
--   Apply method    : single reviewed SQL apply via Supabase SQL Editor
--                     / psql / apply_migration. DO NOT run `supabase db
--                     push` from this repo — its supabase/migrations/
--                     folder is not a mirror of the remote ledger.
--   Verify identity : diff against the proposal shows only this header.
-- ════════════════════════════════════════════════════════════════════
--
-- ════════════════════════════════════════════════════════════════════
-- DRAFT_terminal_access_grants.sql
-- ────────────────────────────────────────────────────────────────────
-- 🚧 DRAFT — DO NOT APPLY UNTIL OWNER REVIEW + EXPLICIT GO-AHEAD.
--
-- Status: Fix B FINAL — per-venue, per-staff Scale Terminal Access
--         permission table. Replaces the rejected env-var allowlist
--         (B2) with a DB-managed, app-configurable grants model.
--
-- Final access rule enforced by terminal-lookups + terminal-weighings
-- after this migration ships:
--
--   ALLOW Scale login if
--     normalized night_staff_assignments.role = 'barback'
--   OR
--     an active row in public.terminal_access_grants exists for the
--     (venue_id, staff_id) pair (revoked_at IS NULL AND
--      (expires_at IS NULL OR expires_at > now())).
--
-- Target: PRODUCTION Supabase project uzommuafouvaerdvirzf
--         (multi-tenant, multi-venue).
-- Adds:   public.terminal_access_grants                (NEW table)
--         3 indices                                    (1 plain + 2 partial)
--         3 CHECK constraints                          (state coherence)
--         RLS + 3 venue admin/owner policies           (SELECT/INSERT/UPDATE)
--         1 BEFORE-INSERT trigger                      (audit attribution: granted_by = auth.uid())
--         1 BEFORE-UPDATE trigger                      (immutable-column guard)
--         2 helper functions for the above triggers
-- Side effects: none on any existing table; no data inserted.
--               No DROP, no ALTER on existing schema.
--
-- Why this file lives in sql/proposals/, NOT supabase/migrations/:
--   The preflight review (2026-06-02) flagged that `supabase db push`
--   behavior toward `DRAFT_*.sql` names is not guaranteed. To remove
--   that risk entirely, the file is staged outside the CLI's
--   migration scan path until owner approval. To apply: review → move
--   the revised draft to supabase/migrations/ with a timestamped name
--   (YYYYMMDDHHMMSS_terminal_access_grants.sql) → apply.
--
-- Pre-requisites verified read-only on 2026-06-02:
--   - public.venues(id)            exists, uuid PK
--   - public.staff(id)             exists, uuid PK
--   - public.venue_members         exists with (user_id, venue_id, role)
--                                  and role='admin' rows for Harbour
--   - auth.users(id)               exists (Supabase default)
--   - pgcrypto extension enabled  (Supabase default; provides
--                                   gen_random_uuid())
--
-- Identity of decision points consumed by this migration:
--   - Granted by which auth user → granted_by (audit; nullable; SET NULL on user delete)
--   - When revoked + by whom    → revoked_at + revoked_by (soft delete)
--   - Optional expiry           → expires_at (time-boxed grants)
--   - Free-text rationale       → notes
--
-- What is INTENTIONALLY NOT in this migration:
--   - No is_active boolean (derived from revoked_at + expires_at).
--   - No permission_type column (single terminal type — Scale —
--     for now; if a second device type appears, add a separate
--     grants table or a typed enum at that point. YAGNI for v1).
--   - No DELETE policy. Soft delete via UPDATE revoked_at is the
--     supported path; hard delete is forbidden by default RLS.
--   - No backfill. Insert rows post-deploy via the admin UI or a
--     separately-approved data INSERT.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1. TABLE
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.terminal_access_grants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL
              REFERENCES public.venues(id) ON DELETE CASCADE,
  staff_id    uuid        NOT NULL
              REFERENCES public.staff(id)  ON DELETE CASCADE,
  granted_by  uuid
              REFERENCES auth.users(id)    ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid
              REFERENCES auth.users(id)    ON DELETE SET NULL,
  expires_at  timestamptz,
  notes       text,

  -- State-coherence invariants (Change 4 from preflight review):
  -- 1. Expiry must come strictly after the grant moment.
  CONSTRAINT terminal_access_grants_expires_after_grant
    CHECK (expires_at IS NULL OR expires_at > granted_at),
  -- 2. revoked_by may only be set when revoked_at is also set. This
  --    one-way invariant (changed 2026-06-02 from the prior strict
  --    biconditional) is what allows `revoked_by uuid REFERENCES
  --    auth.users(id) ON DELETE SET NULL` to fire cleanly: when a
  --    former revoker is deleted from auth.users, revoked_by becomes
  --    NULL while revoked_at remains set — that state is now
  --    permitted (post-cascade audit-preserving state). The only
  --    state still rejected at write time is an active grant
  --    (revoked_at IS NULL) carrying a non-null revoked_by, which
  --    the INSERT WITH CHECK already prevents at policy level.
  CONSTRAINT terminal_access_grants_revoke_pair_coherent
    CHECK (revoked_at IS NOT NULL OR revoked_by IS NULL),
  -- 3. A grant cannot be revoked before it was granted.
  CONSTRAINT terminal_access_grants_revoke_time_ordered
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

COMMENT ON TABLE  public.terminal_access_grants IS
  'Fix B FINAL — per-(venue,staff) grant allowing the staff member to log in to the ESP32 Scale Terminal in that venue. Read by terminal-lookups and terminal-weighings; managed by venue admins via the BARINV admin app.';
COMMENT ON COLUMN public.terminal_access_grants.granted_by IS
  'auth.users.id of the venue admin who created this grant. Nullable for backfill rows; SET NULL on user deletion to preserve audit trail.';
COMMENT ON COLUMN public.terminal_access_grants.revoked_at IS
  'Soft-delete marker. When non-null, the grant is inactive regardless of expires_at.';
COMMENT ON COLUMN public.terminal_access_grants.expires_at IS
  'Optional time-boxed grant. NULL = never expires. Treated as inactive when expires_at <= now().';

-- ────────────────────────────────────────────────────────────────────
-- 2. INDICES
-- ────────────────────────────────────────────────────────────────────
-- (a) Hot path: Edge Function fetches all active grants for one venue.
CREATE INDEX IF NOT EXISTS terminal_access_grants_venue_idx
  ON public.terminal_access_grants(venue_id);

-- (b) Reverse lookup: who currently has Scale access on this staff_id?
--     Partial index keeps it tiny by ignoring tombstones.
CREATE INDEX IF NOT EXISTS terminal_access_grants_active_staff_idx
  ON public.terminal_access_grants(staff_id)
  WHERE revoked_at IS NULL;

-- (c) Uniqueness invariant: AT MOST ONE active grant per (venue, staff)
--     at any time. Partial unique allows full re-grant history to be
--     retained as a queue of tombstoned rows.
CREATE UNIQUE INDEX IF NOT EXISTS terminal_access_grants_one_active_per_pair_idx
  ON public.terminal_access_grants(venue_id, staff_id)
  WHERE revoked_at IS NULL;

-- ────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.terminal_access_grants ENABLE ROW LEVEL SECURITY;

-- (a) Venue admins may READ grants for their own venue.
DROP POLICY IF EXISTS terminal_access_grants_venue_admin_select
  ON public.terminal_access_grants;
CREATE POLICY terminal_access_grants_venue_admin_select
  ON public.terminal_access_grants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.venue_members vm
      WHERE vm.user_id  = auth.uid()
        AND vm.venue_id = terminal_access_grants.venue_id
        AND vm.role     IN ('admin','owner')
    )
  );

-- (b) Venue admins/owners may CREATE active grants for their own venue.
--     Revoke-state columns MUST be NULL at creation — admins revoke
--     existing grants via UPDATE, never by inserting a pre-revoked row.
DROP POLICY IF EXISTS terminal_access_grants_venue_admin_insert
  ON public.terminal_access_grants;
CREATE POLICY terminal_access_grants_venue_admin_insert
  ON public.terminal_access_grants
  FOR INSERT
  WITH CHECK (
    revoked_at IS NULL
    AND revoked_by IS NULL
    AND EXISTS (
      SELECT 1 FROM public.venue_members vm
      WHERE vm.user_id  = auth.uid()
        AND vm.venue_id = terminal_access_grants.venue_id
        AND vm.role     IN ('admin','owner')
    )
  );

-- (c) Venue admins/owners may UPDATE grants for their own venue
--     (revoke path). The BEFORE-UPDATE trigger in section 4 enforces
--     that ONLY revoked_at, revoked_by, expires_at, and notes can
--     change — id / venue_id / staff_id / granted_by / granted_at
--     are immutable after insertion.
DROP POLICY IF EXISTS terminal_access_grants_venue_admin_update
  ON public.terminal_access_grants;
CREATE POLICY terminal_access_grants_venue_admin_update
  ON public.terminal_access_grants
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.venue_members vm
      WHERE vm.user_id  = auth.uid()
        AND vm.venue_id = terminal_access_grants.venue_id
        AND vm.role     IN ('admin','owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.venue_members vm
      WHERE vm.user_id  = auth.uid()
        AND vm.venue_id = terminal_access_grants.venue_id
        AND vm.role     IN ('admin','owner')
    )
  );

-- (d) NO DELETE POLICY by design. Without an enabling policy, the
--     default-deny posture forbids hard deletes for every role except
--     service_role / bypass. Revocation is the supported mechanism.

-- ────────────────────────────────────────────────────────────────────
-- 4. IMMUTABLE-COLUMN GUARD TRIGGER (Change 3 from preflight review)
-- ────────────────────────────────────────────────────────────────────
-- Belt-and-braces protection against accidental or malicious rewrites
-- of identity / audit columns through the UPDATE policy. RLS scopes
-- WHO may update; this trigger scopes WHAT they may update.
--
-- Allowed columns to change on UPDATE:
--   revoked_at, revoked_by, expires_at, notes
-- Immutable after INSERT:
--   id, venue_id, staff_id, granted_by, granted_at
--
-- IS DISTINCT FROM is used everywhere so NULL ⇄ value transitions
-- are detected correctly. granted_by has ONE explicit exception
-- (changed 2026-06-02 per third preflight): a non-NULL → NULL
-- transition is permitted to allow the
--   `granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL`
-- cascade to fire cleanly when the granter is deleted from
-- auth.users. NULL → non-NULL (post-hoc attribution backfill) and
-- non-NULL → different non-NULL (attribution rewrite) both remain
-- rejected. The other immutable columns (id, venue_id, staff_id,
-- granted_at) are still fully locked — every transition raises
-- EXCEPTION. The trigger fires for every UPDATE regardless of role,
-- including service_role — by design.

CREATE OR REPLACE FUNCTION public.terminal_access_grants_guard_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  -- Explicit search_path (hygiene from second preflight): defence in
  -- depth against search_path injection. Function remains SECURITY
  -- INVOKER (the default); no privilege escalation. The function body
  -- references only OLD/NEW columns + RAISE EXCEPTION, so the
  -- declared path is documentation of intent rather than a resolver
  -- dependency, but it keeps Supabase advisors quiet.
  SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.id         IS DISTINCT FROM OLD.id         THEN
    RAISE EXCEPTION 'terminal_access_grants.id is immutable';
  END IF;
  IF NEW.venue_id   IS DISTINCT FROM OLD.venue_id   THEN
    RAISE EXCEPTION 'terminal_access_grants.venue_id is immutable';
  END IF;
  IF NEW.staff_id   IS DISTINCT FROM OLD.staff_id   THEN
    RAISE EXCEPTION 'terminal_access_grants.staff_id is immutable';
  END IF;
  -- granted_by is generally immutable. The single permitted
  -- transition is non-NULL → NULL, which is exactly what the
  -- `ON DELETE SET NULL` FK cascade from auth.users issues when the
  -- granter is deleted. Every other transition (NULL → non-NULL
  -- backfill, non-NULL → different non-NULL rewrite) is rejected.
  IF NEW.granted_by IS DISTINCT FROM OLD.granted_by
     AND NEW.granted_by IS NOT NULL THEN
    RAISE EXCEPTION 'terminal_access_grants.granted_by can only be nullified by FK cascade, not changed to a different value';
  END IF;
  IF NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
    RAISE EXCEPTION 'terminal_access_grants.granted_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS terminal_access_grants_guard_immutable_trg
  ON public.terminal_access_grants;
CREATE TRIGGER terminal_access_grants_guard_immutable_trg
  BEFORE UPDATE ON public.terminal_access_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.terminal_access_grants_guard_immutable();

-- ────────────────────────────────────────────────────────────────────
-- 5. INSERT AUDIT-ATTRIBUTION TRIGGER (final preflight hardening)
-- ────────────────────────────────────────────────────────────────────
-- Ensure granted_by always reflects the authenticated user who
-- actually created the grant. Two failure modes are closed:
--   (a) Client forgets to set granted_by → server fills it from
--       auth.uid().
--   (b) Client sets granted_by to a different uuid (mis-attribution
--       attempt) → reject with EXCEPTION.
--
-- Service-role / postgres callers: auth.uid() returns NULL for these.
-- Such callers must pass granted_by = NULL on INSERT (the function
-- then leaves it NULL — acceptable for backfill or DBA insert).
-- Passing a non-null granted_by from a non-authenticated role
-- triggers the EXCEPTION branch; to backfill with explicit
-- attribution, temporarily disable this trigger.

CREATE OR REPLACE FUNCTION public.terminal_access_grants_set_granted_by()
  RETURNS trigger
  LANGUAGE plpgsql
  -- Explicit search_path (hygiene from second preflight): defence in
  -- depth against search_path injection. Function remains SECURITY
  -- INVOKER (the default); no privilege escalation. auth.uid() is
  -- already fully qualified in the body, so the declared path is
  -- documentation of intent rather than a resolver dependency, but
  -- it keeps Supabase advisors quiet and prevents a future caller
  -- from accidentally shadowing the auth schema via a session-level
  -- search_path.
  SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NEW.granted_by IS NULL THEN
    NEW.granted_by := auth.uid();
  ELSIF NEW.granted_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'granted_by must equal auth.uid()';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS terminal_access_grants_set_granted_by_trg
  ON public.terminal_access_grants;
CREATE TRIGGER terminal_access_grants_set_granted_by_trg
  BEFORE INSERT ON public.terminal_access_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.terminal_access_grants_set_granted_by();

-- ────────────────────────────────────────────────────────────────────
-- 6. SERVICE-ROLE READ POSTURE
-- ────────────────────────────────────────────────────────────────────
-- The Edge Functions (terminal-lookups, terminal-weighings) use the
-- BARINV_SERVICE_ROLE_KEY and therefore bypass RLS. No additional
-- policy is required for them to SELECT this table at runtime. The
-- immutable-column trigger above still fires for service_role on the
-- (rare) UPDATE path — this is intentional defense-in-depth.

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- END DRAFT_terminal_access_grants.sql
-- Apply order (after owner approval):
--   1. Rename file:  mv DRAFT_terminal_access_grants.sql YYYYMMDDHHMMSS_terminal_access_grants.sql
--   2. Apply:        supabase db push  (or psql -f against the prod DB)
--   3. Smoke test:   SELECT * FROM public.terminal_access_grants LIMIT 1;
--                    expect: 0 rows, no error.
--   4. Verify RLS:   as a non-admin auth user → 0 rows on SELECT.
--                    as a Harbour admin       → 0 rows but no error.
--   5. Deploy the matching terminal-lookups + terminal-weighings code
--      changes (separate approval) — only after this migration is live.
-- ════════════════════════════════════════════════════════════════════;

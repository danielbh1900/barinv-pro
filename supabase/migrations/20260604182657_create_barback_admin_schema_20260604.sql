-- BARINV — create barback admin schema (Phase 3 MVP)
-- 2026-06-04
--
-- Creates the three tables required by the deployed barback admin Edge
-- Functions and the manager UI:
--
--   public.barback_sessions   — one row per shareable barback session
--   public.barback_pins       — hashed PIN per staff (1:1 with staff)
--   public.barback_audit_log  — append-only audit trail for session
--                                lifecycle + PIN rotation events
--
-- All three tables ENABLE ROW LEVEL SECURITY. No public policies are
-- added — Edge Functions write/read via the service_role client (which
-- bypasses RLS); the barback page uses a session-scoped JWT and never
-- queries these tables directly through PostgREST in the current MVP
-- flow. Policies for that JWT can be added incrementally as the page
-- evolves (Phase 3 RLS package is out of scope for this MVP unblock).
--
-- Safety properties:
--   • Uses CREATE TABLE / CREATE INDEX IF NOT EXISTS throughout — fully
--     idempotent against re-apply.
--   • No DROP, TRUNCATE, ALTER COLUMN type change, or any other
--     destructive change.
--   • No data backfill — every table is created empty.
--   • Foreign keys to existing public.venues / public.nights /
--     public.bars / public.staff are gated with safe ON DELETE
--     semantics (CASCADE for venue/night since sessions are scoped to
--     those; SET NULL for bar_id, issued_by, revoked_by, audit-log
--     references so historical rows survive a staff/bar delete).
--   • Forces PostgREST to reload its schema cache at the end so the
--     Data API sees the new tables immediately (without this the
--     "Could not find the table … in the schema cache" error can
--     persist for several minutes).

-- ──────────────────────────────────────────────────────────────────────
-- 1) public.barback_sessions
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.barback_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  night_id        uuid NOT NULL REFERENCES public.nights(id) ON DELETE CASCADE,
  bar_id          uuid REFERENCES public.bars(id) ON DELETE SET NULL,
  allowed_bars    uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  allowed_staff   uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  nickname        text,
  issued_by       uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  -- Manager UI session-list query (barback_manager.html L2119) reads
  -- pilot_mode / rehearsal_mode / issued_at as well; we include them
  -- here so that future Phase 5/6 telemetry features can land without
  -- another column-add migration. Defaults are safe ('not in pilot,
  -- not in rehearsal, issued now').
  issued_at       timestamptz NOT NULL DEFAULT now(),
  pilot_mode      boolean NOT NULL DEFAULT false,
  rehearsal_mode  boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_barback_sessions_venue_night
  ON public.barback_sessions(venue_id, night_id);

-- Partial index for the common "fetch live sessions" pattern used by
-- barback-close-night and the manager UI session listings.
CREATE INDEX IF NOT EXISTS idx_barback_sessions_live
  ON public.barback_sessions(venue_id, night_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.barback_sessions ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────
-- 2) public.barback_pins
-- ──────────────────────────────────────────────────────────────────────
-- One PIN per staff. PIN is stored as PBKDF2-HMAC-SHA-256 hash + salt
-- (see supabase/functions/_shared/pin.ts). Plaintext is surfaced ONCE
-- via barback-create-session / barback-rotate-pin response, never
-- persisted.
CREATE TABLE IF NOT EXISTS public.barback_pins (
  staff_id      uuid PRIMARY KEY REFERENCES public.staff(id) ON DELETE CASCADE,
  pin_hash      text NOT NULL,
  pin_salt      text NOT NULL,
  pin_algo      text NOT NULL,
  failed_count  integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  rotated_at    timestamptz NOT NULL DEFAULT now(),
  rotated_by    uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.barback_pins ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────
-- 3) public.barback_audit_log
-- ──────────────────────────────────────────────────────────────────────
-- Append-only. Both session_id and staff_id are nullable + ON DELETE
-- SET NULL so audit history survives the deletion of the parent row.
-- The action set used by the deployed Edge Functions includes:
--   'session_created'  'session_revoked'  'session_extended'
--   'pin_rotated'      'night_closed'
-- Plus future-reserved auth-side codes consumed by barback-login:
--   'login_bad_pin'    'login_rate_limited'   'login_no_pin_set'
--   'login_revoked_session'  'login_session_expired'
--   'login_staff_not_allowed'  'login_unknown_session'
--   'event_insert_blocked'
CREATE TABLE IF NOT EXISTS public.barback_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid REFERENCES public.barback_sessions(id) ON DELETE SET NULL,
  staff_id    uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  action      text NOT NULL,
  ip          text,
  user_agent  text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barback_audit_log_session
  ON public.barback_audit_log(session_id);

CREATE INDEX IF NOT EXISTS idx_barback_audit_log_action_time
  ON public.barback_audit_log(action, created_at DESC);

ALTER TABLE public.barback_audit_log ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────
-- 4) Force PostgREST schema-cache reload so the Data API picks up the
--    new tables immediately. Without this NOTIFY the existing
--    "Could not find the table 'public.barback_sessions' in the schema
--    cache" 404 can persist for ~minutes until the next periodic
--    reload.
-- ──────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';;

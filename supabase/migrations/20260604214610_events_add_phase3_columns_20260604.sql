-- BARINV — public.events Phase-3 column repair
-- 2026-06-04
--
-- The barback web-link page (barback.html, Phase 3 signed-JWT flow)
-- inserts source / staff_id / session_id on every save. Those columns
-- did not exist, so every Phase-3 save returned PostgREST PGRST204
-- "Could not find the 'source' column of 'events' in the schema cache"
-- and the row was silently queued forever in the page's offline Outbox.
-- The page's revoke detector does not match PGRST204 so no forced-logout
-- fires. The manager EXPORT EVENTS CSV path (.eq('source',…)) hit the
-- same error.
--
-- This migration is ADDITIVE ONLY. No NOT NULL, no CHECK, no DROP, no
-- backfill, no row mutation. FKs are loose (ON DELETE SET NULL) so
-- historical saves survive staff deletes. session_id is intentionally
-- not FK to barback_sessions because that table is RLS-isolated under
-- the service_role; leaving it un-referenced lets the existing
-- barback_user JWT insert it without policy edits.
--
-- Idempotent (IF NOT EXISTS throughout). Safe to re-apply.
-- Rollback: ALTER TABLE public.events DROP COLUMN IF EXISTS source,
--           DROP COLUMN IF EXISTS staff_id, DROP COLUMN IF EXISTS
--           session_id;  DROP INDEX IF EXISTS idx_events_source;
--           NOTIFY pgrst, 'reload schema';
--
-- DOES NOT add target_bartender_id — that belongs to a later
-- Bottle/Scale target-bartender feature and ships as a separate
-- migration paired with the matching barback.html UI.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS staff_id uuid
  REFERENCES public.staff(id) ON DELETE SET NULL;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS session_id uuid;

CREATE INDEX IF NOT EXISTS idx_events_source
  ON public.events(source)
  WHERE source IS NOT NULL;

NOTIFY pgrst, 'reload schema';;

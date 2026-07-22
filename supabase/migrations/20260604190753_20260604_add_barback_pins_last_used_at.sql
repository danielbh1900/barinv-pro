-- BARINV — additive: barback_pins.last_used_at observability column.
-- 2026-06-04
--
-- The PIN-aware barback-pin-login Edge Function records the last
-- successful PIN entry for observability ("when did this staff last
-- sign in to the barback page?"). The column is nullable so no row
-- backfill is needed and existing rows are untouched.
--
-- Safety:
--   • ADD COLUMN IF NOT EXISTS — idempotent.
--   • Nullable, no DEFAULT — no rewrite of existing rows.
--   • No DROP, TRUNCATE, ALTER COLUMN type change.
--   • NOTIFY pgrst at end so PostgREST picks up the new column
--     immediately without the ~5 min auto-reload wait.

ALTER TABLE public.barback_pins
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

NOTIFY pgrst, 'reload schema';;

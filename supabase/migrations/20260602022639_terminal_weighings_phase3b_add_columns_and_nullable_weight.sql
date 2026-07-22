-- Phase 3B — Scale storage table catch-up.
-- Add the 6 columns terminal-weighings v2 already writes via upsertWeighing
-- (quantity, mode, staff_code, night_id, bar_id, station_id), and relax
-- the NOT NULL on weight_g so REQUEST/DELIVERED modes (which use quantity
-- instead of weight) can also persist.
--
-- All 6 added columns are NULLABLE — no backfill required, no row breaks.
-- Table currently has 0 rows so the ALTERs are effectively instantaneous.
-- No FK references added on this migration (kept minimal); FKs to nights/
-- bars/stations can be added in a later hardening pass without breaking
-- the firmware contract.

ALTER TABLE public.terminal_weighings
  ADD COLUMN IF NOT EXISTS quantity   numeric NULL,
  ADD COLUMN IF NOT EXISTS mode       text    NULL,
  ADD COLUMN IF NOT EXISTS staff_code text    NULL,
  ADD COLUMN IF NOT EXISTS night_id   uuid    NULL,
  ADD COLUMN IF NOT EXISTS bar_id     uuid    NULL,
  ADD COLUMN IF NOT EXISTS station_id uuid    NULL;

ALTER TABLE public.terminal_weighings
  ALTER COLUMN weight_g DROP NOT NULL;;

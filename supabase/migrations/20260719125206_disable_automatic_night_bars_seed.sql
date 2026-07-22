-- BARINV PRO: new Nights start with zero active operational destinations.
-- This migration changes automation only; it does not modify table data.

drop trigger if exists nights_snapshot_bars_ai on public.nights;
drop function if exists public.snapshot_night_bars_on_insert();

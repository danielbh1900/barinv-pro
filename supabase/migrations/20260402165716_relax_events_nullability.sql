
-- Allow station_id and night_id to be nullable on events
-- Dispatch comps/shots may not have a station, and some events happen outside nights
ALTER TABLE public.events ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE public.events ALTER COLUMN night_id DROP NOT NULL;
ALTER TABLE public.events ALTER COLUMN unit_id DROP NOT NULL;
;


-- Add name alias column and location_id for quick access
ALTER TABLE public.pos_connections ADD COLUMN IF NOT EXISTS name text GENERATED ALWAYS AS (COALESCE(connection_name, provider)) STORED;
ALTER TABLE public.pos_connections ADD COLUMN IF NOT EXISTS location_id text;
-- Note: API keys should be stored in Supabase secrets, not in the DB.
-- But for UI display purposes, we store a masked reference.
ALTER TABLE public.pos_connections ADD COLUMN IF NOT EXISTS api_key_hint text;
;

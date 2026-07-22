
-- Copy any existing Square tokens from business_profile.settings into
-- pos_credentials. Zero-row on current DB (verified) but safe against
-- future rows that might have tokens.
INSERT INTO public.pos_credentials (venue_id, provider, access_token, location_id, created_at, updated_at)
SELECT
  venue_id,
  'square'::text,
  settings->>'square_access_token',
  NULLIF(settings->>'square_location_id', ''),
  now(),
  now()
FROM public.business_profile
WHERE venue_id IS NOT NULL
  AND settings ? 'square_access_token'
  AND NULLIF(settings->>'square_access_token', '') IS NOT NULL
ON CONFLICT (venue_id) DO UPDATE SET
  access_token = EXCLUDED.access_token,
  location_id = COALESCE(EXCLUDED.location_id, public.pos_credentials.location_id),
  updated_at = now();

-- Add square_connected flag for every business_profile whose venue now has
-- credentials in pos_credentials (replaces the token as the client-readable
-- signal).
UPDATE public.business_profile bp
SET settings = COALESCE(bp.settings, '{}'::jsonb) || '{"square_connected": true}'::jsonb
WHERE bp.venue_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.pos_credentials pc
    WHERE pc.venue_id = bp.venue_id AND pc.provider = 'square'
  )
  AND COALESCE(bp.settings->>'square_connected', 'false')::boolean = false;

-- Strip the raw token and location_id keys from business_profile.settings.
-- Nothing outside pos_credentials should hold these values.
UPDATE public.business_profile
SET settings = (COALESCE(settings, '{}'::jsonb) - 'square_access_token' - 'square_location_id')
WHERE settings ? 'square_access_token'
   OR settings ? 'square_location_id';
;

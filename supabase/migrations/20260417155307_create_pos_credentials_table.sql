
-- pos_credentials: server-only storage for POS provider credentials.
-- RLS is enabled with NO policies, so anon and authenticated roles cannot
-- read or write this table. Only service_role (which bypasses RLS) can
-- touch it, and only Edge Functions have access to the service_role key.

CREATE TABLE public.pos_credentials (
  venue_id UUID PRIMARY KEY REFERENCES public.venues(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'square',
  access_token TEXT NOT NULL,
  location_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_credentials ENABLE ROW LEVEL SECURITY;

-- No policies created. With RLS enabled and no policies, PostgREST denies
-- all access from anon/authenticated roles. Service role bypasses RLS.

REVOKE ALL ON public.pos_credentials FROM anon, authenticated;
GRANT ALL ON public.pos_credentials TO service_role;

COMMENT ON TABLE public.pos_credentials IS
  'Server-only POS credentials. Access via Edge Functions with service_role only. Never expose to client.';
COMMENT ON COLUMN public.pos_credentials.access_token IS
  'Provider access token. NEVER return this to clients.';

CREATE OR REPLACE FUNCTION public.touch_pos_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pos_credentials_set_updated_at
BEFORE UPDATE ON public.pos_credentials
FOR EACH ROW EXECUTE FUNCTION public.touch_pos_credentials_updated_at();
;

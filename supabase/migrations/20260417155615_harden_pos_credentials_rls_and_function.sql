
-- Explicit restrictive deny policy on pos_credentials. Redundant with
-- "RLS enabled + zero policies = deny all" but makes the intent
-- auditable and guards against someone later adding a permissive
-- policy by mistake.
CREATE POLICY "pos_credentials_deny_all_non_service"
  ON public.pos_credentials
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Pin the updated_at trigger's search_path (security linter fix).
CREATE OR REPLACE FUNCTION public.touch_pos_credentials_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
;

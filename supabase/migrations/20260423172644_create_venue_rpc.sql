CREATE OR REPLACE FUNCTION public.create_venue(
  p_name     text,
  p_address  text,
  p_phone    text,
  p_currency text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'create_venue: not authenticated';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'create_venue: name is required';
  END IF;

  INSERT INTO public.venues (name, address, phone, currency)
  VALUES (
    btrim(p_name),
    NULLIF(btrim(COALESCE(p_address, '')), ''),
    NULLIF(btrim(COALESCE(p_phone,   '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_currency, '')), ''), 'CAD')
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_venue(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_venue(text, text, text, text) TO authenticated;;

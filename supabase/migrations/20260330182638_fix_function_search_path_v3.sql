ALTER FUNCTION public.get_user_org_id() SET search_path = public;
ALTER FUNCTION public.get_venue_role(uuid) SET search_path = public;
ALTER FUNCTION public.has_min_role(uuid, user_role) SET search_path = public;
ALTER FUNCTION public.is_org_admin() SET search_path = public;
ALTER FUNCTION public.is_org_member(uuid) SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;;

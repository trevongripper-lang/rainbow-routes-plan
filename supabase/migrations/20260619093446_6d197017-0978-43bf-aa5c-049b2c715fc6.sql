
-- Lock down profiles: own row only via direct table SELECT
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Public-safe profile lookup for other users (display name, avatar, plan status only)
CREATE OR REPLACE FUNCTION public.get_public_profiles(_ids uuid[])
RETURNS TABLE(id uuid, display_name text, avatar_url text, is_pro boolean, plus_status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.avatar_url, COALESCE(p.is_pro,false) AS is_pro, p.plus_status
  FROM public.profiles p
  WHERE p.id = ANY(_ids);
$$;
REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

-- Revoke anon execute on auth-only helpers
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.redeem_promo_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text) TO authenticated;

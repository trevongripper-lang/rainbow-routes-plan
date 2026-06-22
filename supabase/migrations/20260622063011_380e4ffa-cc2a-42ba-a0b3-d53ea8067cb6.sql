DROP FUNCTION public.get_public_profiles(uuid[]);
CREATE FUNCTION public.get_public_profiles(_ids uuid[])
RETURNS TABLE(id uuid, display_name text, avatar_url text, is_pro boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id, p.display_name, p.avatar_url, COALESCE(p.is_pro, false) AS is_pro
  FROM public.profiles p
  WHERE p.id = ANY(_ids);
$function$;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;
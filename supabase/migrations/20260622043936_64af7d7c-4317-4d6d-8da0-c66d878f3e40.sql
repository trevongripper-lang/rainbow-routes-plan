CREATE OR REPLACE FUNCTION public.debug_whoami()
RETURNS TABLE(auth_uid uuid, auth_role text, current_db_user text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT auth.uid(), auth.role(), current_user::text;
$$;

GRANT EXECUTE ON FUNCTION public.debug_whoami() TO authenticated, anon, service_role;
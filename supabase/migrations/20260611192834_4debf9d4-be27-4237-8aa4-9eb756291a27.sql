
REVOKE EXECUTE ON FUNCTION public.unlock_destination(uuid, boolean, int) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.unlock_destination(uuid, boolean, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.grant_referral_credits(uuid, uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.grant_referral_credits(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public._maybe_grant_loyalty(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public._maybe_grant_loyalty(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.required_unlock_tier(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.required_unlock_tier(int) TO authenticated, service_role;

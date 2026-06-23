
-- Trigger functions: never meant to be called via the Data API.
REVOKE EXECUTE ON FUNCTION public.on_settlement_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_member_travel_on_flight() FROM PUBLIC, anon, authenticated;

-- Internal helpers: only called by other SECURITY DEFINER functions (which run as owner).
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;

-- Drop anon EXECUTE where authenticated is sufficient. Keep authenticated for app code.
REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_trip_events(uuid, numeric, integer, boolean) FROM anon;

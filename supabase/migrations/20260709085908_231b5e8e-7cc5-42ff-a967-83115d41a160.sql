
-- Lock down SECURITY DEFINER (and other) functions in public schema.
-- Revoke broad EXECUTE, then grant back only to roles that actually need to call each function via PostgREST/RPC.
-- Trigger functions do not need EXECUTE grants (triggers run as table owner).

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Ensure future functions default to no public execute
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Client RPCs (authenticated users)
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_trip_events(uuid, numeric, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debug_whoami() TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_member_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_destination(uuid, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trip_rating_aggregate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_trip_invite(text) TO authenticated;

-- Public (unauthenticated) preview of invite metadata
GRANT EXECUTE ON FUNCTION public.preview_trip_invite(text) TO anon, authenticated;

-- Service-role only (called from server functions/webhooks/cron)
GRANT EXECUTE ON FUNCTION public.required_unlock_tier(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_close_trips() TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_destination(uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_referral_credits(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fanout_notification(uuid, uuid, text, jsonb) TO service_role;

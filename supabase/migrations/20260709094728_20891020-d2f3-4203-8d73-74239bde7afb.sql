
-- Lock down SECURITY DEFINER function execution: revoke broad EXECUTE from
-- anon/authenticated on all public functions, then re-grant only those the
-- app actually calls via PostgREST/RPC or via authenticated server functions.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- Client (browser) RPC calls
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_trip_events(uuid, numeric, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trip_rating_aggregate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_trip_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_trip_invite(text) TO anon, authenticated;

-- Called from authenticated server functions (TanStack createServerFn with
-- requireSupabaseAuth middleware) — run as the signed-in user.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.required_unlock_tier(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_destination(uuid, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_member_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_close_trips() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debug_whoami() TO authenticated;

-- Note: trigger functions (handle_new_user, add_owner_as_member, on_*_insert,
-- check_*, sync_member_travel_on_flight, email_queue_wake, fanout_notification,
-- _maybe_grant_loyalty, grant_referral_credits, cleanup_rate_limits) and
-- service-role-only helpers (enqueue_email, read_email_batch, delete_email,
-- move_to_dlq, email_queue_dispatch) remain non-executable by anon/authenticated.
-- service_role retains EXECUTE via role defaults.

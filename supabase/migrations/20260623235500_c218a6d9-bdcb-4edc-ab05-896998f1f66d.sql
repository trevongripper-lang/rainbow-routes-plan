
-- The previous revoke didn't bite because EXECUTE was granted via PUBLIC.
-- Revoke from PUBLIC, then re-grant only to the roles that legitimately need it.

REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.match_trip_events(uuid, numeric, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_trip_events(uuid, numeric, integer, boolean) TO authenticated;

-- Internal RLS helpers: only the RLS engine (which runs as the function owner)
-- needs to call these; revoke from PUBLIC and keep an explicit authenticated
-- grant for the few app reads that still hit them directly.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_trip_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_member(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_trip_rating_aggregate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_rating_aggregate(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_promo_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_trip_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_trip_invite(text) TO authenticated;

-- preview_trip_invite must remain anon-callable: the /join/$token page calls
-- it before sign-in to show the invitation preview. Keep both grants.
REVOKE EXECUTE ON FUNCTION public.preview_trip_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_trip_invite(text) TO anon, authenticated;

-- Trigger-only / internal helpers: lock down PUBLIC too.
REVOKE EXECUTE ON FUNCTION public.on_settlement_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_member_travel_on_flight() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) FROM PUBLIC;

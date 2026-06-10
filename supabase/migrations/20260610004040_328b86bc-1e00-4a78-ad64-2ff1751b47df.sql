
REVOKE EXECUTE ON FUNCTION public.is_trip_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_owner_as_member() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_headcount_cap() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_trip_invite(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fanout_notification(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_comment_insert() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_cost_insert() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_member_insert() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auto_close_trips() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_trip_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trip_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) TO authenticated;

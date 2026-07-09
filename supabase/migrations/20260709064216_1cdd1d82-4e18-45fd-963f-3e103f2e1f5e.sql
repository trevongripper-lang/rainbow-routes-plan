
REVOKE ALL ON FUNCTION public.is_trip_co_organizer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_co_organizer(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_trip_organizer_or_co(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_organizer_or_co(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_trip_member_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_trip_member_role(uuid, uuid, text) TO authenticated;

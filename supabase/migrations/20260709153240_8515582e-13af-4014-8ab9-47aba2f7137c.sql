-- A. Grant EXECUTE on RLS helper functions to authenticated
GRANT EXECUTE ON FUNCTION
  public.is_trip_owner(uuid, uuid),
  public.is_trip_member(uuid, uuid),
  public.is_trip_co_organizer(uuid, uuid),
  public.is_trip_organizer_or_co(uuid, uuid),
  public.has_role(uuid, public.app_role)
TO authenticated;

-- B. Re-attach missing triggers (idempotent)

-- destinations
DROP TRIGGER IF EXISTS trg_destinations_add_owner_as_member ON public.destinations;
CREATE TRIGGER trg_destinations_add_owner_as_member
  AFTER INSERT ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();

DROP TRIGGER IF EXISTS trg_destinations_check_headcount_cap ON public.destinations;
CREATE TRIGGER trg_destinations_check_headcount_cap
  BEFORE INSERT OR UPDATE ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.check_headcount_cap();

DROP TRIGGER IF EXISTS trg_destinations_check_trip_date_order ON public.destinations;
CREATE TRIGGER trg_destinations_check_trip_date_order
  BEFORE INSERT OR UPDATE ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.check_trip_date_order();

-- trip_members
DROP TRIGGER IF EXISTS trg_trip_members_on_insert ON public.trip_members;
CREATE TRIGGER trg_trip_members_on_insert
  AFTER INSERT ON public.trip_members
  FOR EACH ROW EXECUTE FUNCTION public.on_member_insert();

-- trip_costs
DROP TRIGGER IF EXISTS trg_trip_costs_on_insert ON public.trip_costs;
CREATE TRIGGER trg_trip_costs_on_insert
  AFTER INSERT ON public.trip_costs
  FOR EACH ROW EXECUTE FUNCTION public.on_cost_insert();

-- comments
DROP TRIGGER IF EXISTS trg_comments_on_insert ON public.comments;
CREATE TRIGGER trg_comments_on_insert
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.on_comment_insert();

-- trip_settlements
DROP TRIGGER IF EXISTS trg_trip_settlements_on_insert ON public.trip_settlements;
CREATE TRIGGER trg_trip_settlements_on_insert
  AFTER INSERT ON public.trip_settlements
  FOR EACH ROW EXECUTE FUNCTION public.on_settlement_insert();

-- trip_flights
DROP TRIGGER IF EXISTS trg_trip_flights_sync_member_travel ON public.trip_flights;
CREATE TRIGGER trg_trip_flights_sync_member_travel
  AFTER INSERT OR UPDATE ON public.trip_flights
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_travel_on_flight();

-- auth.users → handle_new_user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

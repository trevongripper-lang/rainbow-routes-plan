DROP POLICY IF EXISTS "Users insert own comments" ON public.comments;
CREATE POLICY "Users insert own comments"
  ON public.comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_trip_member(destination_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own costs" ON public.trip_costs;
CREATE POLICY "Users insert own costs"
  ON public.trip_costs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_trip_member(destination_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own flights" ON public.trip_flights;
CREATE POLICY "Users insert own flights"
  ON public.trip_flights
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_trip_member(destination_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own stays" ON public.trip_stays;
CREATE POLICY "Users insert own stays"
  ON public.trip_stays
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_trip_member(destination_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own tickets" ON public.trip_tickets;
CREATE POLICY "Users insert own tickets"
  ON public.trip_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_trip_member(destination_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own votes" ON public.votes;
CREATE POLICY "Users insert own votes"
  ON public.votes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_trip_member(destination_id, auth.uid())
  );
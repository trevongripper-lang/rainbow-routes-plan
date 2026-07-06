DROP POLICY IF EXISTS "Owner can add members" ON public.trip_members;
CREATE POLICY "Owner can add members"
  ON public.trip_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_trip_owner(destination_id, auth.uid()));
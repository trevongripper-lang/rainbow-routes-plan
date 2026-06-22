DROP POLICY IF EXISTS "Members or owner read destinations" ON public.destinations;
CREATE POLICY "Members or owner read destinations" ON public.destinations
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_trip_owner(id, auth.uid())
    OR public.is_trip_member(id, auth.uid())
  );
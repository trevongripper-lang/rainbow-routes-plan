-- Allow all trip members (owner, co-organizers, plain members) to SEE
-- who else is invited to the same trip. Writes remain restricted to
-- organizers/co-organizers via the existing "Organizer or co-organizer
-- manages invites" ALL policy.
CREATE POLICY "Members read invites for their trips"
  ON public.trip_invites
  FOR SELECT
  TO authenticated
  USING (
    public.is_trip_member(destination_id, auth.uid())
    OR public.is_trip_owner(destination_id, auth.uid())
  );
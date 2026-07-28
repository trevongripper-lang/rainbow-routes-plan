-- 1. Add WITH CHECK to UPDATE policies mirroring USING conditions.

DROP POLICY IF EXISTS "Organizer or co-organizer update destinations" ON public.destinations;
CREATE POLICY "Organizer or co-organizer update destinations"
  ON public.destinations
  FOR UPDATE
  TO authenticated
  USING (is_trip_organizer_or_co(id, auth.uid()))
  WITH CHECK (
    is_trip_organizer_or_co(id, auth.uid())
    AND user_id IS NOT NULL
  );

DROP POLICY IF EXISTS "Author or organizers update costs" ON public.trip_costs;
CREATE POLICY "Author or organizers update costs"
  ON public.trip_costs
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid()))
  WITH CHECK ((auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Author or organizers update flights" ON public.trip_flights;
CREATE POLICY "Author or organizers update flights"
  ON public.trip_flights
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid()))
  WITH CHECK ((auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Author or organizers update stays" ON public.trip_stays;
CREATE POLICY "Author or organizers update stays"
  ON public.trip_stays
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid()))
  WITH CHECK ((auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Author or organizers update tickets" ON public.trip_tickets;
CREATE POLICY "Author or organizers update tickets"
  ON public.trip_tickets
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid()))
  WITH CHECK ((auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid()));

-- Trigger-level guard: prevent tampering with user_id / destination_id on update.
-- WITH CHECK cannot compare NEW vs OLD, so enforce immutability via trigger.
CREATE OR REPLACE FUNCTION public._prevent_owner_or_trip_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable';
  END IF;
  IF TG_TABLE_NAME <> 'destinations' AND NEW.destination_id IS DISTINCT FROM OLD.destination_id THEN
    RAISE EXCEPTION 'destination_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_destinations_owner_reassignment ON public.destinations;
CREATE TRIGGER prevent_destinations_owner_reassignment
  BEFORE UPDATE ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public._prevent_owner_or_trip_reassignment();

DROP TRIGGER IF EXISTS prevent_trip_costs_reassignment ON public.trip_costs;
CREATE TRIGGER prevent_trip_costs_reassignment
  BEFORE UPDATE ON public.trip_costs
  FOR EACH ROW EXECUTE FUNCTION public._prevent_owner_or_trip_reassignment();

DROP TRIGGER IF EXISTS prevent_trip_flights_reassignment ON public.trip_flights;
CREATE TRIGGER prevent_trip_flights_reassignment
  BEFORE UPDATE ON public.trip_flights
  FOR EACH ROW EXECUTE FUNCTION public._prevent_owner_or_trip_reassignment();

DROP TRIGGER IF EXISTS prevent_trip_stays_reassignment ON public.trip_stays;
CREATE TRIGGER prevent_trip_stays_reassignment
  BEFORE UPDATE ON public.trip_stays
  FOR EACH ROW EXECUTE FUNCTION public._prevent_owner_or_trip_reassignment();

DROP TRIGGER IF EXISTS prevent_trip_tickets_reassignment ON public.trip_tickets;
CREATE TRIGGER prevent_trip_tickets_reassignment
  BEFORE UPDATE ON public.trip_tickets
  FOR EACH ROW EXECUTE FUNCTION public._prevent_owner_or_trip_reassignment();

-- 2. Exclude anonymous sign-in sessions from destination cover / draft storage policies.
-- The `authenticated` role includes anonymous auth sessions when anonymous
-- sign-ins are enabled; add an is_anonymous JWT check to lock these to fully
-- signed-in users only.

DROP POLICY IF EXISTS "Members or owner view destination covers" ON storage.objects;
CREATE POLICY "Members or owner view destination covers"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    (COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
    AND bucket_id = 'destination-covers'
    AND EXISTS (
      SELECT 1 FROM public.destinations d
      WHERE (d.id)::text = split_part(objects.name, '/', 1)
        AND (d.user_id = auth.uid() OR public.is_trip_member(d.id, auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Owners can delete their destination covers" ON storage.objects;
CREATE POLICY "Owners can delete their destination covers"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    (COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
    AND bucket_id = 'destination-covers'
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "Owners can update their destination covers" ON storage.objects;
CREATE POLICY "Owners can update their destination covers"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    (COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
    AND bucket_id = 'destination-covers'
    AND owner = auth.uid()
  )
  WITH CHECK (
    (COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
    AND bucket_id = 'destination-covers'
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "drafts owner select" ON storage.objects;
CREATE POLICY "drafts owner select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    (COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
    AND bucket_id = 'destination-cover-drafts'
    AND (storage.foldername(name))[1] = 'drafts'
    AND (storage.foldername(name))[2] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "drafts owner update" ON storage.objects;
CREATE POLICY "drafts owner update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    (COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
    AND bucket_id = 'destination-cover-drafts'
    AND (storage.foldername(name))[1] = 'drafts'
    AND (storage.foldername(name))[2] = (auth.uid())::text
  )
  WITH CHECK (
    (COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
    AND bucket_id = 'destination-cover-drafts'
    AND (storage.foldername(name))[1] = 'drafts'
    AND (storage.foldername(name))[2] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "drafts owner delete" ON storage.objects;
CREATE POLICY "drafts owner delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    (COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
    AND bucket_id = 'destination-cover-drafts'
    AND (storage.foldername(name))[1] = 'drafts'
    AND (storage.foldername(name))[2] = (auth.uid())::text
  );

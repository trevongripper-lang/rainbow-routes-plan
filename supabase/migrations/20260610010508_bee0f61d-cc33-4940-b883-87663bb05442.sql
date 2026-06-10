CREATE TABLE public.trip_events (
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (destination_id, event_id)
);

GRANT SELECT, INSERT, DELETE ON public.trip_events TO authenticated;
GRANT ALL ON public.trip_events TO service_role;

ALTER TABLE public.trip_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view trip_events"
ON public.trip_events FOR SELECT TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()));

CREATE POLICY "Members can attach events"
ON public.trip_events FOR INSERT TO authenticated
WITH CHECK (public.is_trip_member(destination_id, auth.uid()) AND added_by = auth.uid());

CREATE POLICY "Members can detach events"
ON public.trip_events FOR DELETE TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()));

CREATE INDEX trip_events_dest_idx ON public.trip_events(destination_id);
CREATE INDEX trip_events_event_idx ON public.trip_events(event_id);
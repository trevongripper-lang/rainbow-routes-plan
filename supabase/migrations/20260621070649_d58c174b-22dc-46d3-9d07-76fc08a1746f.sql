
-- Itinerary per-day order
CREATE TABLE public.trip_itinerary_order (
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  day_key text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (destination_id, item_key)
);
CREATE INDEX idx_itinerary_order_day ON public.trip_itinerary_order (destination_id, day_key, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_itinerary_order TO authenticated;
GRANT ALL ON public.trip_itinerary_order TO service_role;

ALTER TABLE public.trip_itinerary_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members read order"
ON public.trip_itinerary_order FOR SELECT TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()));

CREATE POLICY "Trip members write order"
ON public.trip_itinerary_order FOR INSERT TO authenticated
WITH CHECK (public.is_trip_member(destination_id, auth.uid()));

CREATE POLICY "Trip members update order"
ON public.trip_itinerary_order FOR UPDATE TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()))
WITH CHECK (public.is_trip_member(destination_id, auth.uid()));

CREATE POLICY "Trip members delete order"
ON public.trip_itinerary_order FOR DELETE TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()));


-- Analytics events
CREATE TABLE public.analytics_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  destination_id uuid REFERENCES public.destinations(id) ON DELETE SET NULL,
  event text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_analytics_events_event_created ON public.analytics_events (event, created_at DESC);
CREATE INDEX idx_analytics_events_created ON public.analytics_events (created_at DESC);

GRANT SELECT, INSERT ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can insert events tagged to themselves (or anonymous null user)
CREATE POLICY "Insert own analytics events"
ON public.analytics_events FOR INSERT TO authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Only admins can read analytics
CREATE POLICY "Admins read analytics"
ON public.analytics_events FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

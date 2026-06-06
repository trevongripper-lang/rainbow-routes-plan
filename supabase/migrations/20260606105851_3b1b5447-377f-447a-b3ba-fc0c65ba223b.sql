CREATE TABLE public.trip_flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL,
  user_id uuid NOT NULL,
  passenger_name text,
  airline text,
  flight_number text,
  flight_date date,
  depart_airport text,
  arrive_airport text,
  depart_time text,
  arrive_time text,
  confirmation text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_flights TO authenticated;
GRANT ALL ON public.trip_flights TO service_role;

ALTER TABLE public.trip_flights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Flights viewable by authenticated" ON public.trip_flights FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own flights" ON public.trip_flights FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own flights" ON public.trip_flights FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own flights" ON public.trip_flights FOR DELETE TO authenticated USING (auth.uid() = user_id);
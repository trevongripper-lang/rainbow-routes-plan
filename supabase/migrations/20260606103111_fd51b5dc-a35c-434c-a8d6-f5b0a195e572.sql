
ALTER TABLE public.destinations ADD COLUMN IF NOT EXISTS headcount integer NOT NULL DEFAULT 2;

CREATE TABLE public.trip_stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  url text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_stays TO authenticated;
GRANT ALL ON public.trip_stays TO service_role;
ALTER TABLE public.trip_stays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Stays viewable by authenticated" ON public.trip_stays FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own stays" ON public.trip_stays FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own stays" ON public.trip_stays FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own stays" ON public.trip_stays FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.trip_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  url text,
  price_cents integer,
  currency text NOT NULL DEFAULT 'USD',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_tickets TO authenticated;
GRANT ALL ON public.trip_tickets TO service_role;
ALTER TABLE public.trip_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tickets viewable by authenticated" ON public.trip_tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own tickets" ON public.trip_tickets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own tickets" ON public.trip_tickets FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own tickets" ON public.trip_tickets FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.trip_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  category text NOT NULL,
  label text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  is_shared boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_costs TO authenticated;
GRANT ALL ON public.trip_costs TO service_role;
ALTER TABLE public.trip_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Costs viewable by authenticated" ON public.trip_costs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own costs" ON public.trip_costs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own costs" ON public.trip_costs FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own costs" ON public.trip_costs FOR DELETE TO authenticated USING (auth.uid() = user_id);

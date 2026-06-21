
-- trip_stays additions
ALTER TABLE public.trip_stays
  ADD COLUMN IF NOT EXISTS check_in date,
  ADD COLUMN IF NOT EXISTS check_out date,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS nightly_rate_cents integer,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS confirmation text,
  ADD COLUMN IF NOT EXISTS booked_by uuid,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- trip_costs additions
ALTER TABLE public.trip_costs
  ADD COLUMN IF NOT EXISTS cost_date date,
  ADD COLUMN IF NOT EXISTS split_mode text DEFAULT 'equal_all',
  ADD COLUMN IF NOT EXISTS split_member_ids uuid[],
  ADD COLUMN IF NOT EXISTS split_shares jsonb;

-- destinations: trip default currency
ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS default_currency text DEFAULT 'USD';

-- trip_settlements: records mark-as-paid between members
CREATE TABLE IF NOT EXISTS public.trip_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  from_user uuid NOT NULL,
  to_user uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  note text,
  settled_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_settlements TO authenticated;
GRANT ALL ON public.trip_settlements TO service_role;

ALTER TABLE public.trip_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members can view settlements"
  ON public.trip_settlements FOR SELECT
  TO authenticated
  USING (public.is_trip_member(destination_id, auth.uid()));

CREATE POLICY "Involved members can create settlements"
  ON public.trip_settlements FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_trip_member(destination_id, auth.uid())
    AND created_by = auth.uid()
    AND (auth.uid() = from_user OR auth.uid() = to_user)
  );

CREATE POLICY "Creator can delete their settlements"
  ON public.trip_settlements FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

CREATE INDEX IF NOT EXISTS trip_settlements_dest_idx ON public.trip_settlements(destination_id);

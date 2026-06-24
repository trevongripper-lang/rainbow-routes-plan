ALTER TABLE public.trip_costs
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS trip_costs_source_unique
  ON public.trip_costs (source_kind, source_id)
  WHERE source_id IS NOT NULL;
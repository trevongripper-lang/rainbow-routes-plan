ALTER TABLE public.destinations
  ADD CONSTRAINT destinations_headcount_free_plan_max
  CHECK (headcount IS NULL OR (headcount >= 1 AND headcount <= 5));
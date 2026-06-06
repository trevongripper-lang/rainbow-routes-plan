
-- Past trips + ratings + map coords
ALTER TABLE public.destinations ADD COLUMN IF NOT EXISTS is_past boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS longitude double precision;

CREATE TABLE IF NOT EXISTS public.trip_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (destination_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_ratings TO authenticated;
GRANT ALL ON public.trip_ratings TO service_role;

ALTER TABLE public.trip_ratings ENABLE ROW LEVEL SECURITY;

-- Users can ONLY see their own rating row (individual feedback hidden from others)
CREATE POLICY "Users select own rating" ON public.trip_ratings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own rating" ON public.trip_ratings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own rating" ON public.trip_ratings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own rating" ON public.trip_ratings FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Security definer aggregate function — returns anonymized aggregated feedback
CREATE OR REPLACE FUNCTION public.get_trip_rating_aggregate(_destination_id uuid)
RETURNS TABLE (avg_rating numeric, rating_count bigint, feedbacks text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ROUND(AVG(rating)::numeric, 2) AS avg_rating,
    COUNT(*)::bigint AS rating_count,
    COALESCE(
      ARRAY_AGG(feedback ORDER BY random()) FILTER (WHERE feedback IS NOT NULL AND length(trim(feedback)) > 0),
      ARRAY[]::text[]
    ) AS feedbacks
  FROM public.trip_ratings
  WHERE destination_id = _destination_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_trip_rating_aggregate(uuid) TO authenticated;

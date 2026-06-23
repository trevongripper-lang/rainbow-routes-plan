
-- 1) Add accuracy/metadata columns to events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence_notes text;

-- Backfill source_url from existing url where empty
UPDATE public.events SET source_url = url WHERE source_url IS NULL AND url IS NOT NULL;

-- 2) Create event_reports table
CREATE TABLE IF NOT EXISTS public.event_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  destination_id uuid REFERENCES public.destinations(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('incorrect_info','not_relevant','wrong_location','wrong_date','duplicate','other')),
  note text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id, reason)
);

GRANT SELECT, INSERT ON public.event_reports TO authenticated;
GRANT ALL ON public.event_reports TO service_role;

ALTER TABLE public.event_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can report events"
  ON public.event_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users see their own reports"
  ON public.event_reports FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS event_reports_event_idx ON public.event_reports(event_id);

-- 3) Rewrite match_trip_events: add match_score, rank exact city/date matches first
DROP FUNCTION IF EXISTS public.match_trip_events(uuid, numeric, integer, boolean);

CREATE OR REPLACE FUNCTION public.match_trip_events(
  _dest uuid,
  _radius_miles numeric DEFAULT 100,
  _buffer_days integer DEFAULT 30,
  _include_outside_dates boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  name text,
  region text,
  city text,
  country text,
  start_date date,
  end_date date,
  url text,
  tags text,
  latitude double precision,
  longitude double precision,
  distance_miles numeric,
  verified boolean,
  match_score integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d_lat double precision;
  d_lng double precision;
  d_region text;
  d_country text;
  d_city text;
  d_title text;
  d_start date;
  d_end date;
  has_coords boolean;
  has_dates boolean;
  buf int := GREATEST(COALESCE(_buffer_days, 0), 0);
  rad numeric := GREATEST(COALESCE(_radius_miles, 0), 0);
BEGIN
  SELECT d.latitude, d.longitude, d.region, d.country, d.city, d.title, d.start_date, d.end_date
    INTO d_lat, d_lng, d_region, d_country, d_city, d_title, d_start, d_end
  FROM public.destinations d
  WHERE d.id = _dest;

  IF NOT FOUND THEN RETURN; END IF;

  has_coords := d_lat IS NOT NULL AND d_lng IS NOT NULL;
  has_dates := d_start IS NOT NULL AND d_end IS NOT NULL;

  RETURN QUERY
  WITH scored AS (
    SELECT
      e.id, e.name, e.region, e.city, e.country,
      e.start_date, e.end_date, e.url, e.tags,
      e.latitude, e.longitude, e.verified,
      CASE
        WHEN has_coords AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL THEN
          ROUND((3958.8 * 2 * asin(sqrt(
            power(sin(radians((e.latitude - d_lat) / 2)), 2)
            + cos(radians(d_lat)) * cos(radians(e.latitude))
              * power(sin(radians((e.longitude - d_lng) / 2)), 2)
          )))::numeric, 1)
        ELSE NULL
      END AS distance_miles,
      -- date overlap within trip window
      (has_dates AND e.start_date <= d_end AND COALESCE(e.end_date, e.start_date) >= d_start) AS in_dates,
      -- date overlap within buffered window
      (has_dates AND e.start_date <= (d_end + (buf || ' days')::interval)::date
                AND COALESCE(e.end_date, e.start_date) >= (d_start - (buf || ' days')::interval)::date) AS in_buffer,
      -- exact city match (case-insensitive)
      (
        (d_city IS NOT NULL AND lower(trim(e.city)) = lower(trim(d_city)))
        OR (d_title IS NOT NULL AND lower(trim(e.city)) = lower(trim(d_title)))
      ) AS city_match,
      (d_region IS NOT NULL AND lower(trim(e.region)) = lower(trim(d_region))) AS region_match,
      (d_country IS NOT NULL AND lower(trim(e.country)) = lower(trim(d_country))) AS country_match
    FROM public.events e
  )
  SELECT
    s.id, s.name, s.region, s.city, s.country,
    s.start_date, s.end_date, s.url, s.tags,
    s.latitude, s.longitude, s.distance_miles, s.verified,
    (
      CASE WHEN s.city_match AND s.in_dates THEN 100
           WHEN s.distance_miles IS NOT NULL AND s.distance_miles <= rad AND s.in_dates THEN 85
           WHEN s.city_match AND s.in_buffer THEN 75
           WHEN s.distance_miles IS NOT NULL AND s.distance_miles <= rad AND s.in_buffer THEN 65
           WHEN s.region_match AND s.in_buffer THEN 45
           WHEN s.country_match AND s.in_buffer THEN 35
           WHEN s.city_match THEN 30
           WHEN s.distance_miles IS NOT NULL AND s.distance_miles <= rad THEN 25
           WHEN s.region_match THEN 15
           WHEN s.country_match THEN 10
           ELSE 0
      END
      + CASE WHEN s.verified THEN 5 ELSE 0 END
    )::int AS match_score
  FROM scored s
  WHERE
    (
      (s.distance_miles IS NOT NULL AND s.distance_miles <= rad)
      OR s.city_match
      OR (
        (s.distance_miles IS NULL)
        AND (s.region_match OR s.country_match)
      )
    )
    AND (_include_outside_dates OR NOT has_dates OR s.in_buffer)
  ORDER BY match_score DESC,
           (has_dates AND s.in_dates) DESC NULLS LAST,
           s.start_date ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_trip_events(uuid, numeric, integer, boolean) TO authenticated;

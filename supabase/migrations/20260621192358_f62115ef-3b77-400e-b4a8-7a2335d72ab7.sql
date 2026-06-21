CREATE OR REPLACE FUNCTION public.match_trip_events(_dest uuid, _radius_miles numeric DEFAULT 100, _buffer_days integer DEFAULT 30, _include_outside_dates boolean DEFAULT false)
 RETURNS TABLE(id uuid, name text, region text, city text, country text, start_date date, end_date date, url text, tags text, latitude double precision, longitude double precision, distance_miles numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d_lat double precision;
  d_lng double precision;
  d_region text;
  d_country text;
  d_start date;
  d_end date;
  has_coords boolean;
  has_dates boolean;
  buf int := GREATEST(COALESCE(_buffer_days, 0), 0);
  rad numeric := GREATEST(COALESCE(_radius_miles, 0), 0);
BEGIN
  SELECT d.latitude, d.longitude, d.region, d.country, d.start_date, d.end_date
    INTO d_lat, d_lng, d_region, d_country, d_start, d_end
  FROM public.destinations d
  WHERE d.id = _dest;

  IF NOT FOUND THEN RETURN; END IF;

  has_coords := d_lat IS NOT NULL AND d_lng IS NOT NULL;
  has_dates := d_start IS NOT NULL AND d_end IS NOT NULL;

  RETURN QUERY
  SELECT
    e.id, e.name, e.region, e.city, e.country,
    e.start_date, e.end_date, e.url, e.tags,
    e.latitude, e.longitude,
    CASE
      WHEN has_coords AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL THEN
        ROUND(
          (3958.8 * 2 * asin(sqrt(
            power(sin(radians((e.latitude - d_lat) / 2)), 2)
            + cos(radians(d_lat)) * cos(radians(e.latitude))
              * power(sin(radians((e.longitude - d_lng) / 2)), 2)
          )))::numeric,
          1
        )
      ELSE NULL
    END AS distance_miles
  FROM public.events e
  WHERE
    (
      (has_coords AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL
        AND (3958.8 * 2 * asin(sqrt(
              power(sin(radians((e.latitude - d_lat) / 2)), 2)
              + cos(radians(d_lat)) * cos(radians(e.latitude))
                * power(sin(radians((e.longitude - d_lng) / 2)), 2)
            ))) <= rad)
      OR (
        (NOT has_coords OR e.latitude IS NULL OR e.longitude IS NULL)
        AND (
          (d_region IS NOT NULL AND lower(trim(e.region)) = lower(trim(d_region)))
          OR (d_country IS NOT NULL AND lower(trim(e.country)) = lower(trim(d_country)))
        )
      )
    )
    AND (
      _include_outside_dates
      OR NOT has_dates
      OR (
        e.start_date <= (d_end + (buf || ' days')::interval)::date
        AND COALESCE(e.end_date, e.start_date) >= (d_start - (buf || ' days')::interval)::date
      )
    )
  ORDER BY
    (has_dates AND e.start_date BETWEEN d_start AND d_end) DESC NULLS LAST,
    e.start_date ASC;
END;
$function$;
ALTER TABLE public.destinations ADD COLUMN IF NOT EXISTS start_date date;

CREATE OR REPLACE FUNCTION public.check_trip_date_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL AND NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'Trip end date cannot be before start date' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_trip_date_order ON public.destinations;
CREATE TRIGGER trg_check_trip_date_order
BEFORE INSERT OR UPDATE ON public.destinations
FOR EACH ROW EXECUTE FUNCTION public.check_trip_date_order();
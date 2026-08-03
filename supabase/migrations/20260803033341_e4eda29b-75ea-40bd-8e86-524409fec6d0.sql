BEGIN;

CREATE OR REPLACE FUNCTION public._prevent_owner_or_trip_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable';
  END IF;

  IF TG_TABLE_NAME <> 'destinations' THEN
    IF NEW.destination_id IS DISTINCT FROM OLD.destination_id THEN
      RAISE EXCEPTION 'destination_id is immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
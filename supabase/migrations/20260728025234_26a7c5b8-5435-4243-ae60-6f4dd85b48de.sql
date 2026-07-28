CREATE OR REPLACE FUNCTION public.on_cost_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.fanout_notification(
    NEW.destination_id,
    NEW.user_id,
    'cost_added',
    jsonb_build_object(
      'label', NEW.label,
      'amount_cents', NEW.amount_cents,
      'currency', NEW.currency
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_on_cost_insert ON public.trip_costs;

DO $blk$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'public.trip_costs'::regclass
    AND NOT t.tgisinternal
    AND t.tgname = 'trg_trip_costs_on_insert'
    AND p.proname = 'on_cost_insert'
    AND p.pronamespace = 'public'::regnamespace;
  IF n <> 1 THEN
    RAISE EXCEPTION 'canonical trigger trg_trip_costs_on_insert missing or misconfigured (found %)', n;
  END IF;

  SELECT count(*) INTO n
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.trip_costs'::regclass
    AND NOT t.tgisinternal
    AND t.tgfoid = 'public.on_cost_insert()'::regprocedure;
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one on_cost_insert trigger on trip_costs, found %', n;
  END IF;
END $blk$;
-- end of migration

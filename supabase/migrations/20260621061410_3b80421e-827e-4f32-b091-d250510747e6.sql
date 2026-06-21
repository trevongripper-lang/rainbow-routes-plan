
CREATE OR REPLACE FUNCTION public.on_settlement_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fanout_notification(
    NEW.destination_id,
    NEW.created_by,
    'settlement_recorded',
    jsonb_build_object(
      'settlement_id', NEW.id,
      'from_user', NEW.from_user,
      'to_user', NEW.to_user,
      'amount_cents', NEW.amount_cents,
      'currency', NEW.currency,
      'note', NEW.note
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_settlement_insert ON public.trip_settlements;
CREATE TRIGGER trg_on_settlement_insert
AFTER INSERT ON public.trip_settlements
FOR EACH ROW EXECUTE FUNCTION public.on_settlement_insert();

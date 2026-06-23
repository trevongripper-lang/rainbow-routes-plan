
-- Trip-level opt-outs (owner controlled)
ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS dates_locked    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stay_not_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_shared_costs boolean NOT NULL DEFAULT false;

-- Per-member commitment
ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'invited',
  ADD COLUMN IF NOT EXISTS travel_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.trip_members
  DROP CONSTRAINT IF EXISTS trip_members_status_check,
  DROP CONSTRAINT IF EXISTS trip_members_travel_status_check;
ALTER TABLE public.trip_members
  ADD CONSTRAINT trip_members_status_check
    CHECK (status IN ('invited','confirmed','declined')),
  ADD CONSTRAINT trip_members_travel_status_check
    CHECK (travel_status IN ('pending','booked','not_needed'));

-- Backfill: owners are confirmed; members with a flight confirmation are booked
UPDATE public.trip_members SET status = 'confirmed' WHERE role = 'owner';

UPDATE public.trip_members m
SET travel_status = 'booked'
WHERE travel_status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.trip_flights f
    WHERE f.destination_id = m.destination_id
      AND f.user_id = m.user_id
      AND f.confirmation IS NOT NULL
      AND length(trim(f.confirmation)) > 0
  );

-- Keep travel_status in sync when a flight confirmation lands
CREATE OR REPLACE FUNCTION public.sync_member_travel_on_flight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.confirmation IS NOT NULL AND length(trim(NEW.confirmation)) > 0 THEN
    UPDATE public.trip_members
      SET travel_status = 'booked'
      WHERE destination_id = NEW.destination_id
        AND user_id = NEW.user_id
        AND travel_status <> 'not_needed';  -- respect opt-out
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_member_travel_on_flight ON public.trip_flights;
CREATE TRIGGER trg_sync_member_travel_on_flight
AFTER INSERT OR UPDATE OF confirmation ON public.trip_flights
FOR EACH ROW EXECUTE FUNCTION public.sync_member_travel_on_flight();

-- RLS: members can update their own commitment fields; owner can update any
DROP POLICY IF EXISTS "Members update own commitment" ON public.trip_members;
CREATE POLICY "Members update own commitment" ON public.trip_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_trip_owner(destination_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_trip_owner(destination_id, auth.uid()));

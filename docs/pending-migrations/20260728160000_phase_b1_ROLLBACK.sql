-- Phase B1 rollback — restores schema shape only.
--
-- IMPORTANT: rollback CANNOT restore personal data. If any subsequent
-- deletion job has already NULLed a user_id / booked_by / created_by column,
-- re-tightening NOT NULL below will FAIL, and that is the correct behaviour:
-- the migration MUST NOT synthesize a placeholder user to satisfy the
-- constraint. In that case do not apply this rollback and instead resolve
-- via a data-restoration path (which does not exist by design — D-1).
--
-- Precondition: 20260728160000_phase_b1_user_fks_expand.sql was applied.

BEGIN;

-- Drop added FKs (SET NULL group)
ALTER TABLE public.trip_costs        DROP CONSTRAINT IF EXISTS trip_costs_user_id_fkey;
ALTER TABLE public.trip_settlements  DROP CONSTRAINT IF EXISTS trip_settlements_from_user_fkey;
ALTER TABLE public.trip_settlements  DROP CONSTRAINT IF EXISTS trip_settlements_to_user_fkey;
ALTER TABLE public.trip_settlements  DROP CONSTRAINT IF EXISTS trip_settlements_created_by_fkey;
ALTER TABLE public.trip_stays        DROP CONSTRAINT IF EXISTS trip_stays_user_id_fkey;
ALTER TABLE public.trip_stays        DROP CONSTRAINT IF EXISTS trip_stays_booked_by_fkey;
ALTER TABLE public.trip_flights      DROP CONSTRAINT IF EXISTS trip_flights_user_id_fkey;
ALTER TABLE public.trip_polls        DROP CONSTRAINT IF EXISTS trip_polls_user_id_fkey;
ALTER TABLE public.storage_object_trip DROP CONSTRAINT IF EXISTS storage_object_trip_uploaded_by_fkey;
ALTER TABLE public.destinations      DROP CONSTRAINT IF EXISTS destinations_unlocked_by_fkey;

-- Drop added FKs (CASCADE group)
ALTER TABLE public.trip_tickets      DROP CONSTRAINT IF EXISTS trip_tickets_user_id_fkey;
ALTER TABLE public.trip_ratings      DROP CONSTRAINT IF EXISTS trip_ratings_user_id_fkey;
ALTER TABLE public.trip_poll_votes   DROP CONSTRAINT IF EXISTS trip_poll_votes_user_id_fkey;
ALTER TABLE public.promo_redemptions DROP CONSTRAINT IF EXISTS promo_redemptions_user_id_fkey;

-- Re-tighten NOT NULL (will FAIL if any row is now NULL — see header note)
ALTER TABLE public.trip_costs        ALTER COLUMN user_id    SET NOT NULL;
ALTER TABLE public.trip_settlements  ALTER COLUMN from_user  SET NOT NULL;
ALTER TABLE public.trip_settlements  ALTER COLUMN to_user    SET NOT NULL;
ALTER TABLE public.trip_settlements  ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE public.trip_stays        ALTER COLUMN user_id    SET NOT NULL;
ALTER TABLE public.trip_flights      ALTER COLUMN user_id    SET NOT NULL;
ALTER TABLE public.trip_polls        ALTER COLUMN user_id    SET NOT NULL;
ALTER TABLE public.storage_object_trip ALTER COLUMN uploaded_by SET NOT NULL;

-- Restore trip_events.added_by → CASCADE + NOT NULL
ALTER TABLE public.trip_events DROP CONSTRAINT IF EXISTS trip_events_added_by_fkey;
ALTER TABLE public.trip_events ALTER COLUMN added_by SET NOT NULL;
ALTER TABLE public.trip_events
  ADD CONSTRAINT trip_events_added_by_fkey
    FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;

-- ============================================================================
-- Phase B1 — Schema expand: user-reference FK backfills + approved nullability
-- ============================================================================
-- Scope: ONLY schema. No deletion worker, no retention jobs, no UI, no
-- privacy copy, no headers. Decisions codified in
-- docs/beta-gate/pending-decisions.md (D-1 through D-20, resolved 2026-07-28).
--
-- Fail-closed preflight: aborts if any orphan user reference exists on the
-- target columns. The earlier 2026-07-28 zero-orphan result is evidence, not
-- a guarantee that state has not shifted before this migration runs.
--
-- Strategy: FK ADD is done with NOT VALID to avoid a long lock, then
-- VALIDATE CONSTRAINT in the same transaction (preflight already proved
-- validation is O(0)-cost). NOT NULL is dropped in the same transaction on
-- columns that must be settable to NULL by ON DELETE SET NULL.
--
-- Deterministic constraint names: <table>_<column>_fkey. If a constraint of
-- that name already exists (per the audit only `trip_events.added_by` does),
-- it is DROPPED first so the new definition (SET NULL) replaces the old one
-- (CASCADE) under the same name. No IF EXISTS wildcards, no broad EXCEPTION
-- handling — the migration will surface any unexpected schema conflict.
--
-- Rollback: docs/pending-migrations/20260728160000_phase_b1_ROLLBACK.sql
-- Rollback restores schema shape (re-tightens NOT NULL, restores CASCADE on
-- trip_events.added_by, drops added FKs). Rollback DOES NOT and CANNOT
-- restore personal columns that a later deletion job has already erased —
-- that erasure is intentionally irreversible under D-1.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight: fail-closed orphan audit.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  orphan_count int;
  offender text;
BEGIN
  FOR offender, orphan_count IN
    SELECT * FROM (VALUES
      ('trip_costs.user_id',
        (SELECT count(*) FROM public.trip_costs x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))),
      ('trip_stays.user_id',
        (SELECT count(*) FROM public.trip_stays x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))),
      ('trip_stays.booked_by',
        (SELECT count(*) FROM public.trip_stays x WHERE x.booked_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.booked_by))),
      ('trip_flights.user_id',
        (SELECT count(*) FROM public.trip_flights x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))),
      ('trip_tickets.user_id',
        (SELECT count(*) FROM public.trip_tickets x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))),
      ('trip_ratings.user_id',
        (SELECT count(*) FROM public.trip_ratings x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))),
      ('trip_polls.user_id',
        (SELECT count(*) FROM public.trip_polls x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))),
      ('trip_poll_votes.user_id',
        (SELECT count(*) FROM public.trip_poll_votes x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))),
      ('trip_settlements.from_user',
        (SELECT count(*) FROM public.trip_settlements x WHERE x.from_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.from_user))),
      ('trip_settlements.to_user',
        (SELECT count(*) FROM public.trip_settlements x WHERE x.to_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.to_user))),
      ('trip_settlements.created_by',
        (SELECT count(*) FROM public.trip_settlements x WHERE x.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.created_by))),
      ('trip_costs.user_id_paid_by',
        (SELECT count(*) FROM public.trip_costs x WHERE x.paid_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.paid_by))),
      ('promo_redemptions.user_id',
        (SELECT count(*) FROM public.promo_redemptions x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))),
      ('storage_object_trip.uploaded_by',
        (SELECT count(*) FROM public.storage_object_trip x WHERE x.uploaded_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.uploaded_by))),
      ('destinations.unlocked_by',
        (SELECT count(*) FROM public.destinations x WHERE x.unlocked_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.unlocked_by))),
      ('trip_events.added_by',
        (SELECT count(*) FROM public.trip_events x WHERE x.added_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.added_by)))
    ) AS t(column_ref, n)
    WHERE n > 0
  LOOP
    RAISE EXCEPTION 'Phase B1 preflight failed: % has % orphan reference(s) to auth.users. Remediate before applying this migration.', offender, orphan_count;
  END LOOP;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. SET NULL group — approved by D-2/D-3/D-4/D-7 to preserve anonymised
--    shared history. NOT NULL relaxed on the same columns.
-- ---------------------------------------------------------------------------

-- trip_costs.user_id (D-2)
ALTER TABLE public.trip_costs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.trip_costs
  ADD CONSTRAINT trip_costs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.trip_costs VALIDATE CONSTRAINT trip_costs_user_id_fkey;

-- trip_settlements.{from_user,to_user,created_by} (D-2)
ALTER TABLE public.trip_settlements
  ALTER COLUMN from_user DROP NOT NULL,
  ALTER COLUMN to_user   DROP NOT NULL,
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.trip_settlements
  ADD CONSTRAINT trip_settlements_from_user_fkey
    FOREIGN KEY (from_user)  REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT trip_settlements_to_user_fkey
    FOREIGN KEY (to_user)    REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT trip_settlements_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.trip_settlements VALIDATE CONSTRAINT trip_settlements_from_user_fkey;
ALTER TABLE public.trip_settlements VALIDATE CONSTRAINT trip_settlements_to_user_fkey;
ALTER TABLE public.trip_settlements VALIDATE CONSTRAINT trip_settlements_created_by_fkey;

-- trip_stays.user_id (D-4) — booked_by already nullable
ALTER TABLE public.trip_stays ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.trip_stays
  ADD CONSTRAINT trip_stays_user_id_fkey
    FOREIGN KEY (user_id)   REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT trip_stays_booked_by_fkey
    FOREIGN KEY (booked_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.trip_stays VALIDATE CONSTRAINT trip_stays_user_id_fkey;
ALTER TABLE public.trip_stays VALIDATE CONSTRAINT trip_stays_booked_by_fkey;

-- trip_flights.user_id (D-3)
ALTER TABLE public.trip_flights ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.trip_flights
  ADD CONSTRAINT trip_flights_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.trip_flights VALIDATE CONSTRAINT trip_flights_user_id_fkey;

-- trip_polls.user_id (D-7)
ALTER TABLE public.trip_polls ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.trip_polls
  ADD CONSTRAINT trip_polls_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.trip_polls VALIDATE CONSTRAINT trip_polls_user_id_fkey;

-- storage_object_trip.uploaded_by (D-2; mapping-row anonymisation; actual
-- object cleanup is in Phase B3)
ALTER TABLE public.storage_object_trip ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE public.storage_object_trip
  ADD CONSTRAINT storage_object_trip_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.storage_object_trip VALIDATE CONSTRAINT storage_object_trip_uploaded_by_fkey;

-- destinations.unlocked_by (already nullable)
ALTER TABLE public.destinations
  ADD CONSTRAINT destinations_unlocked_by_fkey
    FOREIGN KEY (unlocked_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.destinations VALIDATE CONSTRAINT destinations_unlocked_by_fkey;

-- trip_events.added_by — currently CASCADE + NOT NULL; D-2 requires
-- SET NULL + nullable so co-organiser-added event pins survive.
ALTER TABLE public.trip_events DROP CONSTRAINT trip_events_added_by_fkey;
ALTER TABLE public.trip_events ALTER COLUMN added_by DROP NOT NULL;
ALTER TABLE public.trip_events
  ADD CONSTRAINT trip_events_added_by_fkey
    FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.trip_events VALIDATE CONSTRAINT trip_events_added_by_fkey;

-- ---------------------------------------------------------------------------
-- 2. CASCADE group — approved by D-5/D-6/D-7/D-8/D-10 to delete personal
--    rows outright. NOT NULL is retained.
-- ---------------------------------------------------------------------------

-- trip_tickets.user_id (D-5)
ALTER TABLE public.trip_tickets
  ADD CONSTRAINT trip_tickets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.trip_tickets VALIDATE CONSTRAINT trip_tickets_user_id_fkey;

-- trip_ratings.user_id (D-6)
ALTER TABLE public.trip_ratings
  ADD CONSTRAINT trip_ratings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.trip_ratings VALIDATE CONSTRAINT trip_ratings_user_id_fkey;

-- trip_poll_votes.user_id (D-7: departing user's own votes are deleted;
-- other users' votes on the same poll are unaffected because they FK to a
-- different user_id row.)
ALTER TABLE public.trip_poll_votes
  ADD CONSTRAINT trip_poll_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.trip_poll_votes VALIDATE CONSTRAINT trip_poll_votes_user_id_fkey;

-- promo_redemptions.user_id — personal redemption record; the
-- promo_codes.redemptions_count aggregate is a separate counter and is not
-- decremented here.
ALTER TABLE public.promo_redemptions
  ADD CONSTRAINT promo_redemptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.promo_redemptions VALIDATE CONSTRAINT promo_redemptions_user_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. Post-migration self-check: every target column now has an FK of the
--    correct on-delete action and the expected nullability.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  expected record;
  actual_action text;
  actual_notnull boolean;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('trip_costs',       'user_id',      'SET NULL', false),
      ('trip_costs',       'paid_by',      'SET NULL', false),
      ('trip_settlements', 'from_user',    'SET NULL', false),
      ('trip_settlements', 'to_user',      'SET NULL', false),
      ('trip_settlements', 'created_by',   'SET NULL', false),
      ('trip_stays',       'user_id',      'SET NULL', false),
      ('trip_stays',       'booked_by',    'SET NULL', false),
      ('trip_flights',     'user_id',      'SET NULL', false),
      ('trip_polls',       'user_id',      'SET NULL', false),
      ('storage_object_trip','uploaded_by','SET NULL', false),
      ('destinations',     'unlocked_by',  'SET NULL', false),
      ('trip_events',      'added_by',     'SET NULL', false),
      ('trip_tickets',     'user_id',      'CASCADE',  true),
      ('trip_ratings',     'user_id',      'CASCADE',  true),
      ('trip_poll_votes',  'user_id',      'CASCADE',  true),
      ('promo_redemptions','user_id',      'CASCADE',  true),
      -- Already-correct sanity checks
      ('destinations',     'user_id',      'CASCADE',  true),
      ('trip_members',     'user_id',      'CASCADE',  true),
      ('comments',         'user_id',      'CASCADE',  true),
      ('notifications',    'user_id',      'CASCADE',  true),
      ('notifications',    'actor_id',     'SET NULL', false)
    ) AS t(tbl, col, exp_action, exp_notnull)
  LOOP
    SELECT CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'd' THEN 'SET DEFAULT' END,
           a.attnotnull
      INTO actual_action, actual_notnull
    FROM pg_constraint con
    JOIN pg_class rel  ON rel.oid = con.conrelid AND rel.relnamespace = 'public'::regnamespace
    JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND rel.relname = expected.tbl
      AND a.attname   = expected.col
      AND con.confrelid = 'auth.users'::regclass
    LIMIT 1;

    IF actual_action IS NULL THEN
      RAISE EXCEPTION 'Phase B1 verify: %.% has no FK → auth.users', expected.tbl, expected.col;
    END IF;
    IF actual_action <> expected.exp_action THEN
      RAISE EXCEPTION 'Phase B1 verify: %.% expected ON DELETE % but is %', expected.tbl, expected.col, expected.exp_action, actual_action;
    END IF;
    IF actual_notnull <> expected.exp_notnull THEN
      RAISE EXCEPTION 'Phase B1 verify: %.% expected NOT NULL=% but is %', expected.tbl, expected.col, expected.exp_notnull, actual_notnull;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;

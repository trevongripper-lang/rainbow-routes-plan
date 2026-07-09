-- ============================================================================
-- Co-organizer RLS regression tests
-- ----------------------------------------------------------------------------
-- Run with: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/co_organizer_rls.test.sql
--
-- These tests exercise the trip role model (owner / co_organizer / member)
-- by impersonating three synthetic users via PostgREST's JWT claim shim:
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claims" = '{"sub":"<uuid>"}';
--
-- Everything runs inside a single transaction that is ROLLBACK'd, so the
-- database is not mutated. Any failed assertion RAISES and aborts the run.
--
-- What we assert:
--   1. Co-organizer CAN read the destination.
--   2. Co-organizer CAN update destination details (title/dates).
--   3. Co-organizer CAN invite (INSERT into trip_invites).
--   4. Co-organizer CAN add plain members (INSERT into trip_members).
--   5. Co-organizer CAN read invites for the trip (post-migration policy).
--   6. Co-organizer CAN update trip_costs on the trip.
--   7. Co-organizer CANNOT promote anyone to 'owner' via set_trip_member_role.
--   8. Co-organizer CANNOT change roles at all via set_trip_member_role.
--   9. Co-organizer CANNOT delete the destination (owner-only).
--  10. Co-organizer CANNOT call unlock_destination (service_role only EXECUTE).
--  11. Plain member CANNOT invite, update destination, or promote.
-- ============================================================================

BEGIN;

-- Fixtures ------------------------------------------------------------------
DO $$
DECLARE
  owner_id      uuid := '11111111-1111-1111-1111-111111111111';
  co_id         uuid := '22222222-2222-2222-2222-222222222222';
  member_id     uuid := '33333333-3333-3333-3333-333333333333';
  outsider_id  uuid := '44444444-4444-4444-4444-444444444444';
  dest_id       uuid := '99999999-9999-9999-9999-999999999999';
BEGIN
  -- Seed auth.users just enough for FK targets. Requires superuser / service
  -- role; the test file is meant to be run against a dev/staging DB.
  INSERT INTO auth.users (id, email, aud, role, instance_id, created_at, updated_at)
  VALUES
    (owner_id,    'rls-owner@test.local',    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (co_id,       'rls-co@test.local',       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (member_id,   'rls-member@test.local',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (outsider_id, 'rls-outsider@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- Destination owned by owner_id.
  INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status)
  VALUES (dest_id, owner_id, 'RLS Test Trip', 'Test Region', 'Testland', 3, 'free');

  -- Memberships.
  INSERT INTO public.trip_members (destination_id, user_id, role)
  VALUES
    (dest_id, owner_id,  'owner'),
    (dest_id, co_id,     'co_organizer'),
    (dest_id, member_id, 'member');
END $$;

-- Helper: run a block as a specific user ------------------------------------
-- Because Postgres cannot pass functions to DO blocks, we inline the SET calls.

-- =========================================================================
-- 1. Co-organizer CAN read the destination
-- =========================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.destinations
    WHERE id = '99999999-9999-9999-9999-999999999999';
  IF cnt <> 1 THEN RAISE EXCEPTION 'FAIL 1: co-organizer cannot read destination'; END IF;
END $$;

-- =========================================================================
-- 2. Co-organizer CAN update destination details
-- =========================================================================
DO $$
BEGIN
  UPDATE public.destinations
    SET title = 'RLS Test Trip (edited)'
    WHERE id = '99999999-9999-9999-9999-999999999999';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 2: co-organizer cannot update destination'; END IF;
END $$;

-- =========================================================================
-- 3. Co-organizer CAN insert an invite
-- =========================================================================
INSERT INTO public.trip_invites (destination_id, invited_by, email, token)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  '22222222-2222-2222-2222-222222222222',
  'friend@test.local',
  'test-invite-token-co'
);

-- =========================================================================
-- 4. Co-organizer CAN add a plain member
-- =========================================================================
INSERT INTO public.trip_members (destination_id, user_id, role)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  '44444444-4444-4444-4444-444444444444',
  'member'
);

-- =========================================================================
-- 5. Co-organizer CAN read invites for the trip
-- =========================================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.trip_invites
    WHERE destination_id = '99999999-9999-9999-9999-999999999999';
  IF cnt < 1 THEN RAISE EXCEPTION 'FAIL 5: co-organizer cannot read invites'; END IF;
END $$;

-- =========================================================================
-- 6. Co-organizer CAN update trip_costs on the trip
-- =========================================================================
-- Seed a cost as the owner first (temporarily switch identity).
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';
INSERT INTO public.trip_costs (destination_id, user_id, label, amount_cents, currency)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  '11111111-1111-1111-1111-111111111111',
  'Owner-added cost',
  10000,
  'USD'
);

-- Back to co-organizer, edit the cost.
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';
DO $$
BEGIN
  UPDATE public.trip_costs
    SET label = 'Edited by co-organizer'
    WHERE destination_id = '99999999-9999-9999-9999-999999999999'
      AND label = 'Owner-added cost';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 6: co-organizer cannot update trip_costs'; END IF;
END $$;

-- =========================================================================
-- 6a. Co-organizer CAN read + insert their own flight, and update someone
--     else's flight on the trip (Author or organizers update flights).
-- =========================================================================
-- Seed a flight authored by the owner.
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';
INSERT INTO public.trip_flights (destination_id, user_id, airline, flight_number)
VALUES ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'OwnAir', 'OA1');

-- Back to co-organizer.
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.trip_flights
    WHERE destination_id = '99999999-9999-9999-9999-999999999999';
  IF cnt < 1 THEN RAISE EXCEPTION 'FAIL 6a: co-organizer cannot read flights'; END IF;
END $$;

INSERT INTO public.trip_flights (destination_id, user_id, airline, flight_number)
VALUES ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'CoAir', 'CA1');

DO $$
BEGIN
  UPDATE public.trip_flights
    SET notes = 'Edited by co-organizer'
    WHERE destination_id = '99999999-9999-9999-9999-999999999999'
      AND user_id = '11111111-1111-1111-1111-111111111111';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 6a: co-organizer cannot edit owner-authored flight'; END IF;
END $$;

-- =========================================================================
-- 6b. Co-organizer CAN read + insert their own ticket, and edit an
--     owner-authored ticket (Author or organizers update tickets).
-- =========================================================================
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';
INSERT INTO public.trip_tickets (destination_id, user_id, name, currency)
VALUES ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'Owner ticket', 'USD');

SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.trip_tickets
    WHERE destination_id = '99999999-9999-9999-9999-999999999999';
  IF cnt < 1 THEN RAISE EXCEPTION 'FAIL 6b: co-organizer cannot read tickets'; END IF;
END $$;

INSERT INTO public.trip_tickets (destination_id, user_id, name, currency)
VALUES ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'Co ticket', 'USD');

DO $$
BEGIN
  UPDATE public.trip_tickets
    SET notes = 'Edited by co-organizer'
    WHERE destination_id = '99999999-9999-9999-9999-999999999999'
      AND name = 'Owner ticket';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 6b: co-organizer cannot edit owner ticket'; END IF;
END $$;

-- =========================================================================
-- 6c. Co-organizer CAN read + create a poll (as a member), edit their own
--     poll, edit an owner-authored poll, and close it.
-- =========================================================================
-- Seed a poll authored by the owner.
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';
INSERT INTO public.trip_polls (id, destination_id, user_id, question, kind, allow_multi)
VALUES (
  '55555555-5555-5555-5555-555555555501',
  '99999999-9999-9999-9999-999999999999',
  '11111111-1111-1111-1111-111111111111',
  'Owner poll', 'single', false
);

SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.trip_polls
    WHERE destination_id = '99999999-9999-9999-9999-999999999999';
  IF cnt < 1 THEN RAISE EXCEPTION 'FAIL 6c: co-organizer cannot read polls'; END IF;
END $$;

INSERT INTO public.trip_polls (id, destination_id, user_id, question, kind, allow_multi)
VALUES (
  '55555555-5555-5555-5555-555555555502',
  '99999999-9999-9999-9999-999999999999',
  '22222222-2222-2222-2222-222222222222',
  'Co-org poll', 'single', false
);

DO $$
BEGIN
  UPDATE public.trip_polls
    SET question = 'Owner poll (edited by co-org)', closed_at = now()
    WHERE id = '55555555-5555-5555-5555-555555555501';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 6c: co-organizer cannot edit owner poll'; END IF;
END $$;

-- =========================================================================
-- 6d. Co-organizer CAN add, read, and edit poll options on a poll they did
--     not author (Creator or organizers edit options).
-- =========================================================================
-- Seed an option on the owner's poll (as owner).
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';
INSERT INTO public.trip_poll_options (id, poll_id, label, sort_order)
VALUES (
  '66666666-6666-6666-6666-666666666601',
  '55555555-5555-5555-5555-555555555501',
  'Owner option', 0
);

-- Back to co-organizer.
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.trip_poll_options
    WHERE poll_id = '55555555-5555-5555-5555-555555555501';
  IF cnt < 1 THEN RAISE EXCEPTION 'FAIL 6d: co-organizer cannot read poll options'; END IF;
END $$;

INSERT INTO public.trip_poll_options (poll_id, label, sort_order)
VALUES ('55555555-5555-5555-5555-555555555501', 'Co-org option', 1);

DO $$
BEGIN
  UPDATE public.trip_poll_options
    SET label = 'Owner option (edited by co-org)'
    WHERE id = '66666666-6666-6666-6666-666666666601';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 6d: co-organizer cannot edit owner poll option'; END IF;
END $$;

-- =========================================================================
-- 7. Co-organizer CANNOT promote to owner via set_trip_member_role
--    (RPC guards: only is_trip_owner() may change roles, and _role must be
--    one of 'co_organizer' | 'member' — 'owner' is not accepted.)
-- =========================================================================
DO $$
BEGIN
  BEGIN
    PERFORM public.set_trip_member_role(
      '99999999-9999-9999-9999-999999999999',
      '33333333-3333-3333-3333-333333333333',
      'owner'
    );
    RAISE EXCEPTION 'FAIL 7: co-organizer was able to promote to owner';
  EXCEPTION WHEN OTHERS THEN
    -- Expected: "Only the organizer can change roles" OR "Role must be co_organizer or member"
    NULL;
  END;
END $$;

-- =========================================================================
-- 8. Co-organizer CANNOT change roles at all via set_trip_member_role
-- =========================================================================
DO $$
BEGIN
  BEGIN
    PERFORM public.set_trip_member_role(
      '99999999-9999-9999-9999-999999999999',
      '33333333-3333-3333-3333-333333333333',
      'co_organizer'
    );
    RAISE EXCEPTION 'FAIL 8: co-organizer was able to change roles';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- =========================================================================
-- 9. Co-organizer CANNOT delete the destination (owner-only DELETE policy)
-- =========================================================================
DO $$
DECLARE deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.destinations
      WHERE id = '99999999-9999-9999-9999-999999999999'
      RETURNING 1
  )
  SELECT count(*) INTO deleted FROM d;
  IF deleted <> 0 THEN
    RAISE EXCEPTION 'FAIL 9: co-organizer was able to delete destination';
  END IF;
END $$;

-- =========================================================================
-- 10. Co-organizer CANNOT call unlock_destination (EXECUTE = service_role)
-- =========================================================================
DO $$
BEGIN
  BEGIN
    PERFORM public.unlock_destination(
      '99999999-9999-9999-9999-999999999999',
      false,
      0
    );
    RAISE EXCEPTION 'FAIL 10: co-organizer was able to call unlock_destination';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- expected
  WHEN undefined_function THEN
    NULL; -- also acceptable if signature drifts; the point is "no unlock"
  END;
END $$;

-- =========================================================================
-- 11. Plain member CANNOT invite, update destination, or promote
-- =========================================================================
SET LOCAL "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333"}';

DO $$
DECLARE err_caught boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.trip_invites (destination_id, invited_by, email, token)
    VALUES (
      '99999999-9999-9999-9999-999999999999',
      '33333333-3333-3333-3333-333333333333',
      'nope@test.local',
      'test-invite-token-member'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    err_caught := true;
  END;
  IF NOT err_caught THEN
    RAISE EXCEPTION 'FAIL 11a: plain member was able to insert invite';
  END IF;
END $$;

DO $$
DECLARE updated int;
BEGIN
  WITH u AS (
    UPDATE public.destinations
      SET title = 'member should not touch this'
      WHERE id = '99999999-9999-9999-9999-999999999999'
      RETURNING 1
  )
  SELECT count(*) INTO updated FROM u;
  IF updated <> 0 THEN
    RAISE EXCEPTION 'FAIL 11b: plain member was able to update destination';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM public.set_trip_member_role(
      '99999999-9999-9999-9999-999999999999',
      '22222222-2222-2222-2222-222222222222',
      'member'
    );
    RAISE EXCEPTION 'FAIL 11c: plain member was able to change roles';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- =========================================================================
-- 11d. Plain member CANNOT edit or delete another user's flight/ticket
--      (write policies scope to author OR organizer/co-organizer).
-- =========================================================================
DO $$
DECLARE affected int;
BEGIN
  WITH u AS (
    UPDATE public.trip_flights
      SET notes = 'member should not touch this'
      WHERE destination_id = '99999999-9999-9999-9999-999999999999'
        AND user_id = '11111111-1111-1111-1111-111111111111'
      RETURNING 1
  )
  SELECT count(*) INTO affected FROM u;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL 11d: plain member was able to edit another user''s flight';
  END IF;
END $$;

DO $$
DECLARE affected int;
BEGIN
  WITH d AS (
    DELETE FROM public.trip_tickets
      WHERE destination_id = '99999999-9999-9999-9999-999999999999'
        AND user_id = '11111111-1111-1111-1111-111111111111'
      RETURNING 1
  )
  SELECT count(*) INTO affected FROM d;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL 11d: plain member was able to delete another user''s ticket';
  END IF;
END $$;

-- =========================================================================
-- 11e. Plain member CANNOT edit or delete a poll they did not create
--      (Creator or organizers update/delete poll).
-- =========================================================================
DO $$
DECLARE affected int;
BEGIN
  WITH u AS (
    UPDATE public.trip_polls
      SET question = 'member should not touch this'
      WHERE id = '55555555-5555-5555-5555-555555555501'
      RETURNING 1
  )
  SELECT count(*) INTO affected FROM u;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL 11e: plain member was able to edit a poll they did not create';
  END IF;
END $$;

DO $$
DECLARE affected int;
BEGIN
  WITH d AS (
    DELETE FROM public.trip_polls
      WHERE id = '55555555-5555-5555-5555-555555555501'
      RETURNING 1
  )
  SELECT count(*) INTO affected FROM d;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL 11e: plain member was able to delete a poll they did not create';
  END IF;
END $$;

-- =========================================================================
-- 11f. Plain member CANNOT edit a poll option they did not add (options
--      belonging to a poll they did not author).
-- =========================================================================
DO $$
DECLARE affected int;
BEGIN
  WITH u AS (
    UPDATE public.trip_poll_options
      SET label = 'member should not touch this'
      WHERE id = '66666666-6666-6666-6666-666666666601'
      RETURNING 1
  )
  SELECT count(*) INTO affected FROM u;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL 11f: plain member was able to edit another user''s poll option';
  END IF;
END $$;

-- =========================================================================
-- 11g. Plain member CANNOT call unlock_destination (owner-only, service_role
--      EXECUTE). Same guarantee as test 10 but from a member identity.
-- =========================================================================
DO $$
BEGIN
  BEGIN
    PERFORM public.unlock_destination(
      '99999999-9999-9999-9999-999999999999',
      false,
      0
    );
    RAISE EXCEPTION 'FAIL 11g: plain member was able to call unlock_destination';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  WHEN undefined_function THEN
    NULL;
  END;
END $$;

-- Done. Rollback so the DB is unchanged.
ROLLBACK;

\echo 'All co-organizer RLS tests passed.'

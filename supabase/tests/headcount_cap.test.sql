-- ============================================================================
-- Headcount cap regression tests
-- ----------------------------------------------------------------------------
-- Run with: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/headcount_cap.test.sql
--
-- Verifies that free trips are capped at 5 people and that the cap is bypassed
-- only when the trip is unlocked/paid or the owner has an active Plus subscription.
-- Everything runs inside a single transaction that is ROLLBACK'd.
-- ============================================================================

BEGIN;

-- Fixtures ------------------------------------------------------------------
DO $$
DECLARE
  owner_id       uuid := '11111111-1111-1111-1111-111111111111';
  plus_owner_id  uuid := '22222222-2222-2222-2222-222222222222';
  member_id      uuid := '33333333-3333-3333-3333-333333333333';
  free_dest_id   uuid := '99999999-9999-9999-9999-999999999999';
  paid_dest_id   uuid := '88888888-8888-8888-8888-888888888888';
  plus_dest_id   uuid := '77777777-7777-7777-7777-777777777777';
BEGIN
  INSERT INTO auth.users (id, email, aud, role, instance_id, created_at, updated_at)
  VALUES
    (owner_id,      'rls-owner@test.local',      'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (plus_owner_id, 'rls-plus-owner@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (member_id,     'rls-member@test.local',     'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- Free trip owned by a non-Pro, non-Plus user.
  INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status)
  VALUES (free_dest_id, owner_id, 'Free Test Trip', 'Test Region', 'Testland', 2, 'free');

  -- Paid/unlocked trip.
  INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status, unlock_tier, paid_amount_cents)
  VALUES (paid_dest_id, owner_id, 'Paid Test Trip', 'Test Region', 'Testland', 8, 'paid', 'tier1', 499);

  -- Plus-owner trip.
  INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status)
  VALUES (plus_dest_id, plus_owner_id, 'Plus Test Trip', 'Test Region', 'Testland', 2, 'free');

  -- handle_new_user already created a profile row; update it to active Plus.
  UPDATE public.profiles SET plus_status = 'active' WHERE id = plus_owner_id;
END $$;

-- =========================================================================
-- 1. Free trip rejects headcount > 5
-- =========================================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';

DO $$
BEGIN
  UPDATE public.destinations SET headcount = 6 WHERE id = '99999999-9999-9999-9999-999999999999';
  RAISE EXCEPTION 'FAIL 1: free trip allowed headcount 6';
EXCEPTION
  WHEN sqlstate '23514' THEN
    -- expected
    NULL;
END $$;

-- =========================================================================
-- 2. Unlocked trip allows headcount > 5
-- =========================================================================
DO $$
BEGIN
  UPDATE public.destinations SET headcount = 12 WHERE id = '88888888-8888-8888-8888-888888888888';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 2: unlocked trip rejected headcount 12'; END IF;
END $$;

-- =========================================================================
-- 3. Plus-owner trip allows headcount > 5
-- =========================================================================
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';

DO $$
BEGIN
  UPDATE public.destinations SET headcount = 15 WHERE id = '77777777-7777-7777-7777-777777777777';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 3: plus-owner trip rejected headcount 15'; END IF;
END $$;

-- =========================================================================
-- 4. redeem_trip_invite blocks the 6th member on a free trip
-- =========================================================================
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';

DO $$
DECLARE
  tok text;
  member_id uuid;
  member_uuids uuid[] := ARRAY[
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'dddddddd-dddd-dddd-dddd-dddddddddddd'
  ];
BEGIN
  -- Owner is already a member via add_owner_as_member trigger. Add 4 more to reach 5.
  FOREACH member_id IN ARRAY member_uuids LOOP
    INSERT INTO auth.users (id, email, aud, role, instance_id, created_at, updated_at)
    VALUES (member_id, 'member-' || member_id || '@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.trip_members (destination_id, user_id, role)
    VALUES ('99999999-9999-9999-9999-999999999999', member_id, 'member')
    ON CONFLICT (destination_id, user_id) DO NOTHING;
  END LOOP;

  -- Create an invite for a 6th person.
  INSERT INTO public.trip_invites (destination_id, invited_by, email, token)
  VALUES ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'sixth@test.local', 'full-trip-token')
  RETURNING token INTO tok;

  -- Try to redeem as a new user.
  SET LOCAL "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333"}';
  PERFORM public.redeem_trip_invite(tok);
  RAISE EXCEPTION 'FAIL 4: redeem_trip_invite allowed 6th member on free trip';
EXCEPTION
  WHEN sqlstate 'P0001' THEN
    -- expected: "Trip is full — organizer needs to unlock first"
    NULL;
END $$;

ROLLBACK;

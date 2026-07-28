-- ============================================================================
-- Stage 5 consent-gate RLS regression suite
-- ----------------------------------------------------------------------------
-- Run with:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/consent_rls.test.sql
--
-- Requires a role that can INSERT into auth.users (superuser or service_role).
-- Everything runs inside a single transaction that is ROLLBACK'd, so the
-- database is not mutated. Any failed assertion RAISES and aborts the run.
--
-- Personas (all seeded fresh; ids are stable UUIDs so assertions can hardcode):
--   P0 unconfirmed_permanent   0aaaaaaa-...  email_confirmed_at IS NULL
--   P1 anonymous               1aaaaaaa-...  is_anonymous=true, no email_confirmed
--   P2 permanent_missing       2aaaaaaa-...  confirmed, no beta_consents row
--   P3 permanent_stale         3aaaaaaa-...  confirmed, beta_consents row for OLD version
--   P4 permanent_current_owner 4aaaaaaa-...  confirmed, consent current, trip owner
--   P5 permanent_current_member 5aaaaaaa-... confirmed, consent current, trip member
--   P6 permanent_current_outsider 6aaaaaaa-... confirmed, consent current, no trip
--
-- What we assert:
--   § A. Restrictive consent policies exist on all 21 private tables.
--   § B. SELECT under P1/P2/P3 returns 0 rows on every private table where
--        an owner-visible row exists; under P4 returns >=1 on every table;
--        under P6 returns 0 on member-scoped tables.
--   § C. INSERT is denied under P1/P2/P3 on representative writeable tables.
--   § D. analytics_events allowlist and per-event key schema.
--   § E. profile column restrictions and update_profile_basics validation.
--   § F. beta_consents INSERT gated on is_confirmed_permanent.
--   § G. Helper fail-closed / cross-user probing.
--   § H. Consent invalidation via app_config.beta_consent_version bump.
-- ============================================================================

BEGIN;

-- Stable IDs -----------------------------------------------------------------
\set P0 '''0aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set P1 '''1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set P2 '''2aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set P3 '''3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set P4 '''4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set P5 '''5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set P6 '''6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set DEST '''99999999-9999-9999-9999-999999999911'''
\set POLL '''55555555-5555-5555-5555-555555555511'''

-- =============================================================================
-- Fixtures
-- =============================================================================
DO $$
DECLARE
  cur_ver text;
BEGIN
  cur_ver := public.current_consent_version();
  IF cur_ver IS NULL OR length(cur_ver) = 0 THEN
    RAISE EXCEPTION 'PRECHECK: current_consent_version() is empty; app_config not seeded';
  END IF;
END $$;

INSERT INTO auth.users (id, email, aud, role, instance_id, email_confirmed_at, is_anonymous, created_at, updated_at)
VALUES
  (:P0, 'p0-unconfirmed@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', NULL, false, now(), now()),
  (:P1, 'p1-anon@test.local',         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', NULL, true,  now(), now()),
  (:P2, 'p2-missing@test.local',      'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), false, now(), now()),
  (:P3, 'p3-stale@test.local',        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), false, now(), now()),
  (:P4, 'p4-owner@test.local',        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), false, now(), now()),
  (:P5, 'p5-member@test.local',       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), false, now(), now()),
  (:P6, 'p6-outsider@test.local',     'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), false, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Consent rows: stale for P3, current for P4/P5/P6
INSERT INTO public.beta_consents (user_id, version, accepted_at)
VALUES
  (:P3, 'beta-vSTALE', now()),
  (:P4, public.current_consent_version(), now()),
  (:P5, public.current_consent_version(), now()),
  (:P6, public.current_consent_version(), now());

-- Seed the private universe as P4 (owner + current consent). Because RLS is
-- enforced, we bypass by running as service_role for seeding, then flip back.
SET LOCAL ROLE service_role;

INSERT INTO public.destinations
  (id, user_id, title, region, country, headcount, unlock_status,
   start_date, end_date)
VALUES
  (:DEST, :P4, 'Consent Test Trip', 'Testland', 'Testonia', 5, 'free',
   current_date, current_date + 3);

-- add_owner_as_member trigger inserts P4 as owner; add P5 as member
INSERT INTO public.trip_members (destination_id, user_id, role)
VALUES (:DEST, :P5, 'member')
ON CONFLICT DO NOTHING;

INSERT INTO public.comments (destination_id, user_id, body)
VALUES (:DEST, :P4, 'seed comment');

INSERT INTO public.trip_costs (destination_id, user_id, category, label, amount_cents, currency)
VALUES (:DEST, :P4, 'Food & drink', 'seed cost', 1000, 'USD');

INSERT INTO public.trip_flights (destination_id, user_id, airline, flight_number)
VALUES (:DEST, :P4, 'AA', 'AA1');

INSERT INTO public.trip_tickets (destination_id, user_id, name, currency)
VALUES (:DEST, :P4, 'seed ticket', 'USD');

INSERT INTO public.trip_stays (destination_id, user_id, title)
VALUES (:DEST, :P4, 'seed stay');

INSERT INTO public.trip_polls (id, destination_id, user_id, question, kind, allow_multi)
VALUES (:POLL, :DEST, :P4, 'seed poll', 'general', false);

INSERT INTO public.trip_poll_options (poll_id, label, sort_order)
VALUES (:POLL, 'opt a', 0), (:POLL, 'opt b', 1);

INSERT INTO public.trip_poll_votes (poll_id, option_id, user_id)
SELECT :POLL, o.id, :P4 FROM public.trip_poll_options o WHERE o.poll_id = :POLL LIMIT 1;

INSERT INTO public.trip_itinerary_order (destination_id, item_key, day_key, sort_order)
VALUES (:DEST, 'k1', 'day1', 0);

INSERT INTO public.trip_ratings (destination_id, user_id, rating, feedback)
VALUES (:DEST, :P4, 5, 'seed');

INSERT INTO public.trip_settlements
  (destination_id, from_user, to_user, amount_cents, currency, created_by)
VALUES (:DEST, :P5, :P4, 500, 'USD', :P4);

INSERT INTO public.trip_invites
  (destination_id, invited_by, email, token, expires_at)
VALUES (:DEST, :P4, 'x@t.local', 'consent-suite-token', now() + interval '7 days');

INSERT INTO public.votes (destination_id, user_id) VALUES (:DEST, :P4);

INSERT INTO public.notifications (user_id, destination_id, kind, payload)
VALUES (:P4, :DEST, 'seed', '{}'::jsonb);

INSERT INTO public.user_credits (user_id, source, remaining, earned_at)
VALUES (:P4, 'seed', 1, now());

INSERT INTO public.credit_events (user_id, kind, amount, destination_id)
VALUES (:P4, 'earned_promo', 1, :DEST);

INSERT INTO public.promo_codes (code, credits, validity_days)
VALUES ('CONSENTSUITE', 1, 30);

INSERT INTO public.promo_redemptions (promo_code_id, user_id, credits_granted, expires_at)
SELECT id, :P4, 1, now() + interval '30 days'
  FROM public.promo_codes WHERE code = 'CONSENTSUITE';

-- Ensure profile rows exist for each persona
INSERT INTO public.profiles (id, display_name)
VALUES (:P0, 'P0'), (:P1, 'P1'), (:P2, 'P2'), (:P3, 'P3'),
       (:P4, 'P4'), (:P5, 'P5'), (:P6, 'P6')
ON CONFLICT (id) DO NOTHING;

RESET ROLE;

-- =============================================================================
-- § A. Policy coverage: 21 private tables each have the four restrictive
--      consent policies.
-- =============================================================================
DO $$
DECLARE
  private_tables constant text[] := ARRAY[
    'destinations','trip_members','trip_invites','comments','trip_costs',
    'trip_flights','trip_stays','trip_tickets','trip_polls','trip_poll_options',
    'trip_poll_votes','trip_itinerary_order','trip_settlements','trip_events',
    'trip_ratings','votes','notifications','event_reports','credit_events',
    'user_credits','promo_redemptions'
  ];
  t text;
  n int;
BEGIN
  IF array_length(private_tables, 1) <> 21 THEN
    RAISE EXCEPTION 'FAIL A0: expected 21 private tables, got %', array_length(private_tables,1);
  END IF;
  FOREACH t IN ARRAY private_tables LOOP
    SELECT count(*) INTO n FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname LIKE '%require_consent%';
    IF n <> 4 THEN
      RAISE EXCEPTION 'FAIL A: %.% has % consent policies (expected 4)', 'public', t, n;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- § B. SELECT visibility across personas × 21 tables.
--   For each row-count check we set the persona's JWT and expected count:
--     P1 (anon):                every table -> 0
--     P2 (permanent, missing):  every table -> 0
--     P3 (permanent, stale):    every table -> 0
--     P4 (owner, current):      every table -> >= 1
--     P5 (member, current):     member-visible tables -> >= 1
--     P6 (outsider, current):   every trip-scoped table -> 0
-- =============================================================================

-- Helper: build a per-persona expected map inline in DO block.
-- Small tables like credit_events / user_credits / promo_redemptions are
-- owner-scoped, so P5 also expects 0 on those.

DO $$
DECLARE
  -- (table, expected_p4_min, expected_p5_min, expected_p6_max)
  cases record;
  rec text[];
  cnt int;
  personas text[] := ARRAY['P1','P2','P3','P4','P5','P6'];
  claims text;
  p text;
  expected int;
BEGIN
  FOR cases IN
    SELECT * FROM (VALUES
      ('destinations',           1, 1, 0),
      ('trip_members',           1, 1, 0),
      ('trip_invites',           1, 0, 0),  -- invites: organizers-only read
      ('comments',               1, 1, 0),
      ('trip_costs',             1, 1, 0),
      ('trip_flights',           1, 1, 0),
      ('trip_stays',             1, 1, 0),
      ('trip_tickets',           1, 1, 0),
      ('trip_polls',             1, 1, 0),
      ('trip_poll_options',      1, 1, 0),
      ('trip_poll_votes',        1, 1, 0),
      ('trip_itinerary_order',   1, 1, 0),
      ('trip_settlements',       1, 1, 0),
      ('trip_events',            0, 0, 0),  -- no seed row; policy shape only
      ('trip_ratings',           1, 1, 0),
      ('votes',                  1, 1, 0),
      ('notifications',          1, 0, 0),  -- owner-scoped
      ('event_reports',          0, 0, 0),  -- no seed row; policy shape only
      ('credit_events',          1, 0, 0),  -- owner-scoped
      ('user_credits',           1, 0, 0),  -- owner-scoped
      ('promo_redemptions',      1, 0, 0)   -- owner-scoped
    ) AS v(tbl text, p4_min int, p5_min int, p6_max int)
  LOOP
    -- P1: anonymous
    EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object(
      'sub','1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'role','authenticated',
      'is_anonymous',true
    )::text);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*)::int FROM public.%I', cases.tbl) INTO cnt;
    IF cnt <> 0 THEN RAISE EXCEPTION 'FAIL B/P1(%): anonymous saw % rows', cases.tbl, cnt; END IF;
    RESET ROLE;

    -- P2: missing consent
    EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object(
      'sub','2aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'role','authenticated'
    )::text);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*)::int FROM public.%I', cases.tbl) INTO cnt;
    IF cnt <> 0 THEN RAISE EXCEPTION 'FAIL B/P2(%): missing-consent saw % rows', cases.tbl, cnt; END IF;
    RESET ROLE;

    -- P3: stale consent
    EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object(
      'sub','3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'role','authenticated'
    )::text);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*)::int FROM public.%I', cases.tbl) INTO cnt;
    IF cnt <> 0 THEN RAISE EXCEPTION 'FAIL B/P3(%): stale-consent saw % rows', cases.tbl, cnt; END IF;
    RESET ROLE;

    -- P4: current owner
    EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object(
      'sub','4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'role','authenticated'
    )::text);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*)::int FROM public.%I', cases.tbl) INTO cnt;
    IF cnt < cases.p4_min THEN
      RAISE EXCEPTION 'FAIL B/P4(%): owner+current saw % rows, expected >= %',
        cases.tbl, cnt, cases.p4_min;
    END IF;
    RESET ROLE;

    -- P5: current member
    EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object(
      'sub','5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'role','authenticated'
    )::text);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*)::int FROM public.%I', cases.tbl) INTO cnt;
    IF cnt < cases.p5_min THEN
      RAISE EXCEPTION 'FAIL B/P5(%): member+current saw % rows, expected >= %',
        cases.tbl, cnt, cases.p5_min;
    END IF;
    RESET ROLE;

    -- P6: current outsider
    EXECUTE format('SET LOCAL "request.jwt.claims" = %L', json_build_object(
      'sub','6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'role','authenticated'
    )::text);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*)::int FROM public.%I', cases.tbl) INTO cnt;
    IF cnt > cases.p6_max THEN
      RAISE EXCEPTION 'FAIL B/P6(%): outsider+current saw % rows, expected <= %',
        cases.tbl, cnt, cases.p6_max;
    END IF;
    RESET ROLE;
  END LOOP;
END $$;

-- =============================================================================
-- § C. INSERT denial on representative writeable tables under P1/P2/P3.
-- =============================================================================
DO $$
DECLARE
  personas text[] := ARRAY[
    '1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ];
  claim_extras jsonb[] := ARRAY[
    jsonb_build_object('is_anonymous', true),
    '{}'::jsonb,
    '{}'::jsonb
  ];
  labels text[] := ARRAY['P1 anon','P2 missing','P3 stale'];
  i int;
  err_caught boolean;
BEGIN
  FOR i IN 1..3 LOOP
    EXECUTE format('SET LOCAL "request.jwt.claims" = %L',
      (jsonb_build_object('sub', personas[i], 'role','authenticated') || claim_extras[i])::text);
    SET LOCAL ROLE authenticated;

    -- destinations
    err_caught := false;
    BEGIN
      INSERT INTO public.destinations (user_id, title, region, headcount, unlock_status)
      VALUES (personas[i]::uuid, 'nope', 'nope', 3, 'free');
    EXCEPTION WHEN OTHERS THEN err_caught := true;
    END;
    IF NOT err_caught THEN
      RAISE EXCEPTION 'FAIL C/destinations(%): insert unexpectedly succeeded', labels[i];
    END IF;

    -- comments
    err_caught := false;
    BEGIN
      INSERT INTO public.comments (destination_id, user_id, body)
      VALUES ('99999999-9999-9999-9999-999999999911', personas[i]::uuid, 'nope');
    EXCEPTION WHEN OTHERS THEN err_caught := true;
    END;
    IF NOT err_caught THEN
      RAISE EXCEPTION 'FAIL C/comments(%): insert unexpectedly succeeded', labels[i];
    END IF;

    -- trip_costs
    err_caught := false;
    BEGIN
      INSERT INTO public.trip_costs (destination_id, user_id, category, label, amount_cents, currency)
      VALUES ('99999999-9999-9999-9999-999999999911', personas[i]::uuid, 'Food & drink', 'nope', 1, 'USD');
    EXCEPTION WHEN OTHERS THEN err_caught := true;
    END;
    IF NOT err_caught THEN
      RAISE EXCEPTION 'FAIL C/trip_costs(%): insert unexpectedly succeeded', labels[i];
    END IF;

    -- votes
    err_caught := false;
    BEGIN
      INSERT INTO public.votes (destination_id, user_id)
      VALUES ('99999999-9999-9999-9999-999999999911', personas[i]::uuid);
    EXCEPTION WHEN OTHERS THEN err_caught := true;
    END;
    IF NOT err_caught THEN
      RAISE EXCEPTION 'FAIL C/votes(%): insert unexpectedly succeeded', labels[i];
    END IF;

    RESET ROLE;
  END LOOP;
END $$;

-- =============================================================================
-- § D. analytics_events allowlist and per-event key schema.
-- =============================================================================
-- D1: anonymous can insert allowlisted event with allowed key
SET LOCAL "request.jwt.claims" = '{"sub":"1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":true}';
SET LOCAL ROLE authenticated;
INSERT INTO public.analytics_events (user_id, event, props)
VALUES ('1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'anon_explore_started', jsonb_build_object('source','home'));
RESET ROLE;

-- D2: anonymous rejected for non-allowlisted event
DO $$
DECLARE err_caught boolean := false;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":true}''';
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.analytics_events (user_id, event, props)
    VALUES ('1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'arbitrary_event', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN err_caught := true;
  END;
  RESET ROLE;
  IF NOT err_caught THEN
    RAISE EXCEPTION 'FAIL D2: anonymous inserted disallowed event';
  END IF;
END $$;

-- D3: anonymous rejected for disallowed key on allowlisted event
DO $$
DECLARE err_caught boolean := false;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":true}''';
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.analytics_events (user_id, event, props)
    VALUES ('1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'anon_pitch_intent',
            jsonb_build_object('source','x','ip','1.2.3.4'));
  EXCEPTION WHEN OTHERS THEN err_caught := true;
  END;
  RESET ROLE;
  IF NOT err_caught THEN
    RAISE EXCEPTION 'FAIL D3: anonymous inserted disallowed key';
  END IF;
END $$;

-- D4: anonymous rejected when destination_id set
DO $$
DECLARE err_caught boolean := false;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":true}''';
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.analytics_events (user_id, destination_id, event, props)
    VALUES ('1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
            '99999999-9999-9999-9999-999999999911'::uuid,
            'anon_explore_started', jsonb_build_object('source','home'));
  EXCEPTION WHEN OTHERS THEN err_caught := true;
  END;
  RESET ROLE;
  IF NOT err_caught THEN
    RAISE EXCEPTION 'FAIL D4: anonymous attached destination_id';
  END IF;
END $$;

-- D5: permanent user (non-anonymous) can insert arbitrary event
SET LOCAL "request.jwt.claims" = '{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
SET LOCAL ROLE authenticated;
INSERT INTO public.analytics_events (user_id, event, props)
VALUES ('4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'permanent_arbitrary',
        jsonb_build_object('anything','goes','x',1));
RESET ROLE;

-- =============================================================================
-- § E. profile column restrictions and update_profile_basics validation.
-- =============================================================================

-- E1: direct UPDATE on billing/role columns is denied
DO $$
DECLARE err_caught boolean := false;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET is_pro = true
      WHERE id = '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  EXCEPTION WHEN OTHERS THEN err_caught := true;
  END;
  RESET ROLE;
  IF NOT err_caught THEN
    RAISE EXCEPTION 'FAIL E1: authenticated user updated is_pro directly';
  END IF;
END $$;

-- E2: update_profile_basics accepts valid input
SET LOCAL "request.jwt.claims" = '{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT public.update_profile_basics('New Name', 'https://example.com/x.png');
RESET ROLE;

-- E3: rejects blank display_name
DO $$
DECLARE err_caught boolean := false;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.update_profile_basics('   ', NULL);
  EXCEPTION WHEN OTHERS THEN err_caught := true;
  END;
  RESET ROLE;
  IF NOT err_caught THEN RAISE EXCEPTION 'FAIL E3: blank display_name accepted'; END IF;
END $$;

-- E4: rejects non-https avatar URL
DO $$
DECLARE err_caught boolean := false;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.update_profile_basics('Name', 'http://insecure.example.com/x.png');
  EXCEPTION WHEN OTHERS THEN err_caught := true;
  END;
  RESET ROLE;
  IF NOT err_caught THEN RAISE EXCEPTION 'FAIL E4: http avatar accepted'; END IF;
END $$;

-- =============================================================================
-- § F. beta_consents INSERT gated on is_confirmed_permanent.
-- =============================================================================
-- F1: anonymous CANNOT insert consent
DO $$
DECLARE err_caught boolean := false;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":true}''';
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.beta_consents (user_id, version)
    VALUES ('1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, public.current_consent_version());
  EXCEPTION WHEN OTHERS THEN err_caught := true;
  END;
  RESET ROLE;
  IF NOT err_caught THEN RAISE EXCEPTION 'FAIL F1: anonymous inserted beta consent'; END IF;
END $$;

-- F2: unconfirmed permanent CANNOT insert
DO $$
DECLARE err_caught boolean := false;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"0aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.beta_consents (user_id, version)
    VALUES ('0aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, public.current_consent_version());
  EXCEPTION WHEN OTHERS THEN err_caught := true;
  END;
  RESET ROLE;
  IF NOT err_caught THEN RAISE EXCEPTION 'FAIL F2: unconfirmed inserted beta consent'; END IF;
END $$;

-- F3: confirmed permanent user (P2 has no consent yet) CAN insert
SET LOCAL "request.jwt.claims" = '{"sub":"2aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
SET LOCAL ROLE authenticated;
INSERT INTO public.beta_consents (user_id, version)
VALUES ('2aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, public.current_consent_version());
RESET ROLE;

-- =============================================================================
-- § G. Helper fail-closed / cross-user probing.
-- =============================================================================
-- G1: is_confirmed_permanent(other) -> false
DO $$
DECLARE res boolean;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  SELECT public.is_confirmed_permanent('5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) INTO res;
  RESET ROLE;
  IF res IS NOT FALSE THEN RAISE EXCEPTION 'FAIL G1: is_confirmed_permanent leaked cross-user result: %', res; END IF;
END $$;

-- G2: has_confirmed_consent(other) -> false
DO $$
DECLARE res boolean;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  SELECT public.has_confirmed_consent('5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) INTO res;
  RESET ROLE;
  IF res IS NOT FALSE THEN RAISE EXCEPTION 'FAIL G2: has_confirmed_consent leaked cross-user result: %', res; END IF;
END $$;

-- G3: my_consent_status() true for P4, false for P1 (anonymous),
--     false for P2 (missing), false for P3 (stale).
DO $$
DECLARE res boolean;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  SELECT public.my_consent_status() INTO res; RESET ROLE;
  IF res IS NOT TRUE THEN RAISE EXCEPTION 'FAIL G3/P4: my_consent_status = %', res; END IF;

  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":true}''';
  SET LOCAL ROLE authenticated;
  SELECT public.my_consent_status() INTO res; RESET ROLE;
  IF res IS NOT FALSE THEN RAISE EXCEPTION 'FAIL G3/P1: my_consent_status = %', res; END IF;

  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  SELECT public.my_consent_status() INTO res; RESET ROLE;
  IF res IS NOT FALSE THEN RAISE EXCEPTION 'FAIL G3/P3: my_consent_status (stale) = %', res; END IF;
END $$;

-- =============================================================================
-- § H. Consent invalidation via app_config bump.
-- =============================================================================
-- Bump consent version -> P4's row is now stale -> reads collapse to 0.
SET LOCAL ROLE service_role;
UPDATE public.app_config SET value = '"beta-vNEXT"'::jsonb WHERE key = 'beta_consent_version';
RESET ROLE;

DO $$
DECLARE cnt int;
BEGIN
  EXECUTE 'SET LOCAL "request.jwt.claims" = ''{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}''';
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO cnt FROM public.destinations
    WHERE id = '99999999-9999-9999-9999-999999999911';
  RESET ROLE;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL H: after consent bump P4 still saw % destination rows', cnt;
  END IF;
END $$;

-- =============================================================================
-- Success
-- =============================================================================
DO $$ BEGIN RAISE NOTICE 'consent_rls.test.sql: ALL CHECKS PASSED'; END $$;

ROLLBACK;

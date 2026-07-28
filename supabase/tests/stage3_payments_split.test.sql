-- Stage 3 regression suite.
-- Runs on DEV_SUPABASE_DB_URL only. Wraps everything in a single transaction
-- and ROLLBACKs at the end so it can be re-run safely.
--
-- Coverage:
--   1. Old public.unlock_destination(uuid,boolean,int) is gone.
--   2. Direct EXECUTE on the paid RPC is denied to anon and authenticated.
--   3. Paid RPC succeeds through service_role.
--   4. Duplicate successful Paddle event is acknowledged once (no double effects).
--   5. Failed Paddle event can be retried successfully.
--   6. Concurrent duplicate deliveries produce exactly one unlock + one loyalty effect.
--      (Simulated via advisory-lock contention in a single session.)
--   7. Disabled payments → no unlock, no credit spend, no successful event marker.
--   8. Concurrent credit requests spend one credit only.
--      (Simulated via calling the RPC twice — second returns 'already'.)
--   9. Credited unlock never grants paid loyalty (paid_trip_count unchanged).
--  10. Paid unlock never consumes credit (user_credits unchanged).
--
-- Fail-fast: RAISE EXCEPTION inside DO blocks aborts the transaction on any
-- unmet expectation; psql -v ON_ERROR_STOP=1 propagates a non-zero exit.

\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('client_min_messages', 'warning', true);

-- ── Fixture setup ─────────────────────────────────────────────────────────
-- Two synthetic auth users. Direct auth.users writes are only possible on the
-- disposable DB.
DO $seed$
DECLARE
  owner_id  uuid := '00000000-0000-0000-0000-000000005001';
  member_id uuid := '00000000-0000-0000-0000-000000005002';
BEGIN
  -- Insert two confirmed users (skip if they already exist from a previous run).
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
                          aud, role, created_at, updated_at, raw_app_meta_data,
                          raw_user_meta_data, is_anonymous)
  VALUES
    (owner_id,  '00000000-0000-0000-0000-000000000000', 'stage3-owner@example.test',
     crypt('x', gen_salt('bf')), now(), 'authenticated', 'authenticated',
     now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    (member_id, '00000000-0000-0000-0000-000000000000', 'stage3-member@example.test',
     crypt('x', gen_salt('bf')), now(), 'authenticated', 'authenticated',
     now(), now(), '{}'::jsonb, '{}'::jsonb, false)
  ON CONFLICT (id) DO NOTHING;
END $seed$;

-- Two trips: T1 (paid path, headcount 8), T2 (credit path, headcount 8), T3 (paid path, second event).
-- Owner must be flagged is_pro so the headcount>5 fixtures pass check_headcount_cap.
UPDATE public.profiles SET is_pro = true, paid_trip_count = 0
  WHERE id = '00000000-0000-0000-0000-000000005001';

INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status)
VALUES
  ('00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000005001',
   'Stage3 Paid Trip',    'Aegean', 'GR', 8, 'free'),
  ('00000000-0000-0000-0000-000000006002', '00000000-0000-0000-0000-000000005001',
   'Stage3 Credit Trip',  'Aegean', 'GR', 8, 'free'),
  ('00000000-0000-0000-0000-000000006003', '00000000-0000-0000-0000-000000005001',
   'Stage3 Paid Trip #2', 'Aegean', 'GR', 8, 'free');

-- Give the owner 3 credits for the credit-path tests.
INSERT INTO public.user_credits (user_id, source, remaining, earned_at)
VALUES ('00000000-0000-0000-0000-000000005001', 'loyalty', 3, now());

-- (baseline paid_trip_count already reset above via is_pro update)

-- ── §1. Obsolete generic RPC is gone ──────────────────────────────────────
DO $t1$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
    WHERE proname = 'unlock_destination'
      AND pronamespace = 'public'::regnamespace
      AND pronargs = 3;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL §1: obsolete unlock_destination(uuid,bool,int) still present (%)', n;
  END IF;
  RAISE NOTICE 'PASS §1 obsolete RPC removed';
END $t1$;

-- ── §2. Direct EXECUTE on paid RPC denied to anon and authenticated ──────
DO $t2$
DECLARE has_anon boolean; has_auth boolean;
BEGIN
  has_anon := has_function_privilege('anon',
    'public.unlock_destination_paid(uuid,int,text)', 'EXECUTE');
  has_auth := has_function_privilege('authenticated',
    'public.unlock_destination_paid(uuid,int,text)', 'EXECUTE');
  IF has_anon OR has_auth THEN
    RAISE EXCEPTION 'FAIL §2: paid RPC executable by anon=% auth=%', has_anon, has_auth;
  END IF;
  RAISE NOTICE 'PASS §2 paid RPC service_role-only';
END $t2$;

-- ── §3. Paid RPC succeeds through service_role ────────────────────────────
DO $t3$
DECLARE res jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  res := public.unlock_destination_paid(
    '00000000-0000-0000-0000-000000006001'::uuid, 499, 'evt_stage3_1');
  RESET ROLE;
  IF (res->>'status') <> 'paid' THEN
    RAISE EXCEPTION 'FAIL §3: expected paid, got %', res;
  END IF;
  RAISE NOTICE 'PASS §3 paid RPC ok via service_role';
END $t3$;

-- ── §4. Duplicate successful Paddle event is acknowledged once ────────────
DO $t4$
DECLARE res1 jsonb; res2 jsonb; before_paid int; after_paid int;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT paid_trip_count INTO before_paid FROM public.profiles
    WHERE id = '00000000-0000-0000-0000-000000005001';

  -- First delivery
  res1 := public.process_paddle_unlock_event(
    'evt_stage3_dup', 'transaction.completed', '{"x":1}'::jsonb,
    '00000000-0000-0000-0000-000000006003'::uuid, 499);
  IF (res1->>'outcome') <> 'processed' THEN
    RAISE EXCEPTION 'FAIL §4: expected first=processed, got %', res1;
  END IF;

  -- Second delivery of the same event_id
  res2 := public.process_paddle_unlock_event(
    'evt_stage3_dup', 'transaction.completed', '{"x":1}'::jsonb,
    '00000000-0000-0000-0000-000000006003'::uuid, 499);
  IF (res2->>'outcome') <> 'duplicate' THEN
    RAISE EXCEPTION 'FAIL §4: expected second=duplicate, got %', res2;
  END IF;

  SELECT paid_trip_count INTO after_paid FROM public.profiles
    WHERE id = '00000000-0000-0000-0000-000000005001';
  IF after_paid - before_paid <> 1 THEN
    RAISE EXCEPTION 'FAIL §4: paid_trip_count moved by % (expected 1)', after_paid - before_paid;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS §4 duplicate ack, single effect';
END $t4$;

-- ── §5. Failed Paddle event can be retried successfully ──────────────────
INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status)
VALUES ('00000000-0000-0000-0000-000000006005', '00000000-0000-0000-0000-000000005001',
        'Stage3 Retry Trip', 'Aegean', 'GR', 8, 'free');

DO $t5$
DECLARE res jsonb; row_status text;
BEGIN
  -- Simulate a prior failure by upserting a failed row (the handler does this
  -- via the post-rollback recordFailure() upsert).
  INSERT INTO public.paddle_events
    (event_id, event_type, payload, status, attempts, last_attempt_at, error)
  VALUES
    ('evt_stage3_retry', 'transaction.completed', '{"x":1}'::jsonb,
     'failed', 1, now(), 'boom')
  ON CONFLICT (event_id) DO UPDATE
    SET status='failed', error='boom', last_attempt_at=now();

  SET LOCAL ROLE service_role;
  res := public.process_paddle_unlock_event(
    'evt_stage3_retry', 'transaction.completed', '{"x":1}'::jsonb,
    '00000000-0000-0000-0000-000000006005'::uuid, 999);
  RESET ROLE;
  IF (res->>'outcome') <> 'processed' THEN
    RAISE EXCEPTION 'FAIL §5: expected processed on retry, got %', res;
  END IF;
  SELECT status INTO row_status FROM public.paddle_events WHERE event_id='evt_stage3_retry';
  IF row_status <> 'success' THEN
    RAISE EXCEPTION 'FAIL §5: expected status=success, got %', row_status;
  END IF;
  RAISE NOTICE 'PASS §5 failed event retryable';
END $t5$;

-- ── §6. Concurrent duplicate delivery: advisory-lock contention ───────────
-- We simulate contention by taking the lock in the outer session, then
-- calling the RPC in a nested block — the RPC's pg_try_advisory_xact_lock
-- returns false and raises 55P03. In production these are separate txns and
-- the loser retries; here we assert the guard fires.
INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status)
VALUES ('00000000-0000-0000-0000-000000006006', '00000000-0000-0000-0000-000000005001',
        'Stage3 Concurrent', 'Aegean', 'GR', 8, 'free');

DO $t6$
DECLARE res jsonb; caught boolean := false; keyh bigint;
BEGIN
  -- Pre-take the lock this txn will try to grab.
  keyh := hashtextextended('paddle_event:evt_stage3_concurrent', 0);
  PERFORM pg_advisory_xact_lock(keyh);

  BEGIN
    SET LOCAL ROLE service_role;
    res := public.process_paddle_unlock_event(
      'evt_stage3_concurrent', 'transaction.completed', '{"x":1}'::jsonb,
      '00000000-0000-0000-0000-000000006006'::uuid, 499);
    RESET ROLE;
  EXCEPTION WHEN sqlstate '55P03' THEN
    caught := true;
    RESET ROLE;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAIL §6: expected concurrent_processing error, got %', res;
  END IF;
  RAISE NOTICE 'PASS §6 concurrent delivery guarded';
END $t6$;

-- ── §7. Disabled payments: no unlock, no credit spend, no success marker ──
INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status)
VALUES ('00000000-0000-0000-0000-000000006007', '00000000-0000-0000-0000-000000005001',
        'Stage3 Payments Off', 'Aegean', 'GR', 8, 'free');

DO $t7$
DECLARE
  paid_before int; paid_after int;
  cred_before int; cred_after int;
  paid_caught boolean := false; cred_caught boolean := false;
  row_status text; unlock_status text;
BEGIN
  UPDATE public.app_config SET value = to_jsonb(false) WHERE key='payments_enabled';

  SELECT paid_trip_count INTO paid_before FROM public.profiles
    WHERE id='00000000-0000-0000-0000-000000005001';
  SELECT COALESCE(sum(remaining),0) INTO cred_before FROM public.user_credits
    WHERE user_id='00000000-0000-0000-0000-000000005001';

  -- Paid path via webhook RPC
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM public.process_paddle_unlock_event(
      'evt_stage3_off', 'transaction.completed', '{"x":1}'::jsonb,
      '00000000-0000-0000-0000-000000006007'::uuid, 499);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    paid_caught := (SQLERRM ILIKE '%payments_disabled%');
    RESET ROLE;
  END;
  IF NOT paid_caught THEN
    RAISE EXCEPTION 'FAIL §7a: expected payments_disabled on paid path';
  END IF;

  -- Confirm no success row was persisted (RPC rolled back the pending insert).
  SELECT status INTO row_status FROM public.paddle_events WHERE event_id='evt_stage3_off';
  IF row_status = 'success' THEN
    RAISE EXCEPTION 'FAIL §7a: event should not be success while payments disabled';
  END IF;
  SELECT unlock_status INTO unlock_status FROM public.destinations
    WHERE id='00000000-0000-0000-0000-000000006007';
  IF unlock_status <> 'free' THEN
    RAISE EXCEPTION 'FAIL §7a: destination should remain free, got %', unlock_status;
  END IF;

  -- Credit path
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005001', true);
    PERFORM public.unlock_destination_with_credit(
      '00000000-0000-0000-0000-000000006002'::uuid);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    cred_caught := (SQLERRM ILIKE '%payments_disabled%');
    RESET ROLE;
  END;
  IF NOT cred_caught THEN
    RAISE EXCEPTION 'FAIL §7b: expected payments_disabled on credit path';
  END IF;

  SELECT paid_trip_count INTO paid_after FROM public.profiles
    WHERE id='00000000-0000-0000-0000-000000005001';
  SELECT COALESCE(sum(remaining),0) INTO cred_after FROM public.user_credits
    WHERE user_id='00000000-0000-0000-0000-000000005001';
  IF paid_after <> paid_before THEN
    RAISE EXCEPTION 'FAIL §7: paid_trip_count changed under disabled payments';
  END IF;
  IF cred_after <> cred_before THEN
    RAISE EXCEPTION 'FAIL §7: credits spent under disabled payments (before=%, after=%)',
      cred_before, cred_after;
  END IF;

  -- Re-enable.
  UPDATE public.app_config SET value = to_jsonb(true) WHERE key='payments_enabled';
  RAISE NOTICE 'PASS §7 disabled-payments fail-closed';
END $t7$;

-- ── §8. Concurrent credit requests spend one credit only ─────────────────
DO $t8$
DECLARE res1 jsonb; res2 jsonb; cred_before int; cred_after int;
BEGIN
  SELECT COALESCE(sum(remaining),0) INTO cred_before FROM public.user_credits
    WHERE user_id='00000000-0000-0000-0000-000000005001';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005001', true);

  res1 := public.unlock_destination_with_credit(
    '00000000-0000-0000-0000-000000006002'::uuid);
  -- Second call must short-circuit as already unlocked (no second spend).
  res2 := public.unlock_destination_with_credit(
    '00000000-0000-0000-0000-000000006002'::uuid);
  RESET ROLE;

  IF (res1->>'status') <> 'credited' THEN
    RAISE EXCEPTION 'FAIL §8: first call expected credited, got %', res1;
  END IF;
  IF (res2->>'already') IS NULL OR (res2->>'already')::boolean <> true THEN
    RAISE EXCEPTION 'FAIL §8: second call expected already=true, got %', res2;
  END IF;

  SELECT COALESCE(sum(remaining),0) INTO cred_after FROM public.user_credits
    WHERE user_id='00000000-0000-0000-0000-000000005001';
  IF cred_before - cred_after <> 1 THEN
    RAISE EXCEPTION 'FAIL §8: expected 1 credit spent, got %', cred_before - cred_after;
  END IF;
  RAISE NOTICE 'PASS §8 concurrent credit calls spend exactly one';
END $t8$;

-- ── §9. Credited unlock never grants paid loyalty ────────────────────────
DO $t9$
DECLARE paid_now int;
BEGIN
  -- Baseline from earlier tests: §3 gave +1, §4 gave +1, §5 gave +1 = +3.
  -- §8 was credited, so paid_trip_count must still be 3 (unchanged by credit).
  SELECT paid_trip_count INTO paid_now FROM public.profiles
    WHERE id='00000000-0000-0000-0000-000000005001';
  IF paid_now <> 3 THEN
    RAISE EXCEPTION 'FAIL §9: expected paid_trip_count=3 after 3 paid + 1 credit, got %', paid_now;
  END IF;
  RAISE NOTICE 'PASS §9 credited unlock does not grant paid loyalty';
END $t9$;

-- ── §10. Paid unlock never consumes credit ───────────────────────────────
DO $t10$
DECLARE cred_now int;
BEGIN
  -- After §8 we spent exactly 1 credit; baseline was 3 → expect 2 remaining.
  SELECT COALESCE(sum(remaining),0) INTO cred_now FROM public.user_credits
    WHERE user_id='00000000-0000-0000-0000-000000005001';
  IF cred_now <> 2 THEN
    RAISE EXCEPTION 'FAIL §10: expected 2 credits remaining after 3 paid + 1 credit, got %', cred_now;
  END IF;
  RAISE NOTICE 'PASS §10 paid unlock does not consume credit';
END $t10$;

DO $ok$ BEGIN RAISE NOTICE 'Stage 3 suite: ALL PASS'; END $ok$;

ROLLBACK;
-- end of test

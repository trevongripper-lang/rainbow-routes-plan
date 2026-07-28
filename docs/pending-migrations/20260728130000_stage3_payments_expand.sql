-- Stage 3 — Payments split + Paddle idempotency hardening.
-- Applied to DEV_SUPABASE_DB_URL only. Promote to production via
-- supabase--migration after checkpoint approval.
--
-- Changes:
--  1. Adds status/attempts/last_attempt_at columns to paddle_events.
--  2. Splits public.unlock_destination into two purpose-specific RPCs:
--       - unlock_destination_paid(_dest,_paid_cents,_paddle_event_id) service_role only
--       - unlock_destination_with_credit(_dest)                       authenticated only
--     Both enforce public.payments_enabled().
--  3. Adds process_paddle_unlock_event(...) RPC that owns the atomic
--     event claim + destination lock + paid unlock + success mark in a
--     single transaction, guarded by a per-event pg_try_advisory_xact_lock.
--  4. Drops the obsolete generic public.unlock_destination(uuid,boolean,int).

-- ---- paddle_events state machine columns -----------------------------------
ALTER TABLE public.paddle_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

DO $blk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paddle_events_status_check'
      AND conrelid = 'public.paddle_events'::regclass
  ) THEN
    ALTER TABLE public.paddle_events
      ADD CONSTRAINT paddle_events_status_check
      CHECK (status IN ('pending','success','failed'));
  END IF;
END $blk$;

-- Backfill legacy rows that predate the status column.
UPDATE public.paddle_events
  SET status = CASE
    WHEN error IS NOT NULL AND (result IS NULL OR result = '') THEN 'failed'
    WHEN result IS NOT NULL AND result <> '' THEN 'success'
    ELSE 'pending'
  END
  WHERE status = 'pending' AND (result IS NOT NULL OR error IS NOT NULL);

CREATE INDEX IF NOT EXISTS paddle_events_status_processed_idx
  ON public.paddle_events(status, processed_at DESC);

-- ---- Paid unlock RPC (service_role only) -----------------------------------
CREATE OR REPLACE FUNCTION public.unlock_destination_paid(
  _dest uuid,
  _paid_cents int,
  _paddle_event_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  d RECORD;
  t RECORD;
  members int;
  payments_on boolean;
BEGIN
  IF _dest IS NULL THEN RAISE EXCEPTION 'destination required'; END IF;
  IF _paid_cents IS NULL OR _paid_cents < 0 THEN
    RAISE EXCEPTION 'paid_cents must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF _paddle_event_id IS NULL OR length(trim(_paddle_event_id)) = 0 THEN
    RAISE EXCEPTION 'paddle_event_id required' USING ERRCODE = '22023';
  END IF;

  SELECT public.payments_enabled() INTO payments_on;
  IF NOT payments_on THEN
    RAISE EXCEPTION 'payments_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO d FROM public.destinations WHERE id = _dest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'destination not found'; END IF;

  IF d.unlock_status IN ('paid','credited') THEN
    RETURN jsonb_build_object('status', d.unlock_status, 'already', true);
  END IF;

  SELECT count(*)::int INTO members
    FROM public.trip_members WHERE destination_id = _dest;
  SELECT * INTO t FROM public.required_unlock_tier(
    GREATEST(members, COALESCE(d.headcount, members))
  );
  IF t.tier IS NULL THEN
    RAISE EXCEPTION 'trip within free tier' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.destinations
    SET unlock_status   = 'paid',
        unlock_tier     = t.tier,
        unlocked_at     = now(),
        unlocked_by     = d.user_id,
        paid_amount_cents = _paid_cents
    WHERE id = _dest;

  UPDATE public.profiles
    SET paid_trip_count = paid_trip_count + 1
    WHERE id = d.user_id;

  PERFORM public._maybe_grant_loyalty(d.user_id);

  RETURN jsonb_build_object(
    'status', 'paid',
    'tier',   t.tier,
    'cents',  _paid_cents,
    'paddle_event_id', _paddle_event_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.unlock_destination_paid(uuid,int,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlock_destination_paid(uuid,int,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_destination_paid(uuid,int,text) TO service_role;

-- ---- Credit unlock RPC (authenticated, self-scoped) ------------------------
CREATE OR REPLACE FUNCTION public.unlock_destination_with_credit(_dest uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  uid uuid := auth.uid();
  d RECORD;
  t RECORD;
  cred RECORD;
  members int;
  payments_on boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'must be signed in' USING ERRCODE = '42501';
  END IF;
  IF _dest IS NULL THEN RAISE EXCEPTION 'destination required'; END IF;

  SELECT public.payments_enabled() INTO payments_on;
  IF NOT payments_on THEN
    RAISE EXCEPTION 'payments_disabled' USING ERRCODE = 'P0001';
  END IF;

  -- Lock destination first so concurrent callers serialize on the trip.
  SELECT * INTO d FROM public.destinations WHERE id = _dest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip not found'; END IF;
  IF d.user_id <> uid THEN
    RAISE EXCEPTION 'only the trip owner can unlock' USING ERRCODE = '42501';
  END IF;

  IF d.unlock_status IN ('paid','credited') THEN
    RETURN jsonb_build_object('status', d.unlock_status, 'already', true);
  END IF;

  SELECT count(*)::int INTO members
    FROM public.trip_members WHERE destination_id = _dest;
  SELECT * INTO t FROM public.required_unlock_tier(
    GREATEST(members, COALESCE(d.headcount, members))
  );
  IF t.tier IS NULL THEN
    RAISE EXCEPTION 'trip within free tier' USING ERRCODE = 'P0001';
  END IF;

  -- Lock a single spendable credit row for this user.
  SELECT * INTO cred FROM public.user_credits
    WHERE user_id = uid
      AND remaining > 0
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY (expires_at IS NULL), expires_at ASC, earned_at ASC
    LIMIT 1
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no credits available' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.user_credits
    SET remaining = remaining - 1
    WHERE id = cred.id;

  INSERT INTO public.credit_events (user_id, kind, amount, destination_id)
    VALUES (uid, 'spent', 1, _dest);

  UPDATE public.destinations
    SET unlock_status = 'credited',
        unlock_tier   = t.tier,
        unlocked_at   = now(),
        unlocked_by   = uid,
        paid_amount_cents = 0
    WHERE id = _dest;

  RETURN jsonb_build_object('status', 'credited', 'tier', t.tier);
END;
$fn$;

REVOKE ALL ON FUNCTION public.unlock_destination_with_credit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlock_destination_with_credit(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unlock_destination_with_credit(uuid) TO authenticated;

-- ---- Atomic Paddle unlock processor ---------------------------------------
-- One transaction: claim event, lock destination, apply paid unlock, mark
-- success. Advisory lock prevents concurrent deliveries from racing. On
-- failure the whole transaction rolls back (no paddle_events row lingers as
-- 'pending' with side effects); the handler records diagnostic failure state
-- in a separate post-rollback upsert.
CREATE OR REPLACE FUNCTION public.process_paddle_unlock_event(
  _event_id text,
  _event_type text,
  _payload jsonb,
  _dest uuid,
  _paid_cents int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  existing RECORD;
  unlock_result jsonb;
  key_hash bigint;
BEGIN
  IF _event_id IS NULL OR length(trim(_event_id)) = 0 THEN
    RAISE EXCEPTION 'event_id required' USING ERRCODE = '22023';
  END IF;

  key_hash := hashtextextended('paddle_event:' || _event_id, 0);
  IF NOT pg_try_advisory_xact_lock(key_hash) THEN
    RAISE EXCEPTION 'concurrent_processing' USING ERRCODE = '55P03';
  END IF;

  SELECT * INTO existing FROM public.paddle_events
    WHERE event_id = _event_id FOR UPDATE;

  IF FOUND AND existing.status = 'success' THEN
    RETURN jsonb_build_object('outcome', 'duplicate', 'result', existing.result);
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.paddle_events(
      event_id, event_type, payload, status, attempts, last_attempt_at
    ) VALUES (
      _event_id, _event_type, _payload, 'pending', 1, now()
    );
  ELSE
    UPDATE public.paddle_events
      SET attempts        = attempts + 1,
          last_attempt_at = now(),
          status          = 'pending',
          error           = NULL,
          event_type      = _event_type,
          payload         = _payload
      WHERE event_id = _event_id;
  END IF;

  unlock_result := public.unlock_destination_paid(_dest, _paid_cents, _event_id);

  UPDATE public.paddle_events
    SET status       = 'success',
        result       = COALESCE(unlock_result->>'status', 'ok'),
        processed_at = now(),
        error        = NULL
    WHERE event_id = _event_id;

  RETURN jsonb_build_object('outcome', 'processed', 'result', unlock_result);
END;
$fn$;

REVOKE ALL ON FUNCTION public.process_paddle_unlock_event(text,text,jsonb,uuid,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_paddle_unlock_event(text,text,jsonb,uuid,int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_paddle_unlock_event(text,text,jsonb,uuid,int) TO service_role;

-- ---- Drop obsolete generic RPC --------------------------------------------
DROP FUNCTION IF EXISTS public.unlock_destination(uuid, boolean, integer);
-- end of migration

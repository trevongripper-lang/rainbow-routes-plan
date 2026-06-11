
-- 1) destinations: unlock fields
ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS unlock_status text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS unlock_tier text,
  ADD COLUMN IF NOT EXISTS unlocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS unlocked_by uuid,
  ADD COLUMN IF NOT EXISTS paid_amount_cents int NOT NULL DEFAULT 0;

ALTER TABLE public.destinations
  DROP CONSTRAINT IF EXISTS destinations_unlock_status_check;
ALTER TABLE public.destinations
  ADD CONSTRAINT destinations_unlock_status_check
  CHECK (unlock_status IN ('free','paid','credited'));

ALTER TABLE public.destinations
  DROP CONSTRAINT IF EXISTS destinations_unlock_tier_check;
ALTER TABLE public.destinations
  ADD CONSTRAINT destinations_unlock_tier_check
  CHECK (unlock_tier IS NULL OR unlock_tier IN ('tier1','tier2','tier3'));

-- 2) profiles: loyalty counter + referrer
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paid_trip_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3) user_credits
CREATE TABLE IF NOT EXISTS public.user_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('loyalty','referral')),
  remaining int NOT NULL DEFAULT 0 CHECK (remaining >= 0),
  earned_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own credits" ON public.user_credits;
CREATE POLICY "Users read own credits" ON public.user_credits
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS user_credits_user_idx ON public.user_credits(user_id) WHERE remaining > 0;

-- 4) credit_events ledger
CREATE TABLE IF NOT EXISTS public.credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('earned_loyalty','earned_referral','spent')),
  amount int NOT NULL,
  destination_id uuid REFERENCES public.destinations(id) ON DELETE SET NULL,
  related_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.credit_events TO authenticated;
GRANT ALL ON public.credit_events TO service_role;
ALTER TABLE public.credit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own credit events" ON public.credit_events;
CREATE POLICY "Users read own credit events" ON public.credit_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Enforce one referral bonus per (invitee, inviter) pair
CREATE UNIQUE INDEX IF NOT EXISTS credit_events_unique_referral
  ON public.credit_events(user_id, related_user_id)
  WHERE kind = 'earned_referral';

-- 5) helper: tier + cents for a member count
CREATE OR REPLACE FUNCTION public.required_unlock_tier(_members int)
RETURNS TABLE(tier text, cents int)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN _members <= 5 THEN NULL
      WHEN _members <= 10 THEN 'tier1'
      WHEN _members <= 20 THEN 'tier2'
      ELSE 'tier3'
    END,
    CASE
      WHEN _members <= 5 THEN 0
      WHEN _members <= 10 THEN 499
      WHEN _members <= 20 THEN 999
      ELSE 1999
    END;
$$;

-- 6) updated headcount check: no cap if unlocked OR legacy Pro
CREATE OR REPLACE FUNCTION public.check_headcount_cap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pro boolean;
BEGIN
  IF NEW.headcount IS NULL THEN RETURN NEW; END IF;
  IF NEW.headcount < 1 THEN
    RAISE EXCEPTION 'Headcount must be at least 1' USING ERRCODE = '23514';
  END IF;
  -- unlocked trips: no cap
  IF NEW.unlock_status IN ('paid','credited') THEN
    RETURN NEW;
  END IF;
  SELECT is_pro INTO pro FROM public.profiles WHERE id = NEW.user_id;
  IF COALESCE(pro, false) THEN
    RETURN NEW; -- grandfathered legacy Pro users
  END IF;
  IF NEW.headcount > 5 THEN
    RAISE EXCEPTION 'destinations_headcount_free_plan_max: Free plan supports up to 5 people per trip. Unlock this trip to add more.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- 7) loyalty grant helper (called inside unlock_destination)
CREATE OR REPLACE FUNCTION public._maybe_grant_loyalty(_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  SELECT paid_trip_count INTO cnt FROM public.profiles WHERE id = _user;
  IF cnt IS NULL THEN RETURN; END IF;
  IF cnt > 0 AND cnt % 8 = 0 THEN
    INSERT INTO public.user_credits (user_id, source, remaining)
    VALUES (_user, 'loyalty', 2);
    INSERT INTO public.credit_events (user_id, kind, amount)
    VALUES (_user, 'earned_loyalty', 2);
  END IF;
END;
$$;

-- 8) main unlock function: by credit OR by paid record
CREATE OR REPLACE FUNCTION public.unlock_destination(_dest uuid, _use_credit boolean, _paid_cents int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d RECORD;
  members int;
  t RECORD;
  cred RECORD;
  uid uuid;
BEGIN
  uid := auth.uid();
  SELECT * INTO d FROM public.destinations WHERE id = _dest;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  -- service_role bypass: allow when uid is null (webhook)
  IF uid IS NOT NULL AND d.user_id <> uid THEN
    RAISE EXCEPTION 'Only the trip owner can unlock';
  END IF;
  IF d.unlock_status IN ('paid','credited') THEN
    RETURN jsonb_build_object('status', d.unlock_status, 'already', true);
  END IF;

  SELECT count(*)::int INTO members FROM public.trip_members WHERE destination_id = _dest;
  SELECT * INTO t FROM public.required_unlock_tier(GREATEST(members, COALESCE(d.headcount, members)));
  IF t.tier IS NULL THEN
    RAISE EXCEPTION 'Trip is within free tier; no unlock needed';
  END IF;

  IF _use_credit THEN
    SELECT * INTO cred FROM public.user_credits
      WHERE user_id = d.user_id AND remaining > 0
      ORDER BY earned_at ASC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No credits available'; END IF;
    UPDATE public.user_credits SET remaining = remaining - 1 WHERE id = cred.id;
    INSERT INTO public.credit_events (user_id, kind, amount, destination_id)
      VALUES (d.user_id, 'spent', 1, _dest);
    UPDATE public.destinations
      SET unlock_status = 'credited', unlock_tier = t.tier,
          unlocked_at = now(), unlocked_by = d.user_id, paid_amount_cents = 0
      WHERE id = _dest;
    RETURN jsonb_build_object('status','credited','tier',t.tier);
  ELSE
    -- paid path (called from webhook with _paid_cents)
    UPDATE public.destinations
      SET unlock_status = 'paid', unlock_tier = t.tier,
          unlocked_at = now(), unlocked_by = d.user_id,
          paid_amount_cents = COALESCE(_paid_cents, t.cents)
      WHERE id = _dest;
    UPDATE public.profiles SET paid_trip_count = paid_trip_count + 1 WHERE id = d.user_id;
    PERFORM public._maybe_grant_loyalty(d.user_id);
    RETURN jsonb_build_object('status','paid','tier',t.tier,'cents',COALESCE(_paid_cents, t.cents));
  END IF;
END;
$$;

-- 9) referral grant (only if inviter has paid >=1 trip)
CREATE OR REPLACE FUNCTION public.grant_referral_credits(_invitee uuid, _inviter uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inviter_paid int;
BEGIN
  IF _invitee IS NULL OR _inviter IS NULL OR _invitee = _inviter THEN RETURN false; END IF;
  SELECT paid_trip_count INTO inviter_paid FROM public.profiles WHERE id = _inviter;
  IF COALESCE(inviter_paid, 0) < 1 THEN RETURN false; END IF;
  BEGIN
    INSERT INTO public.credit_events (user_id, kind, amount, related_user_id)
      VALUES (_invitee, 'earned_referral', 3, _inviter);
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;
  INSERT INTO public.user_credits (user_id, source, remaining)
    VALUES (_invitee, 'referral', 3);
  UPDATE public.profiles SET referred_by = _inviter WHERE id = _invitee AND referred_by IS NULL;
  RETURN true;
END;
$$;

-- 10) extend redeem_trip_invite to grant referral credits on first acceptance
CREATE OR REPLACE FUNCTION public.redeem_trip_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv RECORD;
  cap int;
  cur_count int;
  dest_owner uuid;
  unlocked boolean;
  invitee_existing_memberships int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  SELECT * INTO inv FROM public.trip_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'Invite expired'; END IF;
  IF inv.accepted_by IS NOT NULL THEN RAISE EXCEPTION 'Invite already used'; END IF;

  SELECT headcount, user_id, unlock_status IN ('paid','credited')
    INTO cap, dest_owner, unlocked
    FROM public.destinations WHERE id = inv.destination_id;
  SELECT count(*) INTO cur_count FROM public.trip_members WHERE destination_id = inv.destination_id;

  -- Block when trip is full AND not unlocked AND owner not legacy-pro
  IF NOT unlocked THEN
    DECLARE pro boolean;
    BEGIN
      SELECT is_pro INTO pro FROM public.profiles WHERE id = dest_owner;
      IF NOT COALESCE(pro,false) AND cur_count >= COALESCE(cap, 5) THEN
        RAISE EXCEPTION 'Trip is full — organizer needs to unlock first';
      END IF;
    END;
  END IF;

  INSERT INTO public.trip_members (destination_id, user_id, role)
    VALUES (inv.destination_id, auth.uid(), 'member')
    ON CONFLICT DO NOTHING;

  UPDATE public.trip_invites SET accepted_by = auth.uid(), accepted_at = now() WHERE id = inv.id;

  -- Referral grant: only for first-time members (this is the invitee's first ever trip_members row -> they're new)
  SELECT count(*) INTO invitee_existing_memberships
    FROM public.trip_members WHERE user_id = auth.uid();
  IF invitee_existing_memberships <= 1 THEN
    PERFORM public.grant_referral_credits(auth.uid(), dest_owner);
  END IF;

  RETURN inv.destination_id;
END;
$$;

-- 11) backfill: existing trips with > 5 members get grandfathered
UPDATE public.destinations d
SET unlock_status = 'credited',
    unlock_tier = (SELECT tier FROM public.required_unlock_tier(GREATEST(
      (SELECT count(*) FROM public.trip_members WHERE destination_id = d.id)::int,
      COALESCE(d.headcount, 0)
    ))),
    unlocked_at = now(),
    unlocked_by = d.user_id
WHERE unlock_status = 'free'
  AND GREATEST(
    (SELECT count(*) FROM public.trip_members WHERE destination_id = d.id)::int,
    COALESCE(d.headcount, 0)
  ) > 5;

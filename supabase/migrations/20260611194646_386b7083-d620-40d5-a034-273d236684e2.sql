
-- 1. expiry on user_credits
ALTER TABLE public.user_credits ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 2. promo codes table (admin-managed)
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  credits int NOT NULL CHECK (credits > 0 AND credits <= 50),
  max_redemptions int,
  redemptions_count int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  code_expires_at timestamptz,
  validity_days int NOT NULL DEFAULT 90,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
-- no policies: authenticated can't read directly; redemption happens via SECURITY DEFINER fn

-- 3. redemption ledger (one redemption per user per code)
CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  credits_granted int NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (promo_code_id, user_id)
);
GRANT SELECT ON public.promo_redemptions TO authenticated;
GRANT ALL ON public.promo_redemptions TO service_role;
ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own promo redemptions"
  ON public.promo_redemptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 4. allow 'promo' as a credit source (informational; user_credits.source is text)
-- 5. redeem function
CREATE OR REPLACE FUNCTION public.redeem_promo_code(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pc RECORD;
  uid uuid;
  exp timestamptz;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN RAISE EXCEPTION 'Enter a code'; END IF;

  SELECT * INTO pc FROM public.promo_codes
    WHERE lower(code) = lower(trim(_code))
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid code'; END IF;
  IF NOT pc.active THEN RAISE EXCEPTION 'This code is no longer active'; END IF;
  IF pc.code_expires_at IS NOT NULL AND pc.code_expires_at < now() THEN
    RAISE EXCEPTION 'This code has expired';
  END IF;
  IF pc.max_redemptions IS NOT NULL AND pc.redemptions_count >= pc.max_redemptions THEN
    RAISE EXCEPTION 'This code has reached its redemption limit';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promo_redemptions WHERE promo_code_id = pc.id AND user_id = uid) THEN
    RAISE EXCEPTION 'You already redeemed this code';
  END IF;

  exp := now() + (pc.validity_days || ' days')::interval;

  INSERT INTO public.promo_redemptions (promo_code_id, user_id, credits_granted, expires_at)
    VALUES (pc.id, uid, pc.credits, exp);
  INSERT INTO public.user_credits (user_id, source, remaining, expires_at)
    VALUES (uid, 'promo', pc.credits, exp);
  INSERT INTO public.credit_events (user_id, kind, amount)
    VALUES (uid, 'earned_promo', pc.credits);
  UPDATE public.promo_codes SET redemptions_count = redemptions_count + 1 WHERE id = pc.id;

  RETURN jsonb_build_object('credits', pc.credits, 'expires_at', exp);
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_promo_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text) TO authenticated;

-- 6. unlock_destination must skip expired credits
CREATE OR REPLACE FUNCTION public.unlock_destination(_dest uuid, _use_credit boolean, _paid_cents integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY (expires_at IS NULL), expires_at ASC, earned_at ASC
      LIMIT 1 FOR UPDATE;
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
$function$;


CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only SECURITY DEFINER functions touch this table.

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.rl_hit(_key text, _window_seconds integer, _max integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wstart timestamptz;
  cur int;
  retry int;
BEGIN
  IF _key IS NULL OR length(_key) = 0 THEN
    RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
  END IF;
  IF _window_seconds < 1 OR _max < 1 THEN
    RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
  END IF;
  wstart := to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);

  INSERT INTO public.rate_limits (key, window_start, count)
    VALUES (_key, wstart, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = public.rate_limits.count + 1
    RETURNING count INTO cur;

  IF cur > _max THEN
    retry := GREATEST(1, _window_seconds - floor(extract(epoch from (now() - wstart)))::int);
    RETURN jsonb_build_object('allowed', false, 'retry_after', retry, 'count', cur, 'max', _max);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'retry_after', 0, 'count', cur, 'max', _max);
END;
$$;

REVOKE ALL ON FUNCTION public.rl_hit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day' RETURNING 1)
  SELECT count(*)::int FROM d;
$$;

-- Patch promo redeem to enforce rate limit before any work
CREATE OR REPLACE FUNCTION public.redeem_promo_code(_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pc RECORD;
  uid uuid;
  exp timestamptz;
  rl_short jsonb;
  rl_day jsonb;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN RAISE EXCEPTION 'Enter a code'; END IF;

  rl_short := public.rl_hit('promo:' || uid::text || ':short', 600, 5);
  IF NOT (rl_short->>'allowed')::boolean THEN
    RAISE EXCEPTION 'Too many attempts. Try again in % seconds.', (rl_short->>'retry_after');
  END IF;
  rl_day := public.rl_hit('promo:' || uid::text || ':day', 86400, 20);
  IF NOT (rl_day->>'allowed')::boolean THEN
    RAISE EXCEPTION 'Daily redemption limit reached. Try again tomorrow.';
  END IF;

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
$function$;

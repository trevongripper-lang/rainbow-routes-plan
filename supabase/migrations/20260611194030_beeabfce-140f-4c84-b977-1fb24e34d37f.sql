
-- Profile fields for Plus subscription
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plus_status text,
  ADD COLUMN IF NOT EXISTS plus_renews_at timestamptz,
  ADD COLUMN IF NOT EXISTS paddle_customer_id text,
  ADD COLUMN IF NOT EXISTS paddle_subscription_id text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plus_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plus_status_check
  CHECK (plus_status IS NULL OR plus_status IN ('active','past_due','canceled'));

CREATE INDEX IF NOT EXISTS profiles_paddle_customer_idx
  ON public.profiles(paddle_customer_id) WHERE paddle_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_paddle_subscription_idx
  ON public.profiles(paddle_subscription_id) WHERE paddle_subscription_id IS NOT NULL;

-- Idempotency ledger for Paddle webhook events
CREATE TABLE IF NOT EXISTS public.paddle_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  result text,
  error text
);
GRANT ALL ON public.paddle_events TO service_role;
ALTER TABLE public.paddle_events ENABLE ROW LEVEL SECURITY;
-- No policies → only service_role can touch it.

CREATE INDEX IF NOT EXISTS paddle_events_type_time_idx
  ON public.paddle_events(event_type, processed_at DESC);

-- Update Plus check for headcount cap: Plus = unlimited
CREATE OR REPLACE FUNCTION public.check_headcount_cap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pro boolean;
  plus_active boolean;
BEGIN
  IF NEW.headcount IS NULL THEN RETURN NEW; END IF;
  IF NEW.headcount < 1 THEN
    RAISE EXCEPTION 'Headcount must be at least 1' USING ERRCODE = '23514';
  END IF;
  IF NEW.unlock_status IN ('paid','credited') THEN
    RETURN NEW;
  END IF;
  SELECT is_pro, plus_status = 'active'
    INTO pro, plus_active
    FROM public.profiles WHERE id = NEW.user_id;
  IF COALESCE(pro, false) OR COALESCE(plus_active, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.headcount > 5 THEN
    RAISE EXCEPTION 'destinations_headcount_free_plan_max: Free plan supports up to 5 people per trip. Unlock this trip or upgrade to Organizer Plus.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- 1) Trigger: assign owner from auth.uid(); reject mismatched or missing.
CREATE OR REPLACE FUNCTION public.enforce_analytics_event_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  allowed_keys text[];
  key text;
  is_anon boolean := false;
  caller uuid := auth.uid();
BEGIN
  -- Ownership is server-assigned. A caller MUST have a valid session.
  IF caller IS NULL THEN
    RAISE EXCEPTION 'analytics_events requires an authenticated caller' USING ERRCODE = '42501';
  END IF;

  IF NEW.user_id IS NULL THEN
    -- Client should omit user_id; fill it from the request JWT.
    NEW.user_id := caller;
  ELSIF NEW.user_id <> caller THEN
    -- Reject any attempt to write on behalf of a different user.
    RAISE EXCEPTION 'analytics_events.user_id must equal auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- Payload must be an object; enforce a generous cap for authenticated events.
  IF NEW.props IS NULL OR jsonb_typeof(NEW.props) <> 'object' THEN
    RAISE EXCEPTION 'analytics_events.props must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(NEW.props) > 4096 THEN
    RAISE EXCEPTION 'analytics_events.props too large' USING ERRCODE = '22023';
  END IF;

  BEGIN
    is_anon := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  EXCEPTION WHEN OTHERS THEN is_anon := false;
  END;

  -- Authenticated permanent callers: existing behavior; no allowlist restrictions.
  IF NOT is_anon THEN
    RETURN NEW;
  END IF;

  -- ---- Anonymous carve-out: strict per-event schema. -----------------
  IF NEW.destination_id IS NOT NULL THEN
    RAISE EXCEPTION 'anonymous callers may not attach destination_id' USING ERRCODE = '42501';
  END IF;

  CASE NEW.event
    WHEN 'anon_explore_started' THEN allowed_keys := ARRAY['source'];
    WHEN 'anon_pitch_intent'    THEN allowed_keys := ARRAY['source'];
    WHEN 'anon_upgrade_prompted' THEN allowed_keys := ARRAY['reason'];
    WHEN 'anon_upgrade_started'  THEN allowed_keys := ARRAY['method'];
    WHEN 'consent_prompted'      THEN allowed_keys := ARRAY['route', 'version'];
    ELSE
      RAISE EXCEPTION 'analytics event % not permitted for anonymous callers', NEW.event USING ERRCODE = '22023';
  END CASE;

  IF pg_column_size(NEW.props) > 512 THEN
    RAISE EXCEPTION 'anonymous analytics props too large' USING ERRCODE = '22023';
  END IF;

  FOR key IN SELECT jsonb_object_keys(NEW.props) LOOP
    IF NOT (key = ANY(allowed_keys)) THEN
      RAISE EXCEPTION 'analytics_events.props key % not allowed for anonymous event %', key, NEW.event USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(NEW.props -> key) <> 'string' THEN
      RAISE EXCEPTION 'analytics_events.props.% must be a string', key USING ERRCODE = '22023';
    END IF;
    IF length(NEW.props ->> key) > 120 THEN
      RAISE EXCEPTION 'analytics_events.props.% too long', key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$fn$;

-- 2) RLS: WITH CHECK the final row against auth.uid().
DROP POLICY IF EXISTS "Insert own analytics events" ON public.analytics_events;
CREATE POLICY "Insert own analytics events"
ON public.analytics_events
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
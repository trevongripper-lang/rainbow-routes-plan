
-- =====================================================================
-- Stage 5: RLS lockdown + beta consent gate
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Identity helpers (SECURITY DEFINER; never called from anon)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_confirmed_permanent(_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Hardening: only ever answer about the caller themselves.
  -- Prevents account-status probing across users.
  IF _user IS NULL OR auth.uid() IS NULL OR _user <> auth.uid() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = _user
      AND u.email_confirmed_at IS NOT NULL
      AND COALESCE(u.is_anonymous, false) = false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_confirmed_permanent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_confirmed_permanent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_confirmed_permanent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_confirmed_permanent(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.has_confirmed_consent(_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_anon boolean;
BEGIN
  IF _user IS NULL OR auth.uid() IS NULL OR _user <> auth.uid() THEN
    RETURN false;
  END IF;

  -- JWT-level anonymous flag; if the claim is missing, treat as not-anonymous.
  BEGIN
    is_anon := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  EXCEPTION WHEN OTHERS THEN
    is_anon := false;
  END;
  IF is_anon THEN
    RETURN false;
  END IF;

  IF NOT public.is_confirmed_permanent(_user) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.beta_consents
    WHERE user_id = _user
      AND version = public.current_consent_version()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_confirmed_consent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_confirmed_consent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_confirmed_consent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_confirmed_consent(uuid) TO service_role;


-- Small convenience wrapper for the client access-state cache.
CREATE OR REPLACE FUNCTION public.my_consent_status()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_confirmed_consent(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.my_consent_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_consent_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_consent_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_consent_status() TO service_role;


-- ---------------------------------------------------------------------
-- 2. beta_consents INSERT guard via helper (never touches auth.users directly)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Users insert own beta consents" ON public.beta_consents;

CREATE POLICY "beta_consents_insert_own_confirmed"
ON public.beta_consents
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.is_confirmed_permanent(auth.uid())
);


-- ---------------------------------------------------------------------
-- 3. get_public_profiles – anon-blocked; pre-consent = self-only;
--    post-consent = co-member intersection.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_public_profiles(_ids uuid[])
RETURNS TABLE(id uuid, display_name text, avatar_url text, is_pro boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean := false;
BEGIN
  IF caller IS NULL THEN RETURN; END IF;
  BEGIN
    is_anon := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  EXCEPTION WHEN OTHERS THEN is_anon := false;
  END;
  IF is_anon THEN RETURN; END IF;

  IF NOT public.has_confirmed_consent(caller) THEN
    -- Pre-consent: only ever return the caller's own row (if requested).
    RETURN QUERY
      SELECT p.id, p.display_name, p.avatar_url, COALESCE(p.is_pro, false)
      FROM public.profiles p
      WHERE p.id = caller AND (_ids IS NULL OR p.id = ANY(_ids));
    RETURN;
  END IF;

  -- Post-consent: caller + anyone they share a trip membership with.
  RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_url, COALESCE(p.is_pro, false)
    FROM public.profiles p
    WHERE p.id = ANY(COALESCE(_ids, ARRAY[]::uuid[]))
      AND (
        p.id = caller
        OR EXISTS (
          SELECT 1
          FROM public.trip_members m_self
          JOIN public.trip_members m_other
            ON m_other.destination_id = m_self.destination_id
          WHERE m_self.user_id = caller
            AND m_other.user_id = p.id
        )
      );
END;
$$;


-- ---------------------------------------------------------------------
-- 4. Restrictive consent policies on private tables
--    Applied per-command (SELECT/INSERT/UPDATE/DELETE); never FOR ALL.
--    Permissive per-row policies (owner/member) still apply on top.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t text;
  private_tables text[] := ARRAY[
    'destinations',
    'trip_members',
    'trip_invites',
    'comments',
    'trip_costs',
    'trip_flights',
    'trip_stays',
    'trip_tickets',
    'trip_polls',
    'trip_poll_options',
    'trip_poll_votes',
    'trip_itinerary_order',
    'trip_settlements',
    'trip_events',
    'trip_ratings',
    'votes',
    'notifications',
    'event_reports',
    'credit_events',
    'user_credits',
    'promo_redemptions'
  ];
BEGIN
  FOREACH t IN ARRAY private_tables LOOP
    -- Drop any prior restrictive consent policies so re-runs are safe.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_require_consent_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_require_consent_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_require_consent_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_require_consent_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.has_confirmed_consent(auth.uid()))',
      t || '_require_consent_select', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.has_confirmed_consent(auth.uid()))',
      t || '_require_consent_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.has_confirmed_consent(auth.uid())) WITH CHECK (public.has_confirmed_consent(auth.uid()))',
      t || '_require_consent_update', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.has_confirmed_consent(auth.uid()))',
      t || '_require_consent_delete', t
    );
  END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- 5. analytics_events – carve-out for anonymous exploration
--    Client SELECT/UPDATE/DELETE remain blocked. INSERT is permitted for
--    authenticated (including anonymous) callers, but strictly validated.
-- ---------------------------------------------------------------------

-- Enforce a per-event schema: name, exact allowed property keys, types,
-- destination_id rules per event, and payload size.
CREATE OR REPLACE FUNCTION public.enforce_analytics_event_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  allowed_keys text[];
  key text;
  is_anon boolean := false;
BEGIN
  -- Owner must be the caller.
  IF NEW.user_id IS NULL OR auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'analytics_events.user_id must equal auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- Payload must be an object and small.
  IF NEW.props IS NULL OR jsonb_typeof(NEW.props) <> 'object' THEN
    RAISE EXCEPTION 'analytics_events.props must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(NEW.props) > 2048 THEN
    RAISE EXCEPTION 'analytics_events.props too large' USING ERRCODE = '22023';
  END IF;

  BEGIN
    is_anon := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  EXCEPTION WHEN OTHERS THEN is_anon := false;
  END;

  -- Per-event allowlist + exact property-key schema.
  -- Extra keys are rejected. Missing keys are permitted (client may omit).
  CASE NEW.event
    WHEN 'anon_explore_started' THEN
      allowed_keys := ARRAY['source'];
      IF NEW.destination_id IS NOT NULL THEN
        RAISE EXCEPTION 'destination_id must be null for %', NEW.event USING ERRCODE = '22023';
      END IF;
    WHEN 'anon_pitch_intent' THEN
      allowed_keys := ARRAY['source'];
      IF NEW.destination_id IS NOT NULL THEN
        RAISE EXCEPTION 'destination_id must be null for %', NEW.event USING ERRCODE = '22023';
      END IF;
    WHEN 'anon_upgrade_prompted' THEN
      allowed_keys := ARRAY['reason'];
      IF NEW.destination_id IS NOT NULL THEN
        RAISE EXCEPTION 'destination_id must be null for %', NEW.event USING ERRCODE = '22023';
      END IF;
    WHEN 'anon_upgrade_started' THEN
      allowed_keys := ARRAY['method'];
      IF NEW.destination_id IS NOT NULL THEN
        RAISE EXCEPTION 'destination_id must be null for %', NEW.event USING ERRCODE = '22023';
      END IF;
    WHEN 'consent_prompted' THEN
      allowed_keys := ARRAY['route', 'version'];
    WHEN 'consent_accepted' THEN
      allowed_keys := ARRAY['version'];
    WHEN 'signup_completed' THEN
      allowed_keys := ARRAY['method'];
    WHEN 'session_recovery' THEN
      allowed_keys := ARRAY['reason'];
    ELSE
      RAISE EXCEPTION 'analytics_events.event % is not in the allowlist', NEW.event USING ERRCODE = '22023';
  END CASE;

  -- Extra-key check.
  FOR key IN SELECT jsonb_object_keys(NEW.props) LOOP
    IF NOT (key = ANY(allowed_keys)) THEN
      RAISE EXCEPTION 'analytics_events.props key % not allowed for event %', key, NEW.event USING ERRCODE = '22023';
    END IF;
    -- All allowed values must be short strings.
    IF jsonb_typeof(NEW.props -> key) <> 'string' THEN
      RAISE EXCEPTION 'analytics_events.props.% must be a string', key USING ERRCODE = '22023';
    END IF;
    IF length(NEW.props ->> key) > 120 THEN
      RAISE EXCEPTION 'analytics_events.props.% too long', key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Anonymous callers cannot post events tied to a destination.
  IF is_anon AND NEW.destination_id IS NOT NULL THEN
    RAISE EXCEPTION 'anonymous callers may not attach destination_id' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_analytics_event_shape_trg ON public.analytics_events;
CREATE TRIGGER enforce_analytics_event_shape_trg
  BEFORE INSERT ON public.analytics_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_analytics_event_shape();


-- ---------------------------------------------------------------------
-- 6. profiles – column-scoped UPDATE + validated RPC
-- ---------------------------------------------------------------------

-- Drop any prior blanket UPDATE policy; replace with a column-scoped one.
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;

REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;
GRANT  UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;

CREATE POLICY "profiles_update_own_basics"
ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);


-- Narrow validated RPC used by the app for profile edits.
CREATE OR REPLACE FUNCTION public.update_profile_basics(
  _display_name text,
  _avatar_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dn text;
  au text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in' USING ERRCODE = '42501';
  END IF;

  -- display_name: trim, 1..80 chars, no control chars.
  dn := btrim(COALESCE(_display_name, ''));
  IF length(dn) < 1 OR length(dn) > 80 THEN
    RAISE EXCEPTION 'display_name must be 1–80 characters' USING ERRCODE = '22023';
  END IF;
  IF dn ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'display_name contains invalid characters' USING ERRCODE = '22023';
  END IF;

  -- avatar_url: optional; if provided must be https URL, ≤ 1024 chars.
  au := NULLIF(btrim(COALESCE(_avatar_url, '')), '');
  IF au IS NOT NULL THEN
    IF length(au) > 1024 THEN
      RAISE EXCEPTION 'avatar_url too long' USING ERRCODE = '22023';
    END IF;
    IF au !~* '^https://[A-Za-z0-9.\-]+(:[0-9]+)?(/[^\s]*)?$' THEN
      RAISE EXCEPTION 'avatar_url must be an https URL' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.profiles
    SET display_name = dn,
        avatar_url   = au
    WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile_basics(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_profile_basics(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_profile_basics(text, text) TO authenticated;

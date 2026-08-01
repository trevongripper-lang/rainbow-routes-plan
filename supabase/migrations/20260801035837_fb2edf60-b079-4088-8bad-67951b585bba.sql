-- Phase 2: confirmation helper + server-side verification primitives.
-- No RLS policy changes. No auth settings changes.

-- 1. is_confirmed_permanent(): caller-only, profile-backed, with temporary
--    Supabase Auth fallback (REMOVE IN PHASE 4).
CREATE OR REPLACE FUNCTION public.is_confirmed_permanent(_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_anon boolean := false;
  auth_email text;
  auth_confirmed timestamptz;
  p_confirmed_at timestamptz;
  p_confirmed_email text;
BEGIN
  -- Caller-only. Never answer about another user.
  IF _user IS NULL OR auth.uid() IS NULL OR _user <> auth.uid() THEN
    RETURN false;
  END IF;

  BEGIN
    is_anon := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  EXCEPTION WHEN OTHERS THEN is_anon := false;
  END;
  IF is_anon THEN RETURN false; END IF;

  SELECT lower(btrim(u.email)), u.email_confirmed_at,
         COALESCE(u.is_anonymous, false)
    INTO auth_email, auth_confirmed, is_anon
    FROM auth.users u WHERE u.id = _user;

  IF auth_email IS NULL OR auth_email = '' OR is_anon THEN
    RETURN false;
  END IF;

  SELECT p.email_confirmed_at, p.confirmed_email
    INTO p_confirmed_at, p_confirmed_email
    FROM public.profiles p WHERE p.id = _user;

  -- Tribe-owned confirmation, void once the auth email diverges.
  IF p_confirmed_at IS NOT NULL
     AND p_confirmed_email IS NOT NULL
     AND p_confirmed_email = auth_email THEN
    RETURN true;
  END IF;

  -- ---- TEMPORARY COMPATIBILITY FALLBACK — REMOVE IN PHASE 4 ----
  -- Accepts the auth system's own confirmation state so users confirmed
  -- before the Tribe-owned pipeline exists keep working unchanged.
  IF auth_confirmed IS NOT NULL THEN
    RETURN true;
  END IF;
  -- ---- END TEMPORARY COMPATIBILITY FALLBACK ----

  RETURN false;
END;
$function$;

-- 2. has_consent_pending_confirmation(): consent without confirmation gate.
CREATE OR REPLACE FUNCTION public.has_consent_pending_confirmation()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean := false;
BEGIN
  IF caller IS NULL THEN RETURN false; END IF;
  BEGIN
    is_anon := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  EXCEPTION WHEN OTHERS THEN is_anon := false;
  END;
  IF is_anon THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.beta_consents
    WHERE user_id = caller
      AND version = public.current_consent_version()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.has_consent_pending_confirmation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_consent_pending_confirmation() TO authenticated, service_role;

-- 3. Server-only token issuance. Accepts a hash minted by the trusted route;
--    the raw token never enters the database or a client response.
CREATE OR REPLACE FUNCTION public.issue_email_verification_token(
  _user uuid, _email text, _token_hash text, _ttl_minutes integer DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  norm_email text := lower(btrim(COALESCE(_email, '')));
  auth_email text;
  new_id uuid;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'user required' USING ERRCODE = '22023'; END IF;
  IF norm_email = '' THEN RAISE EXCEPTION 'email required' USING ERRCODE = '22023'; END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'token_hash must be lowercase hex sha256' USING ERRCODE = '22023';
  END IF;
  IF _ttl_minutes IS NULL OR _ttl_minutes < 1 OR _ttl_minutes > 1440 THEN
    RAISE EXCEPTION 'ttl_minutes out of range' USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(u.email)) INTO auth_email
    FROM auth.users u
    WHERE u.id = _user AND COALESCE(u.is_anonymous, false) = false;
  IF auth_email IS NULL OR auth_email <> norm_email THEN
    RAISE EXCEPTION 'email does not match the account' USING ERRCODE = '22023';
  END IF;

  -- Supersede any open token for this user; only the newest link works.
  UPDATE public.email_verification_tokens
    SET invalidated_at = now()
    WHERE user_id = _user AND used_at IS NULL AND invalidated_at IS NULL;

  INSERT INTO public.email_verification_tokens (user_id, token_hash, email, expires_at)
  VALUES (_user, _token_hash, norm_email, now() + make_interval(mins => _ttl_minutes))
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_email_verification_token(uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_email_verification_token(uuid, text, text, integer) TO service_role;

-- 4. Token consumption: caller-only, atomic, single-use.
CREATE OR REPLACE FUNCTION public.consume_email_verification_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean := false;
  auth_email text;
  h text;
  tok RECORD;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'must be signed in' USING ERRCODE = '42501';
  END IF;
  BEGIN
    is_anon := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  EXCEPTION WHEN OTHERS THEN is_anon := false;
  END;
  IF is_anon THEN
    RAISE EXCEPTION 'must be signed in' USING ERRCODE = '42501';
  END IF;
  IF _token IS NULL OR length(btrim(_token)) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  SELECT lower(btrim(u.email)) INTO auth_email
    FROM auth.users u
    WHERE u.id = caller AND COALESCE(u.is_anonymous, false) = false;
  IF auth_email IS NULL OR auth_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  h := encode(sha256(convert_to(btrim(_token), 'UTF8')), 'hex');

  -- Single atomic claim: exactly one concurrent attempt can win.
  UPDATE public.email_verification_tokens t
    SET used_at = now()
    WHERE t.token_hash = h
      AND t.user_id = caller
      AND t.email = auth_email
      AND t.used_at IS NULL
      AND t.invalidated_at IS NULL
      AND t.expires_at > now()
    RETURNING t.* INTO tok;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  END IF;

  UPDATE public.profiles
    SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
        confirmed_email    = auth_email
    WHERE id = caller;

  RETURN jsonb_build_object('ok', true, 'email', auth_email);
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_email_verification_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_email_verification_token(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_confirmed_permanent(uuid) IS
  'Caller-only confirmation check. Profile-backed; contains a TEMPORARY auth.users fallback to remove in Phase 4.';
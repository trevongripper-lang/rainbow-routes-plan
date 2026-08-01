-- Phase 2 hardening

CREATE OR REPLACE FUNCTION public.has_consent_pending_confirmation()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  jwt_anon boolean := false;
  db_is_anon boolean;
BEGIN
  IF caller IS NULL THEN RETURN false; END IF;

  -- Early rejection only; never authoritative.
  BEGIN
    jwt_anon := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  EXCEPTION WHEN OTHERS THEN jwt_anon := false;
  END;
  IF jwt_anon THEN RETURN false; END IF;

  -- Authoritative: the auth.users row must exist and be non-anonymous.
  SELECT COALESCE(u.is_anonymous, false) INTO db_is_anon
    FROM auth.users u WHERE u.id = caller;
  IF NOT FOUND OR db_is_anon THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.beta_consents
    WHERE user_id = caller
      AND version = public.current_consent_version()
  );
END;
$function$;

COMMENT ON FUNCTION public.has_consent_pending_confirmation() IS
  'True only when the caller is a real, non-anonymous auth.users account (verified against the database, not just the JWT claim) with a current-version beta consent row.';

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

  -- The confirmation applies to the email verified right now.
  UPDATE public.profiles
    SET email_confirmed_at = now(),
        confirmed_email    = auth_email
    WHERE id = caller;

  RETURN jsonb_build_object('ok', true, 'email', auth_email);
END;
$function$;

COMMENT ON FUNCTION public.issue_email_verification_token(uuid, text, text, integer) IS
  'service_role ONLY. Performs no rate limiting. Contract: every trusted server path MUST call public.rl_hit(...) for the resend limit before invoking this, and issuance must be reachable only through the single trusted server-side issuance operation (rate limit -> token generation -> hash -> issuance -> email queue). Do not expose this to any client or to a server path that can skip the rate limit. Server route tests must assert the rate-limit check precedes issuance.';
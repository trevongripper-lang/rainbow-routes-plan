-- Phase 1: additive schema for Tribe-owned email verification.
-- No grant changes. No runtime code changes. Reversible.

-- 1. Profile confirmation state (no defaults)
ALTER TABLE public.profiles
  ADD COLUMN email_confirmed_at timestamptz,
  ADD COLUMN confirmed_email    text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_email_confirmation_paired_chk
    CHECK ((email_confirmed_at IS NULL) = (confirmed_email IS NULL)),
  ADD CONSTRAINT profiles_confirmed_email_normalized_chk
    CHECK (confirmed_email IS NULL OR confirmed_email = lower(btrim(confirmed_email)));

COMMENT ON COLUMN public.profiles.email_confirmed_at IS
  'Phase 1, unread until Phase 2. Written only by SECURITY DEFINER verification RPCs.';
COMMENT ON COLUMN public.profiles.confirmed_email IS
  'lower(btrim(email)) the confirmation applies to. Confirmation is void once auth email diverges.';

-- 2. Verification tokens: hash-only, service_role only
CREATE TABLE public.email_verification_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,
  email          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  invalidated_at timestamptz,
  CONSTRAINT email_verification_tokens_hash_hex_chk
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT email_verification_tokens_email_normalized_chk
    CHECK (email = lower(btrim(email))),
  CONSTRAINT email_verification_tokens_expiry_chk
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX email_verification_tokens_hash_uidx
  ON public.email_verification_tokens (token_hash);

CREATE INDEX email_verification_tokens_open_idx
  ON public.email_verification_tokens (user_id)
  WHERE used_at IS NULL AND invalidated_at IS NULL;

COMMENT ON TABLE public.email_verification_tokens IS
  'Tribe-owned verification links. Stores lowercase hex sha256 only; raw token exists solely in the delivered email.';

REVOKE ALL ON public.email_verification_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_verification_tokens TO service_role;

ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;
-- Intentionally zero policies.

-- 3. Consent provenance
ALTER TABLE public.beta_consents
  ADD COLUMN privacy_version text,
  ADD COLUMN source          text;

ALTER TABLE public.beta_consents
  ADD CONSTRAINT beta_consents_source_allowed_chk
    CHECK (source IS NULL OR source IN ('signup','interstitial','backfill'));

-- 4. Backfill: real auth timestamp, id-to-id mapping, idempotent
UPDATE public.profiles p
SET email_confirmed_at = u.email_confirmed_at,
    confirmed_email    = lower(btrim(u.email))
FROM auth.users u
WHERE u.id = p.id
  AND u.email_confirmed_at IS NOT NULL
  AND u.email IS NOT NULL
  AND btrim(u.email) <> ''
  AND COALESCE(u.is_anonymous, false) = false
  AND p.email_confirmed_at IS NULL;
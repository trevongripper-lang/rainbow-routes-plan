# Phase 1 — additive schema for Tribe-owned verification (final)

All guardrails folded in. Additive only, one transaction, no `src/` changes.

## Verified pre-state (`public.profiles` ACL)

```text
table-level:  anon          = a r d D x t m      (no UPDATE)
              authenticated = a r d D x t m      (no UPDATE)
              service_role  = a r w d D x t m
column-level: authenticated = UPDATE (display_name)
              authenticated = UPDATE (avatar_url)
```

No grant is touched. New columns are browser-unwritable by construction.

## Migration SQL

```sql
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
```

`token_hash` is a 64-char lowercase hex string, constraint-enforced. Partial index predicate is exactly `used_at IS NULL AND invalidated_at IS NULL`. Neither confirmation column has a default. No functions, triggers, auth settings, or `src/` edits.

## Post-execution report I will return

Baseline already measured: **6 expected** confirmed non-anonymous users of 8 profiles.

```sql
-- expected vs actual
SELECT (SELECT count(*) FROM auth.users u JOIN public.profiles p ON p.id = u.id
        WHERE u.email_confirmed_at IS NOT NULL AND u.email IS NOT NULL
          AND COALESCE(u.is_anonymous,false) = false) AS expected,
       (SELECT count(*) FROM public.profiles WHERE email_confirmed_at IS NOT NULL) AS actual;

-- mismatched rows (expect 0)
SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.id
WHERE p.email_confirmed_at IS NOT NULL
  AND (p.email_confirmed_at IS DISTINCT FROM u.email_confirmed_at
       OR p.confirmed_email IS DISTINCT FROM lower(btrim(u.email)));

-- partial state (expect 0)
SELECT count(*) FROM public.profiles
WHERE (email_confirmed_at IS NULL) <> (confirmed_email IS NULL);
```

Plus: before/after `profiles` ACL dump (expect identical), `has_table_privilege('anon'|'authenticated', 'public.email_verification_tokens', ...)` all false, and confirmation that sign-in, sign-up, consent, and trip access paths are untouched (no `src/` file modified, no policy or function altered).

## Tracked separately (not changed here)

`public.beta_consents` carries table-wide `arwdDxtm` to both `anon` and `authenticated`. Logged as a standalone security review item for after Phase 1.

## Rollback SQL

```sql
BEGIN;
DROP TABLE public.email_verification_tokens;
ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_email_confirmation_paired_chk,
  DROP CONSTRAINT profiles_confirmed_email_normalized_chk,
  DROP COLUMN email_confirmed_at,
  DROP COLUMN confirmed_email;
ALTER TABLE public.beta_consents
  DROP CONSTRAINT beta_consents_source_allowed_chk,
  DROP COLUMN privacy_version,
  DROP COLUMN source;
COMMIT;
```

No grant restoration required. I stop after Phase 1.

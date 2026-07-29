# Harden the auth-email pipeline against legacy `/verify` links

Goal: no layer of the production email pipeline can enqueue or send an auth email whose link is anything other than the Tribe-hosted `/auth/callback?token_hash=...` interstitial URL — even if the upstream Supabase webhook payload is malformed, downgraded, or a stale queue message resurfaces.

## What will change

### 1. Queue-time validation (email webhook)

File: `src/routes/lovable/email/auth/webhook.ts`

- Replace the current "use `payload.data.token_hash` if present, otherwise fall back to `payload.data.url`" logic with a strict validator:
  - Accept only these `action_type`s: `signup`, `invite`, `magiclink`, `recovery`, `email_change`, `reauthentication`.
  - For every action except `reauthentication`, require a non-empty `token_hash`. Extract it from `payload.data.token_hash`, or, defensively, from `payload.data.url` if that URL is a token-hash URL. Never accept a `/auth/v1/verify` URL as a token source.
  - For `reauthentication`, require `payload.data.token` (numeric TOTP) and never build a link.
- Build the confirmation URL only as `https://jointribetrips.com/auth/callback?token_hash=…&type=…[&next=/relative/path]`.
- `next` must be an app-relative path (starts with `/`, not `//`). If a foreign origin is embedded, drop `next`.
- Before enqueuing, run the same "no legacy artifact" scan the worker uses (see step 2) against the rendered `html` and `text`. If either contains `/auth/v1/verify`, any `supabase.co` verification host, or is missing the expected callback URL, refuse to enqueue and return HTTP 500 with a clear error code. Log the redacted email and run_id; never log the token hash or full URL.

### 2. Send-time validation (queue worker)

File: `src/routes/lovable/email/queue/process.ts`

- Before calling `sendLovableEmail`, inspect the payload for auth emails (`label` in the set above). Fail closed and DLQ the message when any of these are true:
  - `html` or `text` contains `/auth/v1/verify`
  - `html` or `text` contains a Supabase project host (`*.supabase.co/auth/v1/…`)
  - `html` or `text` contains a `next=` value pointing to a foreign origin
  - `label` (verification type) is missing or not in the allowlist
  - For link-based types, the payload's rendered URL is not the Tribe `/auth/callback?token_hash=…&type=…` shape
  - `link_strategy` (see step 3) is missing or not `tribe_token_hash_interstitial`
- On failure, insert an `email_send_log` row with `status = 'dlq'` and a machine-readable `error_message` code (e.g. `legacy_verify_url_detected`), then move the pgmq message to `auth_emails_dlq`. Never send it.

### 3. Version every auth email

Extend the enqueued payload and `email_send_log.metadata` with:

- `template_version` (string) — bumped when webhook.ts or the templates change materially
- `link_strategy` — hard-coded `tribe_token_hash_interstitial` for link-based auth emails, `totp_code` for reauthentication
- `webhook_deployment` — read at enqueue time from a build-injected constant (falls back to `import.meta.env.VITE_LOVABLE_BUILD_ID` or similar) so we can tell which route version produced the email
- `environment` — `production` when the request host is `jointribetrips.com`, otherwise `preview`

Log these on the `email_send_log` `pending` and `sent` rows. Never log `token_hash`, the confirmation URL, or the raw payload.

### 4. Handle existing queue entries (legacy purge)

- Inspect `pgmq.q_auth_emails` and `pgmq.q_auth_emails_dlq` for messages whose `message.html` or `message.text` contains `/auth/v1/verify`, or that lack `link_strategy = 'tribe_token_hash_interstitial'`.
- Move any such messages from the live queue to DLQ with a `legacy_pipeline_purged` marker and mark their `email_send_log` rows as `dlq`. Do not send them.
- Add a matching check in the worker itself so that even if a legacy message is reintroduced later (rewind, replay), it is refused at send time.
- The user-facing effect: recipients holding old, undelivered signup mails must request a resend from the sign-in screen; the resend path already routes through the hardened webhook.

### 5. Strict server-controlled type mapping

- Introduce one shared map: server `action_type` → callback `type` param → `verifyOtp` `type`. This map lives on the server (webhook) and is duplicated as a hard allowlist on the client (`src/routes/auth.callback.tsx`).
- In `auth.callback.tsx`, ignore any `type` query value not in the allowlist and fall back to `email`. Never trust a user-supplied `type`.
- Every flow uses the same map: signup → signup, invite → invite, magiclink → magiclink, recovery → recovery, email_change → email_change, reauthentication → (no link).

### 6. Protect token-bearing callback URLs

File: `src/routes/auth.callback.tsx`

- Confirm the `Referrer-Policy: no-referrer` meta already present and add `<meta name="robots" content="noindex, nofollow, noarchive">`.
- On mount, capture `token_hash`, `type`, and `next` from `window.location` into a component `ref`, then immediately call `window.history.replaceState(null, '', '/auth/callback')` BEFORE any React children mount third-party assets, analytics beacons, or error reporters.
- The token hash stays in-memory only for the lifetime of the click handler. It is not written to `sessionStorage`, analytics, diagnostics, breadcrumb logs, or Sentry-like reporters.
- Add explicit guards in `src/lib/analytics.ts` and `src/lib/auth-diagnostics.ts` to strip any incoming `token_hash`, `code`, or `access_token` keys before serialization, as belt-and-braces defense if a future caller passes them.

### 7. Record the active webhook deployment

- Expose a small `/api/public/email-webhook-version` GET endpoint that returns the same `webhook_deployment`, `template_version`, `link_strategy`, and `environment` values baked into the webhook module. This lets us confirm from outside the app which route version is live on production vs preview.
- Log the same values on every `pending`/`sent` `email_send_log` row (step 3) so we can join a specific delivered email back to a specific deployment.

### 8. Verification

Test all five link-based flows independently end-to-end (production `jointribetrips.com`):

1. Signup confirmation
2. Password recovery
3. Magic link sign-in
4. Invite accept
5. Email-change confirmation

For each: enqueue → confirm the enqueued payload has `link_strategy = tribe_token_hash_interstitial`, no `/verify`, and the callback URL points to `https://jointribetrips.com/auth/callback?token_hash=…&type=<matching>`; click the delivered link on a different browser/device; confirm the interstitial appears; confirm `verifyOtp` succeeds and routes to the correct final destination (`/app`, `/reset-password`, or the `next` path). Also verify reauthentication delivers a TOTP with no link.

Additional negative tests, both automated where practical and verified in logs:

- Enqueue is refused when a synthetic payload omits `token_hash` for a link type.
- Worker DLQs a synthetic legacy message injected into `pgmq.q_auth_emails` with a `/auth/v1/verify` URL.
- Callback ignores an unknown `type` query value and falls back safely.
- No `email_send_log` row, analytics event, or diagnostics event contains a token hash or the full confirmation URL.
- `/api/public/email-webhook-version` returns the expected `production` values on the live domain.

## Acceptance

- Zero occurrences of `/auth/v1/verify` in `email_send_log`, `pgmq.q_auth_emails`, `pgmq.q_auth_emails_dlq`, or delivered mail after this change ships.
- All five flows sign the user into the correct final route on a first, cross-device click of a fresh link.
- Any future upstream regression that reintroduces `/verify` in the payload results in an enqueue/send refusal and a DLQ row — never a delivered broken link.

## Technical notes

- The webhook and worker files are the only enforcement points that must be edited to close the current bug; steps 3, 4, and 7 add observability so a future regression is caught immediately.
- No database schema changes are required. `email_send_log.metadata` already exists as JSONB and is where `template_version`, `link_strategy`, `webhook_deployment`, `environment` will be recorded.
- `src/routes/auth.callback.tsx` already implements the two-step interstitial and `verifyOtp`; this plan only tightens URL handling and the type-map allowlist.
- No changes to Supabase Auth configuration, OAuth providers, or the reset-password page are required for this fix.
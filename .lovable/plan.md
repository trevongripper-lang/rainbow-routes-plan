## Goal

Stop the signup email from printing the confirmation URL twice, and make plain-text auth emails deterministic with exactly one token-bearing URL per message. All templates already ship as `multipart/alternative` (the webhook enqueues both `html` and `text`); the visible "URL twice" symptom is a template + auto-plain-text-conversion issue, not a MIME issue.

## Changes

### 1. `src/lib/email-templates/signup.tsx`
Remove the fallback block:

- `<Text style={fallbackLabel}>If the button does not work…</Text>`
- `<Text style={fallbackUrl}><Link href={confirmationUrl}>{confirmationUrl}</Link></Text>`

Also drop the now-unused `Link`, `fallbackLabel`, `fallbackUrl`, `fallbackLink` imports/style constants. HTML clients still see the styled CTA button; plain-text clients will see one label + one URL from the deterministic text body (see change 2).

### 2. `src/routes/lovable/email/auth/webhook.ts`
Stop relying on `render(element, { plainText: true })`. Replace the `text` derivation with an explicit per-template plain-text builder so exactly one verification URL is emitted per email:

```ts
function buildPlainText(emailType: string, p: {...}): string { ... }
// ...
const html = await render(element);
const text = buildPlainText(emailType, templateProps);
```

Bodies (each ends with `— Tribe Trips` and a short ignore/help line):

- `signup` — "Confirm the email <recipient> to finish creating your Tribe Trips account. This link expires in 24 hours.\n\n<url>\n\nIf you didn't sign up, ignore this email."
- `recovery` — "Reset your Tribe Trips password:\n\n<url>\n\nIf you didn't request this, ignore this email."
- `magiclink` — "Your Tribe Trips login link:\n\n<url>\n\nIf you didn't request this, ignore this email."
- `invite` — "You've been invited to Tribe Trips. Accept your invitation:\n\n<url>"
- `email_change` — "Confirm changing your Tribe Trips email from <oldEmail> to <newEmail>:\n\n<url>\n\nIf you didn't request this, secure your account."
- `reauthentication` — "Your Tribe Trips verification code: <token>\n\nThis code expires shortly."

No other webhook logic changes. `html`, headers, `from`, `reply_to`, `sender_domain`, subjects, logging, and enqueue behavior stay identical.

## Out of scope (verification you drive after deploy)

- Inspect a delivered message's raw source in Apple Mail / Gmail "Show original" and confirm `Content-Type: multipart/alternative` with both `text/html` and `text/plain` parts. The webhook passes both fields to Lovable's queue, which produces multipart — this is confirmed by inspecting live delivery, not code.
- Manual QA of signup / recovery / magic link / invite / email-change in Apple Mail (macOS + iOS), Gmail (web + app), Outlook (web + Windows).
- Reconfirm `/auth/v1/verify` → `https://jointribetrips.com/auth/callback` completes and the token is single-use (existing PKCE callback + Supabase built-in behavior — no code change needed).
- Analytics/log audit: no code path in `webhook.ts` or `src/lib/analytics.ts` writes `payload.data.url` or `payload.data.token`; only `run_id`, redacted email, and `emailType` are logged. No change required.
- Branded `auth.jointribetrips.com`: requires a Supabase custom auth domain setup in the managed backend. Do **not** proxy or rewrite token-bearing URLs in app code. Tracked as a follow-up, not part of this change.

## Acceptance mapping

- One styled CTA in HTML clients → change 1 removes the second URL block from signup; other templates already had one CTA only.
- One label + one URL in plain-text clients → change 2 replaces auto-conversion with explicit bodies that emit exactly one URL (or one TOTP for reauthentication).
- No template prints the same token-bearing URL twice → guaranteed by change 2 (single `<url>` interpolation per template) and change 1 (HTML fallback block removed).
- Verification and recovery keep working → we only change presentation; `confirmationUrl` (= `payload.data.url`) is unchanged.
- No tokens logged → already true; verified no additions.

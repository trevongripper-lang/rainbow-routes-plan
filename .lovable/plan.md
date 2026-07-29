## Root cause
Email confirmation currently goes: email link → Supabase `/verify` → 303 → `/auth/callback?code=…` → `exchangeCodeForSession(code)`. Because the client is configured with `flowType: "pkce"`, that final exchange **requires the PKCE `code_verifier` that was written to `localStorage` in the browser where the user submitted signup**. If the confirmation email is opened in a different browser, a different device, or a private tab, the verifier is missing and the exchange fails with an "invalid/expired code" error — even though the token itself is fresh and unused. That's what produced the "This sign in link has expired or was already used" screen for this user.

The token-hash / OTP flow (`verifyOtp({ token_hash, type })`) is stateless: it works from any browser, any device, any time within Supabase's token TTL. That's the correct flow for email confirmation links people will forward to their phone, open on their work laptop, etc.

## Fix — switch email confirmation links to token_hash + verifyOtp (cross-browser safe)

Frontend + email-template only. No DB or backend changes required.

### 1. Emit a same-origin verification URL from the auth webhook
`src/routes/lovable/email/auth/webhook.ts` currently forwards `payload.data.url` (the Supabase `/verify` link) into every template as `confirmationUrl`. The Supabase auth webhook payload also carries `token_hash` and (implicitly) `email_action_type`. Build a new `confirmationUrl` for the templates that call our own callback directly, so the click never touches `/verify`:

```
https://jointribetrips.com/auth/callback?token_hash=<token_hash>&type=<email_action_type>&next=<sanitized-next>
```

Apply this for `signup`, `magiclink`, `recovery`, `invite`, and `email_change`. Fall back to `payload.data.url` if `token_hash` is unexpectedly absent (defensive; should not happen). Do NOT change `reauthentication` (that's a numeric TOTP, no URL).

### 2. Teach `/auth/callback` to handle `token_hash`
In `src/routes/auth.callback.tsx`, before the existing `if (code)` branch:

- Read `token_hash` and `type` from the URL.
- If `token_hash` is present, call `supabase.auth.verifyOtp({ token_hash, type })`. This creates a session with no PKCE dependency.
- On success, fall through to the existing session-hydrated / routing block (recovery → `/reset-password`, permanent-with-consent → `/app` or `next`, etc.).
- On failure, show the existing "link expired or already used" error UI (this message becomes accurate again: it only fires if the token is actually stale).
- Keep the `code` branch as-is so OAuth (Google/Apple) — which legitimately needs PKCE and always finishes in the originating browser — still works unchanged.

### 3. Preserve `?next=` for post-confirm redirect
`consumePendingRedirect()` reads from `sessionStorage`, which is per-tab. Because the email click may land in a fresh tab with no sessionStorage, also accept a `next` query param on the callback URL, sanitize it with `sanitizeRedirectPath`, and prefer it over sessionStorage when both exist. `signUp` currently sets `emailRedirectTo` to the canonical `/auth/callback` — no change needed on the send side beyond step 1.

### 4. Guard against mail-scanner prefetch (bonus, cheap)
Because `verifyOtp` consumes the token on click, a corporate link-scanner could still burn the token before the human clicks. Mitigation: in the `/auth/callback` component, only call `verifyOtp` from `useEffect` (already the case) — do not trigger it from a HEAD/prefetch. No further work needed; this is inherent to the client-side flow and is already an improvement over `/verify`, which consumes tokens on any GET.

## Out of scope
- No changes to Google/Apple OAuth (they must remain PKCE).
- No database, RLS, or edge-function changes.
- No change to the "email already registered" flow shipped previously.
- No change to email template visual design.

## Acceptance
- New user signs up on desktop, opens the confirmation email on their **phone**, taps the link → lands on `/auth/callback`, session is created, routed to `/app` (or `/auth/consent` if consent gate applies). No "expired or already used" error.
- Same user, same-browser click → still works.
- Clicking the same email link a second time → shows "link expired or already used" (accurate — token was consumed).
- Password reset link → still routes to `/reset-password` after `verifyOtp`.
- Google / Apple sign-in → unchanged (still uses `?code=` + PKCE exchange).

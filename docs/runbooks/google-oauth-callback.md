# Google OAuth Callback Ownership

## Summary

`/auth/callback` is the **single owner** of the PKCE authorization-code
exchange for Google sign-in. Nothing else — including the Supabase JS SDK's
automatic URL detection — may consume the one-time `?code=…` parameter.

## Why

Google's authorization code is single-use. If two owners try to exchange it,
one succeeds and the other fails with `invalid_grant` / "code already used",
and users see `oauth_return_poll_timeout` because the callback never obtained
a session.

Historical failure modes we've seen and fixed:

1. **SDK vs. callback race.** `detectSessionInUrl: true` let the Supabase
   client swallow the code on any page load whose URL contained `?code=`,
   before `/auth/callback` could call `exchangeCodeForSession`.
2. **Landing on `/auth?code=…`.** If Google (or a browser back-nav or a PWA
   route interception) returns to `/auth` instead of `/auth/callback`,
   `/auth` used to only poll for a session and never exchange, so the code
   expired and the user saw `oauth_return_poll_timeout`.

## Contract

- `src/integrations/supabase/client.ts`: `flowType: "pkce"`,
  `detectSessionInUrl: false`. Do NOT flip this back on to "fix" reset or
  email confirmation — those paths ALSO route through `/auth/callback` and
  rely on the single-owner exchange.
- `src/routes/auth.callback.tsx`: calls `supabase.auth.exchangeCodeForSession(code)`
  exactly once, then strips the query with `history.replaceState`, clears the
  `OAuthPending` sessionStorage marker, and routes:
  - `type=recovery`   → `/reset-password`
  - confirmed + consent → sanitized `pending` redirect (default `/app`)
  - confirmed, no consent → `/auth/consent`
- `src/routes/auth.tsx`: if a visitor lands on `/auth?code=…` or
  `/auth?error=…`, forward the **complete** query to `/auth/callback` with
  `window.location.replace(…)` before rendering anything. Never call
  `exchangeCodeForSession` from `/auth`.
- Sanitized error codes only (`oauth_return.ts::toPublicOAuthErrorCode`).
  Raw provider messages and tokens must never appear in logs, analytics, or
  the UI.

## Do not

- Re-enable `detectSessionInUrl`.
- Add a second `exchangeCodeForSession` caller anywhere in the app.
- Increase the polling timeout in `/auth` — polling is a fallback for
  session hydration after a successful exchange, not a substitute for one.
- Change the Supabase redirect allow-list speculatively; the Site URL is
  `https://jointribetrips.com` and `/auth/callback` is already allow-listed
  on apex, www, and preview.

## Verifying a change

- `bun test src/lib/oauth-return.test.ts` and the full suite.
- Manual pass on: Safari private, normal browser, installed PWA, both a new
  Google account and a returning Google account. In each case confirm:
  1. Callback URL is `/auth/callback?code=…` (never `/auth?code=…` reached
     the login shell).
  2. `code` is consumed exactly once (network tab: one `/token` POST).
  3. User lands on `/app` or `/auth/consent`.
  4. Hard refresh keeps the session.

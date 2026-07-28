# Beta Support Runbook — Sign-in Issue Intake

Status: Google auth failure reported; **not reproduced**. Production evidence
confirms successful new-user creation, profile bootstrap, token issuance, and
returning-user sign-ins. A browser/PWA-specific failure remains possible.

## When a user reports "sign-in is broken"

Ask the reporter for the following, in this order. Do **not** ask for
passwords, OAuth codes, tokens, cookies, or full URLs (URLs can contain
`?code=…`).

### Required
1. **Timestamp** (their local time + timezone, or "just now").
2. **Origin** — one of:
   - `https://jointribetrips.com`
   - `https://www.jointribetrips.com`
   - Installed home-screen app (iOS/Android PWA)
   - Preview URL
3. **Device / browser** — e.g. "iPhone 15, iOS 18, Safari" or "MacBook, Chrome
   130, incognito".
4. **What they clicked** — "Continue with Google", "Sign in" (email), etc.
5. **What they saw** — options:
   - Nothing happened
   - Google account picker never appeared
   - Google error page (screenshot the text)
   - Bounced back to Tribe on a blank screen
   - Stuck spinner
   - Redirected to `/auth` again
   - Landed on `/app` but signed out
   - Other (describe)
6. **Final URL path** (path only, strip everything after `?`) — e.g. `/auth`,
   `/auth/callback`, `/app`.
7. **Sanitized console error** (DevTools → Console): copy any red error line
   that mentions `auth`, `supabase`, `oauth`, or `session`. Redact anything
   that looks like a JWT (`eyJ…`) or a `code=` value.

### Optional but very useful
8. **Auth diagnostics dump** — in the browser DevTools console on the affected
   tab, run:
   ```js
   copy(JSON.stringify(JSON.parse(sessionStorage.getItem("tribe.auth.diag.v1") || "[]"), null, 2))
   ```
   Then paste. This is a per-session ring buffer of sanitized stage
   breadcrumbs (no tokens, codes, emails, or full URLs — see
   `src/lib/auth-diagnostics.ts`). The `cid` field is the correlation ID that
   lets us line the trace up with server auth logs.
9. Reproduces in **desktop incognito**? (yes / no / haven't tried)
10. Reproduces after a **hard reload** (Cmd+Shift+R)?

## Triage by first failing diagnostic stage

| Last stage seen | Likely boundary | First check |
| --- | --- | --- |
| `oauth_start` (no follow-up) | popup/redirect blocked | ad-blocker / iOS pop-up block / third-party cookie block |
| `oauth_redirect_initiated` (no return) | Google or broker | Google consent screen state, broker allowlist for reporter's origin |
| `oauth_inline_tokens_received` + `session_hydration_timeout` | client-side session write | Safari storage restrictions, private mode, quota |
| `callback_reached` + `callback_error_param` | Google/Supabase | copy the `error` code from the URL bar before the user leaves |
| `code_exchange_failed` | expired/reused link | ask the user to request a fresh link and open it in the same browser session |
| `session_hydrated` but no `final_navigate` | consent priming/router race | check `/auth/consent` gate |
| `final_navigate` but user still on `/auth` | bfcache / stale bundle | ask for hard reload, then re-test |

## Correlating with server logs

Give the correlation ID (`cid`) and timestamp to whoever queries Supabase auth
logs. Match on:
- `auth.users` insert time ± 60s (new-user reports),
- `/token` grant time ± 60s (returning-user reports),
- provider = `google`.

If the server side shows a successful login/token for that window and the
client trace ends at `session_hydration_timeout` or before `final_navigate`,
the failure is client-side (browser storage, PWA cache, or extension) — **not
an OAuth or Supabase config issue**.

## Retention

- Client diagnostics live in `sessionStorage` only — cleared when the browser
  tab closes. There is no server-side collection.
- Do not paste diagnostics into public channels; treat as low-sensitivity
  operational data.

## What NOT to change without a reproducible failing case

- OAuth `redirect_uri` (currently `/auth`, proven working with the Lovable
  inline `web_message` flow).
- Supabase Site URL / redirect allowlist.
- Google Cloud OAuth client origins/URIs.
- `handle_new_user` trigger.
- Consent gate routing.

See `docs/beta-gate/` for the full audit context.

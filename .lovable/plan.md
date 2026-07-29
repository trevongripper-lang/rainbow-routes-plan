## Goal

Prevent email scanners and link prefetchers from silently consuming one-time confirmation tokens by turning `/auth/callback` into a two-step flow when the incoming link uses `token_hash`. OAuth (`?code=`) is unchanged.

## Behavior

- **`token_hash` present** → render an interstitial. No network call, no `verifyOtp` on mount.
  - Show: "Confirm your email to finish signing in to Tribe" + a single **Confirm email** button + a small note "Only click if you started this on Tribe."
  - Clicking the button:
    1. Immediately strips `token_hash`/`type`/`next` from the URL via `history.replaceState`, and captures them in memory first.
    2. Calls `supabase.auth.verifyOtp({ token_hash, type })`.
    3. On success: continues into the existing `ensureAuthReady` → tier-based routing block (unchanged).
    4. On failure: shows the email-specific error card (see copy below).
  - Double-click / re-click after success: button is disabled once pressed; a second click is a no-op.
  - Refresh after success: URL has no token; `getSession()` finds the session and routes into `/app` (or consent).
  - Refresh before clicking: token is still in the URL, interstitial re-renders — matches "user must deliberately confirm".
- **`?code=` present** → existing OAuth PKCE branch runs automatically on mount (unchanged). No interstitial.
- **`error` param present** → existing error branch (unchanged, still OAuth-worded).
- **Neither** → existing "didn't receive confirmation" branch (unchanged).

## Copy changes

Email verification failures must not mention Google/OAuth. Split the error surface by branch:

- `token_hash` failure: **"This confirmation link has expired or was already used. Request a new email from the sign-in screen."**
- `token_hash` "no session after error": same as above.
- OAuth `?code=` failures: keep existing "Google didn't complete the sign-in…" / "This sign-in link has expired…" copy.
- Interstitial idle state: **"Confirm your email"** heading, body **"Tap Confirm to finish signing in to Tribe. Only continue if you started this sign-in."**, button **"Confirm email"**.

## Privacy / logging

- `logAuthStage` calls in the `token_hash` branch must never include `token_hash`, `type`, `next`, or any URL substring. Audit the existing calls — current code already only logs `code` labels like `"otp_verify_failed"`, keep it that way.
- The in-memory capture of `token_hash` lives only in the component closure; never write it to `sessionStorage`, analytics, or diagnostics.
- Strip params from `window.location` before the `verifyOtp` call resolves so an error toast / rerender cannot expose it.

## Verification (manual, after implementation)

1. Same-browser signup → click link → interstitial → Confirm → lands in `/app`.
2. Desktop signup → open link on phone → interstitial → Confirm → lands in `/app`.
3. Simulate prefetch: `curl` the confirmation URL, then click in browser → interstitial still works, token still valid.
4. Click Confirm twice rapidly → single `verifyOtp` call, no error.
5. Refresh interstitial before confirming → still works. Refresh after confirming → `/app`, no error.
6. Expired token → email-worded error card, no OAuth phrasing.
7. Resend confirmation email, then click the older link → email-worded expired/used error.
8. Session survives a hard refresh of `/app`.
9. Grep `logAuthStage` and diagnostics for any reference to `token_hash` / URL params → none.

## Technical details

Single file touched: `src/routes/auth.callback.tsx`.

- Add a new phase: `Phase = "exchanging" | "awaiting_confirm" | "verifying" | "routing" | "error"`.
- On mount, branch on URL params **before** any Supabase call:
  - `tokenHash && !code` → capture `{ tokenHash, otpType, nextParam }` into a ref, set phase `awaiting_confirm`, return.
  - Otherwise → run today's logic (OAuth code, error param, bare visit).
- Extract the post-verification block (URL strip → `ensureAuthReady` → tier routing) into a local `finishSession(flowType, nextParam)` helper reused by both the OAuth branch and the new confirm-click handler.
- Confirm-click handler:
  ```ts
  const params = pendingRef.current;
  pendingRef.current = null;
  window.history.replaceState(null, "", "/auth/callback");
  setPhase("verifying");
  const { error } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.otpType });
  if (error) { setErrorMessage(EMAIL_LINK_EXPIRED); setPhase("error"); return; }
  await finishSession(params.flowType, params.nextParam);
  ```
- Interstitial UI reuses the existing card/typography classes from the error branch for visual consistency.
- No changes to `src/routes/lovable/email/auth/webhook.ts`, `src/lib/oauth-return.ts`, `src/lib/auth-state.tsx`, or the OAuth flow.

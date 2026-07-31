# Switch Google sign-in to the Lovable managed OAuth wrapper

## What changes

In `src/routes/auth.tsx`, inside `handleGoogle()`, replace the direct Supabase call block (currently lines ~505–546) with the Lovable wrapper call:

```ts
const result = await lovable.auth.signInWithOAuth("google", {
  redirect_uri: window.location.origin + "/auth/callback",
  extraParams: { prompt: "select_account" },
});
```

Removed:
- `supabase.auth.signInWithOAuth({ provider: "google", ... })`
- `skipBrowserRedirect: true`
- the `!data?.url` condition
- `window.location.assign(data.url)`

The wrapper owns navigation and session installation.

## What stays

- Pre-flight 1: browser-storage-usable check and its error card.
- Pre-flight 2: origin canonicalization to apex before starting.
- `track("google_signin_started")`, `stashPendingRedirect`, `markOAuthPending("google", cid)`.
- The error path, rewired to `result.error` only: same `toPublicOAuthErrorCode("oauth_provider_failed")`, same `logAuthStage`, `track("google_signin_failed")`, `clearOAuthPending()`, and the same `setOauthReconcile` error card.
- The outer `catch` / `finally` block unchanged.

## Post-call handling

The wrapper returns one of three outcomes, so the block after the error check becomes:

- `result.error` → existing error card path.
- `result.redirected` → log `oauth_redirect_initiated` and return; the browser is already navigating to Google.
- neither → tokens came back inline and the session is already set. Log `oauth_redirect_initiated`, then navigate to the stashed redirect target so the user lands in the app instead of sitting on `/auth`.

`import { lovable } from "@/integrations/lovable/index"` is already present at line 7, so no import change is needed.

## Scope note

Apple sign-in (`handleApple`) keeps the direct Supabase PKCE flow — this change is Google only, as requested. That means the two providers will use different mechanisms until you decide to move Apple too.

## Risk to be aware of

`/auth/callback` currently expects a `?code=` PKCE exchange plus the two-step email `token_hash` interstitial. The Lovable wrapper may complete the session before that page loads rather than handing it a `code`. The callback route already handles an "already have a session" case, but this is the one thing to verify after the change: sign in with Google and confirm the callback page forwards to the stashed redirect rather than showing a "couldn't complete sign-in" state.

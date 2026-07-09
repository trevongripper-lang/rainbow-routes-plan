## Root cause

Three issues combine to make every route feel like it forces `/trips` and sign-out feel incomplete:

1. **`src/routes/__root.tsx` (lines 189–191)** — the global auth listener calls `router.navigate({ href: "/app" })` on every `SIGNED_IN` event. `/app` immediately redirects to `/trips`. OAuth returns, cross-tab sign-in, and (in some browsers) session restore all fire `SIGNED_IN`, dragging users off `/privacy`, `/terms`, `/pricing`, and `/auth` back to `/trips`. Post-login navigation is already owned by `AuthPage.goToApp()`; the root listener should not also navigate.

2. **`src/routes/_authenticated.tsx` `signOut` (lines 295–302)** races the async `SIGNED_OUT` event. `router.navigate({ to: "/auth" })` can run before the listener publishes `authStateFromSession(null)`, so `/auth`'s "already signed in" `useEffect` (auth.tsx L179–181) sees a stale `auth.session` snapshot and calls `goToApp()` → `/app` → `/trips`. `clearAuthSession()` is never called explicitly and `router.invalidate()` is not called before navigation.

3. **`scheduleBrowserRedirectFallback` (`_authenticated.tsx` L96–111)** schedules a bare `window.setTimeout` with no handle stored. If a protected `beforeLoad` scheduled a fallback and the user signs out within 1.5 s, the timer still fires `window.location.replace(target)` to the previously-protected URL, undoing the sign-out.

`/privacy` and `/terms` themselves have no `beforeLoad` and no redirects — they render fine on their own. The `/trips` pull is coming from #1 above.

`clearBetaConsentLocal(userId)` already exists in `src/lib/beta-consent.ts`; no new export needed.

## Fixes

### 1. `src/routes/__root.tsx`
Delete the `SIGNED_IN` → `router.navigate({ href: "/app" })` branch. Keep `router.invalidate()` and the filtered `queryClient.invalidateQueries()`.

### 2. `src/routes/_authenticated.tsx`
- Add a module-level `Set<number>` of pending fallback timer ids. `scheduleBrowserRedirectFallback` records its id; export `cancelPendingRedirectFallbacks()` that clears all of them.
- Import `useRouter` and `clearAuthSession`.
- Rewrite `signOut()` (dev-only `console.info("[signout] …")` at each step):
  ```ts
  async function signOut() {
    console.info("[signout] clicked");
    const before = await supabase.auth.getSession();
    console.info("[signout] session before", { hasSession: !!before.data.session });

    cancelPendingRedirectFallbacks();
    await qc.cancelQueries();
    qc.clear();

    const userId = before.data.session?.user?.id;
    const { error } = await supabase.auth.signOut();
    console.info("[signout] supabase.auth.signOut result", { error });

    clearAuthSession();
    clearRedirectTrace();
    if (userId) clearBetaConsentLocal(userId);
    console.info("[signout] app auth state cleared");

    const after = await supabase.auth.getSession();
    console.info("[signout] session after", { hasSession: !!after.data.session });

    await router.invalidate();
    console.info("[signout] navigating to /auth");
    await router.navigate({ to: "/auth", replace: true });
  }
  ```

### 3. `src/routes/auth.tsx`
Guard the "already signed in → goToApp" effect (L179–181) against a stale snapshot by re-confirming with Supabase before navigating:
```ts
useEffect(() => {
  if (!auth.ready || !auth.session) return;
  let cancelled = false;
  void (async () => {
    const { data } = await supabase.auth.getSession();
    if (cancelled || !data.session) return;
    void goToApp();
  })();
  return () => { cancelled = true; };
}, [auth.ready, auth.session, goToApp]);
```

No changes to schema, RLS, product behavior, or unrelated routes.

## Verification (Playwright against localhost)

After the edits, run a headless Playwright script covering each acceptance case and report actual outcomes (URL + screenshot + `supabase.auth.getSession()` result) per test:

1. Signed-out → visit `/auth` → stays on `/auth`.
2. Signed-out → visit `/privacy` → renders privacy page.
3. Signed-out → visit `/terms` → renders terms page.
4. Signed-out → visit `/trips` → redirects to `/auth?redirect=%2Ftrips`.
5. Sign in from `/auth` (managed Supabase session injection) → lands on `/trips` or beta-consent → no manual refresh needed.
6. Sign out from `/trips` → lands on `/auth`, `supabase.auth.getSession()` returns null, refresh keeps user signed out, `[signout]` logs show the full sequence.
7. After sign-out → type `/auth` → stays on `/auth`.
8. After sign-out → type `/privacy` and `/terms` → both render.
9. Signed-in on `/privacy` → simulated `TOKEN_REFRESHED`/`SIGNED_IN` event no longer navigates away.
10. Deep link `/trips` while signed out → sign in → returns to `/trips`.

Any failing case gets reported with the specific test, observed URL, screenshot, and the next suspected cause. No "resolved" claim without evidence.

## Files touched

- `src/routes/__root.tsx`
- `src/routes/_authenticated.tsx`
- `src/routes/auth.tsx`

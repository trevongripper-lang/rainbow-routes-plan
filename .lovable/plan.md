Plan to fix the post-auth stale-session routing bug:

1. Add a single app-wide auth state source
   - Create a small auth/session context owned by the root route so it wraps the whole route tree.
   - On mount, call `supabase.auth.getSession()` first, expose `authReady`, `session`, and `user`.
   - Subscribe once to `onAuthStateChange` and update React state immediately for `INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`, `USER_UPDATED`, and `SIGNED_OUT`.

2. Connect auth state to TanStack Router
   - Extend router context to include the current auth state.
   - When auth changes to `SIGNED_IN`, `TOKEN_REFRESHED`, or `INITIAL_SESSION` with a session, call `router.invalidate()` after the React auth state is updated.
   - On sign-out, clear protected query cache and invalidate the router without refetching protected queries into a cleared session.

3. Make the protected route guard wait for session readiness
   - Update the `_authenticated` layout guard to depend on current auth context/session state instead of a one-time stale check.
   - Add a guarded loading state while the initial session check is still pending.
   - When signed out, redirect to `/auth?redirect=<current path>` so direct protected-route visits return to the intended route after login.

4. Harden the sign-in handler
   - After `signInWithPassword`, explicitly wait for `supabase.auth.getSession()` to return a session.
   - Then invalidate the router and navigate to the sanitized redirect target or the app dashboard.
   - Avoid `window.location.reload()`; keep it out of the primary fix.

5. Normalize the dashboard target
   - The app’s authenticated dashboard route is currently `/trips`. I’ll keep existing navigation working and add `/app` as a protected alias/redirect to `/trips` so the requested acceptance path also works.

6. OAuth callback/return handling
   - Keep OAuth returning to a public URL, then rely on the root auth listener/session context to update state and navigate without refresh.
   - Ensure pending redirect storage is consumed only after session confirmation.

7. Verify the flows
   - Use the running app to test: signed-out email/password sign-in, sign-out then sign back in, direct protected route while signed out then sign in, and OAuth-return behavior where possible.
   - Confirm the dashboard renders without manual refresh and that no reload workaround is used.
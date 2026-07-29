## Add Google sign-in button back to /auth

### What
Restore the "Continue with Google" button on the `/auth` route. The underlying `handleGoogle()` PKCE redirect flow and recovery UI are already in place; only the trigger button in the sign-in shell is missing.

### Changes
1. **src/routes/auth.tsx**
   - Insert a "Continue with Google" button between the intro copy and the email form (around line 937).
   - Use an inline Google "G" SVG icon (no new dependency).
   - Add an "or" divider below the button before the email form.
   - Wire the button to the existing `handleGoogle()` function.
   - Disable the button while `loading`, `blocked`, or an OAuth reconcile is in progress.
   - Show the button in both sign-in and sign-up modes, matching typical OAuth behavior.

### Verification
- Typecheck the project.
- Visually confirm the button renders on `/auth` in the preview.
- Confirm clicking the button calls `handleGoogle()` and begins the PKCE redirect flow.

### Out of scope
- No changes to OAuth configuration, `handleGoogle()` logic, `/auth/callback`, or recovery UI.
- No new npm packages.
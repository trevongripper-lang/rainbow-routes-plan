## Goal
When someone tries to sign up with an email that already has an account, show a clear message and guide them to sign in or reset their password — instead of the current silent "check your inbox" screen.

## Background
Supabase's `signUp` deliberately does not throw an error for duplicate emails (to prevent account enumeration). Instead it returns:
- `data.user` present, but with `identities: []` (empty array)
- `data.session` null

Our current code (`src/routes/auth.tsx` ~L384) treats that as a normal "confirmation required" and shows the generic "confirm your email" screen, so the user has no idea the account already exists.

There's a real security tradeoff here: telling the user "this email already exists" leaks account existence to anyone who can hit the signup form. Given Tribe is a small invite-driven beta and the UX cost is high (users stuck refreshing an inbox for a mail that never arrives), I'll surface it — but only after the user has actually submitted signup themselves. This is the same tradeoff most consumer apps make.

## Changes (frontend only, `src/routes/auth.tsx`)

1. In `submitEmailConfirmed`, after `supabase.auth.signUp` succeeds with no session:
   - If `data.user && (data.user.identities?.length ?? 0) === 0` → treat as "already registered".
   - Otherwise → keep existing "confirmation required" path.

2. New lightweight UI state `alreadyRegisteredEmail: string | null` (mirrors `confirmSent`). When set, render a small card in place of the confirm-sent card with:
   - Heading: "This email is already registered"
   - Body: "An account with {email} already exists. Sign in with your password, or reset it if you've forgotten."
   - Primary button: "Sign in" → switches `mode` to `"login"`, prefills email, clears the card.
   - Secondary button: "Reset password" → calls the existing `handleForgot()` flow with the email prefilled, then shows the standard "reset link is on its way" toast.
   - Tertiary link: "Use a different email" → clears the card, keeps signup mode.

3. Analytics: emit `track("signup_email_exists")` when we detect the empty-identities response, so we can see how often this happens.

4. No backend, RLS, or edge-function changes. No change to the password-reset flow itself — reuse `handleForgot()` as-is.

## Out of scope
- Changing the sign-in path (wrong password already surfaces a clear error).
- Rate-limiting signup attempts beyond the existing `guard()` check.
- Server-side enumeration hardening (would require a captcha; explicitly deferred).

## Acceptance
- Sign up with a brand-new email → unchanged; "check your inbox" screen appears.
- Sign up with an email that already has a confirmed account → "This email is already registered" card appears with Sign in / Reset password actions, and no confirmation email is expected.
- Clicking "Sign in" flips the form to login mode with the email prefilled.
- Clicking "Reset password" triggers the existing reset flow and shows the standard toast.

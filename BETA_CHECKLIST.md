# Beta Checklist

## Legal / consent before beta

- [x] Privacy Policy updated with beta recording, retention, and contact language
- [x] Terms updated with private-beta, 18+, sandbox-payments, and sensitive-info language
- [ ] Beta testers confirmed to be 18+ (consent checkbox at `/beta-consent`)
- [ ] Recording / voice-narration consent captured (consent checkbox at `/beta-consent`)
- [x] No-sensitive-info warning included in Privacy, Terms, and tester instructions
- [x] Data retention period documented (up to 6 months, then deleted)
- [ ] Recordings stored in restricted-access Drive folder (link in internal doc, not public)
- [x] Contact email for deletion requests confirmed: `hello@tgklabs.io`
- [x] Payments remain sandbox / test-only during beta

See [`BETA_TESTER_INSTRUCTIONS.md`](./BETA_TESTER_INSTRUCTIONS.md) for the full tester onboarding doc.


## Must fix before opening the beta

- [ ] **Switch Paddle from sandbox to production keys** (`PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE_TIER*`, `PADDLE_WEBHOOK_SECRET`) and re-test one unlock end-to-end. Without this, real money cannot flow.
- [ ] **Confirm Google OAuth client has the production publish URL** in the authorized redirect list (Lovable subdomain *and* any custom domain).
- [ ] **Enable HIBP leaked-password check** in Cloud → Users → Auth Settings → Email. Currently off.
- [ ] **Disable anonymous sign-ups** in the same screen if it isn't already.
- [ ] **Confirm email templates** (signup confirmation, password reset, magic link) carry the Tribe Trips name and a real "from" address.
- [ ] **Add a privacy policy + terms of service page** and link them from `/auth`. Required for Google OAuth verification and App Store later.
- [ ] **Test account deletion** with a throwaway account end-to-end — make sure all trip memberships and authored content are handled per the cascade rules.
- [ ] **Run a final live-device smoke** (see PWA matrix below) once production keys are in.

## Nice to have after beta

- [ ] Clear the 20 remaining lint errors (`no-explicit-any`, escape chars, empty catches) — they don't change behavior but tighten types.
- [ ] Address the two obsolete `@next/next/no-img-element` rule references in `eslint.config.js`.
- [ ] Address `react-hooks/exhaustive-deps` warnings in `EventsMap.tsx` and `trips.$id.tsx`.
- [ ] Remove the deferred Ratings / Credits / Loyalty schema if it isn't going to ship.
- [ ] Add a service worker + offline shell only if beta users report needing it.
- [ ] Push notifications via Web Push (requires a separate messaging service worker).
- [ ] Resolve Supabase DB advisories: pin `search_path` on the remaining `SECURITY DEFINER` helpers and review `EXECUTE` grants on those callable from `anon`.

## Risks

### Privacy
- Trip data (destination, members, costs, chat) is personal — RLS is the only barrier. Any new table MUST ship with policies + GRANTs in the same migration.
- The `service_role` key bypasses RLS. It is only used by the Paddle webhook handler and the account-deletion server function today. Audit any new admin code paths.
- Notifications fanout copies user IDs and short snippets — no email/PII in payloads, verified.

### Payments
- Paddle is in sandbox mode. Real cards will not be charged until keys are swapped.
- Webhook signature verification is implemented in `src/routes/api/public/paddle-webhook.ts` — do not weaken or short-circuit it.
- The headcount cap and unlock tier price ladder are enforced in `check_headcount_cap` and `required_unlock_tier`. Free plan = 5 people. Validate these match the marketing page before launch.

### User data
- Account deletion uses `supabaseAdmin.auth.admin.deleteUser`. This cascades through FKs to `profiles`, `trip_members`, etc. Confirm no orphan rows by running a test deletion in production.
- No export-my-data flow yet. Add one if GDPR-region users join the beta.

### Authentication
- Email/password + Google only. Apple sign-in is required by App Store if/when we ship native.
- Password reset works (`reset-password.tsx`) but is rate-limit-free at the page level; Supabase rate-limits the email send itself.
- Session storage uses `localStorage` (Supabase default). Compatible with iOS Safari PWA install.

## PWA / mobile-web verification matrix

Run each before opening signups:

- [ ] iPhone Safari (iOS 17+) — sign up, sign in, Google OAuth, reset password
- [ ] iPhone Safari — Add to Home Screen → launches standalone, status bar correct color
- [ ] iPhone PWA — create trip, invite link, join, vote, chat, add flight, add cost, settle
- [ ] iPhone PWA — every modal scrolls and the close button is tappable above the home indicator
- [ ] Android Chrome — install prompt, same flow as iPhone
- [ ] Desktop Chrome + Safari — full flow including admin console (`/console/*`) if applicable

### How testers install Tribe Trips on iPhone

iOS Safari does **not** show a native install prompt — Apple requires a manual
flow. Tell testers:

1. Open Tribe Trips in **Safari** (not Chrome or Firefox — iOS only allows
   Safari to install web apps).
2. Tap the **Share** button (square with an up arrow) in Safari's bottom
   toolbar.
3. Scroll the share sheet and choose **Add to Home Screen**.
4. Tap **Add** in the top right. The Tribe Trips icon will appear on the home
   screen and launch full-screen like a native app.

If the install banner at the top of the app was dismissed, the same
instructions are always available under **Profile → Install Tribe Trips** and
**Settings → Install app**. The banner re-appears after 14 days.

Android Chrome, Edge, and desktop Chromium browsers show a native install
prompt via the in-app **Install** button; desktop Safari and Firefox do not
support installable web apps and the button surfaces a clear message saying so.

If any layout breaks on iPhone-sized widths, the fix usually lives in the responsive header patterns documented in the codebase — see existing trip-detail headers as the reference for `grid-cols-[minmax(0,1fr)_auto]` + `min-w-0` + `shrink-0`.

## Event accuracy verification

Run these once before opening the beta and after any bulk event import:

- [ ] **Coordinates audit**: in admin `/console/events`, every event without a "No lat/lng" red badge can match by distance. Fix or delete events flagged "No lat/lng" before they sit live.
- [ ] **Verified pass**: walk the events list, toggle Verified ON only for ones with a confirmed source URL, real date, and correct city.
- [ ] **Ranking smoke test**: open a trip whose city has a curated event in-dates → confirm it ranks above region-only matches.
- [ ] **Report flow smoke test**: open any trip with suggested events → tap the flag icon → submit a report → confirm toast, then verify `/console/events` shows the report count.
- [ ] **Stale events**: any event whose `end_date` is in the past should be removed or marked inactive — current schema has no `is_active` flag, so deletion is the simplest action for beta.
- [ ] **Curated-only policy**: do NOT wire a third-party event API for beta. Tradeoffs documented in `AUDIT.md §7`.

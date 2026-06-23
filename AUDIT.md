# Beta-Readiness Audit

Date: 2026-06-23 · Branch: web/PWA beta (no Expo/Capacitor)

## 1. Backend (Lovable Cloud / Supabase)

| Area | Status | Notes |
| --- | --- | --- |
| Migrations | ✅ | 31 migrations applied, latest = commitment-based readiness model |
| Auth | ✅ | Email + password, Google OAuth via Lovable broker, password reset flow |
| RLS | ✅ | Enabled on every user-data table; policies scoped to `auth.uid()` or `is_trip_member` / `is_trip_owner` |
| Storage | ✅ | One private bucket `destination-covers` |
| Server functions | ✅ | All app-internal logic uses `createServerFn` with `requireSupabaseAuth`; webhooks under `/api/public/*` |
| DB linter | ⚠️ | 23 advisories, all INFO/WARN — `SECURITY DEFINER` + `search_path` notices on helper RPCs. No critical findings. Documented in BETA_CHECKLIST. |

## 2. Feature walkthrough

| Feature | State | Evidence |
| --- | --- | --- |
| Sign up / sign in / Google OAuth | ✅ | `src/routes/auth.tsx`, broker via `lovable.auth.signInWithOAuth` |
| Password reset | ✅ | `src/routes/reset-password.tsx` |
| Account deletion | ✅ | `src/lib/account.functions.ts` (`deleteMyAccount` via admin client) |
| Create trip | ✅ | `src/lib/pitch-trip.functions.ts` |
| Invite links | ✅ | `trip_invites` table, `preview_trip_invite` + `redeem_trip_invite` RPCs, `/join/$token` route |
| Join trip | ✅ | Headcount cap enforced via `check_headcount_cap` trigger + unlock flow |
| Voting / polls | ✅ | `trip_polls`, `trip_poll_options`, `trip_poll_votes` |
| Chat (chatter) | ✅ | `comments` with mentions + threaded replies, fanout notifications |
| Flights | ✅ | `trip_flights` + Aviationstack lookup, syncs `travel_status` via trigger |
| Stays | ✅ | `trip_stays` |
| Tickets | ✅ | `trip_tickets` |
| Costs + settlements | ✅ | `trip_costs`, `trip_settlements`, balance math in `src/lib/trip-balances.ts` |
| Events near trip | ✅ | `match_trip_events` RPC returns `match_score` + `verified`; admin events carry `source_url`, `verified`, `confidence_notes`; users can flag via `event_reports`. EventsMap with Mapbox. |
| Notifications | ✅ | `notifications` table + bell, fanout from triggers |
| Planning progress | ✅ | New 6-item commitment model (this release) |
| Promo codes | ✅ | Admin console + `redeem_promo_code` RPC, rate-limited |
| Payments (Paddle) | ⚠️ Sandbox | `src/routes/api/public/paddle-webhook.ts` verifies HMAC. Live keys required for production. |
| PDF / ICS export | ✅ | `src/lib/exports/trip-pdf.ts`, `trip-ics.ts` |

## 3. Mocked / fake / incomplete code

- **No TODO/FIXME/HACK markers** in source (grep clean).
- **No hardcoded credentials** outside `.env` (publishable Supabase URL/key are intentionally in `.env`).
- **Ratings / Credits / Loyalty** tables and RPCs exist but are deferred — no user-facing UI yet (per project memory).
- **`RlsDebugPanel`** renders only when `import.meta.env.DEV` — safe in production.

## 4. Code quality

- `bun run format` ran clean across the whole tree.
- `bun run lint` now reports **20 errors + 12 warnings** (down from 70+). Remaining errors are non-blocking:
  - 14× `@typescript-eslint/no-explicit-any` in non-critical helpers
  - 3× `no-useless-escape` in regex (cosmetic)
  - 3× `no-empty` catch blocks (intentional silent retries)
  - 2× obsolete `@next/next/no-img-element` rule definitions missing — config noise, not a real bug
- Warnings are `react-hooks/exhaustive-deps` advisories and `react-refresh/only-export-components` (dev-only)
- **Moved `src/routes/_authenticated/trips.$id.test.tsx` → `src/__tests__/trip-page.test.tsx`** so the file-based router no longer registers it as a `/trips/:id/test` route.

## 5. PWA / mobile-web

- `public/manifest.webmanifest` complete (name, icons 192/512, maskable, theme color, standalone)
- Root layout sets `viewport-fit=cover`, `apple-mobile-web-app-capable`, `apple-touch-icon`
- No service worker — manifest-only install path, matches our "no offline" scope
- Responsive grid patterns reviewed on auth, home, trips list, trip detail, settings — see BETA_CHECKLIST for the live device-test matrix

## 6. Native (Expo / Capacitor / TestFlight)

Not added. Web/PWA path is correct for beta because:

1. The app is data-light (HTML + cached API responses), no native APIs in use today
2. PWA install gives users an app icon + standalone window on iOS 16.4+ and Android
3. Skips App Store review (1–2 week loop) and Apple's $99/yr developer fee until product-market fit
4. Push notifications, deep links, and offline mode would be the only reasons to wrap in Capacitor — none are in scope for beta

Trade-off if we wrap later: Capacitor adds a build pipeline, requires Apple/Google developer accounts, and gates every release on store review. Recommendation: stay PWA for the beta cohort.

## 7. Event accuracy (curated model)

We deliberately keep the curated-events approach for beta. A third-party
events API (Ticketmaster, PredictHQ, SeatGeek, Eventbrite) was evaluated and
deferred:

- Coverage gaps for our niche (Pride, circuit, queer beach events) — most
  large APIs over-index on mainstream sports/concerts and under-index on
  what our users actually plan trips around.
- Licensing + per-call cost would force caching anyway, putting us back in
  the curated/normalized shape we already have.
- Mixing sources without a trust signal makes the "Events near this trip"
  list noisier, not cleaner. Beta value comes from precision, not volume.

We'll revisit after beta if users ask for broader coverage.

### What we shipped this turn

- `events.source_url`, `events.verified`, `events.confidence_notes` columns.
- `event_reports` table (user-submitted flags, RLS-scoped: users see their
  own, admins see all).
- `match_trip_events` rewritten with a `match_score`:
  exact city + in-dates = 100, within-radius + in-dates = 85, buffered/region
  fallbacks lower, verified bonus +5. Results ordered by score.
- Admin console exposes source URL, verified toggle, confidence notes,
  missing-coordinates warning, and per-event report count.
- "Events near this trip" surfaces a Verified badge, "Strong match" label
  when `match_score ≥ 75`, and a Flag icon that opens a Report dialog.

### How to test event accuracy

1. **Coordinates required for distance**: open an event in admin without
   lat/lng → save → confirm it does NOT appear in a trip's nearby list at
   default 100mi radius (only matches if same city/region/country fallback).
2. **City + date ranking**: create two events in the same country — one in
   the trip's exact city during trip dates, one in a different city of the
   same country. Confirm the exact-city event appears first.
3. **Verified bonus**: toggle Verified on a tied-rank event → it should move
   above an unverified peer.
4. **Report flow**: tap the flag on a suggested event → submit "Not
   relevant" → toast confirms → re-submitting the same reason errors with
   "already reported".
5. **Admin report visibility**: as admin, refresh `/console/events` →
   reported event shows a red "N reports" badge.
6. **Buffered dates**: with `_include_outside_dates=false`, events outside
   trip dates ± buffer must not show; toggling "See outside my dates" must
   reveal them with a lower match score.

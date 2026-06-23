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
| Events near trip | ✅ | `match_trip_events` RPC, EventsMap with Mapbox |
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

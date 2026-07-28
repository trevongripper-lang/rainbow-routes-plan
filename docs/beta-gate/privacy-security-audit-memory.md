# Tribe Privacy & Security Audit Memory (repository-local)

Date: 2026-07-28
Author: Phase A code+schema audit
Source of truth: current repo `HEAD` and live production schema `oohyehpikrweipgdxpxd`.

This document supersedes any external audit file for engineering purposes. It
was reconstructed from direct inspection of code, migrations, and the running
database. Where the external audit disagreed with observed behavior, this
document records the observed behavior.

Scope note: This is a static source + schema review plus limited live
database introspection through the managed migration/read tools. It does NOT
independently verify: TLS termination at Cloudflare, encryption-at-rest for
Supabase Postgres and storage, backup retention/restore, staff access to the
Supabase dashboard, Paddle live vs sandbox posture, email-provider config, or
Cloudflare WAF/firewall rules. Every claim below is flagged **[verified]**
(evidence in-tree or in the live schema) or **[unverified — manual]** (relies
on a dashboard or provider inspection that is outside the sandbox).

---

## 1. Current protections — verified

- **Supabase email/password + Google OAuth via Lovable broker.**
  `src/routes/auth.tsx`, `src/integrations/lovable/index.ts`.
- **PKCE flow with `detectSessionInUrl`.**
  `src/integrations/supabase/client.ts` L28-38.
- **Server-side bearer-token claim validation.**
  `src/integrations/supabase/auth-middleware.ts` + registered in
  `src/start.ts` via `attachSupabaseAuth`.
- **RLS enabled on every public-schema table.**
  Live check: `SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false` → **0 rows**.
- **Service-role client is server-only** and loaded via dynamic import
  inside handlers. `src/integrations/supabase/client.server.ts`.
- **Storage buckets `destination-covers` and `destination-cover-drafts`
  are private** and gated by RLS policies scoped to trip membership /
  `auth.uid()`.
  Live check: `SELECT id, public FROM storage.buckets` → both `f`.
- **Paddle webhook HMAC-verified** in `src/routes/api/public/paddle-webhook.ts`.
- **Password-reset flow and recovery-session sign-out** in
  `src/routes/reset-password.tsx`, `src/routes/recover.tsx`.
- **Admin-only first-party analytics.** RLS on `analytics_events` +
  `has_role(auth.uid(),'admin')` gate on `/console/*` routes.
- **Beta feedback described as restricted-access folder** —
  `BETA_TESTER_INSTRUCTIONS.md` L58 says email `hello@tgklabs.io`; app
  copy in `src/routes/privacy.tsx` L86 says `hello@jointribetrips.com`.
  **Documentation inconsistency — flagged as beta blocker BB-11.**

## 2. Material gaps — verified

| # | Gap | Evidence |
|---|-----|----------|
| G1 | Account deletion is a single `auth.admin.deleteUser` call, no orchestration | `src/lib/account.functions.ts` full file |
| G2 | 30+ user-scoped columns on `trip_settlements`, `trip_stays`, `trip_flights`, `trip_tickets`, `trip_ratings`, `trip_poll_votes`, `trip_polls`, `trip_costs.user_id`, `promo_redemptions.user_id`, `storage_object_trip.uploaded_by` have **no FK to `auth.users`** — deleting the auth user leaves orphan UUID references | `pg_constraint` dump in §5 |
| G3 | `analytics_events.props` (jsonb) is arbitrary and only user_id/destination_id are SET NULL — props may still embed identifiers, snippets, and route paths | Trigger `enforce_analytics_event_shape` limits shape only for anon carve-out |
| G4 | `email_send_log.recipient_email`, `suppressed_emails.email`, `email_unsubscribe_tokens.email` are indefinite | No retention job found; `cleanup_rate_limits()` exists but no equivalent for email tables |
| G5 | `paddle_events.payload` (jsonb) retained indefinitely with customer, transaction, and address fields | `src/routes/api/public/paddle-webhook.ts` and `paddle_events` schema |
| G6 | Beta recordings/notes location conflicts (`hello@tgklabs.io` vs `hello@jointribetrips.com`) | `BETA_TESTER_INSTRUCTIONS.md` L58, L76 vs `src/routes/privacy.tsx` L86 |
| G7 | `pending_intents.payload` (jsonb) can carry arbitrary trip-pitch input including free-text | `src/lib/pitch-trip.functions.ts` |
| G8 | Password minimum is 8 (Supabase default) and HIBP check is off per `BETA_CHECKLIST.md` L22 | `configure_auth` not called with `password_hibp_enabled: true` in any migration |
| G9 | No MFA/passkeys/session management/sign-out-all/login history/login alerts | No calls to `supabase.auth.mfa.*`; no `admin.signOut(user, 'global')` orchestration |
| G10 | Browser session in localStorage → XSS reach expands | `src/integrations/supabase/client.ts` L30 |
| G11 | No app-set CSP / HSTS / Permissions-Policy / X-Frame-Options / X-Content-Type-Options in the app | `rg "Content-Security-Policy\|Strict-Transport-Security\|Permissions-Policy\|X-Frame" src/` → 0 hits |
| G12 | No data-export UI or privacy-request dashboard | `rg "export.*(json\|csv)\|downloadMyData" src/` → 0 relevant hits |
| G13 | No cross-store retention schedule, no automated cleanup for analytics, email log, drafts, paddle events, invite claims | Only `cleanup_rate_limits()` exists |
| G14 | Populated-account deletion has never been tested | No fixture in `src/__tests__/` or `supabase/tests/` |
| G15 | Google OAuth production redirect list, HIBP dashboard state, Cloudflare header injection, backup horizon, Supabase org 2FA all **unverified** | Dashboard-only |

## 3. Third parties actually used — verified against imports

| Provider | Called from | Data sent |
|----------|-------------|-----------|
| Supabase | Everywhere | All app data |
| Cloudflare / Lovable Worker | Hosting | All requests |
| Paddle | `src/routes/api/public/paddle-webhook.ts`, `src/lib/paddle-checkout.functions.ts` | Trip-owner user id, price tier, event metadata, customer id |
| Google OAuth | Broker via `src/integrations/lovable/index.ts` | Email, OAuth identity |
| OpenStreetMap / Nominatim | `src/lib/geocode.functions.ts` L52, `src/lib/events-admin.functions.ts` L210 | Trip title / city / region / country / user-entered search query, contact email in User-Agent header |
| Lovable AI Gateway → `google/gemini-3-flash-preview` | `src/lib/flight-lookup.functions.ts` L33, `src/lib/smart-add.functions.ts` L206 | User's free-text flight description; user's free-text smart-add paste; enriched URL metadata |
| AviationStack | `src/lib/flight-lookup.functions.ts` L108 | Flight IATA code + date |
| Serpstack | `src/lib/flight-lookup.functions.ts` L150 | Flight number + date as web-search query |
| Lovable error reporting | `src/lib/lovable-error-reporting.ts` (via `window.__lovableEvents.captureException`) | Error, current route pathname, custom context |
| Arbitrary websites | `src/lib/smart-add.functions.ts` L88 fetches user-pasted URLs | User's pasted URL sent server-side; response HTML parsed |

The current privacy policy (`src/routes/privacy.tsx`) **lists five
subprocessors** and omits Paddle-metadata retention, AviationStack, Serpstack,
Lovable AI Gateway (Gemini), Lovable error reporting, and arbitrary URL
enrichment. **This is a privacy-disclosure defect and a beta blocker.**

## 4. Current deletion behavior — measured

`src/lib/account.functions.ts` (12 lines total) invokes
`supabaseAdmin.auth.admin.deleteUser(userId)` and returns.

Actual downstream effects, derived from the FK map in §5:

**Cascaded** on auth-user delete:
`profiles`, `destinations` (and via them, everything CASCADEd from `destinations`),
`comments`, `votes`, `notifications` where user is recipient,
`credit_events` where user is subject, `user_credits`, `user_roles`,
`beta_consents`, `event_reports`, `trip_events` where user added,
`trip_invites` where user invited, `trip_members` where user is a member.

**Nulled**:
`analytics_events.user_id`, `notifications.actor_id`,
`credit_events.related_user_id`, `trip_costs.paid_by`,
`trip_invites.accepted_by`, `profiles.referred_by`.

**Orphaned — not touched at all**:
- `trip_costs.user_id` (cost author)
- `trip_settlements.from_user`, `to_user`, `created_by`
- `trip_stays.user_id`, `booked_by`
- `trip_flights.user_id`
- `trip_tickets.user_id`
- `trip_ratings.user_id`
- `trip_poll_votes.user_id`
- `trip_polls.user_id`
- `trip_itinerary_order` (no user column, ok)
- `storage_object_trip.uploaded_by`
- `promo_redemptions.user_id`
- Physical `storage.objects` rows (DB CASCADE does not purge storage)
- `analytics_events.props` json content
- `pending_intents.payload`, `pending_intents.claimed_by`
- `pending_invite_access` (no user column, but the invite still references the deleted user via `trip_invites.invited_by` before that CASCADEs)
- `email_send_log.recipient_email`, `email_send_log.metadata`
- `suppressed_emails.email`
- `email_unsubscribe_tokens.email`
- `paddle_events.payload` (retained under §3 justification but currently unminimized)

**Privacy policy claim vs reality**: `src/routes/privacy.tsx` L130 says
"Deleting your account permanently removes … your votes, comments, and beta
consent record. On trips you only joined, your membership is removed and your
name is cleared from shared records such as expenses and invites." Costs,
settlements, poll votes, stays, flights, tickets, ratings on trips owned by
someone else keep the raw `user_id` UUID. That is **a substantive
misrepresentation that must be corrected in Phase E**.

## 5. Foreign-key dump (evidence for §4)

Live query (2026-07-28):

```
analytics_events.user_id → auth.users ON DELETE SET NULL
beta_consents.user_id → auth.users ON DELETE CASCADE
comments.user_id → auth.users ON DELETE CASCADE
credit_events.user_id → auth.users ON DELETE CASCADE
credit_events.related_user_id → auth.users ON DELETE SET NULL
destinations.user_id → auth.users ON DELETE CASCADE
event_reports.user_id → auth.users ON DELETE CASCADE
notifications.user_id → auth.users ON DELETE CASCADE
notifications.actor_id → auth.users ON DELETE SET NULL
profiles.id → auth.users ON DELETE CASCADE
profiles.referred_by → profiles(id) ON DELETE SET NULL
trip_costs.paid_by → auth.users ON DELETE SET NULL
trip_events.added_by → auth.users ON DELETE CASCADE
trip_invites.invited_by → auth.users ON DELETE CASCADE
trip_invites.accepted_by → auth.users ON DELETE SET NULL
trip_members.user_id → auth.users ON DELETE CASCADE
user_credits.user_id → auth.users ON DELETE CASCADE
user_roles.user_id → auth.users ON DELETE CASCADE
votes.user_id → auth.users ON DELETE CASCADE
```

Tables whose user columns have **no FK** to `auth.users`:
`trip_costs.user_id`, `trip_settlements.from_user/to_user/created_by`,
`trip_stays.user_id/booked_by`, `trip_flights.user_id`,
`trip_tickets.user_id`, `trip_ratings.user_id`, `trip_poll_votes.user_id`,
`trip_polls.user_id`, `storage_object_trip.uploaded_by`,
`promo_redemptions.user_id`.

## 6. Browser storage keys

- `sb-<project>-auth-token` — Supabase session (localStorage).
- `tt:beta-consent:<version>:<uid>` — per-user cached consent flag
  (`src/lib/beta-consent.ts` L21).
- `install-banner-snooze` — PWA install nudge (`src/components/install-app-banner.tsx` L259).
- Build-version snapshot — cache-bust marker (`src/lib/build-version-check.ts` L57).

Only the Supabase session key contains personal data.

## 7. Recommendations (see `beta-blockers.md` for the ranked list)

Deferred to `beta-blockers.md`.

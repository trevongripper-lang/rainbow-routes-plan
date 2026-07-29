# Beta blockers — ranked

Date: 2026-07-28
Owner column: WHO must act. "Eng" = code change in this repo. "Ops" = a
person doing something in a dashboard or an external account.

Legend: **P0** = must ship before beta invitations. **P1** = must ship before
public beta (i.e. any tester outside the founder circle). **P2** = post-beta.

## P0 — Account deletion honesty

| # | Blocker | Evidence | Owner |
|---|---|---|---|
| BB-1 | Deletion is a single `auth.admin.deleteUser` call with no orchestration | `src/lib/account.functions.ts` | Eng (Phase B) |
| BB-2 | 10+ user columns lack FK and remain orphaned after deletion (`trip_settlements.*`, `trip_stays.user_id/booked_by`, `trip_flights.user_id`, `trip_tickets.user_id`, `trip_ratings.user_id`, `trip_poll_votes.user_id`, `trip_polls.user_id`, `trip_costs.user_id`, `promo_redemptions.user_id`, `storage_object_trip.uploaded_by`) | `pg_constraint` §5 of audit memory | Eng (Phase B migration) |
| BB-3 | Storage objects survive database CASCADE (physical files stay in `destination-covers` and `destination-cover-drafts`) | Storage RLS present; no cleanup path | Eng (Phase B) |
| BB-4 | `notifications.payload`, `analytics_events.props`, `pending_intents.payload`, `paddle_events.payload`, `email_send_log.metadata` are arbitrary jsonb and are never scrubbed | Column dumps in inventory | Eng (Phase B) |
| BB-5 | Privacy copy claims deletion removes "your name from shared records such as expenses and invites" — false today | `src/routes/privacy.tsx` L130-134 | Eng (Phase E) |
| BB-6 | No populated-account deletion test | Missing from `src/__tests__/` and `supabase/tests/` | Eng (Phase B) |
| BB-7 | No sign-out-all / active-session revocation on deletion; JWT keeps working until natural expiry | No `admin.signOut(userId,'global')` anywhere | Eng (Phase B) |
| BB-8 | Beta recordings folder & contact email inconsistent (`hello@tgklabs.io` in tester doc vs `hello@jointribetrips.com` in privacy policy) | `BETA_TESTER_INSTRUCTIONS.md` L58,76 vs `src/routes/privacy.tsx` L86 | Ops (pick one) + Eng (align copy) |

## P0 — Security hardening

| # | Blocker | Evidence | Owner |
|---|---|---|---|
| BB-9 | HIBP breached-password check off; password min = 8 (Supabase default) | `BETA_CHECKLIST.md` L22; no `configure_auth` migration setting `password_hibp_enabled: true` | Eng (Phase D) + Ops (verify dashboard) |
| BB-10 | No CSP / HSTS / Permissions-Policy / X-Frame-Options / X-Content-Type-Options / Referrer-Policy in the app | `rg` on `src/` returns 0 hits for any header string | Eng (Phase D — set in `__root.tsx` head + server route) |
| BB-11 | MFA on privileged accounts (founder Supabase, Cloudflare/Lovable, Paddle, Google Workspace, email provider, GitHub) unverified | Dashboard-only | Ops (documented step) |
| BB-12 | Retention cron for `pending_intents`, `pending_invite_access`, `analytics_events`, `email_send_log`, `paddle_events`, `destination-cover-drafts`, DLQs, deletion receipts is missing | Only `cleanup_rate_limits()` exists and is not scheduled per code | Eng (Phase C) |
| BB-13 | Cron job list not inspectable from the sandbox (permission denied on `cron.job`) | Live query in Phase A | Ops (verify + document) |
| BB-14 | Google OAuth production redirect list includes both `plantribetrips.lovable.app` and `jointribetrips.com` / `www.jointribetrips.com` — unverified | Provider dashboard | Ops |
| BB-15 | Backup horizon and restore drill unverified | Provider dashboard | Ops |
| BB-16 | Negative-authorization automated tests (non-member / former-member / anon / cross-user / invite-token abuse / admin escalation) missing | No matching suite in `src/__tests__/` or `supabase/tests/` | Eng (Phase D) |
| BB-17 | Rate limits on `deleteMyAccount`, data-export, geocode, flight lookup, smart-add absent or unverified | `src/lib/*.functions.ts` grep for `rl_hit` | Eng (Phase D) |
| BB-18 | Sensitive routes lack `Cache-Control: no-store` | `rg "no-store"` returns 0 | Eng (Phase D) |
| BB-19 | Bundle scan for service-role key / secrets not part of CI | No script or check | Eng (Phase G) |

## P0 — Privacy disclosures

| # | Blocker | Evidence | Owner |
|---|---|---|---|
| BB-20 | Subprocessor list is incomplete: missing Paddle-metadata retention, AviationStack, Serpstack, Lovable AI Gateway/Gemini, Lovable error reporting, arbitrary user-URL fetches | `src/routes/privacy.tsx` L116-124 vs Phase A §3 | Eng (Phase E) + Legal (approval) |
| BB-21 | "We store only success/failure" claim for payments is materially incorrect | Same file L48-50 vs `paddle_events` schema | Eng (Phase E) |
| BB-22 | "Permanently removes" language stronger than implementation proves | L130 | Eng (Phase E) |
| BB-23 | No data-category table (category / examples / purpose / who sees / recipients / retention / deletion result) | Missing | Eng (Phase E) |
| BB-24 | No encryption / security-controls section | Missing | Eng (Phase E, verified-only) |
| BB-25 | No policy version, effective date, or material-change process spelled out | `src/routes/privacy.tsx` L28-29 only shows "Last updated" | Eng (Phase E) |
| BB-26 | Privacy Policy and Terms not reviewed by counsel | New checklist item | Ops (legal) |

## P0 — Customer controls

| # | Blocker | Evidence | Owner |
|---|---|---|---|
| BB-27 | No `/settings/privacy-security` page | Missing | Eng (Phase F) |
| BB-28 | No sign-out-all sessions button | Missing | Eng (Phase F) |
| BB-29 | No data export | Missing | Eng (Phase F) |
| BB-30 | Deletion impact preview and status UI absent | Current UI is a "type DELETE" prompt | Eng (Phase B + F) |
| BB-31 | Beta-feedback deletion instructions not surfaced in-app | Only in `BETA_TESTER_INSTRUCTIONS.md` | Eng (Phase F) |

## P1 — Post-beta engineering

- User MFA / passkeys.
- Active sessions list, per-device sign-out.
- Login notifications and access history.
- In-product privacy-request queue.
- Vulnerability disclosure page, dependency scanning in CI, pentest.
- Move Supabase session out of `localStorage` (requires SSR cookie strategy;
  significant blast radius).

# Tribe Data Inventory — Phase A

Date: 2026-07-28
Evidence: direct schema introspection (`pg_class`, `pg_attribute`,
`pg_constraint`, `pg_policies`, `storage.buckets`) and source read of every
file under `src/lib/`, `src/routes/api/`, `src/integrations/`.
All claims below are verified against the live production schema
(`oohyehpikrweipgdxpxd`) unless marked **[unverified — manual]**.

## A. Public-schema tables

Column notation: `col` = present, `col*` = holds personal data or free text
that may embed personal data, `→X` = FK behavior on `auth.users` delete
(C = CASCADE, S = SET NULL, — = no FK / orphan on delete).

| Table | Personal / free-text columns | Purpose | User key | Retention today | On auth-user delete today | Phase B target (proposed) | Automated? |
|---|---|---|---|---|---|---|---|
| `profiles` | `id`, `display_name*`, `avatar_url*`, `stripe_customer_id`, `paddle_customer_id`, `paddle_subscription_id`, `referred_by` | Profile shown to co-travelers | `id → auth.users C` | Indefinite | CASCADE deletes row | Delete pre-auth in job; keep only pseudonymised billing IDs in `paddle_events`/receipt | Trigger via job |
| `destinations` | `title*`, `description*`, `special_note*`, `downsides*`, `image_url`, `city*`, `latitude`, `longitude`, `cover_object_path` | Trip owned by user | `user_id → auth.users C` | Indefinite | CASCADE if user is owner | Owner delete → cascade all descendants + storage; if not owner, N/A | Trigger via job |
| `trip_members` | `user_id`, `role` | Membership | `user_id → auth.users C` | Indefinite | CASCADE | Delete row on joined trips | Trigger via job |
| `trip_costs` | `label*`, `note*`, `paid_by`, `user_id (no FK)`, `split_member_ids`, `split_shares` | Shared expense | `user_id (no FK)`, `paid_by → S` | Indefinite | `paid_by` nulled, `user_id` **orphan** | Owner-cascade OR NULL user_id + rewrite split_member_ids/shares to drop deleted uuid + preserve amounts | Trigger via job |
| `trip_settlements` | `note*`, `from_user`, `to_user`, `created_by` (no FK) | Balance settlement | none | Indefinite | Orphan UUIDs remain | NULL all three columns on join-only trips; owner-cascade otherwise. Keep amount/currency/date. **Requires column-nullability migration** | Trigger via job |
| `trip_stays` | `title*`, `description*`, `address*`, `confirmation*`, `image_url`, `latitude`, `longitude`, `user_id (no FK)`, `booked_by (no FK)` | Lodging | none | Indefinite | Orphan | Owner-cascade OR delete rows authored by user + NULL `booked_by` | Trigger via job |
| `trip_flights` | `passenger_name*`, `airline`, `flight_number`, `depart_airport`, `arrive_airport`, `confirmation*`, `notes*`, `user_id (no FK)` | Flight | none | Indefinite | Orphan | Owner-cascade OR delete rows authored by user (they contain PII: name+confirmation) | Trigger via job |
| `trip_tickets` | `name*`, `url*`, `notes*`, `user_id (no FK)` | Activity ticket | none | Indefinite | Orphan | Owner-cascade OR delete rows authored by user | Trigger via job |
| `trip_ratings` | `feedback*`, `user_id (no FK)` | Post-trip rating | none | Indefinite | Orphan | Delete rows authored by user (contain free text) | Trigger via job |
| `trip_polls` | `question*`, `user_id (no FK)` | Poll | none | Indefinite | Orphan | Keep poll on join-only trips; NULL creator; delete on owner-cascade | Trigger via job |
| `trip_poll_options` | `label*` | Poll option | none | Indefinite | Orphan | Keep on join-only trips | Trigger via job |
| `trip_poll_votes` | `user_id (no FK)` | Vote | none | Indefinite | Orphan | Delete rows by user | Trigger via job |
| `votes` | `user_id → C` | Destination upvote | `user_id → C` | Indefinite | CASCADE | Fine as-is | Automatic |
| `comments` | `body*`, `mentions[]`, `user_id → C` | Chat | `user_id → C` | Indefinite | CASCADE | Delete authored comments; **also scrub `mentions[]` on others' comments** (uuid array can contain deleted user) | Trigger via job |
| `notifications` | `payload*` jsonb (may embed snippet, comment_id, label, amount, from_user, to_user), `user_id → C`, `actor_id → S` | Notification | `user_id → C` | Indefinite | CASCADE recipient; SET NULL actor; **payload uuids stay** | Delete recipient rows + scrub payload uuids from remaining rows targeting others | Trigger via job |
| `event_reports` | `note*`, `user_id → C` | User flag | `user_id → C` | Indefinite | CASCADE | Fine as-is | Automatic |
| `trip_invites` | `email*`, `token`, `invited_by → C`, `accepted_by → S` | Invite | mixed | Indefinite | CASCADE when inviter deleted; accepted_by nulled | Also delete invites where `email` matches the user's confirmed email(s) | Trigger via job |
| `trip_events` | `added_by → C` | Curated event link | `added_by → C` | Indefinite | CASCADE | Fine | Automatic |
| `analytics_events` | `props*` jsonb (arbitrary strings), `user_id → S` | Product analytics | `user_id → S` | Indefinite | user_id nulled; props kept | Delete all rows for the user + prune props referencing them | Retention cron + job |
| `beta_consents` | `user_agent*`, `user_id → C` | Consent record | `user_id → C` | Indefinite | CASCADE | Fine, but keep an **anonymised** consent-taken audit line for accountability | Trigger via job |
| `user_roles` | `role`, `user_id → C` | RBAC | `user_id → C` | Indefinite | CASCADE | Fine | Automatic |
| `user_credits` | `user_id → C` | Credit ledger | `user_id → C` | Indefinite | CASCADE | Fine (feature deferred per memory) | Automatic |
| `credit_events` | `user_id → C`, `related_user_id → S` | Ledger event | `user_id → C` | Indefinite | CASCADE + set null | Fine | Automatic |
| `promo_redemptions` | `user_id (no FK)` | Promo redeem | none | Indefinite | Orphan | NULL `user_id` after minimal accounting record | Trigger via job |
| `storage_object_trip` | `uploaded_by (no FK)` | Storage map | none | Indefinite | Orphan | Delete rows on owner-cascade; NULL uploaded_by otherwise | Trigger via job |
| `pending_intents` | `payload*` jsonb (free text from trip pitch), `session_id`, `claimed_by` | Pre-auth intent carrier | `claimed_by` (no FK) | `expires_at` present but no cron | Orphan | **Retention cron**: purge on `expires_at`; job deletes any where `claimed_by = uid` | Cron + job |
| `pending_invite_access` | `session_id` | Invite session claim | none | `expires_at` present but no cron | N/A | **Retention cron** on `expires_at` | Cron |
| `rate_limits` | `key` (may contain uid), `window_start`, `count` | Rate limiter | key | `cleanup_rate_limits()` exists but not scheduled | Orphan | Ensure scheduled cron runs `cleanup_rate_limits()` daily | Cron |
| `email_send_log` | `recipient_email*`, `metadata*`, `error_message*` | Delivery observability | `recipient_email` | Indefinite | Orphan | 90-day retention cron; on deletion, scrub `recipient_email`→hash + drop `metadata` | Cron + job |
| `email_send_state` | numeric config | Runtime config | none | Indefinite | Orphan | Fine | Automatic |
| `email_unsubscribe_tokens` | `token`, `email*` | Unsubscribe | `email` | Indefinite | Orphan | Keep unsubscribe suppression forever (no-contact); scrub `token` after use | Retention cron |
| `suppressed_emails` | `email*`, `metadata*` | Bounce/complaint suppression | `email` | Indefinite | Orphan | Keep as-is (no-contact requirement); no PII beyond email itself; **document** | Retained by design |
| `paddle_events` | `event_id`, `event_type`, `payload*` jsonb (customer, tx, addresses) | Webhook idempotency | none | Indefinite | Orphan | 24-month retention cron; on deletion, pseudonymise customer fields in payload but keep event_id/type/amount/tax for fraud/tax | Cron + job |
| `promo_codes` | code text | Admin promo | none | n/a | n/a | Fine | Automatic |
| `events` | curated data | Public curated | none | n/a | n/a | Fine | Automatic |
| `app_config` | config | Runtime toggles | none | n/a | n/a | Fine | Automatic |

## B. Storage buckets

| Bucket | Public | Contents | User key | Retention today | On deletion | Phase B target |
|---|---|---|---|---|---|---|
| `destination-covers` | private | Trip cover images | path `<destination_id>/<filename>` | Indefinite | DB CASCADE removes `destinations` row but **not the physical object** | Job step: list + delete all objects under any deleted destination prefix; also delete objects for trips the user only joined if `storage_object_trip.uploaded_by = uid` |
| `destination-cover-drafts` | private | Draft uploads under `drafts/<uid>/…` | uid in path | Indefinite (no cron) | **Physical files remain** | Job step: list + delete `drafts/<uid>/*`. Retention cron: purge drafts older than 30 days |

## C. Queues, DLQs, cron

- **`pgmq.q_auth_emails`, `pgmq.q_transactional_emails`** — dispatched by
  `email_queue_dispatch()`; drained on visibility timeout.
  Retention today: implicit (drained by worker); **payloads may include
  recipient email and template variables**. Phase B: on account deletion,
  filter and delete queued messages targeting the user's email.
- **DLQ tables** — created lazily by `move_to_dlq()`. No retention.
  Phase B: 30-day retention.
- **Cron jobs** — cron schema is not readable via the DB tools account
  (`permission denied for schema cron`), so **the current scheduled job list
  is [unverified — manual]**. Known-scheduled from code:
  `process-email-queue` (5-second interval, self-scheduling in
  `email_queue_wake`).
- **`cleanup_rate_limits()`** exists but no code path schedules it.
  Confirm via dashboard.

## D. External processors / data flows out

| Processor | What we send | Where | Retention (theirs) | Deletion on user request |
|---|---|---|---|---|
| Supabase (Cloud) | All app data | Managed Postgres, Auth, Storage | Per their DPA + backups | Auth user delete cascades DB; **backup horizon [unverified — manual]** |
| Cloudflare / Lovable Worker | HTTP requests | Edge logs | Per Cloudflare/Lovable DPA | Log rotation [unverified — manual] |
| Paddle | Customer id, subscription id, tx amounts, tier, billing address (in webhook payload) | `paddle_events`, Paddle account | Paddle retains tax/fraud/tx records | We can request Paddle deletion; they will retain tax/fraud records — surface in policy |
| Google | Email, OAuth identity | Google account | Google policy | Revoke via Google account settings |
| Nominatim (OSM) | Trip title / user free-text location search + `User-Agent: TribeTrips/1.0 (+hello@jointribetrips.com)` | osm.org logs | OSM operational logs | Not user-scoped; no deletion mechanism |
| Lovable AI Gateway → Gemini | User free-text pastes (flight desc, smart-add text, enriched URL metadata) | ai.gateway.lovable.dev | Per Lovable + Google policy | Not persisted server-side by us; disclose |
| AviationStack | Flight IATA + date | api.aviationstack.com | Per their policy | Not user-scoped |
| Serpstack | Flight number + date as search query | api.serpstack.com | Per their policy | Not user-scoped |
| Lovable error reporting | JS errors + current pathname + custom context | Lovable observability | Per Lovable policy | Ask Lovable to purge |
| Arbitrary URLs pasted by user | GET request to that URL server-side to fetch metadata | That site | Their access logs | N/A |

## E. Backups and DR

Postgres PITR/backups and storage snapshots are managed by Supabase Cloud.
The horizon and restore procedure are **[unverified — manual]** and must be
recorded on the beta-blocker checklist before Phase E policy copy is
finalised.

## F. Browser-stored items

| Key | Contains PII | Cleared on sign-out today? | Phase B |
|---|---|---|---|
| `sb-<project>-auth-token` (localStorage) | Yes (JWT + user) | Yes (`supabase.auth.signOut`) | Also cleared by "sign out all sessions" (`scope: 'global'`) |
| `tt:beta-consent:<v>:<uid>` | No (cached bool) | No | Clear on deletion request |
| `install-banner-snooze` | No | No | Fine |
| Build-version snapshot | No | No | Fine |

---

## G. Data-category summary for policy copy

(Feeds Phase E — must survive legal review.)

1. **Account & authentication** — email, provider, hashed password (at
   Supabase), confirmation state.
2. **Profile shown to co-travelers** — display name, avatar.
3. **Trip planning content** — destinations, dates, notes, cover image,
   coordinates, city/region/country.
4. **Membership & roles** — trips you own, trips you joined, your role.
5. **Communications** — chat messages and replies (visible to trip members),
   invitations (email addresses of invitees), notifications.
6. **Travel** — flights, stays, tickets, including free-text confirmation
   numbers and passenger names you enter.
7. **Financial trip data** — shared costs, splits, settlements, currencies.
8. **Payments** — Paddle customer/subscription/transaction identifiers,
   webhook metadata. Card data is handled by Paddle and not stored by us.
9. **Product usage & error diagnostics** — first-party analytics events,
   route pathname on error, Lovable error reports.
10. **Third-party lookups you trigger** — AI flight/smart-add text you paste,
    URL enrichment fetches, OpenStreetMap location searches, AviationStack
    lookups, Serpstack search queries.
11. **Email operations** — send log, suppression, unsubscribe tokens, queued
    messages, dead-letter queues.
12. **Consent & beta feedback** — consent records, plus voluntary recordings
    / voice / notes stored outside the app (see G6 above).
13. **Operational** — pending sign-up intents, invite claims, rate limits.
14. **Files** — trip cover images, cover drafts.

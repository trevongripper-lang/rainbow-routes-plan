# Ambiguous retention/anonymisation decisions still requiring approval

Date: 2026-07-28. Owner column indicates who must decide.

These are the calls I will NOT make autonomously in Phase B. Each row lists
the recommended default in **bold** with a one-line rationale.

| # | Question | Options | Recommended | Owner |
|---|---|---|---|---|
| D-1 | Grace period before auth user deletion | (a) immediate irreversible (per your decision) — **CONFIRMED** | Immediate | Product (decided) |
| D-2 | Shared-history anonymisation model | (a) nullable historical actor references + "Former member" presentation — **CONFIRMED** | Nullable | Product (decided) |
| D-3 | `trip_flights.passenger_name` + `confirmation` on trips the user only joined (contains real name and PII the trip owner sees) | (a) hard-delete the row on any owner's trip; (b) NULL the `user_id` and keep the record for the owner's benefit; (c) NULL `user_id` **and** clear `passenger_name`, `confirmation`, `notes` because they are the departing user's PII | **c** — flight PII belongs to the person, not the trip | Product/Legal |
| D-4 | `trip_stays.confirmation` + `booked_by` similar concern | Same options as D-3 | **c** for confirmation/notes; retain address if a stay is shared for the owner | Product/Legal |
| D-5 | `trip_tickets.name/url/notes` authored by the departing user on someone else's trip | keep vs delete | **Delete row** — these are almost always personal and can be re-added by an owner if needed | Product |
| D-6 | `trip_ratings.feedback` authored on someone else's trip | Free text; small utility to owner | **Delete row** | Product |
| D-7 | `trip_polls`/`trip_poll_options` authored by departing user on someone else's trip | Deleting cascades to votes | **Keep poll + options, NULL creator column**; deleting a poll silently wipes everyone's votes and history | Product |
| D-8 | `comments.body` — user's own chat on someone else's trip today CASCADEs | Keep OR delete | **Delete (existing behaviour is correct)** — chat is personal expression | Confirmed |
| D-9 | `analytics_events.props` — arbitrary jsonb from historical events | Delete all rows OR scrub uuids in surviving rows | **Delete all rows for the user; scrub `user_id` uuid substrings from surviving rows referencing the user (mentions/comment authors)** | Eng (default) |
| D-10 | `notifications.payload` on notifications sent to OTHER users where the departing user is `actor_id` | Payload has `actor` uuid, snippet | **SET NULL on `actor_id` (already), strip uuids and snippet from payload for surviving rows** | Eng (default) |
| D-11 | `paddle_events.payload` — must be retained for tax/fraud/dispute per Paddle DPA | Keep raw OR pseudonymise fields naming the user | **Keep raw for 24 months, then pseudonymise `customer.email` and `customer.name` in payload while retaining event_id/tx/amount/tax** | Legal |
| D-12 | `email_send_log.recipient_email` retention | Keep for delivery observability | **90 days full → then hash-only for 12 months → then delete**. On explicit deletion, hash immediately | Product/Legal |
| D-13 | `suppressed_emails` — bounce/complaint suppression | Retain indefinitely (no-contact requirement) | **Retain indefinitely; document as retained category** | Legal |
| D-14 | `email_unsubscribe_tokens` | Post-use, keep only the fact of unsubscribe | **After `used_at` is set, blank the `token` and keep `email` + `used_at`** | Legal |
| D-15 | `pending_intents.payload` (may include free-text trip pitch content) | Retention window | **7-day retention cron; delete `claimed_by = uid` on account deletion** | Product |
| D-16 | Beta-recording folder location and support address | `hello@tgklabs.io` (tester doc) vs `hello@jointribetrips.com` (privacy policy) | **Pick one — recommend `hello@jointribetrips.com` because it matches the app's domain and Nominatim User-Agent** | Founder |
| D-17 | Backup horizon claim in policy | Cannot verify from sandbox | **Do not claim a number until Ops confirms Supabase PITR / storage snapshot horizon** | Ops |
| D-18 | Data export scope | Full JSON vs curated | **Curated JSON per data category in the inventory; excludes analytics/error logs; includes trips user owns and rows they authored** | Product |
| D-19 | Rate-limit key structure includes `user.id` in some cases → potentially PII in `rate_limits.key` | Keep uid-scoped keys | **Keep — needed for per-user limits; delete rows where `key LIKE '%'||uid||'%'` in the deletion job** | Eng (default) |
| D-20 | Founder / staff support-side ability to complete Paddle deletion request | Manual step | **Add explicit job step "request Paddle customer erasure", assign founder, 30-day deadline** | Founder |

Anything above marked "Eng (default)" I will treat as approved unless you
override it. Anything marked "Product", "Legal", or "Founder" I will wait on.

# Hardening: rate limits, password policy, role authorization tests

Three security items from the beta blocker list (BB-9, BB-16, BB-17).

## 1. Rate limiting on sensitive endpoints

The project already has a working limiter: the `rl_hit` database function called
through `src/lib/rate-limit.functions.ts` (service-role only, fail-open). Today it
only covers login / signup / password-reset and chatter posts.

Verified as currently **unprotected**: flight lookup (AI), smart-add URL enrichment
and AI parsing, geocoding, trip pitch, and account deletion.

Add a shared per-user limiter helper and apply it:

| Endpoint | Limit |
|---|---|
| Flight lookup (AI) | 10/min, 100/day |
| Smart-add AI parse | 10/min, 100/day |
| Smart-add URL fetch | 20/min, 200/day |
| Geocode search | 30/min, 300/day |
| Pitch a trip | 5/hour |
| Delete my account | 3/hour |
| Magic link / email resend paths | reuse existing `reset` scope |

Behaviour on limit: the server function throws a friendly "Slow down — try again in
Ns" error, which the existing toast surfaces. Limits are keyed by user id (all of
these are authenticated), so one user cannot exhaust another's budget.

## 2. Leaked-password protection and stronger password rules

- Turn on the breached-password (HIBP) check so passwords found in known breaches
  are rejected at signup and password change.
- Raise the minimum password length from 8 to 10 and require a mix of letters and
  digits.
- Align the UI, which is currently inconsistent: the sign-up form hints "At least 6
  characters" and the password-setup form enforces 8. Both become 10 with a short
  requirements hint and a clear error when the backend rejects a breached password
  ("This password appeared in a known data breach — pick another").

## 3. Negative authorization tests for every trip role

Extend the SQL test suite (currently one co-organizer file) with a full negative
matrix, run inside a rolled-back transaction like the existing tests.

Roles covered: owner, co-organizer, member, former member (row deleted), outsider
(signed in, not on the trip), anonymous.

Assertions per role across `destinations`, `trip_members`, `trip_invites`,
`trip_costs`, `trip_stays`, `trip_flights`, `trip_tickets`, `trip_polls`,
`trip_poll_votes`, `comments`, `notifications`:

- Outsider and anonymous: no read, no write on any trip-scoped table.
- Former member: loses read access immediately after removal.
- Member: can read; cannot edit trip details, invite, delete the trip, change roles,
  or modify another member's rows; can modify their own rows.
- Co-organizer: can invite and edit trip content; cannot delete the trip, change
  roles, or unlock/pay.
- Owner: full control; still cannot touch another trip they're not on.
- Invite-token abuse: an expired / already-redeemed / wrong-trip token cannot be
  redeemed.
- Admin escalation: a non-admin cannot insert into `user_roles` or call
  admin-gated RPCs.

Each assertion raises on failure so a single `psql` run either passes fully or
aborts with the failing case named.

## Technical notes

- New file `src/lib/rate-limits.ts` (shared scope table) plus a `rlHitUser` helper
  in `src/lib/rate-limit.functions.ts`; per-endpoint calls added at the top of each
  handler, before any external API call.
- Auth policy changes applied through the auth configuration tool
  (`password_hibp_enabled`, `password_min_length`, required character classes).
- New test file `supabase/tests/negative_authorization.test.sql`, following the JWT
  claim-shim pattern already used by `co_organizer_rls.test.sql`.
- No schema migration is required for items 1 and 2; item 3 is test-only.

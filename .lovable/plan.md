## What's broken

Two related pieces of the database were lost (looks like a schema restore/remix stripped them):

1. **`authenticated` has no EXECUTE grant on the trip helper functions.** Every RLS policy on `destinations`, `trip_members`, `trip_costs`, `trip_flights`, `trip_tickets`, `trip_polls`, `trip_poll_options`, `trip_poll_votes`, `trip_ratings`, `trip_stays`, `trip_events`, `trip_invites`, etc. calls `public.is_trip_owner(...)`, `is_trip_member(...)`, `is_trip_co_organizer(...)`, or `is_trip_organizer_or_co(...)`. When the policy runs, Postgres refuses to invoke the function and returns `permission denied for function is_trip_owner` (SQLSTATE 42501). That's the "permission denied … trip_owner" message you saw when pitching a trip — the INSERT fires the SELECT policy for the `.select("id")` returning clause, and the policy explodes on the helper call.

2. **All `public` schema triggers are missing** (`information_schema.triggers` in `public` returns 0 rows). The functions still exist, but nothing is wired up. That means: the trip creator is not auto-added to `trip_members` (`add_owner_as_member`), free-tier headcount cap is not enforced (`check_headcount_cap`), date-order validation is off (`check_trip_date_order`), fanout notifications don't fire for new costs / members / comments / settlements, `sync_member_travel_on_flight` doesn't run, `handle_new_user` doesn't seed `profiles` for new signups, and `email_queue_wake` doesn't kick the email queue.

## Fix (single migration)

**A. Grant EXECUTE on RLS helpers to `authenticated`**

```sql
GRANT EXECUTE ON FUNCTION
  public.is_trip_owner(uuid, uuid),
  public.is_trip_member(uuid, uuid),
  public.is_trip_co_organizer(uuid, uuid),
  public.is_trip_organizer_or_co(uuid, uuid),
  public.has_role(uuid, app_role)
TO authenticated;
```

Also grant EXECUTE on the user-callable RPCs that the app invokes directly (`redeem_promo_code`, `redeem_trip_invite`, `preview_trip_invite`, `set_trip_member_role`, `match_trip_events`, `get_trip_rating_aggregate`, `get_public_profiles`) — verify each and only add if missing. `unlock_destination` stays service-role only.

**B. Re-attach the missing triggers on `public` tables**

Recreate the triggers using the existing functions:

- `destinations`: `add_owner_as_member` (AFTER INSERT), `check_headcount_cap` (BEFORE INSERT OR UPDATE), `check_trip_date_order` (BEFORE INSERT OR UPDATE)
- `trip_members`: `on_member_insert` (AFTER INSERT)
- `trip_costs`: `on_cost_insert` (AFTER INSERT)
- `comments`: `on_comment_insert` (AFTER INSERT)
- `trip_settlements`: `on_settlement_insert` (AFTER INSERT)
- `trip_flights`: `sync_member_travel_on_flight` (AFTER INSERT OR UPDATE)
- `auth.users`: `handle_new_user` (AFTER INSERT) — this is the one exception outside `public`; needed so new signups get a `profiles` row and welcome notification.
- Email queues (`pgmq.q_auth_emails`, `pgmq.q_transactional_emails`): `email_queue_wake` (AFTER INSERT). If pgmq's table structure has changed or these were intentionally cron-only, skip and note in the migration.

Each `CREATE TRIGGER` will be idempotent (`DROP TRIGGER IF EXISTS ... ; CREATE TRIGGER ...`).

## Out of scope

- No RLS policy changes, no GRANTs on tables (those look correct — the failure is purely the function EXECUTE bit).
- No app / TypeScript changes.

## Verification after migration

- Pitch a trip end-to-end from the UI — should succeed and land you as `owner` in `trip_members`.
- `SELECT count(*) FROM information_schema.triggers WHERE trigger_schema='public'` returns >0.
- `has_function_privilege('authenticated', 'public.is_trip_owner(uuid,uuid)', 'EXECUTE')` returns true.

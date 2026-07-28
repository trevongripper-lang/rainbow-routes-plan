# Phase B1 evidence — schema expand, disposable-DB verified

**Date:** 2026-07-28
**Migration:** `docs/pending-migrations/20260728160000_phase_b1_user_fks_expand.sql`
**Rollback:** `docs/pending-migrations/20260728160000_phase_b1_ROLLBACK.sql`
**Status:** verified on disposable DB. **Not applied to production.**

## 1. Exact affected columns and chosen FK behavior

Grouped by treatment. Every choice traces to a resolved decision in
`docs/beta-gate/pending-decisions.md`.

### SET NULL — preserve anonymised shared history (nullability relaxed)

| Table | Column | Decision | Nullability |
|---|---|---|---|
| `trip_costs` | `user_id` | D-2 | NOT NULL → NULL |
| `trip_costs` | `paid_by` | D-2 | NULL (already) |
| `trip_settlements` | `from_user` | D-2 | NOT NULL → NULL |
| `trip_settlements` | `to_user` | D-2 | NOT NULL → NULL |
| `trip_settlements` | `created_by` | D-2 | NOT NULL → NULL |
| `trip_stays` | `user_id` | D-4 | NOT NULL → NULL |
| `trip_stays` | `booked_by` | D-4 | NULL (already) |
| `trip_flights` | `user_id` | D-3 | NOT NULL → NULL |
| `trip_polls` | `user_id` | D-7 | NOT NULL → NULL |
| `storage_object_trip` | `uploaded_by` | D-2 (mapping-row anonymisation; object cleanup B3) | NOT NULL → NULL |
| `destinations` | `unlocked_by` | D-2 | NULL (already) |
| `trip_events` | `added_by` | D-2 (was CASCADE, replaced under same deterministic name) | NOT NULL → NULL |

### CASCADE — approved to delete the entire private row (nullability retained)

| Table | Column | Decision | Notes |
|---|---|---|---|
| `trip_tickets` | `user_id` | D-5 | |
| `trip_ratings` | `user_id` | D-6 | |
| `trip_poll_votes` | `user_id` | D-7 | Deletes departing user's own votes only; other users' votes on the same poll are unaffected (they FK to a different user row). |
| `promo_redemptions` | `user_id` | Personal record | `promo_codes.redemptions_count` is a separate counter and is not adjusted here. |

### Unchanged (already correct, audited as sanity check)

| Table | Column | Existing on-delete | Decision |
|---|---|---|---|
| `destinations` | `user_id` | CASCADE | trip-owner deletion cascades their owned trips |
| `trip_members` | `user_id` | CASCADE | membership is personal |
| `comments` | `user_id` | CASCADE | D-8 |
| `notifications` | `user_id` | CASCADE | D-10 |
| `notifications` | `actor_id` | SET NULL | D-10 |

## 2. Before / after nullability + constraint table

Twenty-one target columns audited. Nullability change: **9 columns**
(NOT NULL → NULL). New foreign keys added: **14** (13 fresh + 1 replacement
on `trip_events.added_by`).

Full post-migration state (from disposable DB):

```
tbl                  | col         | not_null | on_delete | validated
---------------------+-------------+----------+-----------+----------
comments             | user_id     | t        | CASCADE   | t
destinations         | unlocked_by | f        | SET NULL  | t  (NEW)
destinations         | user_id     | t        | CASCADE   | t
notifications        | actor_id    | f        | SET NULL  | t
notifications        | user_id     | t        | CASCADE   | t
promo_redemptions    | user_id     | t        | CASCADE   | t  (NEW)
storage_object_trip  | uploaded_by | f (was t)| SET NULL  | t  (NEW)
trip_costs           | paid_by     | f        | SET NULL  | t
trip_costs           | user_id     | f (was t)| SET NULL  | t  (NEW)
trip_events          | added_by    | f (was t)| SET NULL  | t  (REPLACED, was CASCADE)
trip_flights         | user_id     | f (was t)| SET NULL  | t  (NEW)
trip_members         | user_id     | t        | CASCADE   | t
trip_poll_votes      | user_id     | t        | CASCADE   | t  (NEW)
trip_polls           | user_id     | f (was t)| SET NULL  | t  (NEW)
trip_ratings         | user_id     | t        | CASCADE   | t  (NEW)
trip_settlements     | created_by  | f (was t)| SET NULL  | t  (NEW)
trip_settlements     | from_user   | f (was t)| SET NULL  | t  (NEW)
trip_settlements     | to_user     | f (was t)| SET NULL  | t  (NEW)
trip_stays           | booked_by   | f        | SET NULL  | t  (NEW)
trip_stays           | user_id     | f (was t)| SET NULL  | t  (NEW)
trip_tickets         | user_id     | t        | CASCADE   | t  (NEW)
```

All constraint names deterministic (`<table>_<column>_fkey`).

## 3. Preflight output (production, 2026-07-28, immediately before writing this doc)

Zero orphan user references across all 19 audited columns. Full result under
"B0 — Preflight" in `docs/beta-gate/phase-b-plan.md`. The migration file's
in-transaction preflight `DO $preflight$` block re-runs the same audit at
apply time and RAISES on any drift — the earlier count is evidence, not a
guarantee.

## 4. Migration SQL

See `docs/pending-migrations/20260728160000_phase_b1_user_fks_expand.sql`.
Structure: `BEGIN` → fail-closed preflight `DO` block → SET NULL group (per
column: DROP NOT NULL, ADD CONSTRAINT ... NOT VALID, VALIDATE CONSTRAINT) →
CASCADE group (ADD CONSTRAINT ... NOT VALID, VALIDATE) → post-migration
self-check `DO $verify$` block asserting every target column has the correct
FK action + nullability → `COMMIT`.

Idempotency: intentionally **not** idempotent. Re-running against a database
already in the B1 state fails at the first `ADD CONSTRAINT` with a duplicate
name — this is the desired signal that the migration already ran, and it
avoids broad `EXCEPTION WHEN duplicate_object` handling that would mask real
schema drift.

## 5. Generated-type diff

Not yet regenerated. `src/integrations/supabase/types.ts` is auto-regenerated
by Lovable Cloud after a **production** migration succeeds; disposable-DB
application does not trigger regeneration. On production apply, the
following columns will flip from non-nullable to nullable in
`Database['public']['Tables'][X]['Row']`:

- `trip_costs.user_id`
- `trip_settlements.{from_user,to_user,created_by}`
- `trip_stays.user_id`
- `trip_flights.user_id`
- `trip_polls.user_id`
- `storage_object_trip.uploaded_by`
- `trip_events.added_by`

Impact call-out for downstream sub-phases: TypeScript will start reporting
`possibly null` on any code path that dereferences the above without a null
check. That surfacing is **desired** (it is the compiler warning us where
"Former member" presentation must render). The type update is deferred to
production-apply time by design.

## 6. RLS / RPC / trigger / index impact review

Full audit run against production before writing the migration:

- **RLS SELECT policies**: use `is_trip_member(destination_id, auth.uid())`,
  not `user_id = auth.uid()`. Anonymised rows stay visible to remaining trip
  members. ✓
- **RLS UPDATE/DELETE policies** on affected tables use
  `(auth.uid() = user_id) OR is_trip_organizer_or_co(destination_id, auth.uid())`.
  When `user_id` is NULL the first disjunct is false; organiser/co-organiser
  path continues to work — a former member cannot return to edit. ✓
- **RLS INSERT WITH CHECK**: every affected table requires
  `user_id = auth.uid()` on insert. NULL never satisfies `= auth.uid()`, so
  relaxing NOT NULL **cannot** create an anonymous-insert vector. ✓
- **Unique indexes** touching any target column exist only on CASCADE
  tables (`promo_redemptions_promo_code_id_user_id_key`,
  `trip_poll_votes_poll_id_user_id_option_id_key`,
  `trip_ratings_destination_id_user_id_key`). None touch a SET-NULL column;
  no unique-with-NULL semantics to reason about. ✓
- **Triggers**: `on_cost_insert`, `on_settlement_insert`, and
  `sync_member_travel_on_flight` fire on INSERT and `UPDATE OF confirmation`
  only, never on `user_id`. A post-hoc SET NULL on `user_id` will not
  re-trigger them. ✓
- **RPC return types** and **STABLE/VOLATILE functions** referencing the
  affected tables (`is_trip_member`, `is_trip_owner`,
  `is_trip_co_organizer`, `is_trip_organizer_or_co`,
  `get_trip_rating_aggregate`, `match_trip_events`, `fanout_notification`,
  `sync_member_travel_on_flight`, `on_cost_insert`, `on_settlement_insert`,
  `redeem_trip_invite`, `unlock_destination*`) — none return a column that
  becomes nullable, none dereference the affected columns in a way that
  crashes on NULL. Reviewed manually against the RPC list under the
  supabase-info block.
- **UI assumptions** that treat these columns as non-null are called out in
  §10 below as Phase B2/B7 follow-ups. B1 does not change UI; it only
  enables the presentation-layer work.

## 7. Disposable-environment migration and validation results

**Apply**: exit 0. All 27 `ALTER TABLE` statements + preflight + verify
blocks committed atomically.

**Post-migration constraint state**: 21 target FKs present, all with
`convalidated = true`. See §2.

**Behavioral test** (in-transaction; auth user delete triggers real FK
actions):

```
metric                              | value
------------------------------------+------
baseline_settlement_sum_cents       | 1000     ← before delete
baseline_cost_sum_cents             | 5000     ← before delete
post_settlement_sum_cents           | 1000     ← INVARIANT HOLDS
post_cost_sum_cents                 | 5000     ← INVARIANT HOLDS
settlement_from_user_nulled         | 1        ← D-2 SET NULL applied
settlement_created_by_nulled        | 1        ← D-2
cost_user_id_nulled                 | 1        ← D-2
cost_paid_by_nulled                 | 1        ← D-2
flight_user_id_nulled               | 1        ← D-3
stay_user_id_nulled                 | 1        ← D-4
stay_booked_by_nulled               | 1        ← D-4
poll_user_id_nulled                 | 1        ← D-7
poll_options_retained               | 1        ← D-7 (poll survives)
poll_votes_cascaded_zero            | 0        ← departing user's vote gone
tickets_cascaded_zero               | 0        ← D-5
ratings_cascaded_zero               | 0        ← D-6
comments_cascaded_zero              | 0        ← D-8 (already CASCADE)
trip_membership_cascaded_zero       | 0        ← already CASCADE
```

**Rollback**: exit 0. Post-rollback FK count on the target set = 7,
matching the original pre-B1 audit exactly.

**Re-apply after rollback**: exit 0. Disposable DB left in B1 state.

## 8. Test results

Full `bunx vitest run` on the app: **70 tests / 9 files passed** (11.66s).
Log tail: `Test Files 9 passed (9); Tests 70 passed (70)`. B1 introduces
no regressions in the existing suite.

## 9. Rollback notes

- File: `docs/pending-migrations/20260728160000_phase_b1_ROLLBACK.sql`.
- Scope: schema shape only. Drops all 13 new FKs, re-tightens the 9 relaxed
  NOT NULL columns, restores `trip_events.added_by` to CASCADE.
- **Rollback CANNOT restore personal data.** If a later deletion job has
  already NULLed a column, the `SET NOT NULL` in this rollback will FAIL —
  and that is the correct behaviour. The migration must not synthesize a
  placeholder user to satisfy the constraint. In that case, do not apply
  the rollback and treat the schema as forward-only, consistent with D-1.
- Verified on disposable DB (see §7).

## 10. Lock, downtime, and validation cost

- All FK `ADD CONSTRAINT ... NOT VALID` acquires
  `ShareRowExclusiveLock` on the referenced-side (`auth.users`) and on the
  child table — brief, does not block SELECT.
- `VALIDATE CONSTRAINT` acquires `ShareUpdateExclusiveLock` on the child
  table only — does not block SELECT or ordinary DML.
- Preflight already proved every target table has zero rows requiring
  remediation. `VALIDATE` cost is O(rows scanned). Largest affected tables
  in production are `trip_costs` and `notifications`; both fit comfortably
  under the async worker budget.
- `ALTER COLUMN DROP NOT NULL` takes `AccessExclusiveLock` momentarily on
  the child table. Sub-second per column.
- **Expected user-visible downtime: none.**

## 11. Residual risks

1. **Type surface change on production apply.** Nine columns become
   nullable in `types.ts`. Downstream code that indexes `row.user_id`
   assuming non-null will get TypeScript errors on the next build after
   production apply. This is desired but must be handled in the same
   deployment window as the production migration (either bundle Phase B2
   presentation shims or accept a short compile-error window and let CI
   surface the sites).
2. **Ownership on `trip_events.added_by`**: FK behavior changed from
   CASCADE → SET NULL. If any dashboard or admin console counts "events
   added by a departed user" via join instead of the added_by column, the
   count semantics shift slightly. No such surface found in the repo.
3. **`storage_object_trip.uploaded_by` SET NULL leaves the physical object
   in the bucket.** This is intentional for B1 (mapping-row anonymisation
   only). B3 will delete-and-verify the actual object.
4. **Not idempotent.** Re-running the file against an already-B1 database
   fails at the first duplicate FK add. This is the correct posture per the
   B1 constraints ("do not hide unexpected schema conflicts with broad
   exception handling") but the deployment runbook must not attempt to
   re-run without first checking the constraint state.
5. **Legal-review-pending decisions (D-3, D-4)** are honoured in code, not
   in a legal instrument. Column-level erasure semantics may need
   adjustment after counsel review — additive changes only, no NOT NULL
   re-tightening required.

## B2 readiness recommendation

B1 is verified and ready for a **separate, explicit production-deployment
approval**. The disposable-DB evidence above meets every acceptance
requirement you set. On production apply, the following are the immediate
next actions (all landing in B2, not B1):

1. Regenerate `src/integrations/supabase/types.ts` (Lovable Cloud does this
   automatically after migration success).
2. Land the "Former member" presentation shim so newly-nullable columns
   render safely in the UI.
3. Begin B2: deletion state machine + reauth-gated `requestAccountDeletion`
   server function + idempotent worker.

Stopping here for your production-apply approval per your instruction.

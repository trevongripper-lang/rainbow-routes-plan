# Phase B execution plan — awaiting go-ahead on sub-phase sequencing

Date: 2026-07-28. Preflight complete. Decisions recorded in
`docs/beta-gate/pending-decisions.md`. Nothing below has been applied.

## Sub-phase order

Phase B is too large for a single migration. To keep every change reviewable
and rollback-safe, it is broken into ordered sub-phases. Each sub-phase ends
with a hard checkpoint: I stop, report evidence, and wait for approval before
starting the next.

### B0 — Preflight (DONE, 2026-07-28)

- Orphan-UUID audit across 19 user-reference columns: **0 orphans**.
- No remediation UPDATE required before FK backfills.
- Evidence: this file + prior chat message with `supabase--read_query` output.

### B1 — Schema expand (FK backfills + nullability relaxation)

Additive-only. No behaviour change on its own. `NOT VALID` then `VALIDATE`.

- Add `FK → auth.users(id) ON DELETE SET NULL` for every column in decisions
  §1 that currently lacks one.
- Relax `NOT NULL` on columns listed in decisions §2.
- Add companion trigger guards: RPCs that today rely on `NEW.user_id`
  being non-null gain an explicit "author unknown" branch OR reject NEW rows
  with null (so we don't accidentally let anonymous inserts sneak in).
- Regenerate `src/integrations/supabase/types.ts` (auto by tool) and grep for
  callers that would crash on `null`.

**Checkpoint**: list every code site that dereferences a now-nullable column
and confirm the "Former member" presentation renders correctly.

### B2 — Deletion state machine (schema + server function + worker)

- Create `public.account_deletion_jobs`, `public.account_deletion_steps`,
  `account_deletion_status` enum (design in
  `docs/beta-gate/phase-b-schema-sketch.sql`, cleaned up).
- Rewrite `src/lib/account.functions.ts::deleteMyAccount` into
  `requestAccountDeletion`:
  1. reauth-gated (recent password / OTP within 5 min);
  2. userId from `context.userId` never body;
  3. insert job + one pending step per known key;
  4. immediately: rotate password + `admin.signOut(uid, 'global')`;
  5. return `{ audit_receipt, jobId }`.
- Worker at `src/routes/api/public/deletion/tick.ts` advances each step under
  a `pg_try_advisory_xact_lock(jobId)`; every step is idempotent and safe to
  retry. Triggered by cron every minute AND eagerly by the request handler.
- Auth-user delete step runs LAST and only when every prior automated step
  is `done`.

**Checkpoint**: unit + integration tests cover happy path, mid-job failure
resume, and null-safe cascade.

### B3 — Storage cleanup + verification

- New step `purge_storage_covers` and `purge_storage_drafts` that lists all
  objects under both buckets scoped to trips owned by the departing user,
  calls `storage.remove([...])`, then re-lists to assert 0 remaining, then
  writes `done` with the object count (no paths, no PII).

**Checkpoint**: disposable-DB fixture with a real uploaded cover.

### B4 — Retention crons

- `pending_intents`: 7-day cron (D-15).
- `analytics_events`: 90-day cron on old rows + on-deletion delete/scrub
  (D-9).
- `email_send_log`: 90-day plain → 12-month digest → delete (D-12).
- `email_unsubscribe_tokens`: 30-day cron for unused tokens + on-use token
  blanking (D-14).
- `paddle_events`: pseudonymise `payload.customer.*` for events > N months
  (interim value; pending legal per D-11).
- `account_deletion_steps` cleanup: never — receipts are non-PII and stay.

**Checkpoint**: `cron.job` listing + one dry-run per cron.

### B5 — Security hardening

- CSP / HSTS / Referrer-Policy / X-Content-Type-Options / X-Frame-Options /
  Permissions-Policy set on every response (root route head + a server
  middleware for API routes).
- `Cache-Control: no-store` on `/settings/*`, `/api/public/paddle-webhook`,
  `/auth/*`, `/reset-password`, deletion endpoints.
- Rate limits on `requestAccountDeletion`, `deletionTick`, data export,
  geocode, flight lookup, smart-add (per BB-17). Uses `rl_hit` with keyed
  digest of uid per D-19.
- HIBP + password min 12 via `supabase--configure_auth`.
- Bundle scan for service-role key / secrets as a CI check (BB-19).

**Checkpoint**: header inspection + rate-limit unit tests + HIBP config
verification.

### B6 — Privacy disclosure rewrite

- Full rewrite of `src/routes/privacy.tsx` to match approved decisions:
  data-category table, complete subprocessor list (Paddle + AviationStack +
  Serpstack + Lovable AI Gateway + Lovable error reporting + arbitrary
  user-URL fetches), retention schedule, deletion mechanics honest to code,
  encryption / security-controls section, policy version + effective date +
  material-change process, interim backup wording per D-17.
- Every claim carries an internal source note in a repo-only
  `docs/beta-gate/privacy-source-map.md` mapping claim → code path.
- Draft flagged **"legal review pending"** in both the docs and the visible
  policy header until counsel signs off.

**Checkpoint**: legal reviewer copy sent (Ops).

### B7 — Customer controls

- `/settings/privacy-security` page: sign-out-all, deletion impact preview,
  deletion status (job.progress), data-export request.
- Sign-out-all uses `admin.signOut(uid, 'global')` via a server function.
- Data export runs asynchronously, produces the curated JSON per D-18, and
  emails a signed download link (short TTL).

**Checkpoint**: manual acceptance test walk-through.

### B8 — Test evidence + release gate

- Populated-account deletion regression (BB-6): fixture with 1 owned trip,
  1 joined trip, costs/settlements/comments/polls/flights/stays/tickets
  authored on both, cover uploaded to storage, promo redemption, analytics
  events. Assert: balances unchanged; personal columns null/deleted per
  decisions; storage empty; auth user gone; audit receipt present.
- Negative-authorisation suite (BB-16): non-member, former member, anon,
  cross-user, invite-token abuse, admin escalation.
- Bundle secret scan.
- Updated `docs/beta-gate/beta-blockers.md` with resolved status per row.

**Checkpoint**: this is the release gate. `docs/beta-gate/phase-b-report.md`
consolidates all evidence.

## Where I need you to unblock me before I proceed

I need explicit go-ahead on **B1 only** to start writing the expand
migration. Every subsequent sub-phase gets its own approval before I apply
schema or user-facing copy changes, per your process.

Ambiguities that would benefit from a quick call before B2:
- **Reauth window** for `requestAccountDeletion`. 5 minutes is my default.
  Confirm or override.
- **Data export delivery**. Signed download link vs in-app download of a
  generated file. Email adds a fresh subprocessor surface if we route via
  the send-log path; in-app avoids that.
- **Manual step SLA for D-16 (support mailbox) and D-17 (backup horizon)**:
  should these be pre-beta gate items or acceptable as "resolved before
  first external tester"? Both are Ops steps I can't complete from the
  sandbox.

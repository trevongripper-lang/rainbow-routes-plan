-- Phase B proposed schema + deletion state machine.
-- ============================================================
-- NOT APPLIED. Do not run through the migration tool yet.
-- This file is a design artefact for the Phase B review.
-- ============================================================
--
-- Goals:
--   1. Give trip_settlements / trip_stays / trip_flights / trip_tickets /
--      trip_ratings / trip_poll_votes / trip_polls / promo_redemptions /
--      storage_object_trip a real FK relationship to auth.users so the DB
--      can help us (SET NULL / CASCADE), instead of leaving orphan uuids.
--   2. Give trip_settlements the nullable columns needed for the
--      "Former member" presentation approved in Phase A decisions D-1/D-2.
--   3. Introduce an idempotent, auditable deletion job with per-step retries
--      and a non-PII audit receipt.
--
-- Every CREATE TABLE below already includes required GRANTs per project
-- guidance and RLS is enabled with policies that lock rows to the owning
-- user + service_role (the job runs as service_role).

BEGIN;

-- 1. Backfill missing FKs (all SET NULL so a delete never blocks) --------
ALTER TABLE public.trip_costs
    ADD CONSTRAINT trip_costs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.trip_costs ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.trip_settlements
    ADD CONSTRAINT trip_settlements_from_user_fkey
        FOREIGN KEY (from_user) REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD CONSTRAINT trip_settlements_to_user_fkey
        FOREIGN KEY (to_user) REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD CONSTRAINT trip_settlements_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.trip_settlements
    ALTER COLUMN from_user DROP NOT NULL,
    ALTER COLUMN to_user DROP NOT NULL,
    ALTER COLUMN created_by DROP NOT NULL;

-- Analogous FKs for trip_stays, trip_flights, trip_tickets, trip_ratings,
-- trip_poll_votes, trip_polls, promo_redemptions, storage_object_trip.
-- (Same pattern — omitted here for brevity in the sketch; will be complete
-- in the applied migration.)

-- 2. Deletion job state machine -----------------------------------------
CREATE TYPE public.account_deletion_status AS ENUM (
    'requested',      -- user confirmed; sessions revoked
    'in_progress',    -- worker actively cleaning up
    'awaiting_manual',-- app cascade done, manual steps outstanding
    'completed',      -- everything (including manual) done
    'failed'          -- terminal failure requiring operator
);

CREATE TABLE public.account_deletion_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,   -- captured at request time; no FK so it survives auth delete
    audit_receipt text NOT NULL UNIQUE,  -- opaque non-PII id shown to user
    status public.account_deletion_status NOT NULL DEFAULT 'requested',
    requested_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    app_cleanup_completed_at timestamptz,
    manual_completed_at timestamptz,
    completed_at timestamptz,
    failure_reason text,          -- non-PII summary
    retry_count int NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.account_deletion_jobs TO authenticated;
GRANT ALL ON public.account_deletion_jobs TO service_role;
ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_deletion_job_read" ON public.account_deletion_jobs
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.account_deletion_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES public.account_deletion_jobs(id) ON DELETE CASCADE,
    step_key text NOT NULL,       -- e.g. 'revoke_sessions', 'cascade_owned_trips',
                                  -- 'anonymise_settlements', 'purge_storage_covers',
                                  -- 'purge_storage_drafts', 'scrub_analytics',
                                  -- 'scrub_notification_payloads', 'hash_email_logs',
                                  -- 'delete_pending_intents', 'suppress_email',
                                  -- 'delete_auth_user', 'paddle_erasure_request',
                                  -- 'beta_recordings_purge'
    kind text NOT NULL CHECK (kind IN ('automatic','manual')),
    status text NOT NULL CHECK (status IN ('pending','running','done','failed','skipped')),
    attempts int NOT NULL DEFAULT 0,
    last_error text,              -- non-PII summary
    owner text,                   -- e.g. 'founder' for manual steps
    deadline timestamptz,         -- for manual steps
    started_at timestamptz,
    completed_at timestamptz,
    UNIQUE (job_id, step_key)
);
GRANT ALL ON public.account_deletion_steps TO service_role;
GRANT SELECT ON public.account_deletion_steps TO authenticated;
ALTER TABLE public.account_deletion_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_deletion_step_read" ON public.account_deletion_steps
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.account_deletion_jobs j
                   WHERE j.id = account_deletion_steps.job_id
                     AND j.user_id = auth.uid()));

-- Audit receipt after auth user is gone: keep only the receipt + timestamps.
-- The `user_id` column is intentionally *not* an FK so the receipt survives.

COMMIT;

-- 3. Deletion job flow (in code, not SQL) --------------------------------
-- The Phase B server function `requestAccountDeletion` will:
--   1. require recent reauthentication (< 5 min)
--   2. derive userId from claims (never from request body)
--   3. insert a job row + one step row per known step in status='pending'
--   4. immediately: supabaseAdmin.auth.admin.updateUserById(uid, {password: random})
--      + admin.signOut(uid, 'global') to kill live sessions
--   5. return { audit_receipt, jobId } to the client
-- A worker (server route under /api/public/deletion/tick called by pg_cron
-- and also invoked eagerly from the request) advances each step under an
-- advisory lock keyed on jobId to prevent overlap. Each step is idempotent.
-- The auth user is deleted only after every automatic step reports 'done'.
-- Manual steps hold the job at 'awaiting_manual' until an operator marks
-- them done via the console.

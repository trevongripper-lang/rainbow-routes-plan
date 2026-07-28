-- Stage 3 CONTRACT — drop obsolete public.unlock_destination(uuid,bool,int).
--
-- Preconditions (verify BEFORE applying to production):
--   1. The EXPAND migration 20260728130000_stage3_payments_expand.sql has been
--      applied to the same database.
--   2. The application deployment that calls the NEW RPCs
--      (unlock_destination_with_credit, process_paddle_unlock_event via the
--      Paddle webhook) is fully rolled out and serving traffic.
--   3. Production logs contain no calls to the compatibility RPC
--      public.unlock_destination(uuid,boolean,integer) from application code
--      for a full observation window (recommended ≥ 24h).
--
-- This migration is intentionally minimal so it can be reverted trivially by
-- re-applying the pre-Stage-3 definition if a caller is discovered post-drop.

DROP FUNCTION IF EXISTS public.unlock_destination(uuid, boolean, integer);

-- Verify absence (raises if the function somehow survives).
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'unlock_destination'
      AND pg_get_function_identity_arguments(p.oid) = '_dest uuid, _use_credit boolean, _paid_cents integer'
  ) THEN
    RAISE EXCEPTION 'contract migration failed: public.unlock_destination(uuid,boolean,integer) still present';
  END IF;
END
$verify$;
-- end of contract migration

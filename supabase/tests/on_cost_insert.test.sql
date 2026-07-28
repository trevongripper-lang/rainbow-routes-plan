-- Focused regression for on_cost_insert() after 20260728120000 migration.
-- Runs entirely in a transaction and rolls back — safe for the disposable DB.
-- Uses SECURITY DEFINER RPCs / direct inserts under service_role privileges;
-- exercise via `psql "$DEV_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>`.

\set ON_ERROR_STOP on
BEGIN;

-- 1. Exactly one non-internal trigger for on_cost_insert on trip_costs, and it
--    is the canonical name.
DO $$
DECLARE
  total int;
  canonical int;
BEGIN
  SELECT count(*) INTO total
  FROM pg_trigger
  WHERE tgrelid = 'public.trip_costs'::regclass
    AND NOT tgisinternal
    AND tgfoid = 'public.on_cost_insert()'::regprocedure;
  IF total <> 1 THEN
    RAISE EXCEPTION 'expected 1 on_cost_insert trigger, found %', total;
  END IF;

  SELECT count(*) INTO canonical
  FROM pg_trigger
  WHERE tgrelid = 'public.trip_costs'::regclass
    AND tgname = 'trg_trip_costs_on_insert'
    AND NOT tgisinternal;
  IF canonical <> 1 THEN
    RAISE EXCEPTION 'canonical trigger trg_trip_costs_on_insert missing (%)', canonical;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.trip_costs'::regclass
      AND tgname = 'trg_on_cost_insert'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'obsolete duplicate trigger trg_on_cost_insert still present';
  END IF;
END $$;

-- 2. Seed two auth users so fanout has a non-actor recipient.
--    fanout_notification excludes the actor, so a second member is required.
DO $$
DECLARE
  owner_id  uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  dest_id   uuid;
  cost_id   uuid;
  notif_row public.notifications%ROWTYPE;
  notif_count int;
BEGIN
  -- Minimal auth.users rows (test-only; rolled back).
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (owner_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'oncost-owner-'  || owner_id  || '@test.local', '', now(), now(), now()),
    (member_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'oncost-member-' || member_id || '@test.local', '', now(), now(), now());

  -- profiles are created by handle_new_user() trigger on auth.users insert.

  INSERT INTO public.destinations (user_id, title, region, headcount)
  VALUES (owner_id, 'Trigger Test Trip', 'Test Region', 5)
  RETURNING id INTO dest_id;

  -- add_owner_as_member trigger inserts owner; add the second member explicitly.
  INSERT INTO public.trip_members (destination_id, user_id, role)
  VALUES (dest_id, member_id, 'member')
  ON CONFLICT DO NOTHING;

  -- Clear any notifications produced by member_joined fanout so we assert only
  -- the cost_added row.
  DELETE FROM public.notifications WHERE destination_id = dest_id;

  -- 3. Valid insert must succeed (previously failed with NEW.amount error).
  INSERT INTO public.trip_costs
    (destination_id, user_id, category, label, amount_cents, currency, is_shared)
  VALUES
    (dest_id, owner_id, 'Food & drink', 'Dinner', 4200, 'USD', true)
  RETURNING id INTO cost_id;

  -- 4. Exactly one cost_added notification, sent to the non-actor member.
  SELECT count(*) INTO notif_count
  FROM public.notifications
  WHERE destination_id = dest_id AND kind = 'cost_added';
  IF notif_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 cost_added notification, found %', notif_count;
  END IF;

  SELECT * INTO notif_row
  FROM public.notifications
  WHERE destination_id = dest_id AND kind = 'cost_added';

  IF notif_row.user_id <> member_id THEN
    RAISE EXCEPTION 'notification went to wrong user: expected member %, got %', member_id, notif_row.user_id;
  END IF;
  IF notif_row.actor_id <> owner_id THEN
    RAISE EXCEPTION 'notification actor_id wrong: expected %, got %', owner_id, notif_row.actor_id;
  END IF;

  -- 5. Payload shape and values.
  IF notif_row.payload ->> 'label' <> 'Dinner' THEN
    RAISE EXCEPTION 'payload.label wrong: %', notif_row.payload ->> 'label';
  END IF;
  IF (notif_row.payload ->> 'amount_cents')::int <> 4200 THEN
    RAISE EXCEPTION 'payload.amount_cents wrong: %', notif_row.payload ->> 'amount_cents';
  END IF;
  IF notif_row.payload ->> 'currency' <> 'USD' THEN
    RAISE EXCEPTION 'payload.currency wrong: %', notif_row.payload ->> 'currency';
  END IF;

  RAISE NOTICE 'on_cost_insert regression: all assertions passed';
END $$;

ROLLBACK;

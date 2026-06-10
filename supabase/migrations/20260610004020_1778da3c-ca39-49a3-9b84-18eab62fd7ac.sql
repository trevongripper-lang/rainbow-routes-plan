
-- =========================================================
-- 1. PROFILES: pro flag + stripe customer
-- =========================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_pro boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- =========================================================
-- 2. DESTINATIONS: end_date
-- =========================================================
ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS end_date date;

-- =========================================================
-- 3. TRIP_MEMBERS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.trip_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (destination_id, user_id)
);
CREATE INDEX IF NOT EXISTS trip_members_user_idx ON public.trip_members(user_id);
CREATE INDEX IF NOT EXISTS trip_members_dest_idx ON public.trip_members(destination_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_members TO authenticated;
GRANT ALL ON public.trip_members TO service_role;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;

-- Security-definer helpers (avoid recursion)
CREATE OR REPLACE FUNCTION public.is_trip_member(_dest uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.trip_members WHERE destination_id = _dest AND user_id = _user);
$$;

CREATE OR REPLACE FUNCTION public.is_trip_owner(_dest uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.destinations WHERE id = _dest AND user_id = _user);
$$;

CREATE POLICY "Members can view membership of their trips"
  ON public.trip_members FOR SELECT TO authenticated
  USING (public.is_trip_member(destination_id, auth.uid()) OR public.is_trip_owner(destination_id, auth.uid()));

CREATE POLICY "Owner can add members"
  ON public.trip_members FOR INSERT TO authenticated
  WITH CHECK (public.is_trip_owner(destination_id, auth.uid()) OR user_id = auth.uid());

CREATE POLICY "Owner can remove members; user can leave"
  ON public.trip_members FOR DELETE TO authenticated
  USING (public.is_trip_owner(destination_id, auth.uid()) OR user_id = auth.uid());

-- Backfill owner rows for existing trips
INSERT INTO public.trip_members (destination_id, user_id, role)
SELECT id, user_id, 'owner' FROM public.destinations
ON CONFLICT (destination_id, user_id) DO NOTHING;

-- Auto-create owner row on new destination
CREATE OR REPLACE FUNCTION public.add_owner_as_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.trip_members (destination_id, user_id, role)
  VALUES (NEW.id, NEW.user_id, 'owner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dest_owner_member ON public.destinations;
CREATE TRIGGER trg_dest_owner_member AFTER INSERT ON public.destinations
FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();

-- =========================================================
-- 4. HEADCOUNT CAP — Pro removes the limit
-- =========================================================
ALTER TABLE public.destinations DROP CONSTRAINT IF EXISTS destinations_headcount_free_plan_max;

CREATE OR REPLACE FUNCTION public.check_headcount_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pro boolean;
BEGIN
  IF NEW.headcount IS NULL THEN RETURN NEW; END IF;
  IF NEW.headcount < 1 THEN
    RAISE EXCEPTION 'Headcount must be at least 1' USING ERRCODE = '23514';
  END IF;
  SELECT is_pro INTO pro FROM public.profiles WHERE id = NEW.user_id;
  IF NOT COALESCE(pro, false) AND NEW.headcount > 5 THEN
    RAISE EXCEPTION 'destinations_headcount_free_plan_max: Free plan supports up to 5 people per trip. Upgrade for larger crews.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_check_headcount ON public.destinations;
CREATE TRIGGER trg_check_headcount BEFORE INSERT OR UPDATE OF headcount ON public.destinations
FOR EACH ROW EXECUTE FUNCTION public.check_headcount_cap();

-- =========================================================
-- 5. TRIP_INVITES
-- =========================================================
CREATE TABLE IF NOT EXISTS public.trip_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'base64'),
  email text,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_invites_dest_idx ON public.trip_invites(destination_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_invites TO authenticated;
GRANT ALL ON public.trip_invites TO service_role;
ALTER TABLE public.trip_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages invites"
  ON public.trip_invites FOR ALL TO authenticated
  USING (public.is_trip_owner(destination_id, auth.uid()))
  WITH CHECK (public.is_trip_owner(destination_id, auth.uid()));

CREATE POLICY "Authenticated can read invite by id"
  ON public.trip_invites FOR SELECT TO authenticated
  USING (true);

-- RPC for redeeming an invite by token (works for any authenticated user)
CREATE OR REPLACE FUNCTION public.redeem_trip_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv RECORD;
  cap int;
  cur_count int;
  pro boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  SELECT * INTO inv FROM public.trip_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'Invite expired'; END IF;
  IF inv.accepted_by IS NOT NULL THEN RAISE EXCEPTION 'Invite already used'; END IF;

  SELECT headcount, (SELECT is_pro FROM public.profiles WHERE id = destinations.user_id)
    INTO cap, pro
    FROM public.destinations WHERE id = inv.destination_id;
  SELECT count(*) INTO cur_count FROM public.trip_members WHERE destination_id = inv.destination_id;
  IF NOT COALESCE(pro, false) AND cur_count >= COALESCE(cap, 5) THEN
    RAISE EXCEPTION 'Trip is full';
  END IF;

  INSERT INTO public.trip_members (destination_id, user_id, role)
  VALUES (inv.destination_id, auth.uid(), 'member')
  ON CONFLICT DO NOTHING;

  UPDATE public.trip_invites SET accepted_by = auth.uid(), accepted_at = now() WHERE id = inv.id;
  RETURN inv.destination_id;
END;
$$;

-- Public preview of an invite (title/region only, no PII)
CREATE OR REPLACE FUNCTION public.preview_trip_invite(_token text)
RETURNS TABLE(destination_id uuid, title text, region text, country text, image_url text, expired boolean, used boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.title, d.region, d.country, d.image_url,
         (i.expires_at < now()) AS expired,
         (i.accepted_by IS NOT NULL) AS used
  FROM public.trip_invites i
  JOIN public.destinations d ON d.id = i.destination_id
  WHERE i.token = _token
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.preview_trip_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_trip_invite(text) TO authenticated;

-- =========================================================
-- 6. COMMENTS: threading + mentions
-- =========================================================
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS comments_parent_idx ON public.comments(parent_id);

-- =========================================================
-- 7. NOTIFICATIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notif_user_idx ON public.notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS notif_user_dest_idx ON public.notifications(user_id, destination_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own notifications"
  ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());
-- Inserts happen only via SECURITY DEFINER triggers; no client INSERT policy.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- =========================================================
-- 8. FANOUT TRIGGERS
-- =========================================================
CREATE OR REPLACE FUNCTION public.fanout_notification(
  _dest uuid, _actor uuid, _kind text, _payload jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, destination_id, kind, actor_id, payload)
  SELECT m.user_id, _dest, _kind, _actor, COALESCE(_payload, '{}'::jsonb)
  FROM public.trip_members m
  WHERE m.destination_id = _dest
    AND (_actor IS NULL OR m.user_id <> _actor);
$$;

-- comments
CREATE OR REPLACE FUNCTION public.on_comment_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid;
BEGIN
  -- mention notifications (one per mentioned user, NOT actor)
  IF NEW.mentions IS NOT NULL THEN
    FOREACH uid IN ARRAY NEW.mentions LOOP
      IF uid <> NEW.user_id THEN
        INSERT INTO public.notifications (user_id, destination_id, kind, actor_id, payload)
        VALUES (uid, NEW.destination_id, 'chatter_mention', NEW.user_id,
                jsonb_build_object('comment_id', NEW.id, 'snippet', left(NEW.body, 120)));
      END IF;
    END LOOP;
  END IF;
  -- generic message/reply notification to everyone else
  PERFORM public.fanout_notification(
    NEW.destination_id, NEW.user_id,
    CASE WHEN NEW.parent_id IS NULL THEN 'chatter_message' ELSE 'chatter_reply' END,
    jsonb_build_object('comment_id', NEW.id, 'snippet', left(NEW.body, 120))
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_on_comment_insert ON public.comments;
CREATE TRIGGER trg_on_comment_insert AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.on_comment_insert();

-- costs
CREATE OR REPLACE FUNCTION public.on_cost_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fanout_notification(
    NEW.destination_id, NEW.user_id, 'cost_added',
    jsonb_build_object('label', NEW.label, 'amount', NEW.amount)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_on_cost_insert ON public.trip_costs;
CREATE TRIGGER trg_on_cost_insert AFTER INSERT ON public.trip_costs
FOR EACH ROW EXECUTE FUNCTION public.on_cost_insert();

-- members joined
CREATE OR REPLACE FUNCTION public.on_member_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'owner' THEN RETURN NEW; END IF;
  PERFORM public.fanout_notification(
    NEW.destination_id, NEW.user_id, 'member_joined',
    jsonb_build_object('user_id', NEW.user_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_on_member_insert ON public.trip_members;
CREATE TRIGGER trg_on_member_insert AFTER INSERT ON public.trip_members
FOR EACH ROW EXECUTE FUNCTION public.on_member_insert();

-- events: events may not be tied to a single trip — if a `destination_id` column exists, fanout; otherwise no-op.
-- (events table per existing schema has no destination_id; skip)

-- =========================================================
-- 9. AUTO-CLOSE TRIP (called by cron, but defined here)
-- =========================================================
CREATE OR REPLACE FUNCTION public.auto_close_trips()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  closed int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, user_id FROM public.destinations
    WHERE is_past = false
      AND end_date IS NOT NULL
      AND end_date < (now() AT TIME ZONE 'UTC')::date - 1
  LOOP
    UPDATE public.destinations SET is_past = true WHERE id = r.id;
    PERFORM public.fanout_notification(r.id, NULL, 'trip_closed', '{}'::jsonb);
    closed := closed + 1;
  END LOOP;
  RETURN closed;
END;
$$;
GRANT EXECUTE ON FUNCTION public.auto_close_trips() TO service_role;

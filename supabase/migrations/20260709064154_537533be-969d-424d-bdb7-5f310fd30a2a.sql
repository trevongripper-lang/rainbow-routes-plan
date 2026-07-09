
-- 1. Broaden role CHECK
ALTER TABLE public.trip_members DROP CONSTRAINT IF EXISTS trip_members_role_check;
ALTER TABLE public.trip_members
  ADD CONSTRAINT trip_members_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'co_organizer'::text, 'member'::text]));

-- 2. Helper functions
CREATE OR REPLACE FUNCTION public.is_trip_co_organizer(_dest uuid, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE destination_id = _dest AND user_id = _user AND role = 'co_organizer'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_organizer_or_co(_dest uuid, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_trip_owner(_dest, _user) OR public.is_trip_co_organizer(_dest, _user);
$$;

-- 3. destinations: co-organizers can update trip details (owner-only delete stays)
DROP POLICY IF EXISTS "Users update own destinations" ON public.destinations;
CREATE POLICY "Organizer or co-organizer update destinations"
  ON public.destinations FOR UPDATE
  USING (public.is_trip_organizer_or_co(id, auth.uid()));

-- 4. trip_invites: allow organizer and co-organizers
DROP POLICY IF EXISTS "Owner manages invites" ON public.trip_invites;
CREATE POLICY "Organizer or co-organizer manages invites"
  ON public.trip_invites FOR ALL
  USING (public.is_trip_organizer_or_co(destination_id, auth.uid()))
  WITH CHECK (public.is_trip_organizer_or_co(destination_id, auth.uid()));

-- 5. trip_members: broaden add/remove/update but protect owner + role escalation
DROP POLICY IF EXISTS "Owner can add members" ON public.trip_members;
CREATE POLICY "Organizer or co-organizer can add members"
  ON public.trip_members FOR INSERT
  WITH CHECK (
    public.is_trip_organizer_or_co(destination_id, auth.uid())
    AND role = 'member'
  );

DROP POLICY IF EXISTS "Owner can remove members; user can leave" ON public.trip_members;
CREATE POLICY "Manage members or leave"
  ON public.trip_members FOR DELETE
  USING (
    -- self-leave (but the organizer cannot leave their own trip)
    (user_id = auth.uid() AND role <> 'owner')
    OR (
      -- organizer can remove anyone except themselves
      public.is_trip_owner(destination_id, auth.uid()) AND role <> 'owner'
    )
    OR (
      -- co-organizer can remove plain members only
      public.is_trip_co_organizer(destination_id, auth.uid()) AND role = 'member'
    )
  );

DROP POLICY IF EXISTS "Members update own commitment" ON public.trip_members;
CREATE POLICY "Members update own commitment"
  ON public.trip_members FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_trip_organizer_or_co(destination_id, auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_trip_organizer_or_co(destination_id, auth.uid())
  );

-- 6. trip_costs: co-organizer can also edit/delete any row on their trip
DROP POLICY IF EXISTS "Users update own costs" ON public.trip_costs;
CREATE POLICY "Author or organizers update costs"
  ON public.trip_costs FOR UPDATE
  USING (auth.uid() = user_id OR public.is_trip_organizer_or_co(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Users delete own costs" ON public.trip_costs;
CREATE POLICY "Author or organizers delete costs"
  ON public.trip_costs FOR DELETE
  USING (auth.uid() = user_id OR public.is_trip_organizer_or_co(destination_id, auth.uid()));

-- 7. trip_stays / flights / tickets: same broadening
DROP POLICY IF EXISTS "Users update own flights" ON public.trip_flights;
CREATE POLICY "Author or organizers update flights"
  ON public.trip_flights FOR UPDATE
  USING (auth.uid() = user_id OR public.is_trip_organizer_or_co(destination_id, auth.uid()));
DROP POLICY IF EXISTS "Users delete own flights" ON public.trip_flights;
CREATE POLICY "Author or organizers delete flights"
  ON public.trip_flights FOR DELETE
  USING (auth.uid() = user_id OR public.is_trip_organizer_or_co(destination_id, auth.uid()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='trip_stays' AND policyname='Users update own stays') THEN
    EXECUTE 'DROP POLICY "Users update own stays" ON public.trip_stays';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='trip_stays' AND policyname='Users delete own stays') THEN
    EXECUTE 'DROP POLICY "Users delete own stays" ON public.trip_stays';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='trip_tickets' AND policyname='Users update own tickets') THEN
    EXECUTE 'DROP POLICY "Users update own tickets" ON public.trip_tickets';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='trip_tickets' AND policyname='Users delete own tickets') THEN
    EXECUTE 'DROP POLICY "Users delete own tickets" ON public.trip_tickets';
  END IF;
END $$;

CREATE POLICY "Author or organizers update stays"
  ON public.trip_stays FOR UPDATE
  USING (auth.uid() = user_id OR public.is_trip_organizer_or_co(destination_id, auth.uid()));
CREATE POLICY "Author or organizers delete stays"
  ON public.trip_stays FOR DELETE
  USING (auth.uid() = user_id OR public.is_trip_organizer_or_co(destination_id, auth.uid()));

CREATE POLICY "Author or organizers update tickets"
  ON public.trip_tickets FOR UPDATE
  USING (auth.uid() = user_id OR public.is_trip_organizer_or_co(destination_id, auth.uid()));
CREATE POLICY "Author or organizers delete tickets"
  ON public.trip_tickets FOR DELETE
  USING (auth.uid() = user_id OR public.is_trip_organizer_or_co(destination_id, auth.uid()));

-- 8. trip_polls / trip_poll_options: co-organizer can moderate
DROP POLICY IF EXISTS "Creator or owner updates poll" ON public.trip_polls;
CREATE POLICY "Creator or organizers update poll"
  ON public.trip_polls FOR UPDATE
  USING (user_id = auth.uid() OR public.is_trip_organizer_or_co(destination_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_trip_organizer_or_co(destination_id, auth.uid()));
DROP POLICY IF EXISTS "Creator or owner deletes poll" ON public.trip_polls;
CREATE POLICY "Creator or organizers delete poll"
  ON public.trip_polls FOR DELETE
  USING (user_id = auth.uid() OR public.is_trip_organizer_or_co(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Creator/owner edits options" ON public.trip_poll_options;
CREATE POLICY "Creator or organizers edit options"
  ON public.trip_poll_options FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.trip_polls p
    WHERE p.id = trip_poll_options.poll_id
      AND (p.user_id = auth.uid() OR public.is_trip_organizer_or_co(p.destination_id, auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.trip_polls p
    WHERE p.id = trip_poll_options.poll_id
      AND (p.user_id = auth.uid() OR public.is_trip_organizer_or_co(p.destination_id, auth.uid()))
  ));
DROP POLICY IF EXISTS "Creator/owner deletes options" ON public.trip_poll_options;
CREATE POLICY "Creator or organizers delete options"
  ON public.trip_poll_options FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.trip_polls p
    WHERE p.id = trip_poll_options.poll_id
      AND (p.user_id = auth.uid() OR public.is_trip_organizer_or_co(p.destination_id, auth.uid()))
  ));

-- 9. RPC to set a member's role (organizer only, cannot set 'owner', cannot touch the owner row)
CREATE OR REPLACE FUNCTION public.set_trip_member_role(_dest uuid, _user uuid, _role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller uuid := auth.uid();
  current_role text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Must be signed in'; END IF;
  IF NOT public.is_trip_owner(_dest, caller) THEN
    RAISE EXCEPTION 'Only the organizer can change roles';
  END IF;
  IF _role NOT IN ('co_organizer', 'member') THEN
    RAISE EXCEPTION 'Role must be co_organizer or member';
  END IF;

  SELECT role INTO current_role FROM public.trip_members
    WHERE destination_id = _dest AND user_id = _user;
  IF current_role IS NULL THEN RAISE EXCEPTION 'User is not a member of this trip'; END IF;
  IF current_role = 'owner' THEN RAISE EXCEPTION 'Cannot change the organizer''s role'; END IF;

  UPDATE public.trip_members
    SET role = _role
    WHERE destination_id = _dest AND user_id = _user;
END;
$$;

REVOKE ALL ON FUNCTION public.set_trip_member_role(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_trip_member_role(uuid, uuid, text) TO authenticated;


-- 1. Restrict profiles: revoke stripe_customer_id from clients
REVOKE SELECT (stripe_customer_id) ON public.profiles FROM anon, authenticated;

-- 2. Tighten SELECT policies on trip-scoped tables to trip members only
DROP POLICY IF EXISTS "Comments viewable by authenticated" ON public.comments;
CREATE POLICY "Members read comments" ON public.comments FOR SELECT TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()) OR public.is_trip_owner(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Destinations viewable by authenticated" ON public.destinations;
CREATE POLICY "Members or owner read destinations" ON public.destinations FOR SELECT TO authenticated
USING (public.is_trip_owner(id, auth.uid()) OR public.is_trip_member(id, auth.uid()));

DROP POLICY IF EXISTS "Costs viewable by authenticated" ON public.trip_costs;
CREATE POLICY "Members read costs" ON public.trip_costs FOR SELECT TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()) OR public.is_trip_owner(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Flights viewable by authenticated" ON public.trip_flights;
CREATE POLICY "Members read flights" ON public.trip_flights FOR SELECT TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()) OR public.is_trip_owner(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Stays viewable by authenticated" ON public.trip_stays;
CREATE POLICY "Members read stays" ON public.trip_stays FOR SELECT TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()) OR public.is_trip_owner(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Tickets viewable by authenticated" ON public.trip_tickets;
CREATE POLICY "Members read tickets" ON public.trip_tickets FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.trip_costs c WHERE false
) OR EXISTS (
  -- trip_tickets has no destination_id? It does. Use it.
  SELECT 1 WHERE public.is_trip_member((SELECT destination_id FROM public.trip_tickets t WHERE t.id = trip_tickets.id), auth.uid())
));
-- Simpler correct version (replace above):
DROP POLICY IF EXISTS "Members read tickets" ON public.trip_tickets;
CREATE POLICY "Members read tickets" ON public.trip_tickets FOR SELECT TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()) OR public.is_trip_owner(destination_id, auth.uid()));

DROP POLICY IF EXISTS "Votes viewable by authenticated" ON public.votes;
CREATE POLICY "Members read votes" ON public.votes FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR public.is_trip_member(destination_id, auth.uid())
  OR public.is_trip_owner(destination_id, auth.uid())
);

-- 3. trip_invites: only the owner manages (already has policy). Drop the open SELECT.
DROP POLICY IF EXISTS "Authenticated can read invite by id" ON public.trip_invites;
-- Owner already covered by "Owner manages invites" (ALL).
-- Public preview path uses SECURITY DEFINER function preview_trip_invite — keep it.

-- 4. realtime.messages: restrict subscriptions to user-scoped topics
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own realtime topic" ON realtime.messages;
CREATE POLICY "Users read own realtime topic" ON realtime.messages FOR SELECT TO authenticated
USING (
  realtime.topic() = ('user:' || auth.uid()::text)
);

DROP POLICY IF EXISTS "Users write own realtime topic" ON realtime.messages;
CREATE POLICY "Users write own realtime topic" ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  realtime.topic() = ('user:' || auth.uid()::text)
);

-- 5. Revoke EXECUTE on internal SECURITY DEFINER functions that should not be callable from the API
REVOKE EXECUTE ON FUNCTION public.is_trip_member(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fanout_notification(uuid, uuid, text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.on_comment_insert() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.on_cost_insert() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.on_member_insert() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_owner_as_member() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_headcount_cap() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_close_trips() FROM anon, authenticated, PUBLIC;

-- Keep callable: preview_trip_invite (anon+auth), redeem_trip_invite (auth), get_trip_rating_aggregate (auth)
-- Ensure those grants remain
GRANT EXECUTE ON FUNCTION public.preview_trip_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_trip_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trip_rating_aggregate(uuid) TO authenticated;

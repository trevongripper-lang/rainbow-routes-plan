-- 1) Revoke sensitive billing columns from anon/authenticated; service_role retains access
REVOKE SELECT (paddle_customer_id, paddle_subscription_id, stripe_customer_id)
  ON public.profiles FROM anon, authenticated, PUBLIC;

-- 2) Tighten destination-covers storage SELECT: owner or trip member only
DROP POLICY IF EXISTS "Authenticated can view destination covers" ON storage.objects;
CREATE POLICY "Members or owner view destination covers"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'destination-covers'
    AND EXISTS (
      SELECT 1 FROM public.destinations d
      WHERE d.id::text = split_part(storage.objects.name, '/', 1)
        AND (d.user_id = auth.uid() OR public.is_trip_member(d.id, auth.uid()))
    )
  );

-- 3) Allow trip owner to read polls
DROP POLICY IF EXISTS "Members read polls" ON public.trip_polls;
CREATE POLICY "Members or owner read polls"
  ON public.trip_polls FOR SELECT TO authenticated
  USING (
    public.is_trip_member(destination_id, auth.uid())
    OR public.is_trip_owner(destination_id, auth.uid())
  );

-- 4) Set fixed search_path on required_unlock_tier
ALTER FUNCTION public.required_unlock_tier(integer) SET search_path = public;

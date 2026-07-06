## P0 fix: block self-join into `trip_members`

### Problem
`trip_members` INSERT policy `"Owner can add members"` has:
```
WITH CHECK (is_trip_owner(destination_id, auth.uid()) OR user_id = auth.uid())
```
The `user_id = auth.uid()` branch lets any signed-in user who guesses/knows a trip id insert themselves as a member, bypassing the invite flow.

### Why it's safe to remove the self-insert branch
- `redeem_trip_invite(_token)` is `SECURITY DEFINER` — it inserts into `trip_members` with elevated rights and is not gated by the INSERT policy.
- `add_owner_as_member()` trigger is also `SECURITY DEFINER` — owner auto-membership on trip creation still works.
- No client code calls `supabase.from('trip_members').insert(...)` for self-joins; joining goes through the RPC.

### Change (single migration)
Drop and recreate the INSERT policy so only the trip owner may directly insert membership rows:
```sql
DROP POLICY "Owner can add members" ON public.trip_members;
CREATE POLICY "Owner can add members"
  ON public.trip_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_trip_owner(destination_id, auth.uid()));
```
All other policies (SELECT, UPDATE, DELETE) are left untouched — a member can still leave (DELETE `user_id = auth.uid()`) and update their own commitment.

### Invite preview stays intact
`preview_trip_invite(_token)` is unchanged — anonymous users with a token still see only `title, region, country, image_url, expired, used`.

### Manual test checklist
1. **Self-join blocked**: signed-in user runs `supabase.from('trip_members').insert({ destination_id: <someone-else's-trip>, user_id: <self>, role: 'member' })` → expect RLS error.
2. **Invite redemption still works**: valid `/join/<token>` → click Join → membership row created, redirect to trip.
3. **Owner creates trip**: new destination → owner row auto-added by trigger.
4. **Owner adds member directly**: owner inserts a `trip_members` row for another user on their own trip → allowed.
5. **Leave trip**: member deletes their own row → allowed.
6. **Preview**: unauthenticated `preview_trip_invite` returns only public pitch fields.

### Out of scope (per instructions)
- No role rename (owner→organizer, add co_organizer).
- No destinations→trips refactor.
- No new entity tables.
- No new automated RLS tests — repo has no existing RLS test harness; manual checklist above.

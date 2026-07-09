## 1. Content updates
- **`src/routes/terms.tsx`**: bump "Last updated" date; set contact to `hello@jointribetrips.com`; remove any credits/loyalty/referral wording; add co-organizer role mention if relevant.
- **`src/routes/privacy.tsx`**: bump date; contact → `hello@jointribetrips.com`; drop Mapbox from subprocessors, add OpenStreetMap Nominatim; remove "credits" from the data-we-store list; describe first-party `analytics_events` accurately (event name, trip id, user id).
- Grep the app for `hello@tribetrips.app` and `hello@tgklabs.io` and replace with `hello@jointribetrips.com` (beta-consent, recordings, footer, error-reporting, etc.).

## 2. Remove Mapbox, keep geocoding via Nominatim
- Rewrite `src/lib/geocode.functions.ts` to call `https://nominatim.openstreetmap.org/search` (JSON, `q`, `limit`, `addressdetails=1`) with a descriptive `User-Agent: TribeTrips/1.0 (hello@jointribetrips.com)` header. Map response to existing `GeocodeCandidate` shape (`place_id`, `display_name`, `lat`, `lon`, address parts → city/region/country).
- Rewrite the geocode block in `src/lib/events-admin.functions.ts` the same way; drop the "Verify via Mapbox" copy.
- Delete `MAPBOX_TOKEN` usage; no code path reads it anymore. Ask the user to delete the secret in Cloud settings (can't do it from here).
- Leaflet + OSM tiles stay (already OSM-based).

## 3. Remove credits from UI and product surfaces
Keep DB tables (`user_credits`, `credit_events`, `promo_*`) untouched — memory says feature is deferred, not deleted — but hide everything user-facing:
- **Delete** `src/components/credits-panel.tsx` and its import/use in `src/routes/_authenticated/me.tsx`.
- **`src/components/unlock-trip-button.tsx`**: remove the "free credit" branch, `useCredit` mutation, credits panel, and `creditsAvailable` UI. Button just shows Paid / Unlock CTA.
- **`src/routes/pricing.tsx`**: remove the "Loyalty credits" and "Referral credits" cards.
- **`src/components/promo-code-redeem.tsx`**: reword success toast + helper text without "credit" (e.g. "Promo applied · unlocks 1 trip up to N people, expires in D days"), or hide the redeem entry point entirely if simpler. Recommendation: hide the promo redeem UI for now (matches "no credits UI").
- **`src/routes/_authenticated/console.promo-codes.tsx`**: keep the admin console (memory notes it's active) but relabel "Credits" column → "Unlocks" so no credits vocabulary leaks to admins either. Optional; confirm if you want the admin console rephrased too.
- **`src/routes/_authenticated/me.tsx`**: remove the "credits" mention in the delete-account copy.
- **`src/routes/index.tsx`**: "No credit card required" stays (that's a card, not our credits).
- Keep `trip-balances.ts` / `trip-tabs.tsx` "creditors/debtors" — that's settlement math, unrelated.

## 4. Roles: add `co_organizer`
Keep the DB value `owner` for the trip creator; introduce a new `co_organizer` role in `trip_members`. UI labels: `owner → "Organizer"`, `co_organizer → "Co-organizer"`, else "Member".

### Migration
- Drop the existing `trip_members.role` CHECK; add new CHECK allowing `'owner' | 'co_organizer' | 'member'`.
- Add `public.is_trip_co_organizer(_dest uuid, _user uuid)` (SECURITY DEFINER, stable).
- Add `public.is_trip_organizer_or_co(_dest uuid, _user uuid)` returning `is_trip_owner OR is_trip_co_organizer`.
- Update RLS so co-organizers get organizer-level powers on: `destinations` (UPDATE), `trip_invites` (ALL), `trip_members` (INSERT/DELETE/UPDATE — plus prevent co-organizers from touching the owner row or promoting themselves), `trip_costs` / `trip_stays` / `trip_flights` / `trip_tickets` / `trip_polls` / `trip_poll_options` (UPDATE/DELETE on any row within the trip), `trip_itinerary_order`, `trip_events`. Existing "own row" author policies remain.
- New RPC `public.set_trip_member_role(_dest uuid, _user uuid, _role text)` — only callable by the owner (never co-organizers), rejects setting `owner`, prevents demoting the owner.
- `redeem_trip_invite` unchanged (still inserts as `member`).
- Add `notifications` kind `role_changed` fan-out (optional; skip if noise).

### Server functions / UI
- New `src/lib/trip-roles.functions.ts` exposing `setTripMemberRole` (calls the RPC) + `removeTripMember` (owner or co-org, cannot remove owner).
- Trip members panel in `src/components/trip-tabs.tsx` (or wherever roster lives): add a per-member menu for the owner — "Make co-organizer" / "Remove co-organizer" / "Remove from trip". Co-organizers see "Remove from trip" for plain members only.
- Badge label in roster: Organizer / Co-organizer / Member.
- Invite/manage buttons and edit-trip actions become visible to co-organizers too (currently gated by `is_owner` — swap to `is_owner || is_co_organizer`).

## 5. Verification
- `bun run build:dev` (auto-run) — confirm no unresolved imports after credits deletions.
- Manual: sign in as owner, promote a member, sign in as that user, verify they can edit trip + invite + add costs; verify they cannot demote the owner or promote themselves.
- Grep sweep: `rg -i "mapbox|hello@tribetrips|hello@tgklabs|free credit|loyalty credit|referral credit"` should return zero user-facing hits.

## Open questions before I build
1. Promo-code redeem UI: **hide entirely** (recommended) or keep with reworded copy ("Redeem unlock code")?
2. Admin console `console.promo-codes.tsx` column labels — relabel "Credits" → "Unlocks", or leave admin-only vocabulary alone?

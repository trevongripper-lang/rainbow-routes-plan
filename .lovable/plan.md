
## Part 1 — Bulk edit for Costs and Itinerary

Reuses the existing `useBulkSelection`, `BulkActionBar`, and `BulkConfirmDialog` building blocks already in the codebase (built for the trips list).

### Costs tab (`CostsTab` in `src/components/trip-tabs.tsx`)

- Add a checkbox to each cost row (hover-visible, pinned once anything is selected). Shift-click extends a range over the currently-rendered list.
- Bulk action bar shows: `N selected · Mark settled · Delete · Clear`.
- **Bulk delete** — runs `trip_costs.delete().in("id", ids)`. RLS already restricts deletes to cost creator or trip owner. Confirm dialog splits the selection into "Will delete (N)" vs "Skipped (M) — not yours" using `me`/`isOwner`.
- **Bulk mark settled** — for each selected cost where I'm the payer or owe a share, insert a `trip_settlements` row mirroring the existing single-row "settle up" flow. Rows that don't apply to me are listed as skipped.
- Invalidates `["costs", destinationId]` and `["settlements", destinationId]` on success. Toast with counts. Analytics: `track("bulk_delete", { surface: "costs", count })`, `track("bulk_settle", { count })`.

### Itinerary tab (`ItineraryTab` in `src/components/itinerary-tab.tsx`)

The list is aggregated from 5 source tables (`trip_flights`, `trip_stays`, `trip_tickets`, `trip_costs`, `trip_events`) plus a `trip_itinerary_order` overlay. Item IDs already carry a kind prefix (`f-`, `s-`, `t-`, `c-`, `e-`) which makes routing safe.

- Add a checkbox to each item card in both Days and List views.
- Bulk action bar: `N selected · Move to day… · Delete · Clear`.
- **Bulk delete** — group selected IDs by kind and issue one `delete().in("id", ids)` per source table:
  - `f-*` → `trip_flights`
  - `s-*` → `trip_stays`
  - `t-*` → `trip_tickets`
  - `c-*` → `trip_costs`
  - `e-*` → `trip_events` (detach, not delete the underlying event)
  Confirm dialog lists what will be removed grouped by kind. Events show "Detach from trip" wording.
- **Bulk move to day** — popover lists every day in the trip window. Upserts `trip_itinerary_order` rows `{ destination_id, item_key: <id>, day_key, sort_order }` for each selected item, appending to the end of the chosen day. Skips items the day picker can't anchor (no-op for tickets with no date and no existing order row — they stay where they were).
- Invalidates all 5 source queries + `["itinerary-order", destinationId]`. Analytics: `track("bulk_delete", { surface: "itinerary", count, by_kind })`, `track("bulk_move_day", { count })`.

### Files

**New**
- `src/components/itinerary-bulk-bar.tsx` — thin wrapper that injects the "Move to day…" popover into the shared `BulkActionBar`.

**Edited**
- `src/components/trip-tabs.tsx` — wire selection + bulk bar into `CostsTab`.
- `src/components/itinerary-tab.tsx` — wire selection + bulk bar, route bulk delete by kind prefix, implement bulk-move-to-day.

No schema changes, no new server functions, no migrations. RLS already governs all of it.

---

## Part 2 — Tribe scope today

### In scope (already built or actively maintained)

**Trips & membership**
- Create / edit / delete trips; cover image; dates with order check; region/country/city; description.
- Headcount cap (free = 5) with per-tier unlock pricing (Paddle, sandbox).
- Invite via shareable token link; preview before accepting; redeem flow.
- Trip members list with roles (owner / member); leave trip; owner can't leave (must delete).
- Auto-close trips a day past end date.

**In-trip planning**
- Costs ledger with categories, currency, payer, shares; per-row settle-up writes to `trip_settlements`.
- Stays (hotels/Airbnb-style) with check-in/out and URL.
- Flights (with optional aviationstack lookup) and airport combobox.
- Tickets/attractions.
- Itinerary view (Days + List) with drag-to-reorder and cross-day moves, persisted in `trip_itinerary_order`.
- Polls (single trip-scoped polls + votes).
- Chatter (comments + replies + @mentions + notifications fanout).
- Trip ratings (post-trip feedback, aggregated).
- Events catalogue + auto-matching to a trip by region/country/coords and date window; attach/detach events.
- Smart-add (LLM parses pasted text into a stay/flight/ticket/cost).

**Bulk actions** (this pass)
- Trips list: bulk delete, bulk leave, bulk export PDF, bulk export ICS.
- Costs: bulk delete, bulk mark settled.
- Itinerary: bulk delete (routes per source table), bulk move-to-day.

**Account & monetization**
- Email/password + Google OAuth (via Lovable broker).
- Profiles, avatars, display names.
- Credits system: referral grants, loyalty (every 8 paid trips), promo codes with rate-limited redemption.
- Paddle checkout for per-trip unlocks (tier1/2/3); webhook at `/api/public/paddle-webhook`.
- Pricing page; per-trip unlock UI.

**Admin / ops**
- Admin role gate via `has_role`.
- Console: promo codes, webhook test, analytics (last 30 days).
- Notifications bell + realtime fanout for comments, mentions, member joins, cost added, settlement recorded, trip closed.
- Trip events map (Mapbox).
- RLS smoke tests, rate limiting helper, install-app banner.

### Out of scope today

- **In-app payments / money movement.** Settlements are an IOU ledger; Tribe does not collect or disburse funds.
- **Subscriptions.** Pricing is strictly per-trip; no recurring plans.
- **Native mobile apps.** Web/PWA only.
- **Multi-trip "tribes" or persistent groups.** Membership is per-trip; no group/org concept that survives across trips.
- **Direct messaging.** Chatter is trip-scoped only; no DMs or private threads.
- **Calendar two-way sync.** Export to ICS is one-shot; no live Google/Apple/Outlook write-back.
- **Booking integrations.** No live hotel/flight/ticket purchase — links and metadata only.
- **AI trip generation / itinerary suggestion.** Smart-add parses what you paste; it does not propose plans.
- **Public/discoverable trips.** All trips are private to invited members; no marketplace or feed.
- **Bulk actions on Stays, Tickets, Flights, Polls.** Deferred — single-row actions only.
- **Corporate/enterprise features.** Tracked in `mem://features/enterprise-edition` for a future build.
- **Per-user notification preferences, email digests, push notifications.** In-app bell only.
- **File/photo attachments on chatter, stays, tickets, costs.** Text + URLs only.
- **Multi-language / localization.** English only; currencies are per-row but UI is not translated.
- **Trip templates / duplication.** No "clone this trip" or starter templates.

---

## Technical notes

- All bulk mutations go through the browser Supabase client; RLS owns auth. No new server functions.
- Selection state is component-local and clears on tab switch.
- For itinerary bulk delete of events, we delete from `trip_events` (the join), never from `events`.
- `trip_itinerary_order` is upsert with `onConflict: "destination_id,item_key"` — same shape already used by drag-reorder.
- Confirm dialog reuses the existing `willApply` / `skipped` split with a per-kind reason string.

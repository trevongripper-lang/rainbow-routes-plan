
## Bulk management for trips

A reusable selection pattern that turns any list into a multi-select surface with a sticky "bulk action bar" at the bottom. Activated by a checkbox on each row (always visible on hover, persistent once anything is selected). Shift-click extends a range. Esc / "Clear" exits selection mode.

### 1. Trips list (`/trips`)

- Add a checkbox overlay on each `TripCard` (top-right, under the "Past" badge). Selecting any card reveals a fixed bottom bar: `N selected · Delete · Leave · Export PDF · Export calendar · Clear`.
- Filters & search still work; selection persists across tab switches but is scoped to currently-visible cards (a "Select all visible" appears in the bar).
- **Delete** — only trips where I'm the owner. Mixed selection shows a confirm dialog listing what'll be deleted vs skipped (non-owner trips show "You'll leave instead"). One confirm, then parallel `destinations.delete()` calls (RLS already restricts to owner). Toast with counts. Owner-cascade already removes members/costs/etc. via FK.
- **Leave** — trips where I'm a non-owner member. Same mixed-selection handling: owner rows are skipped with a note ("Owners can't leave — delete instead"). Deletes my `trip_members` row.
- **Export PDF** — generates one PDF per selected trip (or a single combined PDF if >1), containing: cover (title, dates, region), attendees, day-by-day itinerary (respecting `trip_itinerary_order`), costs summary, stays & flights. Uses `pdf-lib` client-side (no server round-trip, no native deps — Worker-safe anyway since we run it in the browser). Downloads as `trips-export-YYYY-MM-DD.pdf`.
- **Export calendar** — generates a single `.ics` file containing VEVENTs for: trip date range, each itinerary day with items, stays (check-in → check-out), and flights (departure/arrival times). Built with a tiny inline ICS serializer (no dependency). Downloads as `trips-YYYY-MM-DD.ics`. Opens in Apple Calendar / Google Calendar / Outlook.

### 2. In-trip tabs (multi-select inside a trip)

Apply the same selection pattern to the list-style tabs. Owner OR creator of each row can delete (RLS already enforces this); rows the user can't delete are shown disabled in the confirm dialog.

- **Costs** (`trip-tabs.tsx` costs section) — checkbox per row, bulk delete, bulk "mark settled" (writes to `trip_settlements` like the existing single-row flow).
- **Itinerary** (`itinerary-tab.tsx`) — checkbox per item, bulk delete, bulk "move to day…" (popover picks a day key, updates `trip_itinerary_order.day_key`).
- **Stays** (`trip_stays`) — bulk delete.
- **Tickets** (`trip_tickets`) — bulk delete.
- **Flights** (`flights-tab.tsx`) — bulk delete.
- **Polls** — out of scope for this pass (polls are short-lived and rarely accumulate).

### 3. Shared building blocks

- `src/hooks/use-bulk-selection.ts` — generic `useBulkSelection<T>(items, getId)` returning `{ selected, toggle, toggleRange, clear, selectAll, isSelected, count }`. Handles shift-click range.
- `src/components/bulk-action-bar.tsx` — sticky bottom bar (slides up when count > 0), accepts `actions: { label, icon, onClick, destructive?, disabled?, tooltip? }[]` and a `count`/`onClear`.
- `src/components/bulk-confirm-dialog.tsx` — confirm dialog that splits the selection into "Will apply to N" vs "Skipped (M)" with reasons.
- `src/lib/exports/trip-pdf.ts` — `exportTripsPdf(trips)` using `pdf-lib`. Pulls all child data (members, itinerary, costs, stays, flights) in one batched query per table filtered by `destination_id IN (...)`.
- `src/lib/exports/trip-ics.ts` — `exportTripsIcs(trips)` building an RFC 5545 string. No deps.
- Analytics: `track("bulk_delete", { surface, count })`, `track("bulk_export", { format, count })`, etc.

### 4. Technical notes

- All deletes go through the existing browser Supabase client — RLS owns the auth check, no new server functions or migrations needed.
- For export, members/profiles fetch uses `get_public_profiles` RPC (already exists) to render names/avatars in the PDF.
- `pdf-lib` is browser-safe (no canvas/sharp). Install with `bun add pdf-lib`.
- Selection state is component-local; not persisted across navigations. Switching the upcoming/past tab clears selection.
- Empty bulk action bar has no DOM presence — only mounts when `count > 0`, so it doesn't affect layout.
- Keyboard: `Esc` clears, `Cmd/Ctrl+A` selects all visible when the list is focused, `Delete` triggers the destructive action with confirm.

### 5. Files

**New**
- `src/hooks/use-bulk-selection.ts`
- `src/components/bulk-action-bar.tsx`
- `src/components/bulk-confirm-dialog.tsx`
- `src/lib/exports/trip-pdf.ts`
- `src/lib/exports/trip-ics.ts`

**Edited**
- `src/routes/_authenticated/trips.index.tsx` — checkbox overlay on cards, wire bulk bar with delete/leave/export PDF/export ICS.
- `src/components/trip-tabs.tsx` — multi-select for costs (bulk delete + bulk mark-settled).
- `src/components/itinerary-tab.tsx` — multi-select with bulk delete + move-to-day.
- `src/components/flights-tab.tsx` — multi-select bulk delete.
- Stays & tickets sections (currently inside `trip-tabs.tsx`) — multi-select bulk delete.

**Dependencies**
- `bun add pdf-lib`

No database migrations.

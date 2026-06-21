
# Refining the three highest-impact surfaces

After reading the current Itinerary, Costs, and Stays code, three concrete problems stand out across all three tabs. They share a root cause: **stays/costs/tickets have no dates**, so the itinerary timeline can't actually sequence the trip, and costs can't be timeboxed. Fixing this unlocks a much more "trip-shaped" experience.

---

## 1) Stays tab — turn it into a real lodging card

**Today:** Free-text title + URL + description. No check-in/out dates, no location, no nightly rate, no who's staying where. So stays show as "Undated" in the itinerary and contribute nothing to costs.

**Changes:**
- Add fields: `check_in` (date), `check_out` (date), `address` (text), `nightly_rate_cents` + `currency`, `confirmation` (text, collapsible), `booked_by` (uuid → trip member).
- Replace the bare list with a card per stay: thumbnail (auto-fetch OG image from the URL on insert, fall back to a Mapbox static map of the address), nights count, total cost preview, "Booked by @Name" chip.
- "Add to costs" one-tap action that creates a linked shared cost from `nightly_rate × nights`.
- Map preview using the existing `MAPBOX_TOKEN`.
- Default check-in to the trip's `start_date`, check-out to `end_date`.
- Edit + delete (currently delete only).

## 2) Costs tab — make the math trustworthy

**Today:** Settle-up exists but is brittle. Splits are always equal across `headcount` even if some members aren't on the trip yet, no per-cost split overrides, no category totals, no per-person view, no edit, currencies aren't enforced (first row wins).

**Changes:**
- **Split modes per cost:** equal among members (default), equal among selected members, custom shares, or per-person (existing).
- **Headcount source of truth:** use actual `trip_members` count, not the destinations.headcount field, with a clear warning when they diverge.
- **Currency lock:** pick once at trip level (store on `destinations.default_currency`), all new costs default to it; show a chip when a cost is in a different currency (no FX conversion yet, just flag).
- **Per-person summary:** small table showing each member's "paid / owes / net" with avatars; settle-up suggestions stay but get a "Mark settled" toggle that writes to a new `trip_settlements` table.
- **Categories with totals:** lodging / transport / food / activities / other, with a tiny bar chart of trip spend by category.
- **Edit + duplicate** on each cost row.
- **Optional date** on a cost (defaults to today, used by the itinerary).

## 3) Itinerary tab — make it the daily plan, not a dump

**Today:** Lists everything in one chronological feed; stays/costs/tickets all bucket into "Undated" because they have no date fields. Events from `trip_events` show by their own start date, which can be outside the trip window.

**Changes (lands after #1 and #2 add dates):**
- **Day-by-day view** between `start_date` and `end_date`, with an explicit empty day rendering ("Free day — what should we do?") instead of skipping.
- Stays render as a **multi-day band** spanning check-in → check-out (not a point on one day).
- Flights render with **departure day + arrival day** (handles overnight legs); add a conflict pill when an event/ticket starts before the flight arrives.
- **"Outside the trip" section** at the bottom for anything dated before/after the window — currently those silently render as the wrong day.
- **Per-day quick add** button → opens existing `SmartAdd` pre-filled with that day's date.
- **"My day" toggle** to filter to items owned by the current member (flights with their `passenger_name`, stays where they're `booked_by`, costs they paid).
- Keep the existing chronological "list view" behind a toggle.

---

## Technical notes

- **DB migrations needed:**
  - `trip_stays`: add `check_in date`, `check_out date`, `address text`, `nightly_rate_cents int`, `currency text`, `confirmation text`, `booked_by uuid`, `image_url text`.
  - `trip_costs`: add `cost_date date`, `split_mode text` (`equal_all` | `equal_some` | `custom` | `per_person`), `split_member_ids uuid[]`, `split_shares jsonb`.
  - new `trip_settlements (id, destination_id, from_user, to_user, amount_cents, currency, settled_at)`.
  - `destinations`: add `default_currency text default 'USD'`.
  - All with GRANTs + RLS scoped to `is_trip_member`.
- **Itinerary aggregation** (`src/components/itinerary-tab.tsx`) gets a new `buildDays(start, end, items)` helper; stays expand into a band; flights split into two markers.
- **Mapbox static map** for stays uses the existing `MAPBOX_TOKEN`; OG image scraping uses a small `createServerFn` to avoid CORS.
- No changes to flights tab in this pass.
- No changes to auth, billing, polls, chatter, or invites in this pass.

## Out of scope (call out for a later turn)

- FX conversion between currencies on costs.
- Drag-to-reorder within a day.
- ICS export of the itinerary.
- Mobile polish pass across other tabs.
- Notifications unread state + deep links.
- Past-trip recap/ratings nudge.

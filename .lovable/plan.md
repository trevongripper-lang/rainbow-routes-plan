## Goal

Make Planning Progress a real retention engine: every meaningful planning action nudges the bar, not just the final flip. Add two high-signal actions (Itinerary, Invites) and give partial credit for in-progress items.

## New scoring model

8 items, weighted to 100. A trip starts at 10 (Destination) and climbs as members do work.

| # | Item | Weight | Done = full | Partial credit |
|---|---|---|---|---|
| 1 | Destination | 10 | trip exists | — |
| 2 | Dates | 10 | both `start_date` + `end_date` set | 5 if only one set |
| 3 | Invites | 10 | `trip_members` count ≥ `destinations.headcount` | proportional: `members / headcount × 10` |
| 4 | Stay | 15 | ≥ 1 row in `trip_stays` | — |
| 5 | Flights | 20 | booked count ≥ member count | proportional: `booked / members × 20` (booked = non-empty `confirmation`) |
| 6 | Activities | 10 | ≥ 1 row in `trip_tickets` | — |
| 7 | Itinerary | 10 | ≥ 1 itinerary item per trip day | proportional: `days_with_item / trip_days × 10` |
| 8 | Balances | 15 | viewer's net = 0 | 7 if any settlement exists but net ≠ 0 |

Total = 100. Percentage = `sum(earned) / 100`.

### Why these weights

- Flights (20) and Stay (15) are the highest-friction, highest-commitment actions — they drive trip lock-in.
- Balances (15) is the post-trip retention hook.
- Invites (10) is new and directly grows the network.
- Dates / Activities / Itinerary / Destination at 10 each — frequent, low-friction nudges.

### Actions that increase progress (full list, for the UI tooltip + analytics)

- Set start date → +5
- Set end date → +5 (or +10 if setting both at once)
- Send/accept an invite (each new `trip_members` row up to headcount) → +`10/headcount`
- Add a stay → +15 (first one)
- Enter a flight confirmation code → +`20/members` per member
- Add a ticket/activity → +10 (first one)
- Add an itinerary item on a new day → +`10/trip_days`
- Record a settlement → +7 first time, +15 when net hits 0

Things that still do NOT score (intentional, to avoid gaming): polls, chatter messages, smart-add suggestions, costs without settlement.

## UX changes

- Progress bar shows the weighted percentage (0–100). Same component, no layout change.
- Tooltip lists each item with its current contribution: `Flights — 8 / 20 (2 of 5 booked)`. Pending items keep the amber/grey icons.
- New copy line at the bottom of the tooltip: "Next best action: <highest-weighted pending item>" — drives one clear click.
- Analytics: keep `planning_progress_view`; add `planning_progress_next_action_click` with `{ key, weight }`.

## Technical notes

- `src/lib/planning-progress.ts`: replace the boolean `status` with `{ status, earned, weight }`. Add `computeWeightedScore(items)` returning `{ earned, total, pct }`. Keep `pendingPlanningItems` (anything where `earned < weight`).
- `src/components/planning-progress.tsx`:
  - Add two queries: `trip_itinerary` rows (or current itinerary table — confirm name during build) and reuse `trip_members` for Invites.
  - Pass `headcount` from `destinations.headcount` (already loaded by the trip route) for the Invites denominator.
  - Compute "next best action" = pending item with max `weight - earned`.
- `src/lib/planning-progress.test.ts`: extend cases — partial dates, partial invites, itinerary day coverage, balances with settlement-in-progress.
- No schema changes. No migrations. No new RLS.

## Files

- Edited: `src/lib/planning-progress.ts`, `src/lib/planning-progress.test.ts`, `src/components/planning-progress.tsx`
- Possibly edited: `src/components/planning-progress.a11y.test.tsx` (update summary string assertions)

## Out of scope

- Push/email nudges when score crosses thresholds (next release).
- Per-member flight checklist UI.
- Gamification (badges, streaks) — Ratings/Loyalty are already deferred per project memory.
- Changing what counts as a "booked" flight (still = non-empty confirmation).

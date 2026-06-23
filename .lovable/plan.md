## Goal

Reframe Planning Progress from "data entered" to "commitment made." Six items, organizer-controlled opt-outs, no false-positive completion.

## New model — 6 items, commitment-framed

| #   | Label              | Weight | Done when                                                                                                    | Partial credit                                                                       |
| --- | ------------------ | ------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1   | Destination picked | 10     | Trip exists                                                                                                  | —                                                                                    |
| 2   | Dates locked       | 15     | `start_date` AND `end_date` set AND `dates_locked = true` on the trip                                        | 7 if both dates set but not locked; 3 if only one date set                           |
| 3   | People confirmed   | 15     | Every `trip_members` row has `status = 'confirmed'`, AND total confirmed ≥ `headcount`                       | proportional: `confirmed / headcount × 15`                                           |
| 4   | Stay handled       | 15     | ≥ 1 row in `trip_stays` OR organizer toggled `stay_not_needed = true`                                        | —                                                                                    |
| 5   | Travel handled     | 25     | Each member either has a flight with non-empty `confirmation` OR `travel_status = 'not_needed'` (per-member) | proportional: `(booked + opted_out) / members × 25`                                  |
| 6   | Money handled      | 20     | Viewer's net = 0 AND at least one settlement exists, OR organizer toggled `no_shared_costs = true`           | 10 if any settlement exists but net ≠ 0; **0** when no costs and no toggle (key fix) |

Total = 100.

### Critical behavior changes from v1

- **Money handled never auto-completes from emptiness.** A brand-new trip with zero costs scores 0 on this item until either a settlement reconciles or the organizer explicitly opts out. This fixes the false-progress bug.
- **Travel handled is per-member opt-out, not all-or-nothing.** Road trips, locals, late bookers count via `travel_status = 'not_needed'`.
- **Dates locked is a deliberate commit step**, not just "two dates typed in." Prevents the common "tentative July?" drift.
- **People confirmed replaces Invites.** Counts confirmed RSVPs, not bodies-in-the-room. Invited-but-not-responded ≠ confirmed.

## Organizer controls (UI)

Three new owner-only toggles, surfaced inline on the progress item when it's pending:

- **Dates row** → "Lock dates" button (owner only, requires both dates). Once locked, shows "Unlock" in the trip settings (not on the progress card).
- **Stay row** → "Mark not needed" link button (owner only).
- **Money row** → "No shared costs on this trip" link button (owner only).
- **Travel row** → each member sees their own "I don't need a flight" toggle inline; owner can toggle on a member's behalf from the Flights tab attendee list.
- **People row** → each member sees a "Confirm I'm coming" CTA the first time after joining. Owner sees a "Nudge unconfirmed" button that triggers a `member_unconfirmed_nudge` notification fanout.

All toggles are reversible. All emit analytics: `planning_commit` with `{ item, value }`.

## Schema changes (one migration)

```text
ALTER TABLE destinations
  ADD COLUMN dates_locked     boolean NOT NULL DEFAULT false,
  ADD COLUMN stay_not_needed  boolean NOT NULL DEFAULT false,
  ADD COLUMN no_shared_costs  boolean NOT NULL DEFAULT false;

ALTER TABLE trip_members
  ADD COLUMN status         text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','confirmed','declined')),
  ADD COLUMN travel_status  text NOT NULL DEFAULT 'pending'
    CHECK (travel_status IN ('pending','booked','not_needed'));
```

- Backfill: existing owners → `status = 'confirmed'`; everyone else → `'invited'`. `travel_status` derived: members with a flight confirmation → `'booked'`, else `'pending'`.
- RLS additions: members can update only their own `status` and `travel_status`; only the owner can update the three `destinations` flags. Existing GRANTs already cover the columns.
- A trigger keeps `trip_members.travel_status = 'booked'` in sync when a `trip_flights.confirmation` for that member becomes non-empty (one-way: setting `not_needed` is sticky and the trigger respects it).

## Files

- New migration (schema + RLS + trigger + backfill).
- Edited: `src/lib/planning-progress.ts` (new inputs: `datesLocked`, `confirmedCount`, `stayNotNeeded`, `travelHandledCount`, `noSharedCosts`, `settlementsCount`; rewritten item math).
- Edited: `src/lib/planning-progress.test.ts` (cover the false-positive fix, opt-outs, partials).
- Edited: `src/components/planning-progress.tsx` (fetch members with new columns + dest flags; relabel items; pass through).
- Edited: `src/components/planning-progress.a11y.test.tsx` (label assertions: "Money handled", "Travel handled", etc.).
- Edited: `src/routes/_authenticated/trips.$id.tsx` (load the three dest flags; pass `dest` flags to `PlanningProgress`).
- Edited: `src/components/flights-tab.tsx` (per-member "I don't need a flight" toggle for self; owner can toggle for any).
- Edited: `src/components/attendees-card.tsx` (Confirm/Nudge controls; show member statuses).
- New tiny owner-only button components inline on the progress tooltip rows (or in a new "Owner controls" popover anchored to the progress card) for `Lock dates`, `Mark stay not needed`, `No shared costs`.
- Edited: `src/integrations/supabase/types.ts` regenerated by the migration step (not hand-edited).

## Analytics

- `planning_commit` with `{ item: 'dates_locked'|'stay_not_needed'|'no_shared_costs'|'member_confirmed'|'travel_not_needed', value: boolean }`.
- `member_nudged` with `{ count }` from the owner's Nudge button.

## Out of scope

- Cross-trip "ready-to-go" digest emails.
- Auto-locking dates when all members confirm (could mask owner intent).
- Gamification, badges, streaks.
- Itinerary-day coverage scoring (covered by Stay + Travel + Plans).
- Renaming "Activities" → "Plans" UI-wide; only the progress card uses the new label this release.

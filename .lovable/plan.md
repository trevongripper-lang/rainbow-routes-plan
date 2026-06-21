## Goal

When a member opens a trip, the first thing they see (top of the Overview tab) is a **Planning Progress** card that summarizes the trip at a glance and links into each tab. Also adjust scope: referrals move to next release; promo codes, loyalty, and credits stay in scope.

## Planning Progress card

Placed at the top of the Overview tab (above Smart-add), inside the existing trip detail route. Owners and members both see it.

Six rows, each with a status pill, a one-line summary, and a "Go →" link that switches to the relevant tab.

```text
Destination   Decided ✓                              (trip exists)
Dates         Jun 12 – Jun 19 ✓   /   Not set        → Overview (date editor)
Stay          Booked ✓ · 2 places / Not booked        → Stays tab
Flights       4 / 7 booked        / 0 / 7            → Flights tab
Activities    3 added             / None yet         → Tickets tab
Balances      You're owed $42 / You owe $142 / Settled → Costs tab
```

### Status rules

- **Destination**: always ✓ (the trip page implies a destination).
- **Dates**: ✓ when both `start_date` and `end_date` are set, otherwise "Not set".
- **Stay**: ✓ when `trip_stays` has ≥ 1 row for the trip; show count. "Not booked" otherwise.
- **Flights**: count of `trip_flights` rows with non-empty `confirmation` (treated as "booked") over total trip member count (`headcount` source already used by CostsTab — `trip_members` count, fallback to `destinations.headcount`). Display `booked / total`.
- **Activities**: count of `trip_tickets` rows. "None yet" when 0.
- **Balances**: reuse the same per-person summary logic CostsTab computes (`memberIds`, `headcount`, `trip_costs`, `trip_settlements`) to derive the current user's net balance:
  - `> 0` → "You're owed {amount}"
  - `< 0` → "You owe {amount}"
  - `= 0` → "Settled ✓"

All amounts in `destinations.default_currency`.

### Visual

Card uses the existing token palette (`bg-card`, `border-border/60`, `rounded-3xl`). Each row: 24px status icon (CheckCircle / Circle / AlertCircle from `lucide-react`), label, summary, and a right-aligned `<Link>` to the relevant tab via the existing tab search param pattern (`search: { tab: 'flights' }`).

Loading: render six skeleton rows.

## Scope changes

Update `.lovable/plan.md`:

- Move **Referrals** ("from invites" credit source, referral tracking) → Out of scope (next release).
- Keep in scope: **promo codes** (admin console + redemption), **loyalty credits** (paid-trip progress → free unlocks), **credits panel/spending**.
- Update `CreditsPanel` to hide the "Referral" tile (the `referralRemaining` data still loads but is not displayed). No backend changes — server fn keeps returning the field for future use.

## Technical notes

- New component `src/components/planning-progress.tsx`, rendered at the top of the `overview` `TabsContent` in `src/routes/_authenticated/trips.$id.tsx`.
- Props: `destinationId`, `me`, `startDate`, `endDate`, `headcountFallback`, `defaultCurrency`.
- Data: one `useQueries` block with five lightweight `select('id, ...')` queries (`trip_stays`, `trip_flights`, `trip_tickets`, `trip_costs`, `trip_settlements`) + `trip_members` count, all keyed by `destinationId`. Cache keys reuse existing ones where possible (`["stays", id]`, `["flights", id]`, `["tickets", id]`, `["costs", id]`) so navigating into a tab is instant and edits invalidate the card automatically.
- Balance math extracted into `src/lib/trip-balances.ts` (pure function) so CostsTab and PlanningProgress share one source of truth — no behavior change to CostsTab.
- Analytics: `planning_progress_view` on mount, `planning_progress_click` with `{ section }` on row click.
- `CreditsPanel`: simple JSX edit to hide referral tile; grid becomes `sm:grid-cols-2`.
- No schema changes, no migrations.

## Files

- New: `src/components/planning-progress.tsx`, `src/lib/trip-balances.ts`
- Edited: `src/routes/_authenticated/trips.$id.tsx` (mount card in overview), `src/components/trip-tabs.tsx` (use shared balance util in CostsTab), `src/components/credits-panel.tsx` (hide referral tile), `.lovable/plan.md` (scope update)

## Out of scope for this change

- Restructuring tabs or the existing overview content (Smart-add, Polls, Events, Chatter stay below the new card).
- Push notifications when progress changes.
- Per-member flight-booked checklist UI (only the count is shown).

## Defer "Add anything via link" (SmartAdd) from P0

Remove SmartAdd from the P0 surface without deleting the underlying implementation, so it can be refined and re-enabled later.

### Changes

1. **`src/routes/_authenticated/trips.$id.tsx`**
   - Remove the `<SmartAdd destinationId={id} me={me} />` mount on the Overview tab (line 405).
   - Remove the now-unused `import { SmartAdd } from "@/components/smart-add"` (line 25).

2. **`docs/Tribe-SPEC.md`**
   - Add a "Deferred / future enhancement" note for **Smart Add (paste-a-link → auto-classify)**: needs refinement on classification accuracy, URL enrichment reliability, and undo/edit UX before re-enabling.

3. **Keep intact (no deletion):**
   - `src/components/smart-add.tsx`
   - `src/lib/smart-add.functions.ts` (`enrichUrl`, `classifySmartAdd`)
   - Test mock in `src/__tests__/trip-page.test.tsx` (harmless; safe to leave)
   - `SERPSTACK_API_KEY` and `LOVABLE_API_KEY` secrets (leave — either shared with other features or benign if unused)

### Not touched
- No database migration.
- No changes to `trip_stays` / `trip_tickets` / `trip_costs` / `trip_flights` / `comments` — data users already added stays put and remains editable in each tab.
- No changes to the invite/join flow or any other P0 feature.

### Manual verification
1. Open a trip → Overview tab: the "Smart Add" paste box no longer appears.
2. Polls, Events strip, and the rest of Overview still render.
3. Stays/Tickets/Costs/Flights tabs still list previously-added items.
4. `bun run lint` / typecheck: no unused-import errors.

## Fix all 7 exhaustive-deps warnings

### 1. `src/__tests__/settings-page.test.tsx:40`
Wrap the inline `queryFn` in `useCallback` (or hoist it) so the dep array can include it without re-creating each render.

### 2. `src/components/notifications-bell.tsx:83` — `tripMap`
Memoize `tripMap` with `useMemo` keyed on the trips query data, then include it in the effect's deps.

### 3. `src/components/planning-progress.tsx:118, 125, 126` — `members`, `costs`, `settlements` fallbacks
The warnings come from `?? []` fallbacks creating new array identities each render. Lift each fallback to a `useMemo(() => data ?? [], [data])` so the deps array references the stable memoized value.

### 4. `src/components/trip-tabs.tsx:774` — `nameOf`
Wrap `nameOf` in `useCallback` with its real deps (members lookup), then add it to the dependent effect/memo.

### Validation
- Run `bun run lint` — expect 0 warnings, 0 errors.
- Run `bunx vitest run` — expect 59/59 passing (no behavior changes).
- Smoke-check Notifications bell, Planning progress, Trip tabs, and Settings page render without regression.

### Out of scope
No behavior changes; purely dependency-array correctness. `BETA_CHECKLIST.md` stale reference is not touched in this plan (ask separately if desired).

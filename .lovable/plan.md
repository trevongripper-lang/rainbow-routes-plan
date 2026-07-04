# Beta / iPhone readiness fixes

Eight items, ordered by UX impact vs effort. All within existing conventions — no new libraries except local Leaflet marker assets.

## 1. Invite auth redirect (safe same-origin)

- `src/routes/auth.tsx`: read `redirect` from search params (Zod-validated, same-origin-only via new helper `sanitizeRedirectPath`).
- Apply the sanitized path in **all four** paths:
  1. Existing session detected on mount
  2. Email/password sign-in success
  3. Signup auto-confirm success
  4. Google OAuth (`lovable.auth.signInWithOAuth`) — pass through query, then honor after `getSession()` resolves post-callback
- Fallback to `/trips` when redirect is missing/invalid/cross-origin/protected auth route.
- Preserve beta-consent gate: if consent missing, land on `/beta-consent` and stash the intended redirect in `sessionStorage` under `tt.pendingRedirect`; consent page consumes it on accept.
- `src/lib/redirect-guard.ts`: extend with `sanitizeRedirectPath(input, { fallback: "/trips" })` — allow only paths starting with `/`, not `//`, not `/auth`, not `/beta-consent`.
- Unit tests: `src/lib/redirect-guard.test.ts` (new).

## 2. Vitest localStorage brittleness

Root cause: tests touch `localStorage` at import time (beta-consent, redirect guard) and current Node needs the `--localstorage-file` flag.

Fix without a runtime flag:
- `vitest.setup.ts`: install a minimal in-memory `localStorage`/`sessionStorage` polyfill when `globalThis.localStorage` is undefined (guarded, no-op under jsdom).
- `vitest.config.ts`: confirm `environment: "jsdom"` for DOM tests; keep node env for pure lib tests.
- No package.json script changes needed; `bunx vitest run` and `npx vitest run` both work.
- Verify all 59 tests green.

## 3. Lockfile sync

**Note:** this project uses **`bun.lock`**, not `package-lock.json` — there is no npm lockfile in the repo and `npm ci` is not the project's install path.

Proposed handling:
- Run `bun install` to regenerate `bun.lock` after any package.json drift from recent `xlsx` add.
- Verify `bun install --frozen-lockfile` succeeds (bun's equivalent of `npm ci`).
- If you specifically want an `npm` lockfile added, say so and I'll generate one; otherwise I'll treat this item as "keep bun.lock in sync."

## 4. Mobile trip navigation — sticky section bar

- `src/components/trip-tabs.tsx`: extract the existing tab list into a `<TripSectionBar />` that renders:
  - Desktop (`md+`): unchanged sidebar behavior.
  - Mobile: sticky horizontal, scrollable pill bar under the trip header — Chatter, Itinerary, Flights, Stays, Tickets, Costs, Ratings (Ratings hidden per Core rule — confirmed deferred). Actually **exclude Ratings** since Core memory says no user-facing Ratings UI. Include: Chatter, Itinerary, Flights, Stays, Tickets, Costs.
  - `position: sticky; top: 0` with safe-area padding; overflow-x scroll, snap-x.
  - Active state driven by current tab query param.
- `src/routes/_authenticated/trips.$id.tsx`: mount `<TripSectionBar />` above tab content on mobile only (`md:hidden`).
- No logic changes to the tabs themselves.

## 5. Mobile dialog ergonomics

- `src/components/ui/dialog.tsx` + `src/components/ui/alert-dialog.tsx`: update `Content` classNames to:
  - `max-h-[calc(100dvh-2rem)]` on mobile, `overflow-y-auto`
  - Safe-area padding: `pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]`
  - Ensure sticky footer buttons stay above home indicator: footer wrapper gets `pb-[env(safe-area-inset-bottom)]`.
  - Close (X) button gets `top-[max(0.75rem,env(safe-area-inset-top))]`.
- Audit and lightly adjust: `pitch-trip-dialog.tsx`, `invite-modal.tsx`, `unlock-trip-button.tsx`, event report dialog (in `events-map` / `console.events`), `bulk-confirm-dialog.tsx`, and any `AlertDialog` used for destructive flows — wrap long bodies in scrollable region, pin footers.

## 6. Replace native `confirm()`

- Grep `window.confirm` / `confirm(` across `src/`. Known offenders: `flights-tab.tsx` (duplicate flight), invite member removal in `attendees-card.tsx` or `invite-modal.tsx`.
- Replace each with `<AlertDialog>` using the standard destructive pattern from `bulk-confirm-dialog.tsx`. Extract a tiny `useConfirm()` hook in `src/hooks/use-confirm.tsx` if the pattern repeats 3+ times.

## 7. Bundle Leaflet markers locally

- `src/components/EventsMap.tsx`: remove `unpkg.com` icon URLs.
- Copy `marker-icon.png`, `marker-icon-2x.png`, `marker-shadow.png` from `leaflet/dist/images` into `src/assets/leaflet/`.
- Import them as ES modules; wire into `L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })`.
- Verify pins render offline / with CDN blocked.

## 8. Build warnings

- **`.inputValidator()` → `.validator()`**: bulk search-replace across all `*.functions.ts`. TanStack Start renamed the API; both work today but `.validator()` is the non-deprecated name. Verify types compile.
- **Bundle size**: identify top 3 offenders from `bun run build` output. Apply route-level dynamic import (`React.lazy` + Suspense) for:
  - `EventsMap.tsx` (Leaflet is heavy)
  - `pitch-trip-dialog.tsx` (only when opened)
  - `trip-pdf.ts` export path (already lazy? verify)
- Do NOT touch working chunks; only convert clear wins.

## Verification (run at the end)

- `bun install --frozen-lockfile` (npm equivalent — see item 3 note)
- `bun run lint`
- `bunx vitest run` → all 59 pass
- `bun run build` → 0 errors, warnings noted
- Dev server: Playwright headless at **390×844** — smoke `/`, `/auth`, `/pricing`, `/privacy`, `/terms`. Screenshot each; verify sticky section bar renders on `/trips/$id` at mobile width; open one dialog and confirm safe-area behavior.
- Signed-in flows (using `LOVABLE_BROWSER_AUTH_STATUS` if `injected`): create trip → invite join redirect → chatter post → add flight → add cost → settle → open unlock dialog. Skip gracefully if `signed_out`.

## Out of scope

- No copy or visual style changes beyond safe-area padding and the mobile section bar.
- No new features (Ratings, Loyalty, Credits stay deferred per Core memory).
- No RLS / DB / migration changes.
- No splitting of `trip-tabs.tsx` into per-tab files (separate refactor pass).

## Files touched (estimated)

- `src/routes/auth.tsx`, `src/routes/_authenticated/beta-consent.tsx`
- `src/lib/redirect-guard.ts` (+ `.test.ts` new)
- `vitest.setup.ts`, `vitest.config.ts`
- `bun.lock`, `package.json` (if drift)
- `src/components/trip-tabs.tsx`, `src/routes/_authenticated/trips.$id.tsx`
- `src/components/ui/dialog.tsx`, `src/components/ui/alert-dialog.tsx`
- `src/components/pitch-trip-dialog.tsx`, `invite-modal.tsx`, `unlock-trip-button.tsx`, `flights-tab.tsx`, `attendees-card.tsx`, `bulk-confirm-dialog.tsx`
- `src/components/EventsMap.tsx` (+ `src/assets/leaflet/*.png` new)
- Every `*.functions.ts` (`inputValidator` → `validator`)
- `src/hooks/use-confirm.tsx` (new, optional)

## Open question worth flagging now

Item 3 says `npm ci` / `package-lock.json`, but this repo is bun-only. **Default:** I'll sync `bun.lock` and treat that as the equivalent. Tell me if you actually want an npm lockfile added to the repo instead.

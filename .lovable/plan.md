
## 1. Pricing consistency (sidebar + landing)
- `src/routes/_authenticated.tsx` `ProUpsell`: replace "Unlimited crew · $9/mo" with the real model — "Free up to 5 · pay once per bigger trip" linking to `/pricing`; and a second variant "Organizer Plus · $35/yr" for power users. No "$9/mo" anywhere.
- `src/routes/index.tsx` landing: surface the free-tier line beside the hero CTA and link to `/pricing`. No new pricing copy invented — mirror the PDF.

## 2. Pitch-a-destination form (geocode on save, dates, drop best_months)
Migration: add `city text` to `public.destinations` (nullable). Keep `best_months` column for back-compat, stop writing/displaying it.

`NewTripDialog` in `src/routes/_authenticated/trips.index.tsx`:
- Fields: Title, City, Region, Country, Start date, End date, Image URL (optional), Why it slaps.
- Remove "Best months".
- After insert, call `geocodeDestination({ data: { destinationId }})` (existing server fn) — update it to prefer `city, region, country` for the Mapbox query.
- Card subtitle: replace `· best_months` with a date-derived season label (e.g. "Aug · late summer") computed from `start_date`.

## 3. Attendees list + remove member (owner)
RLS already allows owner DELETE on `trip_members`; no migration needed.

Two surfaces:
- `InviteModal` "Current crew" list: add a trash icon next to each non-owner row when viewer is owner → confirm → `delete from trip_members`.
- New `AttendeesCard` rendered in the trip header section of `trips.$id.tsx` (avatar stack + count, click opens the same modal). Solves "what does it look like when others are on the trip".

## 4. Auto-flip past trips by `end_date`
- DB already has `auto_close_trips()` SECURITY DEFINER fn. Call it opportunistically from the trips list loader via a tiny server fn `closeExpiredTrips` (auth-gated) — best-effort, swallow errors.
- Trip detail: rename the manual `Archive` button to **"Override: mark as past now"** / **"Override: reopen"** under a small "Trip status" disclosure. Add helper text: "Trips auto-close 1 day after end date."
- Trips index `Upcoming/Past` tab: also treat `end_date < today` as past in the client filter so the UI is immediately correct even before the cron-equivalent runs.

## 5. Install-App banner (dismissible, remembered)
- Remove `<InstallAppButton />` from the toolbar in `trips.index.tsx`.
- New `InstallAppBanner`: thin top-of-page card shown only when `beforeinstallprompt` fires AND localStorage `install-banner:dismissed !== "true"`. Has Install + Dismiss buttons; dismiss writes `"true"` (the "remember my choice").
- Mount once in `_authenticated.tsx` above `<Outlet />`.

## 6. Slim trip-detail header on non-Overview tabs
- `trips.$id.tsx` header currently shows a 16:8 image on every tab. Change to: full image only when `activeTab === "overview"`; on other tabs render a compact banner (h-20, image as background with gradient overlay, title + region + dates inline + Invite/Unlock pills). Same data, ~1/5 the height.

## 7. De-duplicate trip-section nav (sidebar only)
- Remove the `<TabsList>` mobile row in `trips.$id.tsx` (lines 253–261). Keep `<TabsContent>` panels. Navigation happens solely through the sidebar sub-items (which already drive `?tab=`).
- On mobile, the sidebar is the off-canvas drawer — already accessible via the `SidebarTrigger` in the header, so users still have one nav surface.

## 8. Rename "Mine" → "Profile"
- `src/routes/_authenticated.tsx` navItems: label `"Profile"`.
- `src/routes/_authenticated/me.tsx`: `crumbs={[{ label: "Profile" }]}`.

## 9. Vote button affordance
- Replace stacked arrow+count with a pill: `▲ Upvote · 12` (active state: filled). Wider tap target, reads as a button, count is clearly secondary. Apply on both trips index card and trip-detail header.

## 10. Copy / microcopy
- Landing: "Sign in" → **"Get started"** (`src/routes/index.tsx` line 44).
- Empty state in `trips.index.tsx`: replace "Were there people planning a tribe trip in your bathroom?" with **"Your crew's next move starts here."** + existing subline.
- Chatter header (`src/components/chatter.tsx` line 79): keep "Trip tips, flight finds, club intel. Discuss it all!" as the visible copy; move "Type @ to mention." into a tooltip on an `Info` icon next to it.

## Technical notes (skim-friendly)

- **Files touched**: `src/routes/_authenticated.tsx`, `src/routes/_authenticated/trips.index.tsx`, `src/routes/_authenticated/trips.$id.tsx`, `src/routes/_authenticated/me.tsx`, `src/routes/index.tsx`, `src/components/invite-modal.tsx`, `src/components/chatter.tsx`, `src/lib/geocode.functions.ts`. New: `src/components/install-app-banner.tsx`, `src/components/attendees-card.tsx`, `src/lib/trips-maintenance.functions.ts`.
- **Migration**: `ALTER TABLE public.destinations ADD COLUMN city text;` (no GRANT changes; column inherits table grants).
- **Server fns**: extend `geocodeDestination` to read `city`; add `closeExpiredTrips` wrapping `auto_close_trips()` RPC (auth required).
- **No removal** of `best_months` column or `InstallAppButton` component (component repurposed inside the banner).
- **Out of scope** for this pass (would balloon credits): full onboarding sequence, /events vs trip-events reconciliation, rebuilding `TripEventsStrip` filters, header back-button, route-level Suspense fallback.

Want me to proceed?

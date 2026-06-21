
# Pitch a Trip — redesign

Reframe the destination dialog from a database form into a persuasive, mobile-first trip proposal with a live preview card. Replace fixed dates with flexible planning (best time / length / budget), add vibes, audience, top 3 reasons, and a downsides field. Support cover photo upload OR URL fallback.

## Backend (already done in this turn)

- Migration adding `vibes text[]`, `special_note`, `trip_length`, `budget`, `reasons text[]`, `audience text[]`, `downsides`, `best_time` to `public.destinations`. Existing `start_date` / `end_date` / `best_months` / `region` / `city` columns stay (kept nullable) so existing trips, the auto-past logic, and geocoding don't break.
- Storage bucket `destination-covers` (private — workspace blocks public buckets) with RLS letting authenticated users upload to their own path and read all covers in the bucket. Cover uploads will be stored at `destination-covers/{userId}/{uuid}.{ext}`; after upload we mint a long-lived signed URL and save it to `image_url` so the existing `<img src={d.image_url}>` card path keeps working.

## New form structure

Replace `NewTripDialog` in `src/routes/_authenticated/trips.index.tsx` with a dedicated `PitchTripDialog` component (`src/components/pitch-trip-dialog.tsx`). Sectioned, scrollable inside the dialog; on mobile renders as a sheet-style full-height dialog.

1. **Destination**
   - Destination Name (required → `title`)
   - Country (required → `country`)
   - Optional one-liner City (→ `city`, fed into geocode)
2. **Cover Photo**
   - Drop/tap-to-upload (file input) → uploads to `destination-covers`, stores signed URL in `image_url`
   - "Or paste a URL" fallback input
   - Live thumbnail preview with replace/remove
3. **Vibe** — multi-select emoji chips (the 10 listed) → `vibes[]`
4. **Convince the Crew**
   - Why should we go? (required, textarea → `description`)
   - What makes this trip special? (optional, short text → `special_note`)
5. **Trip Planning**
   - Best Time to Go — month picker (Jan–Dec chips) → `best_time` (single string, e.g. "Aug" or "Summer")
   - Ideal Trip Length — segmented: Weekend / 4–5 Days / 1 Week / 10+ Days → `trip_length`
   - Budget — segmented: $ / $$ / $$$ / $$$$ → `budget`
6. **Highlights** — three numbered inputs → `reasons[]` (empty entries filtered out)
7. **Who Is This Trip For?** — multi-select chips → `audience[]`
8. **Things to Know** — optional textarea → `downsides`

Submit button copy: "Pitch it to the crew". Drop `start_date` / `end_date` / `region` from this form (kept as DB columns so existing data and the past-trip auto-flip still function; can be set later from the trip detail page).

## Live preview card

Right column on desktop (sticky), collapsed accordion on mobile ("Preview your pitch"). Renders a mini version of the real `TripCard`:

- Cover photo (or skeleton/fallback) with country pin chip
- Destination name + country
- Vibe chips (first 4 + "+N")
- Budget glyph + best time + trip length on one row
- Truncated pitch (2 lines)
- Top reasons as a checklist (✓ rows)

Updates in real time as fields change; uses the same tokens/styles as the trip card so it really previews "what your friends will see".

## Card + display updates

- `TripCard` in `trips.index.tsx`: show vibe chips (top 3) under the title; show budget glyph next to date subtitle when present. No layout overhaul — additive only.
- Trip detail header (`trips.$id.tsx`): show vibes + best time + budget + trip length in the meta row if present (additive, behind null-checks).

## Geocoding & past-trip logic

- `geocodeDestination` already uses `city, region, country` — unchanged; region simply absent now.
- `isEffectivelyPast` keeps working: trips without `end_date` are always "upcoming" until the owner explicitly marks past from the detail screen (the override toggle already added).

## Files

- New: `src/components/pitch-trip-dialog.tsx`
- New: `src/components/pitch-trip-preview.tsx` (preview card)
- Edit: `src/routes/_authenticated/trips.index.tsx` — swap `NewTripDialog`, add vibe + budget chips on `TripCard`
- Edit: `src/routes/_authenticated/trips.$id.tsx` — show new meta in header (optional, additive)

No removal of `best_months` / `start_date` / `end_date` columns. No new server function — upload happens client-side via the browser Supabase client + storage RLS.

## Open question (one)

Workspace blocks public storage buckets, so cover uploads use a **private bucket with long-lived signed URLs** (~10-year expiry minted at upload time and saved into `image_url`). Alternative: ask you to enable public buckets in workspace Settings → Privacy & Security so covers can use plain public URLs. Default to signed URLs unless you'd rather flip the workspace setting.

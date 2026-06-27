## Goal
Give admins a seamless "download → edit in Excel → upload to update" workflow for the `events` table, on the admin Events console.

## Where it lives
Extend `src/routes/_authenticated/console.events.tsx` (admin-gated) with two new controls next to the existing event list:
- **Download events (.xlsx)** button
- **Upload events (.xlsx)** button (file picker → preview diff → confirm apply)

No new route; keeps everything in the existing admin Events console.

## Download flow
New server fn `exportEvents` in `src/lib/events-admin.functions.ts` (admin-gated via existing `assertAdmin`):
- Selects all columns from `public.events` (id, name, description, start_date, end_date, city, region, country, url, source_url, image_url, tags, latitude, longitude, verified, confidence_notes).
- Returns rows as JSON.

Client converts to `.xlsx` using `xlsx` (SheetJS) — already widely used; add via `bun add xlsx`. Header row matches column names exactly. `id` column is included and acts as the upsert key. Filename: `tribe-events-YYYY-MM-DD.xlsx`.

A short instructions row is added as a second sheet "README" explaining: leave `id` blank for new rows, do not rename columns, dates must be `YYYY-MM-DD`, `verified` is TRUE/FALSE, `latitude`/`longitude` are numbers.

## Upload flow
1. User picks an `.xlsx` file. Client parses it with `xlsx` and normalizes rows (trim strings, coerce booleans/numbers, blank → null, dates → ISO `YYYY-MM-DD`).
2. Client calls new server fn `previewEventsImport({ rows })`:
   - Validates each row with Zod (same shape as existing `SaveInput`, `id` optional).
   - Splits into `inserts` (no id), `updates` (id matches existing row, diff non-empty), `unchanged`, and `errors` (per-row reason).
   - Returns summary counts + first ~50 diffs for preview.
3. UI shows a confirmation dialog: "X new, Y updated, Z unchanged, N errors" with a scrollable diff table and an "Apply changes" button.
4. On confirm, client calls `applyEventsImport({ rows })`:
   - Re-validates, then performs a single `upsert` on `public.events` with `onConflict: 'id'` using the admin-context supabase client (RLS already lets admins write via existing policies; if not, fn uses `assertAdmin` + admin client).
   - Returns final counts and any per-row failures.
5. Toast success + refresh `listAdminEvents` query.

## Safety
- Both new server fns are admin-only (`assertAdmin`).
- Hard cap: 2,000 rows per upload to keep payload small.
- No deletes from the spreadsheet path (removing a row in Excel does NOT delete from DB). Deletes stay in the existing admin UI.
- All-or-nothing is not required; per-row errors are reported but valid rows still apply (matches the "seamless" ask). This is called out in the confirmation dialog.

## Files touched
- `src/lib/events-admin.functions.ts` — add `exportEvents`, `previewEventsImport`, `applyEventsImport`.
- `src/routes/_authenticated/console.events.tsx` — add Download / Upload buttons + preview dialog.
- `package.json` — add `xlsx` dependency.

## Out of scope
- Bulk delete via spreadsheet.
- CSV format (xlsx only, per request).
- Schema changes to `events`.

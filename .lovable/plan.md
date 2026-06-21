# Flights tab refinements

## 1. Passenger name → required
- Mark the Passenger field with a required indicator and disable **Save flight** until it's filled.
- Update the `add` mutation guard so it errors on empty `passenger_name` (currently only airline/flight number is required).
- Default the field to the current user's display name (from `profiles`) so the common case is one tap.
- AI lookup keeps filling airline/route/times but never overwrites passenger.

## 2. Airport fields → autocomplete
- Replace the two plain `Input`s for **From / To** with a combobox (shadcn `Command` inside `Popover`) that searches a bundled IATA airport list by code, city, or airport name and stores the IATA code (e.g. `JFK`) while displaying `JFK · New York (John F. Kennedy Intl)`.
- Source: ship a small static JSON of the ~600 busiest airports under `src/data/airports.json` (keeps it offline, no API key, instant). Larger list can come later.
- When the AI / AviationStack lookup returns `depart_airport` / `arrive_airport`, resolve them through the same list so the combobox shows the rich label instead of a bare code.
- Keep free-text fallback for obscure fields (allow custom value if no match).

## 3. Confirmation # → drop from primary form
- Remove **Confirmation #** from the default form; it's rarely shared in a group context and adds noise.
- Keep the column in `trip_flights` (don't migrate) and expose it behind a small **"Add booking details"** disclosure that also reveals Notes. This keeps existing data visible and editable without cluttering the create flow.

## 4. Other refinements worth doing in the same pass
- **Date defaulting**: pre-fill `flight_date` with the trip's `start_date` for outbound and `end_date` if a previous flight on `start_date` already exists — cuts a tap for the common round-trip.
- **Time inputs**: today they're free `<input type="time">` with no timezone hint. Label them "Depart (local)" / "Arrive (local)" so people stop asking.
- **List grouping**: group the saved flights by date with a sticky day header, and sort passengers' flights together — easier to scan "who's landing when".
- **Empty + AI hero**: when there are zero flights, collapse the manual form by default and lead with the AI hero only; expand on "Enter manually". Reduces perceived complexity on first visit.
- **Duplicate guard**: warn (not block) on save if a flight with the same `flight_number` + `flight_date` + `passenger_name` already exists for the trip.
- **Delete confirmation**: the trash icon currently deletes instantly — wrap in an `AlertDialog` since flights are shared data.
- **Mobile**: the 2-column grid is cramped on small screens; switch to single-column under `sm` and group related fields (route together, times together) with subtle separators.

## Technical notes
- New file: `src/data/airports.json` + `src/components/airport-combobox.tsx` (reusable; also useful later for the pitch form).
- Edit: `src/components/flights-tab.tsx` for required-passenger, combobox integration, disclosure for confirmation/notes, date defaulting, grouped list, delete confirm.
- No DB migration; no server-function changes. `lookupFlight` already returns IATA codes, so the combobox just needs a resolver.
- Pull current user's name via the existing `useMe` hook to prefill passenger.

## Out of scope (call out, don't build now)
- Live status polling / gate changes (AviationStack already runs once on lookup; continuous polling would chew credits).
- Sharing flights as calendar invites (.ics export) — worth a follow-up.
- Seat map / aircraft type — not in `trip_flights` schema.

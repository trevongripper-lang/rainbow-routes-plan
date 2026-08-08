# Audit and harden free-plan 5-person headcount enforcement

## Goal
Confirm that the current "free trips are capped at 5 people" behavior is consistently enforced across every user path, with clear upgrade prompts, while keeping headcount automatic at trip creation.

## Current state (verified)
- Trip creation ("Pitch a trip") does **not** ask for group size. `destinations.headcount` defaults to 2.
- The 5-person cap is enforced in three places:
  1. Database trigger `check_headcount_cap` on `public.destinations` rejects `headcount > 5` for free/unlocked trips owned by non-Pro users.
  2. `redeem_trip_invite` blocks joining when `cur_count >= cap` and the trip is not unlocked and the owner is not legacy Pro.
  3. Costs tab UI caps the headcount input at 5 for free trips and surfaces an upgrade message.

## Work to do

### 1. Map every path that can grow a trip beyond 5 people
Check the following entry points and confirm each one either cannot exceed 5 or is gated by the same unlock prompt:
- Accepting an invite (`/join/$token` → `redeem_trip_invite`).
- Editing headcount in Costs tab (`src/components/trip-tabs.tsx`).
- Any bulk/management flows that insert `trip_members` directly.
- Any future API or server function that updates `destinations.headcount`.

### 2. Standardize user-facing copy
Ensure the free-plan cap message is the same everywhere:
- "Free plan trips are capped at 5 people. Unlock this trip or upgrade to Pro for larger crews."
- Replace older/legacy strings such as "Upgrade for larger crews" and "Organizer Plus" where they still appear.

### 3. Improve the join-page error experience
When `redeem_trip_invite` fails because the trip is full, the `/join/$token` page currently only shows a generic toast. Add an inline state that:
- Explains the trip has reached the free-plan limit.
- Points the user to contact the organizer or suggests upgrading.
- Does not allow retry until the organizer unlocks.

### 4. Add/update tests
- Database test: inserting a 6th member into a free, non-unlocked trip fails with the expected error.
- Database test: updating `destinations.headcount` to 6 on a free trip fails.
- UI test: Costs tab disables/saves headcount > 5 and shows the upgrade prompt.

### 5. Verify owner/co-organizer messaging
Confirm the "Free plan trips are capped at 5 people total" helper text in the invite modal and the "Unlock trip" CTA are visible to the right roles.

## Out of scope
- Changing the pricing model or tier amounts.
- Adding a headcount field to the pitch/creation flow.
- Removing the free-plan cap.

## Acceptance criteria
- A free trip cannot exceed 5 members through any user-facing path.
- Every block path shows the same, clear unlock/upgrade message.
- The join page surfaces the "trip full" state inline, not only as a toast.
- Existing tests pass and new tests cover the >5 scenarios.

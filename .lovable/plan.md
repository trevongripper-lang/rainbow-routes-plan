# Per-trip pricing — final spec

## Model

**Free tier stays:** trips with ≤5 members are always free, no unlock needed.

**Paid tier (organizer pays once):**

| Trip size (members) | Price |
|---|---|
| 6–10 | **$4.99** |
| 11–20 | **$9.99** |
| 21+   | **$19.99** |

- Charged to the **organizer** (trip owner) only. Guests never pay to RSVP or join.
- Unlock is per-trip and permanent. Adding more members later that pushes a trip into a higher tier triggers a **top-up charge** equal to the price difference.
- Subscription model (`profiles.is_pro`, `/pricing`) is **retired**. Repurpose `is_pro` as a legacy flag that grandfathers existing subscribers to unlimited unlocks; remove the Pro upsell UI.

## Credits

**Loyalty:** every **8 paid unlocks** grants the user **2 free unlock credits** (25% effective discount for power organizers). Counter resets every 8.

**Referral:** when a new user signs up via an invite link, they get **3 free organizer credits** — **only if the inviter has paid for ≥1 trip** at the moment of signup. One bonus per inviter→invitee pair.

**Credit usage:** auto-applied at checkout in cheapest-first order. Credits cover any tier (a credit on a $19.99 trip = $19.99 saved). User sees "1 free credit will be used — $0 due" before confirming.

## Anti-abuse

1. **Referral credits require a paying sponsor.** No paid trips by inviter → no credit. Prevents free-account chains from compounding.
2. **One referral bonus per (inviter, invitee) pair.** Enforced by unique constraint on the credit_events ledger.
3. **Credits are non-transferable, non-refundable.** Tied to `user_id`.
4. **Device/email fingerprinting:** out of scope for v1; rely on the "inviter must have paid" gate.
5. **Top-up rule** blocks the "create as 5-person free trip, then add 50 members" exploit.

## Schema (single migration)

New columns on `destinations`:
- `unlock_status text` — `'free' | 'paid' | 'credited'`, default `'free'`
- `unlock_tier text NULL` — `'tier1' | 'tier2' | 'tier3'`
- `unlocked_at timestamptz NULL`
- `unlocked_by uuid NULL` (FK profiles)
- `paid_amount_cents int NOT NULL DEFAULT 0`

New columns on `profiles`:
- `paid_trip_count int NOT NULL DEFAULT 0` (denormalized)
- `referred_by uuid NULL` (FK profiles, set at signup via invite token)

New tables:
- `user_credits(id, user_id, source 'loyalty'|'referral', remaining int, earned_at)` — RLS: owner read.
- `credit_events(id, user_id, kind 'earned_loyalty'|'earned_referral'|'spent', amount int, destination_id NULL, related_user_id NULL, created_at)` — append-only ledger. **Unique (kind='earned_referral', user_id, related_user_id)** to enforce one-per-pair.

Triggers / functions (security definer):
- `required_unlock_tier(member_count int)` → returns tier + cents.
- `unlock_destination(_dest, _use_credit bool)` → validates owner, computes tier, spends credit or records paid amount, sets unlock fields, bumps `paid_trip_count`, fires loyalty grant every 8.
- `topup_destination(_dest)` → called when member count crosses a tier boundary.
- `grant_referral_credits(_invitee, _inviter)` → only fires if inviter `paid_trip_count >= 1`; unique constraint blocks duplicates.
- Modify `redeem_trip_invite`: also call referral grant on first acceptance from a new user.
- Modify `check_headcount_cap`: free if `unlock_status != 'free'`, otherwise enforce 5-person cap (drop the `is_pro` branch).

## Server functions

`src/lib/unlock.functions.ts`:
- `quoteUnlock({ destinationId })` → returns `{ tier, priceCents, creditsAvailable, dueCents }`.
- `unlockTripWithCredit({ destinationId })` → applies credit, no Paddle call.
- `createUnlockCheckout({ destinationId })` → returns Paddle checkout URL with `destinationId` + `tier` in metadata.

`src/routes/api/public/paddle-webhook.ts`: on `transaction.completed`, call `unlock_destination` for the matching destination, mark `paid`, store `paid_amount_cents`.

## UI

1. **Trip detail page:** when adding the 6th member (or member count would push into a new tier), show **Unlock dialog**:
   - "This trip needs unlocking — 6 people → $4.99"
   - Shows credits available; auto-applies them
   - "Pay $4.99" → Paddle checkout, OR "Use 1 free credit"
2. **Invite acceptance:** if trip not unlocked and accepting would push to ≥6, block with "Organizer needs to unlock this trip first" (notify organizer).
3. **`/me` page:** "Your credits" panel — loyalty progress bar (`X / 8 paid trips → next 2 free`), referral credits remaining.
4. **`/pricing` page:** replace subscription cards with the tier table + credit rules.
5. **Remove:** Pro upsell badges, "Upgrade to Pro" CTAs, headcount-cap error messaging tied to `is_pro`.

## Implementation order

1. Migration (schema + functions + triggers + retire is_pro headcount logic).
2. Paddle: `recommend_payment_provider` → `enable_paddle_payments` → create 3 one-time products via `batch_create_product`.
3. Server fns: `unlock.functions.ts` + webhook route.
4. UI: unlock dialog, credits panel on `/me`, rewrite `/pricing`.
5. Backfill: existing trips with ≤5 members stay `free`; existing trips with >5 members get auto-`credited` (grandfathered) so nothing breaks.

## Not in this pass
- Refunds via Paddle portal (manual for now).
- Per-tier currency localization.
- Annual "organizer" subscription bundle.
- Anti-abuse fingerprinting beyond the paying-sponsor gate.

Approve and I'll execute top-to-bottom.

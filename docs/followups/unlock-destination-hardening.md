# Follow-up: harden `unlock_destination(_paid_cents)`

**Status**: open, not part of the SECURITY DEFINER audit ignore.

## Problem

`public.unlock_destination(_dest uuid, _use_credit boolean, _paid_cents integer)`
is EXECUTE-able by `authenticated` (owner-gated via `d.user_id = auth.uid()`).
Its paid branch trusts the client-supplied `_paid_cents` value and writes:

```sql
UPDATE public.destinations
  SET unlock_status = 'paid',
      unlock_tier   = t.tier,
      unlocked_at   = now(),
      unlocked_by   = d.user_id,
      paid_amount_cents = COALESCE(_paid_cents, t.cents)
  WHERE id = _dest;
UPDATE public.profiles SET paid_trip_count = paid_trip_count + 1 WHERE id = d.user_id;
```

Nothing in the function verifies that a Paddle transaction actually completed.
A trip owner can call the RPC directly with `_use_credit=false, _paid_cents=0`
and mark their trip `paid`, bypassing the paywall entirely, and get their
`paid_trip_count` incremented (which also affects loyalty credit grants).

Paddle webhook (`/api/public/paddle-webhook`, signature-verified) is the real
source of truth for money.

## Options

1. **Drop the paid branch from the RPC.** Keep only `_use_credit=true` as a
   client-callable path. Move all `unlock_status='paid'` writes into the
   Paddle webhook handler, which already has the transaction id, price id,
   and verified signature. This is the cleanest fix — client can't fake
   a payment because it can't reach the write path.

2. **Require a verified Paddle transaction id.** Change the signature to
   `unlock_destination(_dest, _use_credit, _paddle_txn_id text)`, verify
   the transaction id exists in `paddle_events` with a matching
   `destination_id` / owner and a completed status, and derive
   `_paid_cents` from `required_unlock_tier(headcount)` server-side.

Option 1 is preferred (fewer moving parts, no race between webhook and RPC).

## Verification once fixed

- Signed-in owner calling `supabase.rpc('unlock_destination', { _dest, _use_credit: false, _paid_cents: 0 })` directly from a browser console must NOT mark the trip paid.
- Paddle sandbox checkout end-to-end still unlocks the trip via the webhook.
- Credit-based unlock (`_use_credit=true`) still works.

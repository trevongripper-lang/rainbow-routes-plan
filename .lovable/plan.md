
## Scope

Six interlocking features. Building bottom-up: schema → server logic → UI.

---

### 1. Trip membership (foundation for everything else)

Today, a "trip" has one owner (`destinations.user_id`) and `headcount` is just a number. Almost every other feature in this request needs a real list of members, so I'll add that first.

**New tables**
- `trip_members(destination_id, user_id, role 'owner'|'member', joined_at)` — unique (destination_id, user_id). Backfill owner row for every existing trip.
- `trip_invites(id, destination_id, token, email NULL, invited_by, accepted_by NULL, expires_at, created_at)` — link invites have `email = NULL`, email invites store the recipient.

**RLS**: members can `SELECT` their own trip's members; owner can `INSERT`/`DELETE` members. Invites readable by token (via security-definer RPC) so unauthenticated viewers can preview before signing in.

**Headcount semantics**: `destinations.headcount` becomes the cap (free = 5). Actual seat count = `COUNT(trip_members)`. Block invite acceptance when seats are full.

---

### 2. Pricing & Stripe upgrade

- New public route `/pricing` with Free vs Pro cards. Pro = unlimited headcount + (room for more later).
- Add `profiles.is_pro` boolean + `stripe_customer_id`.
- Run `recommend_payment_provider` → `enable_stripe_payments` (user fills the form). I'll then create one Pro product ($9/mo) via `batch_create_product`, wire the checkout server fn, and webhook handler that flips `is_pro` on `checkout.session.completed` / `customer.subscription.deleted`.
- Headcount cap check moves to: `is_pro ? unlimited : 5`. Both the existing CHECK constraint and client validation get updated to consult `profiles.is_pro` via a security-definer function.

---

### 3. Threaded chatter + @mentions

- Add `comments.parent_id uuid NULL REFERENCES comments(id)` and `comments.mentions uuid[]` (array of mentioned user IDs).
- Chatter UI: top-level messages render with a "Reply" affordance; replies nest one level (Slack/Linear style — no deep nesting).
- `@` triggers a member picker (autocomplete over `trip_members` joined to `profiles`). On submit, parse `@displayName` tokens back to user IDs and store in `mentions`.
- Mentioned users see a highlighted notification (see #4).

---

### 4. Notifications

- `notifications(id, user_id, destination_id, kind, actor_id, payload jsonb, read_at NULL, created_at)`.
- Kinds: `cost_added`, `chatter_message`, `chatter_reply`, `chatter_mention`, `event_added`, `member_joined`, `trip_closed`.
- DB triggers fan-out: on `INSERT` into `trip_costs` / `comments` / `events` / `trip_members`, insert one notification row per *other* trip member.
- Bell icon in header → popover. **Grouped by trip**: one row per trip with a count badge (e.g. "Lisbon — 4 updates"). Clicking opens that trip and marks the group read.
- Realtime: subscribe to `notifications` filtered by `user_id` for live badge updates.

---

### 5. Invites (link + email)

- **Link**: owner clicks "Invite" → server fn creates `trip_invites` row → returns `/join/:token`. Public route shows trip preview + "Join trip" (auth-gated). Accepting inserts a `trip_members` row and marks invite accepted.
- **Email**: same flow but enter email(s). Requires email domain setup — I'll scaffold the transactional email function and surface the domain-setup dialog if not configured. If the user skips domain setup, the link path still works and the email field shows "Add email domain to enable".
- Owner UI: invite modal on trip detail page with "Copy link" + email input.

---

### 6. Auto-close at midnight UTC + open ratings

- Add `destinations.end_date date NULL` (currently no end date exists — `is_past` is manual). Owner sets it in trip detail.
- pg_cron job daily at 00:05 UTC: `UPDATE destinations SET is_past = true WHERE end_date IS NOT NULL AND end_date < (now() - interval '1 day')::date AND is_past = false`. Also fans out `trip_closed` notifications.
- Ratings tab is currently gated on `is_past`; this transition naturally opens it. Add a banner on the Ratings tab when freshly closed.

---

## Implementation order (single migration where possible)

1. **Migration A**: `trip_members`, `trip_invites`, `notifications`, `comments.parent_id` + `comments.mentions`, `destinations.end_date`, `profiles.is_pro` + `stripe_customer_id`, all GRANTs/policies, triggers, security-definer `is_trip_member()` helper, backfill owner rows, updated headcount CHECK using `is_pro`.
2. **Migration B**: pg_cron job for auto-close.
3. **Stripe**: `recommend_payment_provider` → `enable_stripe_payments` (user form) → `batch_create_product` → checkout server fn + webhook route.
4. **Code**: `/pricing` route, invite modal + `/join/:token` route, notifications bell, threaded chatter with mention picker, ratings banner.
5. **Email**: scaffold transactional email function for invites; if no domain configured, show setup dialog.

## What I'm NOT doing in this pass
- Real-time presence / typing indicators in chatter.
- @everyone or channel-style mentions.
- Configurable per-user notification preferences (all-on by default).
- Stripe customer portal (just checkout + webhook is enough to flip the flag).

If anything in here is wrong, push back before I start. Otherwise I'll execute top-to-bottom.

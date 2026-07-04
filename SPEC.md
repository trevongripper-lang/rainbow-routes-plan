# App Spec

> Fill this in before writing code. The AI reads this first and uses it to make consistent decisions across the codebase. Keep it under one page per section — link out for detail.

---

## 1. One-liner

**App name:** <!-- e.g. Tribe Trips -->
**Tagline (≤10 words):** <!-- e.g. Plan group trips without the group chat chaos -->
**Elevator pitch (2–3 sentences):**
<!-- Who it's for, what it does, why it's better than the status quo. -->

**Success looks like:** <!-- one metric — e.g. "10 paying trips in 30 days" -->

---

## 2. Users & roles

| Role | Who they are | Can do | Cannot do |
|------|--------------|--------|-----------|
| `anon` | Not signed in | Browse marketing, sign up | Anything authenticated |
| `user` | Signed-in default | <!-- core actions --> | <!-- admin actions --> |
| `admin` | Internal ops | Everything + console | — |
| <!-- add more --> | | | |

**Auth methods:** email/password, Google OAuth <!-- add/remove -->
**Sign-up flow:** open / invite-only / waitlist
**Multi-tenant?** no / yes (by `org_id`)

---

## 3. Core entities

For each entity: purpose, key fields, ownership, RLS rule in plain English.

### `entity_name`
- **Purpose:** <!-- what it represents -->
- **Key fields:** `id`, `owner_id`, `created_at`, <!-- domain fields -->
- **Owned by:** user / org / system
- **Who can read:** <!-- e.g. owner + members via junction table -->
- **Who can write:** <!-- e.g. owner only -->
- **Lifecycle:** created when… archived when… deleted when…

### `entity_name_members` (junction, if applicable)
- Links `entity_name` ↔ `user`, with a `role` enum.

<!-- Repeat per entity. Aim for 3–7 core entities. If you have more, you're probably overscoping MLP. -->

---

## 4. Routes

Public (crawlable, own `head()` metadata):
- `/` — landing
- `/pricing`
- `/privacy`, `/terms`
- `/auth`, `/recover`, `/reset-password` (noindex)
- <!-- add marketing/content routes -->

Authenticated (`_authenticated/*`, noindex):
- `/app` or `/<entity>` — primary dashboard
- `/<entity>/$id` — detail view
- `/settings`, `/me`
- <!-- add -->

Admin (`_authenticated/console/*`, role-gated):
- `/console/users`
- `/console/analytics`
- <!-- add -->

Webhooks / public API (`/api/public/*`, signature-verified):
- `/api/public/<provider>-webhook`

---

## 5. Key flows

Describe the 3–5 flows that define the product. Each: trigger → steps → success state → failure modes.

### Flow: <!-- e.g. Create and share a trip -->
1. User does X
2. System does Y (server fn: `createX`)
3. Notification/email fires
4. Success: user lands on Z
5. Failure: <!-- validation, quota, payment -->

<!-- Repeat. If a flow can't be described in 5 bullets it's two flows. -->

---

## 6. Monetization

**Model:** free / freemium / per-seat / per-use / one-time
**Provider:** Paddle / Stripe / none
**Free tier limits:** <!-- e.g. up to 5 members per trip -->
**Paid unlocks:** <!-- what changes when they pay -->
**Entitlements stored in:** `entitlements` table keyed by `user_id` or `<entity>_id`

---

## 7. AI features (if any)

For each AI-powered feature:
- **Feature:** <!-- e.g. Smart-add: parse free text into structured event -->
- **Input:** <!-- text / image / voice -->
- **Output:** <!-- structured object, streaming chat, etc. -->
- **Model:** Lovable AI Gateway default (`google/gemini-2.5-flash`) unless specified
- **Rate limit:** <!-- per user per day -->
- **Fallback if it fails:** <!-- manual form -->

---

## 8. Notifications & email

**Transactional emails:** signup confirm, password reset, invite, <!-- add -->
**In-app notifications:** <!-- events that ring the bell -->
**From address:** `hello@<domain>`
**Domain auth:** SPF + DKIM required before launch

---

## 9. Integrations

| Service | Purpose | Secret name | Optional? |
|---------|---------|-------------|-----------|
| <!-- e.g. Google Maps --> | geocoding | `GOOGLE_MAPS_API_KEY` | no |
| | | | |

---

## 10. Design direction

**Theme:** dark / light / both
**Mood (3 words):** <!-- e.g. minimal, warm, confident -->
**Reference apps:** <!-- 1–3 apps whose feel you want -->
**Primary color:** `#______`  **Accent:** `#______`
**Fonts:** headings `______`, body `______` (no default Inter/Poppins unless asked)
**Avoid:** <!-- generic AI purple gradients, stock hero layouts, etc. -->

---

## 11. Out of scope for MLP

List explicitly. Prevents scope creep and tells the AI what NOT to build.
- <!-- e.g. Mobile native app -->
- <!-- e.g. Ratings / reviews -->
- <!-- e.g. Multi-language -->

---

## 12. Launch checklist

- [ ] All public routes have unique `head()` metadata + canonical
- [ ] RLS enabled + GRANTs on every public table
- [ ] Auth emails send from custom domain with SPF/DKIM
- [ ] Legal pages filled in (not placeholder)
- [ ] Payment webhook verified end-to-end in sandbox
- [ ] Error capture + analytics wired
- [ ] `robots.txt` + sitemap
- [ ] One real user completed the primary flow

---

## 13. Open questions

Things you haven't decided yet. The AI should ask about these before implementing.
- <!-- e.g. Do invited members need an account or can they view read-only via token? -->

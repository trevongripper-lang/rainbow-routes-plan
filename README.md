# Tribe Trips

Plan group trips together — pitch destinations, vote, chat, track flights/stays/tickets, split costs, and discover events near your dates.

This is a **web app** that also installs to a phone home screen as a PWA. No App Store build yet.

## Links

- **GitHub repository:** https://github.com/trevongripper-lang/rainbow-routes-plan
- **Live (published):** https://rainbow-routes-plan.lovable.app
- **Preview (editor):** https://id-preview--938ee2e4-e28c-4f9a-80fb-c8ac6ff9fb0b.lovable.app

## Key setup files

- [`README.md`](./README.md) — this file (setup, deploy, accounts, env vars)
- [`AUDIT.md`](./AUDIT.md) — feature-by-feature beta readiness audit
- [`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md) — must-fix, nice-to-have, risks, mobile/PWA matrix
- [`.env`](./.env) — non-secret client config (publishable Supabase keys)
- [`package.json`](./package.json) — scripts and dependencies
- [`vite.config.ts`](./vite.config.ts) — Vite + TanStack Start config
- [`vitest.config.ts`](./vitest.config.ts) — test runner config
- [`eslint.config.js`](./eslint.config.js) — lint rules
- [`supabase/migrations/`](./supabase/migrations/) — database schema history (applied automatically by Lovable Cloud)
- [`supabase/config.toml`](./supabase/config.toml) — Supabase project config (auto-managed)
- [`src/routes/__root.tsx`](./src/routes/__root.tsx) — root layout, head tags, PWA manifest links
- [`public/manifest.webmanifest`](./public/manifest.webmanifest) — PWA install manifest
- [`src/integrations/supabase/`](./src/integrations/supabase/) — auto-generated DB client and types (do not edit)

- [`docs/Tribe-SPEC.md`](./docs/Tribe-SPEC.md) — product spec (authoritative)

---

## What's in the box

- **Frontend:** React 19 + TanStack Start (SSR on Cloudflare Workers) + Tailwind v4 + shadcn/ui
- **Backend:** Lovable Cloud (managed Supabase) — Postgres + Auth + Storage + Row-Level Security
- **Payments:** Paddle (sandbox today, switch keys to go live)
- **Email auth + Google OAuth** out of the box

---

## Beta testing notes

Tribe Trips is in a **private beta**. A few things testers should know:

- **U.S.-only preferred** for the first wave (timezone / payments / events coverage).
- **Testers must be 18+** — confirmed at the in-app `/beta-consent` screen on first sign-in.
- **Screen recordings, voice narration, and written feedback are reviewed by the founder
  and a small group of analysts** — and only with the tester's explicit consent.
- **Payments are sandbox / test-only** during beta. No real cards are charged.
- **Do not enter sensitive information** (payment cards, passport details, real
  confirmation numbers, private addresses, health information). Use placeholders.
- **Retention:** beta feedback and recordings are kept up to 6 months and then deleted.
- **Deletion requests:** email `hello@tgklabs.io`.

Full tester onboarding lives in [`BETA_TESTER_INSTRUCTIONS.md`](./BETA_TESTER_INSTRUCTIONS.md).



## Running locally

Recommended: Node.js 18+ and `npm` (Bun is supported but `npm` is the primary workflow here).

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run build        # production build (Cloudflare Worker bundle)
npm run preview      # preview the production build
npm run lint         # ESLint
npm run format       # Prettier --write
npx vitest run       # unit + accessibility tests
```

The dev server reads `.env` (see below).

---

## Deploying

The simplest path: click **Publish** in the Lovable editor. That ships both the frontend bundle and the Worker SSR runtime to a `*.lovable.app` URL. A custom domain can be attached afterwards from **Project settings → Domains**.

Database migrations live in `supabase/migrations/` and are applied automatically through Lovable Cloud — there's nothing to deploy by hand.

---

## Accounts & services you need

| Service | Why | How to get a key |
| --- | --- | --- |
| **Lovable Cloud** | Database, auth, storage, server functions | Comes with the Lovable project — nothing to sign up for |
| **Google Cloud OAuth** | Google sign-in | Console → Credentials → OAuth Client ID (Web). Add the published origin + `https://<project>.lovable.app` as redirect URIs |
| **Paddle** | Trip-unlock payments | Sandbox keys today. Production keys before charging real money |
| **Mapbox** | Map tiles on the Events map | mapbox.com → access token (public scope) |
| **Aviationstack** | Flight number lookup | aviationstack.com (free tier OK for beta) |
| **Serpstack** | Image search for trip covers | serpstack.com (free tier OK for beta) |

All of the above are optional except Lovable Cloud — features degrade gracefully if a key is missing.

---

## Environment variables

Secrets live in **Lovable Cloud → Project secrets** (or local `.env` for `bun run dev`). Never commit real values. The current keys are:

**Client-visible (safe in the bundle):**

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

**Server-only (never expose):**

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS, used only by webhooks/admin paths
- `SUPABASE_DB_URL`
- `PADDLE_CLIENT_TOKEN` — used client-side too (publishable)
- `PADDLE_WEBHOOK_SECRET` — verifies Paddle webhook signatures
- `PADDLE_PRICE_TIER1`, `PADDLE_PRICE_TIER2`, `PADDLE_PRICE_TIER3`
- `MAPBOX_TOKEN`
- `AVIATIONSTACK_API_KEY`
- `SERPSTACK_API_KEY`
- `LOVABLE_API_KEY` — Lovable AI Gateway (image search fallback, summaries)

The Paddle webhook endpoint is `/api/public/paddle-webhook`.

---

## Project layout

```
src/
  routes/                 file-based routing (TanStack Router)
    _authenticated/       signed-in subtree (auto-gated)
    api/public/           webhooks & cron endpoints (no auth)
  components/             UI components
  lib/                    business logic + *.functions.ts (server fns)
  integrations/supabase/  managed Supabase clients (do not edit)
supabase/migrations/      database schema history
```

See `AUDIT.md` for the current state of every feature and `BETA_CHECKLIST.md` for what to verify before opening the beta.

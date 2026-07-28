# Stage 3 — Observation Window Baseline (T0)

**Observation start (UTC):** 2026-07-28T11:48:56Z
**Production DB ref:** oohyehpikrweipgdxpxd
**Domains observed:** https://jointribetrips.com, https://plantribetrips.lovable.app
**Expand migration applied:** 2026-07-28 (Stage 3 EXPAND, this session)
**Contract migration:** NOT applied (held for post-observation approval)
**Application build:** Phase B (tested repo build) — published by user immediately prior to T0

## T0 endpoint probes

| Probe | Result | Expectation |
|---|---|---|
| `GET  https://jointribetrips.com/` | HTTP 200, ttfb 1.10s | site serves ✓ |
| `GET  https://plantribetrips.lovable.app/` | HTTP 302 (canonical redirect) | expected ✓ |
| `GET  /api/public/paddle-webhook` | HTTP 200 | route reachable ✓ |
| `POST /api/public/paddle-webhook` (no signature) | HTTP **401** — `Missing signature parts` | signature enforcement intact ✓ |

## T0 published Worker logs (last hour, filtered)

- `paddle` filter → only the two probe requests above (GET 200, POST 401). No live Paddle traffic in the window.
- `unlock_destination` filter → no log entries.
- `error` filter → no Worker errors; only local sandbox `dev` exit noise (unrelated to production).

## T0 `paddle_events` snapshot (production)

| Metric | Value |
|---|---|
| total_events | 5 |
| success_events | 2 |
| failed_events | 3 |
| pending_events | 0 |
| events_last_hour | 0 |
| last_processed_at | 2026-06-22 06:24:27 UTC (pre-EXPAND historical) |

Status backfill from EXPAND migration is present and coherent (no orphan `pending` with side effects).

## Verified invariants at T0

- ✅ Legacy `unlock_destination(uuid,boolean,integer)` EXECUTE restricted to `postgres`/`service_role` only; `PUBLIC`/`anon`/`authenticated` cannot execute.
- ✅ `unlock_destination_paid(uuid,int,text)` — service-role only.
- ✅ `unlock_destination_with_credit(uuid)` — `authenticated`; identity derived from `auth.uid()` inside body.
- ✅ `process_paddle_unlock_event(...)` — service-role only; advisory-lock idempotency in source.
- ✅ `payments_enabled()` check present at top of both new unlock RPCs.
- ✅ Published Worker source (repo HEAD) calls only:
  - `process_paddle_unlock_event` from `src/routes/api/public/paddle-webhook.ts`
  - `unlock_destination_with_credit` from `src/lib/unlock.functions.ts`
  - No repo references to the legacy `unlock_destination(_use_credit,...)` signature remain in application code.

## Watch list for the 24h window

- Legacy RPC call count in Worker logs (must remain zero).
- `function ... does not exist` errors (must remain zero).
- Paddle webhook 5xx rate (must not rise abnormally vs baseline).
- 401 on unsigned/invalid signatures (must persist).
- Duplicate `event_id` → 2xx `outcome:duplicate` (verify on first live delivery).
- Failed events remain retryable (`status='failed'` never coexists with unlock side effects).

## Rollback triggers (do NOT re-grant legacy to `authenticated`)

1. Set `app_config.payments_enabled=false` to halt payment mutations.
2. Republish prior application build (legacy RPC still reachable via `supabaseAdmin`/service_role).
3. Leave CONTRACT unapplied.

---

Follow-up evidence file `stage3-observation-report.md` will be added at T0+24h with a go/no-go recommendation for CONTRACT.

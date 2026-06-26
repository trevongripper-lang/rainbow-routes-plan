## Status snapshot

**Everything functioning:** ✅
- Live site (jointribetrips.com): `/`, `/auth`, `/pricing`, `/privacy`, `/terms` all return 200, correct titles, zero console errors.
- Tests: **59/59 passing** across 7 files.
- Typecheck: clean.
- Lovable Cloud backend: healthy.
- Security scan: **0 findings** across supabase, supabase_lov, supply_chain, and connector scanners.

**One regression introduced recently:** ⚠️
- **Lint: 466 errors / 14 warnings** (was ~20 before). The bulk is **prettier formatting in `src/routes/lovable/email/queue/process.ts`** from the email-infra work — single vs double quotes and missing semicolons. 458 are auto-fixable with `eslint --fix`. No behavior impact, but it will block any CI gate that runs lint.

## Outstanding items (from `BETA_CHECKLIST.md`)

37 unchecked, 6 done. Grouped by who has to act:

### Needs code/agent work (I can do)
1. Fix the 466 lint errors (`eslint --fix`, then hand-clean the residual ~8).
2. Remove two obsolete `@next/next/no-img-element` rule references in `eslint.config.js`.
3. Resolve `react-hooks/exhaustive-deps` warnings in `EventsMap.tsx` and `trips.$id.tsx`.
4. Pin `search_path` on the remaining `SECURITY DEFINER` helpers flagged by Supabase advisors (separate from the 0-finding scanner above).
5. Decide on and either ship or drop deferred Ratings / Credits / Loyalty schema.

### Needs your action (config / dashboards / manual QA — I can't do)
6. **Switch Paddle from sandbox to production keys** + re-run one unlock end-to-end.
7. Confirm Google OAuth client has prod redirect URLs (Lovable subdomain + custom domain).
8. Enable HIBP leaked-password check, disable anonymous sign-ups (Cloud → Auth Settings).
9. Live-device PWA smoke matrix (iPhone Safari, iPhone PWA, Android Chrome, desktop) — 6 checklist rows.
10. Beta cohort confirmation: 18+ ack, recording consent, recordings stored in restricted Drive.
11. Events curation pass: coordinates audit, verified pass, stale-event sweep in `/console/events`.

### Verification rows (mostly already implemented — just need a tester to tick them)
12. Consent-gate analytics, auth analytics, page-load timing, redirect-loop guard, offline toast, build-label chip, error boundary — all 7 are wired; they just need one live tester to confirm the events land in `analytics_events`.

## Proposed next step

Run lint auto-fix + hand-clean the email queue file, drop the dead eslint rule refs, and address the two `exhaustive-deps` warnings. That gets lint back to green and is the only true regression. The rest is either your-side ops work or tester verification — I'll list those in chat so you can route them.

### Technical detail (for the cleanup work)

- `bunx eslint . --fix` will resolve ~458 prettier/quote/semicolon errors.
- Residual `no-explicit-any` and empty-catch errors will need manual narrowing or `// eslint-disable-next-line` with a reason.
- `eslint.config.js`: drop the two `@next/next/no-img-element` entries (Next.js plugin not installed).
- `EventsMap.tsx` / `trips.$id.tsx`: add the missing deps or wrap with `useCallback` — review case by case.
- DB advisors: `ALTER FUNCTION ... SET search_path = public, pg_temp` on each remaining flagged function.

No production deploy required for the lint cleanup itself; publish only once items 1–5 are batched.
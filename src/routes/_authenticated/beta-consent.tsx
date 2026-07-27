import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy alias. The canonical consent capture route is now `/auth/consent`
 * (public), so the protected gate no longer needs a pathname bypass.
 *
 * We keep this file so bookmarked/emailed `/beta-consent` links keep
 * working — it just performs a permanent client-side redirect that
 * preserves the `next` and `reason` search params.
 */
type LegacySearch = { next?: string; reason?: string };

export const Route = createFileRoute("/_authenticated/beta-consent")({
  validateSearch: (s: Record<string, unknown>): LegacySearch => ({
    next: typeof s.next === "string" ? s.next : undefined,
    reason: typeof s.reason === "string" ? s.reason : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/auth/consent",
      search: {
        next: search.next,
        reason: search.reason,
      },
      replace: true,
    });
  },
  component: () => null,
});

import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy · Tribe Trips" },
      {
        name: "description",
        content: "How Tribe Trips collects, uses, and protects your data during the beta.",
      },
      { property: "og:title", content: "Privacy Policy · Tribe Trips" },
      {
        property: "og:description",
        content: "How Tribe Trips handles your data.",
      },
      { property: "og:type", content: "article" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
        Beta · Last updated June 23, 2026
      </p>
      <h1 className="font-display text-3xl">Privacy Policy</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Tribe Trips ("we", "us") is a beta product. This page explains, in plain language, what we
        collect and why.
      </p>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">What we collect</h2>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">Account info:</strong> email, name, optional avatar,
            and login provider (email/password or Google).
          </li>
          <li>
            <strong className="text-foreground">Trip content you create:</strong> destinations,
            dates, members, chat messages, polls, flights, stays, costs, and settlements.
          </li>
          <li>
            <strong className="text-foreground">Payments (when you unlock a trip):</strong> handled
            by Paddle. We never see or store your card details — only the success/failure result.
          </li>
          <li>
            <strong className="text-foreground">Basic logs:</strong> error reports and anonymous
            usage events so we can fix bugs.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">How we use it</h2>
        <p className="text-muted-foreground">
          To run the app: authenticate you, show your trips, deliver invites and notifications,
          calculate balances, and process unlock payments. We do not sell your data.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Who can see your data</h2>
        <p className="text-muted-foreground">
          Trip data is visible to members of that trip. Profile name and avatar are visible to
          people you share a trip with. Database access is restricted by row-level security.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Subprocessors</h2>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>Supabase (database, auth, storage)</li>
          <li>Cloudflare (hosting / edge)</li>
          <li>Paddle (payments)</li>
          <li>Google (optional sign-in)</li>
          <li>Mapbox (maps)</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Your choices</h2>
        <p className="text-muted-foreground">
          You can edit your profile, leave trips, or delete your account at any time from Settings.
          Deleting your account removes your profile and authored content; trip records you co-own
          may be retained for the other members.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Contact</h2>
        <p className="text-muted-foreground">
          Questions or requests? Email{" "}
          <a className="underline" href="mailto:hello@tribetrips.app">
            hello@tribetrips.app
          </a>
          .
        </p>
      </section>

      <p className="mt-10 text-xs text-muted-foreground">
        This is a beta policy and may change before general availability. We will notify signed-in
        users by email of material changes.
      </p>

      <div className="mt-8 flex gap-4 text-sm">
        <Link to="/terms" className="underline">
          Terms of Service
        </Link>
        <Link to="/" className="underline">
          Home
        </Link>
      </div>
    </div>
  );
}

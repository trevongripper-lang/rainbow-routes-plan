import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service · Tribe Trips" },
      {
        name: "description",
        content: "The terms that govern your use of the Tribe Trips beta.",
      },
      { property: "og:title", content: "Terms of Service · Tribe Trips" },
      {
        property: "og:description",
        content: "Beta terms for using Tribe Trips.",
      },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://jointribetrips.com/terms" },
    ],
    links: [{ rel: "canonical", href: "https://jointribetrips.com/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="safe-top safe-bottom mx-auto max-w-3xl px-6 py-12">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
        Beta · Last updated June 23, 2026
      </p>
      <h1 className="font-display text-3xl">Terms of Service</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Welcome to Tribe Trips. By creating an account you agree to these simple beta terms.
      </p>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Private beta</h2>
        <p className="text-muted-foreground">
          Tribe Trips is currently in a private beta. That means a few honest things up front:
        </p>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>You may run into bugs, incomplete features, downtime, or occasional data issues.</li>
          <li>
            Payments are <strong className="text-foreground">test-only (sandbox)</strong> right now
            — no real cards are charged. When we go live we'll say so clearly.
          </li>
          <li>
            Beta testers must be <strong className="text-foreground">18 or older</strong>.
          </li>
          <li>
            Please don't enter sensitive personal, financial, travel-document, or health information
            while testing — use placeholders or fake data where possible.
          </li>
          <li>
            Participation is voluntary. You can stop testing, stop recording, or delete your account
            at any time.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Your account</h2>
        <p className="text-muted-foreground">
          You are responsible for the activity on your account. Keep your password secret. Tell us
          right away if you suspect unauthorized access.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Acceptable use</h2>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>Don't break the law or harass other members.</li>
          <li>Don't try to access data that isn't yours.</li>
          <li>Don't upload spam, malware, or illegal content.</li>
        </ul>
        <p className="text-muted-foreground">
          We may suspend or remove accounts that violate these rules.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Payments</h2>
        <p className="text-muted-foreground">
          Unlocking a trip is a one-time payment processed by Paddle, our merchant of record. Free
          trips support up to 5 members. Paid unlocks are non-refundable except where required by
          law.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Content you create</h2>
        <p className="text-muted-foreground">
          You own the content you add to your trips. You grant us a limited license to store and
          display it so the app can work for you and your co-travelers.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Disclaimer</h2>
        <p className="text-muted-foreground">
          The service is provided "as is" during beta. We don't guarantee uptime, accuracy, or
          fitness for any particular purpose. To the maximum extent allowed by law, our liability is
          limited to the amounts you paid us in the prior 12 months.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Changes</h2>
        <p className="text-muted-foreground">
          We may update these terms as the product evolves. Material changes will be announced by
          email or in-app notice.
        </p>
      </section>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-xl">Contact</h2>
        <p className="text-muted-foreground">
          Reach us at{" "}
          <a className="underline" href="mailto:hello@tribetrips.app">
            hello@tribetrips.app
          </a>
          .
        </p>
      </section>

      <div className="mt-8 flex gap-4 text-sm">
        <Link to="/privacy" className="underline">
          Privacy Policy
        </Link>
        <Link to="/" className="underline">
          Home
        </Link>
      </div>
    </div>
  );
}

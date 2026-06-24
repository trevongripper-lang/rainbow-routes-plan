import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Smartphone,
  User,
  ShieldCheck,
  FileText,
  MessageCircle,
  LogOut,
  CheckCircle2,
  Wrench,
  ChevronRight,
  Mail,
} from "lucide-react";
import { InstallAppButton } from "@/components/install-app-banner";
import { BETA_CONSENT_VERSION, hasBetaConsentLocal } from "@/lib/beta-consent";

const SUPPORT_EMAIL = "hello@tgklabs.io";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Tribe Trips" },
      { name: "description", content: "Manage your Tribe Trips app, account and beta access." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const isAdmin = useQuery({
    queryKey: ["me", "is-admin"],
    queryFn: async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return false;
      const { data } = await supabase.rpc("has_role", {
        _user_id: s.session.user.id,
        _role: "admin",
      });
      return !!data;
    },
    staleTime: 60_000,
  });

  const qc = useQueryClient();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  const consented = typeof window !== "undefined" ? hasBetaConsentLocal() : true;

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">App, account and beta info.</p>
        </div>
        <span
          className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
          title="Beta build — share this when reporting a bug"
        >
          Beta build: {BETA_CONSENT_VERSION}
        </span>
      </header>

      {/* Install */}
      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Smartphone className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-lg">Install app</h2>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                Add Tribe Trips to your home screen for a faster, full-screen experience. Works on
                iPhone, iPad, Android, and desktop Chrome/Edge.
              </p>
            </div>
          </div>
          <InstallAppButton />
        </div>
      </section>

      {/* Account */}
      <section className="rounded-2xl border border-border/60 bg-card p-2">
        <SettingsRow
          to="/me"
          icon={<User className="size-5" />}
          title="Profile & account"
          subtitle="Display name, email, plan, delete account"
        />
      </section>

      {/* Beta */}
      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg">Beta access</h2>
              {consented ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="size-3 text-emerald-500" /> Consent on file
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Consent pending
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Consent version{" "}
              <span className="font-mono text-foreground">{BETA_CONSENT_VERSION}</span>.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link to="/beta-consent" className="text-primary hover:underline">
                Review beta agreement
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Legal */}
      <section className="rounded-2xl border border-border/60 bg-card p-2">
        <SettingsRow to="/privacy" icon={<FileText className="size-5" />} title="Privacy Policy" />
        <Divider />
        <SettingsRow to="/terms" icon={<FileText className="size-5" />} title="Terms of Service" />
      </section>

      {/* Support */}
      <section className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MessageCircle className="size-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg">Contact & feedback</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Found a bug or have a suggestion? We read every message.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Tribe%20Trips%20feedback%20(${encodeURIComponent(
                  BETA_CONSENT_VERSION,
                )})`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:border-primary/50"
              >
                <Mail className="size-3.5" /> Email support
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Tribe%20Trips%20bug%20report%20(${encodeURIComponent(
                  BETA_CONSENT_VERSION,
                )})&body=What%20happened%3A%0A%0AWhat%20you%20expected%3A%0A%0ASteps%20to%20reproduce%3A%0A`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:border-primary/50"
              >
                <MessageCircle className="size-3.5" /> Report a bug
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Admin-only */}
      {isAdmin.data && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-2">
          <SettingsRow
            to="/console/diagnostics"
            icon={<Wrench className="size-5" />}
            title="Diagnostics (admin)"
            subtitle="Integrations, RLS smoke tests, webhooks"
          />
        </section>
      )}

      {/* Sign out */}
      <section className="rounded-2xl border border-border/60 bg-card p-2">
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-xl p-4 text-left text-destructive transition hover:bg-destructive/5"
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/10">
            <LogOut className="size-5" />
          </div>
          <div className="flex-1 font-medium">Sign out</div>
        </button>
      </section>
    </div>
  );
}

function Divider() {
  return <div className="mx-4 h-px bg-border/60" />;
}

function SettingsRow({
  to,
  icon,
  title,
  subtitle,
}: {
  to: "/me" | "/privacy" | "/terms" | "/console/diagnostics";
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl p-4 transition hover:bg-muted/40">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

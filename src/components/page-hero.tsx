import { Link } from "@tanstack/react-router";
import { ChevronRight, Home, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type Crumb = {
  label: string;
  to?: string;
  params?: Record<string, string>;
};

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Link
        to="/trips"
        className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 px-2.5 py-1 backdrop-blur transition hover:text-foreground"
      >
        <Home className="size-3" />
        <span>Home</span>
      </Link>
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1.5">
            <ChevronRight className="size-3 text-muted-foreground/60" />
            {last || !c.to ? (
              <span className={last ? "rounded-full bg-primary/15 px-2.5 py-1 text-primary" : ""}>
                {c.label}
              </span>
            ) : (
              <Link
                to={c.to}
                params={c.params as never}
                className="rounded-full px-2.5 py-1 hover:bg-card/60 hover:text-foreground"
              >
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function PageHero({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  highlight,
  description,
  actions,
  crumbs,
}: {
  eyebrow?: string;
  eyebrowIcon?: LucideIcon;
  title: ReactNode;
  highlight?: string;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <header className="rounded-3xl border border-border/60 bg-card/30 p-6 backdrop-blur md:p-10">
      {crumbs && crumbs.length > 0 && (
        <div className="mb-5">
          <Breadcrumbs items={crumbs} />
        </div>
      )}
      {eyebrow && (
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          {EyebrowIcon ? <EyebrowIcon className="size-3.5 text-accent" /> : null}
          {eyebrow}
        </p>
      )}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl leading-[1.05] md:text-5xl lg:text-6xl">
            {title}
            {highlight ? (
              <>
                {" "}
                <em className="text-primary not-italic">{highlight}</em>
              </>
            ) : null}
          </h1>
          {description && (
            <p className="mt-4 text-base text-muted-foreground md:text-lg">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

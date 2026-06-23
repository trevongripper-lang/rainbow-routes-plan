import type { ComponentType, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type BulkAction = {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  pending?: boolean;
};

export function BulkActionBar({
  count,
  noun = "item",
  actions,
  onClear,
  leading,
}: {
  count: number;
  noun?: string;
  actions: BulkAction[];
  onClear: () => void;
  leading?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label={`${count} ${noun}${count === 1 ? "" : "s"} selected`}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3"
    >
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/95 px-3 py-2 shadow-[var(--shadow-soft)] backdrop-blur">
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <span className="px-1 text-sm tabular-nums">
          <span className="font-medium">{count}</span>{" "}
          <span className="text-muted-foreground">
            {noun}
            {count === 1 ? "" : "s"} selected
          </span>
        </span>
        {leading}
        <div className="ml-1 flex flex-wrap items-center gap-1.5">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                disabled={a.disabled || a.pending}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                  a.destructive
                    ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                    : "border-border/60 hover:border-primary/50 hover:text-primary",
                )}
              >
                {Icon && <Icon className="size-4" />}
                <span>{a.pending ? "Working…" : a.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import {
  MessageSquare,
  CalendarDays,
  Plane,
  BedDouble,
  Ticket,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Section = { key: string; label: string; icon: LucideIcon };

const SECTIONS: Section[] = [
  { key: "overview", label: "Chatter", icon: MessageSquare },
  { key: "itinerary", label: "Itinerary", icon: CalendarDays },
  { key: "flights", label: "Flights", icon: Plane },
  { key: "stays", label: "Stays", icon: BedDouble },
  { key: "tickets", label: "Tickets", icon: Ticket },
  { key: "costs", label: "Costs", icon: Wallet },
];

/**
 * Sticky, horizontally scrollable section bar for the trip detail page.
 * Mobile-only (hidden at md+ where the sidebar takes over).
 */
export function TripSectionBar({
  tripId,
  activeTab,
}: {
  tripId: string;
  activeTab: string;
}) {
  return (
    <nav
      aria-label="Trip sections"
      className="safe-top -mx-4 mb-4 sticky top-14 z-10 border-b border-border/60 bg-background/85 backdrop-blur md:hidden"
    >
      <div className="flex snap-x snap-mandatory gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECTIONS.map((s) => {
          const active = activeTab === s.key;
          const Icon = s.icon;
          return (
            <Link
              key={s.key}
              to="/trips/$id"
              params={{ id: tripId }}
              search={{ tab: s.key }}
              className={cn(
                "flex shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {s.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MissionControl } from "@/components/mission-control";
import { PlanningProgressInline } from "@/components/planning-progress";
import {
  computePlanningItems,
  computeWeightedScore,
  pendingPlanningItems,
  nextBestAction,
} from "@/lib/planning-progress";

export const Route = createFileRoute("/__mc-preview")({ component: Preview });

const ID = "preview-trip";
const ME = "me-1";

function makeClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  qc.setQueryData(["trip-members", ID], [
    { user_id: ME, role: "owner", status: "confirmed", travel_status: "booked" },
    { user_id: "u2", role: "member", status: "confirmed", travel_status: "booked" },
    { user_id: "u3", role: "member", status: "invited", travel_status: "pending" },
    { user_id: "u4", role: "member", status: "invited", travel_status: "pending" },
  ]);
  qc.setQueryData(["dest-flags", ID], {
    dates_locked: true,
    stay_not_needed: false,
    no_shared_costs: false,
  });
  qc.setQueryData(["stays", ID], []);
  qc.setQueryData(["costs", ID], [
    { user_id: ME, paid_by: ME, amount_cents: 584000, is_shared: true, currency: "USD" },
  ]);
  qc.setQueryData(["settlements", ID], []);
  qc.setQueryData(["trip-invites", ID], [
    { id: "i1", accepted_at: null, expires_at: null },
    { id: "i2", accepted_at: null, expires_at: null },
  ]);
  qc.setQueryData(["flights", ID], [{ id: "f1" }, { id: "f2" }, { id: "f3" }, { id: "f4" }]);
  return qc;
}

function Preview() {
  const items = computePlanningItems({
    startDate: "2026-05-10",
    endDate: "2026-05-17",
    datesLocked: true,
    memberCount: 4,
    confirmedCount: 2,
    headcount: 8,
    staysCount: 0,
    stayNotNeeded: false,
    travelHandledCount: 2,
    myNetCents: 21200,
    settlementsCount: 0,
    noSharedCosts: false,
    hasSharedCosts: true,
  });
  const { earned, total, pct } = computeWeightedScore(items);

  return (
    <QueryClientProvider client={makeClient()}>
      <div className="mx-auto max-w-5xl space-y-5 p-4">
        <header className="overflow-hidden rounded-3xl border border-border/60 bg-card md:grid md:grid-cols-[38%_1fr]">
          <div
            className="h-[165px] w-full sm:h-[195px] md:h-full md:min-h-[225px]"
            style={{ background: "var(--gradient-hero)" }}
          />
          <div className="space-y-3 px-5 py-4 md:px-6 md:py-5">
            <h1 className="font-display text-2xl md:text-3xl">Portugal Adventure</h1>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
              <div>
                <dt className="sr-only">Destination</dt>
                <dd>Algarve · Portugal</dd>
              </div>
              <div>
                <dt className="sr-only">Dates</dt>
                <dd>May 10 – May 17</dd>
              </div>
              <div>
                <dt className="sr-only">Travelers</dt>
                <dd>8 travelers</dd>
              </div>
              <div>
                <dt className="sr-only">Organizer</dt>
                <dd>Trevon</dd>
              </div>
            </dl>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              A week on the Algarve coast with the crew — surf mornings, long lunches, and a rented
              villa near Lagos.
            </p>
            <PlanningProgressInline
              isLoading={false}
              items={items}
              earned={earned}
              total={total}
              pct={pct}
              remaining={pendingPlanningItems(items)}
              next={nextBestAction(items)}
              actions={{ stay: () => {} }}
              actionLabels={{ stay: "Mark not needed" }}
            />
          </div>
        </header>
        <MissionControl
          destinationId={ID}
          me={ME}
          startDate="2026-05-10"
          endDate="2026-05-17"
          headcountFallback={8}
          defaultCurrency="USD"
          canOrganize
        />
      </div>
    </QueryClientProvider>
  );
}

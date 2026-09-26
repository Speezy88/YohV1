/**
 * web/src/pages/Home.tsx — Story 7.8, DESIGN.md Layout ("Home"),
 * EXPERIENCE.md State Patterns.
 *
 * Renders today's Plan checklist (left) next to the Calendar Day View
 * (right), both from one `GET /api/home` response — everything about order,
 * placement, and completion status is server-computed (AD-17); this
 * component only renders what it's given. Cold loads show skeleton rows/
 * cards, never a static spinner (UX-DR48). Registers the `"home-data"`
 * readiness gate that Story 7.6's launch splash waits on — the ONLY gate
 * this story adds (Ruling R16).
 *
 * Story 7.10: the checklist rows are `PlanChecklist` — interactive
 * Checkboxes with check-off, the dissolve, and the Undo Toast. It adds no
 * readiness gate ("home-data" stays the only one, Ruling R16).
 */
import { useEffect } from "react";
import { startHomeViewStream, useHomeView } from "../lib/homeView.ts";
import { useReadinessGate } from "../lib/readiness.ts";
import { CalendarDayView } from "../components/CalendarDayView.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { PlanChecklist } from "../components/PlanChecklist.tsx";

function PlanRowSkeleton(): React.JSX.Element {
  return <div data-testid="plan-row-skeleton" className="h-10 animate-pulse rounded-md bg-surface-sunken" />;
}

export default function HomePage(): React.JSX.Element {
  useEffect(() => startHomeViewStream(), []);
  const state = useHomeView();
  // Ruling R16: registered every render (including "loading"), so this gate
  // exists from Home's very first render — no later-registering gate can
  // trip the splash's one-way latch before Home has had its own say.
  useReadinessGate("home-data", state.status !== "loading");

  if (state.status === "loading") {
    return (
      <div className="grid h-full grid-cols-2 gap-4 p-5">
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <PlanRowSkeleton key={i} />
          ))}
        </div>
        <div data-testid="calendar-skeleton" className="animate-pulse rounded-lg bg-surface-sunken" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full items-center justify-center p-5 font-body text-body text-ink-secondary">
        Couldn't load Home right now.
      </div>
    );
  }

  const { today, plan, calendar } = state.value;
  const rows = plan?.rows ?? [];
  const allDone = plan !== undefined && rows.every((r) => r.completed);

  return (
    <div className="grid h-full grid-cols-2 gap-4 p-5">
      <Confetti today={today} />
      <div className="flex flex-col gap-2">
        {plan === undefined ? (
          <p className="font-body text-body text-ink-secondary">No Plan yet today.</p>
        ) : allDone ? (
          <p className="font-body text-body text-ink-secondary">Nothing left on today's Plan.</p>
        ) : (
          <PlanChecklist rows={rows} />
        )}
      </div>
      <CalendarDayView blocks={calendar.blocks} />
    </div>
  );
}

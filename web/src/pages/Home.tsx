/**
 * web/src/pages/Home.tsx — Story 7.8, DESIGN.md Layout ("Home"),
 * EXPERIENCE.md State Patterns.
 *
 * Renders today's Plan checklist (left) next to the mini month + Calendar
 * Day View (right), both from one `GET /api/home` response — everything
 * about order, placement, and completion status is server-computed
 * (AD-17); this component only renders what it's given. Cold loads show
 * skeleton rows/cards, never a static spinner (UX-DR48). Registers the
 * `"home-data"` readiness gate that the launch splash waits on — the ONLY
 * gate this page adds (Ruling R16).
 *
 * Task 6A (2026-09-27, UI refresh): a greeting + host-TZ date header, the
 * Time Budget widget (always visible, click-to-edit), and the mini month
 * alongside the Google-style Calendar Day View. The Ask Yoh pill moves out
 * of this page entirely — `PageShell.tsx` now renders it once, over every
 * page — so Home no longer mounts its own copy.
 */
import { useEffect } from "react";
import { startHomeViewStream, useHomeView } from "../lib/homeView.ts";
import { useReadinessGate } from "../lib/readiness.ts";
import { CalendarDayView } from "../components/CalendarDayView.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { PlanChecklist } from "../components/PlanChecklist.tsx";
import { TimeBudgetWidget } from "../components/TimeBudgetWidget.tsx";
import { MiniMonth } from "../components/MiniMonth.tsx";

/** Weekday + month + day, e.g. "SUNDAY, SEPTEMBER 27" — the server's own host-timezone `today` (AD-17), never `new Date()`. */
function formatDateHeading(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function PlanRowSkeleton(): React.JSX.Element {
  return <div data-testid="plan-row-skeleton" className="h-16 animate-pulse rounded-lg bg-surface-sunken" />;
}

function HomeHeader({ today }: { readonly today: string }): React.JSX.Element {
  return (
    <header className="flex items-end justify-between">
      <div className="flex flex-col gap-1.5">
        <span className="font-body text-small font-bold tracking-wide text-ink-secondary">{formatDateHeading(today)}</span>
        <h1 className="m-0 font-body text-display font-bold tracking-tight text-ink-primary">
          {greetingForHour(new Date().getHours())}, <span className="bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end bg-clip-text text-transparent">Spencer</span>
        </h1>
      </div>
    </header>
  );
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
      <div className="grid h-full grid-cols-[minmax(0,1fr)_520px] gap-7 p-8 pb-24">
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <PlanRowSkeleton key={i} />
          ))}
        </div>
        <div data-testid="calendar-skeleton" className="animate-pulse rounded-2xl bg-surface-sunken" />
      </div>
    );
  }

  if (state.status === "error") {
    return <div className="flex h-full items-center justify-center p-5 font-body text-body text-ink-secondary">Couldn't load Home right now.</div>;
  }

  const { today, plan, calendar, timeBudget, timeZone } = state.value;
  const rows = plan?.rows ?? [];
  const allDone = plan !== undefined && rows.every((r) => r.completed);

  return (
    <div className="flex h-full flex-col gap-6 p-8 pb-24">
      <Confetti today={today} />
      <HomeHeader today={today} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_520px] gap-7">
        <section className="flex min-h-0 flex-col gap-4 rounded-2xl bg-surface-raised p-7 shadow-extruded-lg">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 font-body text-heading font-bold text-ink-primary">Today's Plan</h2>
            <TimeBudgetWidget timeBudget={timeBudget} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {plan === undefined ? (
              <p className="font-body text-body text-ink-secondary">No Plan yet today. Type /plan to build it now.</p>
            ) : allDone ? (
              <p className="font-body text-body text-ink-secondary">Nothing left on today's Plan.</p>
            ) : (
              <PlanChecklist rows={rows} timeZone={timeZone} />
            )}
          </div>
        </section>
        <aside className="flex min-h-0 flex-col gap-5">
          <MiniMonth today={today} />
          {/* Task 6A: "It never stretches the full screen height" — capped
              regardless of how much vertical room the grid row offers, so a
              short Plan (a tall left column) never drags this card along
              with it. */}
          <section aria-label="Today's calendar" className="h-[380px] max-h-[380px] shrink-0 overflow-hidden rounded-2xl bg-surface-raised p-5 shadow-extruded-lg">
            <CalendarDayView blocks={calendar.blocks} timeZone={timeZone} />
          </section>
        </aside>
      </div>
    </div>
  );
}

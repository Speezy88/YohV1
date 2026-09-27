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
 *
 * Polish-2 (2026-09-27, Spencer's live-app report — real bugs from using
 * the app, not a redesign): "the google calendar visualization overlaps
 * with the search tasks and tasks filtering section" — the right column
 * used to be a MiniMonth card plus a fixed `h-[380px]` Calendar Day View
 * card, together taller than a real (700-900px) viewport, spilling past
 * this page's own slot into Tasks' (`PageShell.tsx`'s per-page
 * `overflow-hidden` now also guards against this). The fix: the whole
 * right column is now ONE calendar panel (`min-h-0 flex-1`, no fixed pixel
 * heights) that fills the column, with a header (title + a Day/Month
 * toggle, neumorphic like Tasks' Due/Area/Status control) and ONE content
 * area that's either the Calendar Day View or `MiniMonth` — never both at
 * once. "I want the right section... to primarily have the daily view...
 * and have the option to switch to monthly view": Day is the default,
 * remembered per browser (`lib/calendarView.ts`); clicking a day in Month
 * switches back to Day (only today's data exists client-side).
 */
import { useEffect, useState } from "react";
import { startHomeViewStream, useHomeView } from "../lib/homeView.ts";
import { useReadinessGate } from "../lib/readiness.ts";
import { CalendarDayView } from "../components/CalendarDayView.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { PlanChecklist } from "../components/PlanChecklist.tsx";
import { TimeBudgetWidget } from "../components/TimeBudgetWidget.tsx";
import { MiniMonth } from "../components/MiniMonth.tsx";
import { loadCalendarView, saveCalendarView, type CalendarView } from "../lib/calendarView.ts";
import type { HomeCalendarBlock } from "../../../src/types/api.ts";

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

const VIEW_OPTIONS: ReadonlyArray<{ readonly value: CalendarView; readonly label: string }> = [
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
];

/** Polish-2: the Day/Month segmented toggle — neumorphic styling matching Tasks' own Due/Area/Status control (`pages/Tasks.tsx`). */
function CalendarViewToggle({ view, onChange }: { readonly view: CalendarView; readonly onChange: (view: CalendarView) => void }): React.JSX.Element {
  return (
    <div role="group" aria-label="Calendar view" className="flex gap-1 rounded-lg bg-surface-sunken p-1 shadow-inset">
      {VIEW_OPTIONS.map((option) => {
        const pressed = option.value === view;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={
              "h-[34px] rounded-md px-3.5 font-body text-small focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid " +
              (pressed
                ? "bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end font-bold text-on-accent-solid shadow-extruded-sm"
                : "text-ink-secondary hover:text-ink-primary")
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
    <div className="flex h-full min-h-0 flex-col gap-6 p-8 pb-24">
      <Confetti today={today} />
      <HomeHeader today={today} />
      {/* Polish-2 (real bug: this grid row used to hold a MiniMonth card
          PLUS a fixed h-[380px] Calendar Day View card, together taller
          than a real viewport — no fixed pixel heights below this line;
          both columns are `min-h-0` flex columns that fill exactly this
          row's own height, so nothing can ever grow past it and bleed into
          the next page's slot (`PageShell.tsx`'s per-page `overflow-hidden`
          is the other, structural half of this fix). */}
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
        <CalendarColumn today={today} blocks={calendar.blocks} timeZone={timeZone} />
      </div>
    </div>
  );
}

interface CalendarColumnProps {
  readonly today: string;
  readonly blocks: readonly HomeCalendarBlock[];
  readonly timeZone: string;
}

/**
 * Polish-2: the right column is now ONE calendar panel that fills the
 * whole column height (`min-h-0 flex-1`, no fixed pixel heights) — a
 * header (title + the Day/Month toggle) plus ONE content area that's
 * either the Calendar Day View or `MiniMonth`, never both. Day is the
 * default; the choice is remembered per browser (`lib/calendarView.ts`).
 */
function CalendarColumn({ today, blocks, timeZone }: CalendarColumnProps): React.JSX.Element {
  const [view, setView] = useState<CalendarView>(loadCalendarView);

  const changeView = (next: CalendarView): void => {
    setView(next);
    saveCalendarView(next);
  };

  return (
    <aside aria-label="Calendar" className="flex min-h-0 flex-col rounded-2xl bg-surface-raised p-5 shadow-extruded-lg">
      <header className="flex shrink-0 items-center justify-between pb-4">
        <h2 className="m-0 font-body text-heading font-bold text-ink-primary">Calendar</h2>
        <CalendarViewToggle view={view} onChange={changeView} />
      </header>
      <div className="min-h-0 flex-1">
        {view === "day" ? (
          <CalendarDayView blocks={blocks} timeZone={timeZone} />
        ) : (
          // Only today's data exists client-side (this task's own brief):
          // a day click never fakes another day's events — it just returns
          // to Day, which always shows today.
          <MiniMonth today={today} onSelectDay={() => changeView("day")} />
        )}
      </div>
    </aside>
  );
}

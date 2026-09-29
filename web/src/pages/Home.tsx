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
 *
 * Real-use fixes plan, Task 4 (2026-09-27, "I cant see my google calendar
 * on other days when i select a day on the month view. it just reverts
 * back to day"): that limitation is lifted — clicking a Month day now
 * switches Day to THAT date. `CalendarColumn` tracks a `shownDate` (resets
 * to `today` on every mount/full reload — never persisted, unlike the
 * Day/Month mode itself). Today keeps using `GET /api/home`'s own live
 * `calendar.blocks`; any other date fetches `GET /api/calendar/day`
 * (`lib/calendarDay.ts`, cached per date for the session, invalidated on
 * that date's own "plan" hint).
 */
import { useEffect, useState } from "react";
import { startHomeViewStream, useHomeView } from "../lib/homeView.ts";
import { retryCalendarDay, useCalendarDay } from "../lib/calendarDay.ts";
import { useReadinessGate } from "../lib/readiness.ts";
import { CalendarDayView } from "../components/CalendarDayView.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { PlanChecklist } from "../components/PlanChecklist.tsx";
import { TimeBudgetWidget } from "../components/TimeBudgetWidget.tsx";
import { MiniMonth } from "../components/MiniMonth.tsx";
import { loadCalendarView, saveCalendarView, type CalendarView } from "../lib/calendarView.ts";
import { ReshufflePreviewCard } from "../components/ReshufflePreviewCard.tsx";
import { approveReshuffle, discardReshuffle, requestReshuffle, useReshuffle, type ReshuffleView } from "../lib/reshuffle.ts";
import type { HomeCalendarBlock } from "../../../src/types/api.ts";

/** Weekday + month + day, e.g. "SUNDAY, SEPTEMBER 27" — the server's own host-timezone `today` (AD-17), never `new Date()`. */
function formatDateHeading(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

/** "Tue, Sep 29" — the Day header's own short date label (Task 4's brief, verbatim). Plain calendar-date math (`Date.UTC` + a forced "UTC" formatter), never the browser's own zone — there's no wall-clock instant here to get wrong, just a `YYYY-MM-DD` label. */
function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** One calendar day added to (or subtracted from) `isoDate` — pure `YYYY-MM-DD` string arithmetic, same "no real timezone involved" reasoning as `formatShortDate` above. */
function addDays(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + delta)).toISOString().slice(0, 10);
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
    <header data-testid="home-greeting" className="flex items-end justify-between">
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
  const reshuffle = useReshuffle(state.status === "loaded" ? state.value.reshuffle : undefined);
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
        {/* Polish-4 addendum (wheel paging only outside cards): a wheel
            gesture over this raised card always scrolls its own content,
            never changes page, even at an edge (`data-wheel-nav="off"`,
            `lib/wheelNav.ts`) — the greeting above stays un-opted-out, so a
            wheel gesture there still changes page. */}
        <section data-wheel-nav="off" className="flex min-h-0 flex-col gap-4 rounded-2xl bg-surface-raised p-7 shadow-extruded-lg">
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
        <CalendarColumn today={today} blocks={reshuffle.preview ? reshuffle.preview.blocks : calendar.blocks} timeZone={timeZone} reshuffle={reshuffle} />
      </div>
    </div>
  );
}

interface CalendarColumnProps {
  readonly today: string;
  readonly blocks: readonly HomeCalendarBlock[];
  readonly timeZone: string;
  readonly reshuffle: ReshuffleView;
}

/**
 * Task 4: the Day view's own secondary header — the shown date (always
 * visible) plus prev/next-day arrows and a "Today" button, shown only when
 * the shown date ISN'T today (this task's brief, verbatim).
 */
function DayNavHeader({
  shownDate,
  isTodayShown,
  onPrevDay,
  onNextDay,
  onToday,
}: {
  readonly shownDate: string;
  readonly isTodayShown: boolean;
  readonly onPrevDay: () => void;
  readonly onNextDay: () => void;
  readonly onToday: () => void;
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between pb-2">
      <span className="font-body text-small font-bold text-ink-secondary">{formatShortDate(shownDate)}</span>
      {!isTodayShown && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous day"
            onClick={onPrevDay}
            className="flex size-[28px] items-center justify-center rounded-md border-[length:var(--rim-width)] border-rim-interactive text-ink-primary shadow-extruded-sm focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next day"
            onClick={onNextDay}
            className="flex size-[28px] items-center justify-center rounded-md border-[length:var(--rim-width)] border-rim-interactive text-ink-primary shadow-extruded-sm focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onToday}
            className="rounded-md px-2.5 py-1 font-body text-caption-lg font-bold text-ink-secondary hover:text-ink-primary focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
          >
            Today
          </button>
        </div>
      )}
    </div>
  );
}

/** `lib/calendarDay.ts`'s loading/error states for a non-today shown date — a skeleton while it loads, a plain line + Retry on error (this task's brief, verbatim); never a static spinner. */
function OtherDayPanel({ shownDate, timeZone }: { readonly shownDate: string; readonly timeZone: string }): React.JSX.Element {
  const state = useCalendarDay(shownDate);

  if (state.status === "loading") {
    return <div data-testid="calendar-day-loading-skeleton" className="h-full animate-pulse rounded-lg bg-surface-sunken" />;
  }
  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="font-body text-body text-ink-secondary">Couldn't load that day</p>
        <button
          type="button"
          onClick={() => retryCalendarDay(shownDate)}
          className="rounded-md border-[length:var(--rim-width)] border-rim-interactive px-3 py-1.5 font-body text-small text-ink-primary shadow-extruded-sm focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
        >
          Retry
        </button>
      </div>
    );
  }
  return <CalendarDayView blocks={state.value.blocks} timeZone={timeZone} isToday={false} />;
}

/**
 * Polish-2: the right column is now ONE calendar panel that fills the
 * whole column height (`min-h-0 flex-1`, no fixed pixel heights) — a
 * header (title + the Day/Month toggle) plus ONE content area that's
 * either the Calendar Day View or `MiniMonth`, never both. Day is the
 * default; the choice is remembered per browser (`lib/calendarView.ts`).
 *
 * Task 4: `shownDate` (today by default, reset on every mount — point 4 of
 * this task's brief: "the shown date resets to today on a full reload,"
 * unlike the Day/Month mode) is this column's own state; a Month day click
 * sets it and switches to Day.
 */
function CalendarColumn({ today, blocks, timeZone, reshuffle }: CalendarColumnProps): React.JSX.Element {
  const [view, setView] = useState<CalendarView>(loadCalendarView);
  const [shownDate, setShownDate] = useState<string>(today);
  const isTodayShown = shownDate === today;

  const changeView = (next: CalendarView): void => {
    setView(next);
    saveCalendarView(next);
  };

  return (
    // Polish-4 addendum (wheel paging only outside cards): same opt-out as
    // the Plan card above.
    <aside aria-label="Calendar" data-wheel-nav="off" className="flex min-h-0 flex-col rounded-2xl bg-surface-raised p-5 shadow-extruded-lg">
      <header className="flex shrink-0 items-center justify-between pb-4">
        <h2 className="m-0 font-body text-heading font-bold text-ink-primary">Calendar</h2>
        <CalendarViewToggle view={view} onChange={changeView} />
      </header>
      {view === "day" && (
        <DayNavHeader
          shownDate={shownDate}
          isTodayShown={isTodayShown}
          onPrevDay={() => setShownDate((d) => addDays(d, -1))}
          onNextDay={() => setShownDate((d) => addDays(d, 1))}
          onToday={() => setShownDate(today)}
        />
      )}
      <div className="min-h-0 flex-1">
        {view === "day" ? (
          isTodayShown ? (
            <CalendarDayView blocks={blocks} timeZone={timeZone} onUnpin={(taskId) => void requestReshuffle({ kind: "unpin-task", taskId })}
              onMoveBlock={(planBlockId, newStart) => void requestReshuffle({ kind: "move-block", planBlockId, newStart })}
              dragLocked={reshuffle.preview !== undefined || reshuffle.busy}
            />
          ) : (
            <OtherDayPanel shownDate={shownDate} timeZone={timeZone} />
          )
        ) : (
          <MiniMonth
            today={today}
            onSelectDay={(date) => {
              setShownDate(date);
              changeView("day");
            }}
          />
        )}
      </div>
      {/* Always mounted so screen readers announce a preview when it appears. */}
      <span data-testid="reshuffle-announcer" className="sr-only" role="status" aria-live="polite">
        {reshuffle.preview ? (reshuffle.preview.rejectedReason ?? reshuffle.preview.summary) : ""}
      </span>
      {reshuffle.preview && (
        <div className="shrink-0 pt-3">
          <ReshufflePreviewCard
            preview={reshuffle.preview}
            busy={reshuffle.busy}
            error={reshuffle.error}
            notice={reshuffle.notice}
            onApprove={(id) => void approveReshuffle(id)}
            onDiscard={(id) => void discardReshuffle(id)}
          />
        </div>
      )}
      {!reshuffle.preview && reshuffle.error && (
        <p role="alert" className="m-0 shrink-0 pt-3 font-body text-small font-bold text-ink-primary">
          {reshuffle.error}
        </p>
      )}
    </aside>
  );
}

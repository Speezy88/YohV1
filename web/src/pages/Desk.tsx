/**
 * web/src/pages/Desk.tsx — Epic 12: the Desk page. Six widgets from
 * `GET /api/desk` (copy: Ruling E12-R9): Tasks completed today, Worked,
 * On-time rate, Streak and Claude API spend this month, then the full-width
 * Activity heatmap (Task 5).
 */
import { useContext, useEffect } from "react";
import { DeskWidget, DeskWidgetSkeleton } from "../components/DeskWidget.tsx";
import { DeskHeatmap } from "../components/DeskHeatmap.tsx";
import { CheckGlyph } from "../components/icons/Glyphs.tsx";
import { StateMessage } from "../components/StateMessage.tsx";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import { PAGES } from "../lib/pages.ts";
import { refetchDesk, startDeskStream, useDesk } from "../lib/desk.ts";
import type { DeskResponse } from "../../../src/types/api.ts";

const DESK_PAGE_INDEX = PAGES.findIndex((p) => p.id === "desk");
const FIGURE = "m-0 font-body text-display font-bold tabular-nums text-ink-primary";
const CAPTION = "m-0 font-body text-small text-ink-secondary";

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

function CompletedWidget({ items }: { readonly items: DeskResponse["completedToday"] }): React.JSX.Element {
  return (
    <DeskWidget title="Tasks completed today" className="sm:col-span-2">
      <p className={FIGURE}>{items.length}</p>
      {items.length === 0 ? (
        <p className={CAPTION}>Nothing completed yet today.</p>
      ) : (
        <div role="region" aria-label="Tasks completed today, list" tabIndex={0} className="max-h-48 overflow-y-auto rounded-sm focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((item, i) => (
              <li key={`${item.completedAt}-${i}`} className="flex min-w-0 items-start gap-2 font-body text-body text-ink-primary">
                <CheckGlyph size={16} className="mt-1 shrink-0 text-ink-secondary" />
                <span className="min-w-0 break-words line-through">{item.taskName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DeskWidget>
  );
}

function Widgets({ value }: { readonly value: DeskResponse }): React.JSX.Element {
  const { onTime, streak, spend } = value;
  return (
    <>
      <CompletedWidget items={value.completedToday} />
      <DeskWidget title="Worked">
        <p className={FIGURE}>{value.minutesToday} min today</p>
        <p className={CAPTION}>{value.hoursWithYoh} h with Yoh</p>
      </DeskWidget>
      <DeskWidget title="On-time rate">
        {onTime.percent === null ? (
          <>
            <p className={FIGURE}>
              <span aria-hidden="true">—</span>
              <span className="sr-only">No on-time rate yet</span>
            </p>
            <p className={CAPTION}>No Tasks with a due date completed yet.</p>
          </>
        ) : (
          <>
            <p className={FIGURE}>{onTime.percent}%</p>
            <p className={CAPTION}>
              {onTime.onTime} of {onTime.counted} Tasks with a due date
            </p>
          </>
        )}
      </DeskWidget>
      <DeskWidget title="Streak">
        <p className="m-0 font-body text-title font-bold tabular-nums text-ink-primary">
          Streak: {days(streak.current)} · Longest: {days(streak.longest)}
        </p>
        <p className={CAPTION}>A day counts when it has a Plan and a finished night close-out.</p>
      </DeskWidget>
      <DeskWidget title="Claude API spend this month">
        <p className={FIGURE}>${spend.monthUsd.toFixed(2)}</p>
        <p className={CAPTION}>Estimated from recorded calls.</p>
        {spend.unpricedCalls > 0 && <p className={CAPTION}>{spend.unpricedCalls === 1 ? "1 call not priced." : `${spend.unpricedCalls} calls not priced.`}</p>}
      </DeskWidget>
      <DeskWidget title="Activity" className="sm:col-span-2 lg:col-span-3">
        <p className={CAPTION}>Last 26 weeks</p>
        <DeskHeatmap weeks={value.heatmap.weeks} />
      </DeskWidget>
    </>
  );
}

export default function DeskPage(): React.JSX.Element {
  const state = useDesk();
  const reducedMotion = useReducedMotion();
  const nav = useContext(PageNavigationContext);
  // Every page stays mounted, so fetch only while Desk is the page in view (no provider: a lone render, always active).
  const isActive = nav === undefined || nav.index === DESK_PAGE_INDEX;
  useEffect(() => (isActive ? startDeskStream() : undefined), [isActive]);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-8 pb-24 max-sm:p-4 max-sm:pb-24">
      <h1 className="font-body text-display font-bold tracking-tight text-ink-primary">Desk</h1>
      {state.status === "error" ? (
        <StateMessage variant="error" className="rounded-2xl bg-surface-raised p-5 shadow-extruded-lg" message="Couldn't load Desk." onRetry={() => void refetchDesk()} retrying={state.retrying === true} />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {state.status === "loading" ? (
            Array.from({ length: 6 }, (_, i) => <DeskWidgetSkeleton key={i} reducedMotion={reducedMotion} className={i === 0 ? "sm:col-span-2" : i === 5 ? "sm:col-span-2 lg:col-span-3" : ""} />)
          ) : (
            <Widgets value={state.value} />
          )}
        </div>
      )}
    </div>
  );
}

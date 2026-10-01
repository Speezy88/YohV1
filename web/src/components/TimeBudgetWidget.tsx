/**
 * web/src/components/TimeBudgetWidget.tsx — Task 6A.
 *
 * "Today's Time Budget (Spencer, 2026-09-27), always visible on Home. It
 * shows the budget, how much of it the Plan uses, and time done so far
 * (e.g. 'Time Budget 6 h · 4 h planned · 1 h done'). Click it to change the
 * budget in place, through the existing `app/time-budget.ts`. With no
 * budget set today, it shows the default and 'Set today's budget'."
 *
 * The mockup's raised-sm header pill (`4 of 6 hours planned · 1 done`),
 * made clickable: a click swaps it for an inline hours field + Save/Cancel,
 * `POST /api/time-budget` (`lib/timeBudget.ts`) on submit, then a manual
 * `refetchHomeView()` so the widget (and the rest of Home) reflects the new
 * value immediately, without waiting on the next "plan" hint.
 */
import { useState } from "react";
import type { HomeTimeBudget } from "../../../src/types/api.ts";
import { requestSetTimeBudget } from "../lib/timeBudget.ts";
import { refetchHomeView } from "../lib/homeView.ts";
import { addLocalFailureNotice } from "../lib/notifications.ts";

/**
 * Shown before Spencer has ever declared a Time Budget today. `core/time-
 * budget.ts` defines no default TOTAL budget (only the default 70/15
 * work/break segment lengths), so 6 hours — the approved mockup's own
 * example value ("4 of 6 hours planned") — is this widget's own documented
 * placeholder, never written to the server until Spencer actually saves.
 */
const DEFAULT_TOTAL_MINUTES = 360;

function formatHours(minutes: number): string {
  const rounded = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} h`;
}

export interface TimeBudgetWidgetProps {
  readonly timeBudget: HomeTimeBudget | undefined;
}

export function TimeBudgetWidget({ timeBudget }: TimeBudgetWidgetProps): React.JSX.Element {
  const defaultTotal = timeBudget?.totalMinutes ?? DEFAULT_TOTAL_MINUTES;
  const [editing, setEditing] = useState(false);
  const [hoursInput, setHoursInput] = useState(() => String(defaultTotal / 60));
  const [saving, setSaving] = useState(false);

  const startEdit = (): void => {
    setHoursInput(String(defaultTotal / 60));
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    const hours = Number(hoursInput);
    if (!Number.isFinite(hours) || hours <= 0) return;
    setSaving(true);
    const outcome = await requestSetTimeBudget(Math.round(hours * 60));
    setSaving(false);
    if (!outcome.ok) {
      addLocalFailureNotice("Couldn't set today's Time Budget");
      return;
    }
    setEditing(false);
    void refetchHomeView();
  };

  if (editing) {
    return (
      <form
        data-testid="time-budget-edit"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex items-center gap-2.5 rounded-lg bg-surface-sunken px-4.5 py-3 font-body text-small text-ink-primary shadow-inset"
      >
        <label htmlFor="time-budget-hours" className="sr-only">
          Today's Time Budget, in hours
        </label>
        <input
          id="time-budget-hours"
          type="number"
          min={0.5}
          step={0.5}
          value={hoursInput}
          autoFocus
          onChange={(e) => setHoursInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="w-16 rounded-sm bg-transparent text-center focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
        />
        <span>h budget</span>
        <button
          type="submit"
          disabled={saving}
          className="rounded-sm bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end px-3 py-1 font-bold text-on-accent-solid disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-ink-secondary">
          Cancel
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      data-testid="time-budget-widget"
      onClick={startEdit}
      className="flex items-center gap-2.5 rounded-lg bg-surface-raised px-4.5 py-3 font-body text-small text-ink-primary shadow-extruded-sm"
    >
      <span aria-hidden="true" className="size-2.5 rounded-full bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end" />
      {timeBudget ? (
        <span>
          Time Budget {formatHours(timeBudget.totalMinutes)} · {formatHours(timeBudget.plannedMinutes)} planned · {formatHours(timeBudget.doneMinutes)} done
        </span>
      ) : (
        <span>
          Time Budget {formatHours(DEFAULT_TOTAL_MINUTES)} (default) · <span className="font-bold text-accent-solid">Set today's budget</span>
        </span>
      )}
    </button>
  );
}

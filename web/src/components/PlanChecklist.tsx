/**
 * web/src/components/PlanChecklist.tsx — Story 7.10, DESIGN.md `plan-row`,
 * EXPERIENCE.md Component Patterns ("Checkbox", "Undo Toast").
 *
 * Home's Plan checklist, now interactive. Rows render in exactly the order
 * the server gave (AD-17). Checking a row is visual first, instantly and
 * before any server response (NFR-Latency, UX-DR30): checkmark +
 * strikethrough + 50% opacity, then the row dissolves — or is hidden at
 * once under reduced motion. Then `POST /api/check-off` records the pending
 * completion and the Undo Toast appears for the server's own window.
 *
 * Optimistic UI is visual only (AD-17): a check-off the server rejects
 * brings the row back with a failure notice naming the Task; a failed Undo
 * leaves it checked with a notice. A locally checked row stays dissolved for
 * this component's lifetime — the server commits it on its own clock, and
 * Home's next re-fetch reports it `completed`.
 *
 * UX OQ7 (`[ASSUMPTION]` per the story): several check-offs in quick
 * succession each get their own pending record and commit independently;
 * the toast shows only the most recent, and its Undo undoes only that one.
 * An earlier one stays dissolved and commits silently once superseded.
 *
 * Fix round (2026-09-27 review): each row shows its local time range (e.g.
 * "9:00–10:30"), formatted in the HOST timezone (`timeZone`, required —
 * `HomeViewResponse.timeZone`) via `hostTime.ts`, never the browser's own
 * zone (AD-17).
 */
import { useState } from "react";
import type { HomePlanRow } from "../../../src/types/api.ts";
import type { RefiningFieldNames } from "../../../src/types/domain.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { remainingMs, requestCheckOff, requestUndo } from "../lib/checkOff.ts";
import { addLocalFailureNotice } from "../lib/notifications.ts";
import { displayLabel } from "../lib/labels.ts";
import { formatClockTime } from "../lib/hostTime.ts";
import { Checkbox } from "./Checkbox.tsx";
import { UndoToast } from "./UndoToast.tsx";

/** Story 9.1: matches the codebase's existing "Area"/"Energy" capitalized field-name convention (`core/planning-field-value.ts`'s `PLANNING_FIELD_LABELS`, `TaskRow.tsx`'s own `FIELD_NAMES`) — duplicated here rather than imported, since `web/` may only `import type` from `src/types/*.ts` (AD-17), never a runtime const from `core/`. */
const REFINING_FIELD_LABELS: Record<RefiningFieldNames, string> = { area: "Area", energy: "Energy" };

function missingRefiningText(missing: readonly RefiningFieldNames[]): string {
  return missing.map((field) => `no ${REFINING_FIELD_LABELS[field]}`).join(", ");
}

/** aria-hidden — the marker's own text carries the meaning (NFR-Accessibility: glyph plus text, never color alone). A small outlined "i" (information) glyph, not a color-only dot. */
function IncompleteGlyph(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** aria-hidden — the badge's own "pinned" text carries the meaning. */
function PinGlyph(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" />
      <line x1="12" y1="13" x2="12" y2="20" />
    </svg>
  );
}

/** A locally checked row: still fading out, or gone. */
type LocalCheck = "dissolving" | "gone";

interface ToastState {
  readonly id: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly durationMs: number;
}

export interface PlanChecklistProps {
  readonly rows: readonly HomePlanRow[];
  /** The host timezone (`HomeViewResponse.timeZone`, AD-17) each row's start–end range is formatted in — never the browser's own zone. */
  readonly timeZone: string;
}

export function PlanChecklist({ rows, timeZone }: PlanChecklistProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [local, setLocal] = useState<ReadonlyMap<string, LocalCheck>>(new Map());
  const [toast, setToast] = useState<ToastState | undefined>(undefined);

  const setLocalCheck = (taskId: string, value: LocalCheck | undefined): void => {
    setLocal((prev) => {
      const next = new Map(prev);
      if (value === undefined) next.delete(taskId);
      else next.set(taskId, value);
      return next;
    });
  };

  const check = async (row: HomePlanRow): Promise<void> => {
    setLocalCheck(row.taskId, reducedMotion ? "gone" : "dissolving");
    const outcome = await requestCheckOff(row.taskId);
    if (!outcome.ok) {
      setLocalCheck(row.taskId, undefined);
      addLocalFailureNotice(`Couldn't check off ${row.label}`);
      return;
    }
    setToast({ id: outcome.value.id, taskId: row.taskId, taskName: row.label, durationMs: remainingMs(outcome.value) });
  };

  const undo = async (shown: ToastState): Promise<void> => {
    const outcome = await requestUndo(shown.id);
    setToast((current) => (current?.id === shown.id ? undefined : current));
    if (outcome.ok) setLocalCheck(shown.taskId, undefined);
    else addLocalFailureNotice(`Couldn't undo ${shown.taskName}`);
  };

  return (
    <>
      {rows.map((row) => {
        const localCheck = local.get(row.taskId);
        const checked = row.completed || localCheck !== undefined;
        // Ruling R18: only a completed/checked row is read-only. A past,
        // incomplete row keeps its visual "past" cue but stays checkable —
        // "past blocks read-only" governs Calendar Day View blocks, not rows.
        const readOnly = checked;
        const motion = localCheck === "dissolving" ? "check-off-dissolve" : "";
        return (
          <div
            key={row.blockId}
            data-testid="plan-row"
            data-task-id={row.taskId}
            aria-disabled={readOnly}
            hidden={localCheck === "gone"}
            onAnimationEnd={localCheck === "dissolving" ? () => setLocalCheck(row.taskId, "gone") : undefined}
            className={`flex h-16 items-center gap-4 rounded-lg bg-surface-raised px-5 font-body text-body text-ink-primary shadow-extruded-sm ${checked ? "line-through opacity-50" : ""} ${row.past && !checked ? "opacity-70" : ""} ${motion}`}
          >
            <Checkbox label={displayLabel(row.label)} checked={checked} disabled={readOnly} onCheck={() => void check(row)} />
            {/* The label shares the checkbox's hit target: same check(row), inert when read-only, not a second tab stop. */}
            <span
              data-testid="plan-row-label"
              onClick={readOnly ? undefined : () => void check(row)}
              className={`min-w-0 flex-1 truncate ${readOnly ? "" : "cursor-pointer"}`}
            >
              {displayLabel(row.label)}
            </span>
            {row.missingRefining && row.missingRefining.length > 0 && (
              <span data-testid="plan-row-incomplete-marker" className="flex shrink-0 items-center gap-1 whitespace-nowrap font-body text-label font-bold text-ink-secondary">
                <IncompleteGlyph />
                {missingRefiningText(row.missingRefining)}
              </span>
            )}
            {row.pinned && (
              <span data-testid="plan-row-pinned-badge" className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-surface-sunken px-2 py-0.5 font-body text-label font-bold text-ink-secondary">
                <PinGlyph />
                pinned
              </span>
            )}
            <span className="shrink-0 font-body text-small tabular-nums text-ink-secondary">
              {formatClockTime(new Date(row.start), timeZone)}–{formatClockTime(new Date(row.end), timeZone)}
            </span>
          </div>
        );
      })}
      {toast && (
        <UndoToast
          key={toast.id}
          id={toast.id}
          taskName={toast.taskName}
          durationMs={toast.durationMs}
          onUndo={() => undo(toast)}
          onExpire={() => setToast((current) => (current?.id === toast.id ? undefined : current))}
        />
      )}
    </>
  );
}

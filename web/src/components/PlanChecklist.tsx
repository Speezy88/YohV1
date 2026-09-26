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
 */
import { useState } from "react";
import type { HomePlanRow } from "../../../src/types/api.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { remainingMs, requestCheckOff, requestUndo } from "../lib/checkOff.ts";
import { addLocalFailureNotice } from "../lib/notifications.ts";
import { Checkbox } from "./Checkbox.tsx";
import { UndoToast } from "./UndoToast.tsx";

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
}

export function PlanChecklist({ rows }: PlanChecklistProps): React.JSX.Element {
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
            className={`flex items-center gap-2 rounded-md bg-surface-raised px-3 py-2 font-body text-body text-ink-primary ${checked ? "line-through opacity-50" : ""} ${row.past && !checked ? "opacity-70" : ""} ${motion}`}
          >
            <Checkbox label={row.label} checked={checked} disabled={readOnly} onCheck={() => void check(row)} />
            {row.label}
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

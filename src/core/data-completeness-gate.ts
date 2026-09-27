/**
 * src/core/data-completeness-gate.ts
 *
 * The Data-Completeness Gate (Story 1.5 / FR-4, AD-11). Per AD-11 of the
 * Architecture Spine, `checkDataCompleteness` below is the *only* function
 * anywhere in this codebase allowed to produce a `CompleteTask` value from a
 * raw `Task`. Every function downstream of the gate — `derived-priority.ts`,
 * `work-break-fit.ts`, `plan-reasoning.ts` (later tasks) — accepts
 * `CompleteTask`, never `Task`, in its signature, so a Task with a missing
 * required field cannot type-check its way into Plan assembly.
 *
 * Per AD-2 (core purity) and AD-8 (Result types), this file is a pure
 * `core/*.ts` module: no I/O, no module-level mutable state, same inputs
 * always produce the same outputs, and it never throws — it always returns
 * `Result<T, YohError>`. It does NOT call `memory-store.ts` and does not
 * persist anything itself; per the Task 5 brief's Implementer note, wiring
 * this gate's "missing field" output into an open interaction request
 * (AD-5) is the caller's job — see `rituals/data-completeness.ts`'s
 * `syncDataCompletenessInteractionRequest`, a thin orchestration function
 * that calls this gate, then writes to `memory-store.ts`.
 *
 * Design choice: "missing" means the field is `undefined` on the input
 * `Task` — exactly the same optionality `Task`'s own type declares for its
 * five planning fields (see `types/domain.ts`). This file does not apply any
 * additional validation (e.g. rejecting an empty-string `area` or a
 * zero-minute `estimatedDurationMinutes`) — Story 1.5's acceptance criteria
 * is about a field being *missing*, not about validating a present field's
 * value, and `Task`'s own optional-field typing is precisely "present or
 * absent", not "present, absent, or invalid".
 */
import type { CompleteTask, PlanningFieldNames, Result, Task, YohError } from "../types/domain.ts";

// ============================================================================
// Output shapes
// ============================================================================

/**
 * Reports exactly which of the five planning fields (FR-4) are missing on
 * one Task — the shape a caller (`rituals/data-completeness.ts`'s
 * `buildMissingFieldsPromptText`; Story 8.9: originally also `shell/
 * chat-cli.ts` directly) turns into a combined
 * open interaction request naming exactly the missing field(s) on exactly
 * that Task (Story 1.5's acceptance criteria).
 */
export interface MissingFieldReport {
  readonly taskId: Task["id"];
  readonly taskTitle: string;
  /** In the fixed order `PLANNING_FIELD_NAMES` below lists them — stable across calls, not input-object key order. */
  readonly missingFields: readonly PlanningFieldNames[];
}

/**
 * `checkDataCompleteness`'s successful result: `completeTasks` holds every
 * Task from the input that had all five planning fields present, upgraded
 * to `CompleteTask`; `incomplete` holds a `MissingFieldReport` for every
 * other Task. Every input Task appears in exactly one of the two lists, in
 * input order within each.
 */
export interface DataCompletenessGateResult {
  readonly completeTasks: readonly CompleteTask[];
  readonly incomplete: readonly MissingFieldReport[];
}

// ============================================================================
// checkDataCompleteness (AD-9's primary export; AD-11's sole CompleteTask producer)
// ============================================================================

/** The five planning fields FR-4 requires, in the fixed order missing-field reports list them. */
const PLANNING_FIELD_NAMES: readonly PlanningFieldNames[] = [
  "estimatedDurationMinutes",
  "area",
  "dueDate",
  "status",
  "energy",
];

/**
 * Runs the Data-Completeness Gate over today's candidate Task set. For each
 * Task: if every one of the five planning fields (Estimated Duration, Area,
 * Due Date, Status, Energy) is present, it's upgraded to `CompleteTask` and
 * placed in `completeTasks`; otherwise it's left out entirely (per AD-11, it
 * "does not produce a `CompleteTask` value, and no other planning function
 * ever receives it as a `Task`") and a `MissingFieldReport` naming exactly
 * its missing field(s) is placed in `incomplete`.
 *
 * Returns `ok: false` (`YohError.kind: "validation"`) only for malformed
 * input this gate cannot meaningfully attribute a missing-field report to —
 * specifically, two Tasks sharing the same `id` in the same candidate set,
 * which would make "an open interaction request naming exactly that Task"
 * ambiguous. A well-formed candidate set (the normal case) always returns
 * `ok: true`, even when every Task in it is incomplete.
 */
export function checkDataCompleteness(tasks: readonly Task[]): Result<DataCompletenessGateResult, YohError> {
  const seenIds = new Set<string>();
  for (const task of tasks) {
    if (seenIds.has(task.id)) {
      return {
        ok: false,
        error: {
          kind: "validation",
          message: `data-completeness-gate: duplicate Task id "${task.id}" in candidate set`,
          detail: { taskId: task.id },
        },
      };
    }
    seenIds.add(task.id);
  }

  const completeTasks: CompleteTask[] = [];
  const incomplete: MissingFieldReport[] = [];

  for (const task of tasks) {
    const missingFields = PLANNING_FIELD_NAMES.filter((field) => task[field] === undefined);
    if (missingFields.length === 0) {
      completeTasks.push(toCompleteTask(task));
    } else {
      incomplete.push({ taskId: task.id, taskTitle: task.title, missingFields });
    }
  }

  return { ok: true, value: { completeTasks, incomplete } };
}

/**
 * Upgrades `task` to `CompleteTask`. Private — this is the one place in the
 * whole codebase that performs this upgrade (AD-11), and it is only ever
 * called immediately after `checkDataCompleteness` has itself confirmed
 * (above) that every one of `PLANNING_FIELD_NAMES` is present on `task`;
 * that runtime check is what makes the cast below sound, since
 * `CompleteTask` is exactly `Task` with those same fields required instead
 * of optional (see `types/domain.ts`).
 */
function toCompleteTask(task: Task): CompleteTask {
  return task as CompleteTask;
}

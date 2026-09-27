/**
 * src/core/data-completeness-gate.ts
 *
 * The Data-Completeness Gate (Story 1.5 / FR-4, AD-11) — reshaped into a
 * two-tier gate by Story 9.1 (AD-11 amended 2026-09-27). Per AD-11,
 * `checkDataCompleteness` below is the *only* function anywhere in this
 * codebase allowed to produce a `CompleteTask` value from a raw `Task`.
 * Every function downstream of the gate — `derived-priority.ts`,
 * `work-break-fit.ts`, `plan-reasoning.ts` — accepts `CompleteTask`, never
 * `Task`, in its signature, so a Task missing a Required Field cannot
 * type-check its way into Plan assembly.
 *
 * ============================================================================
 * The two tiers (FR-4 amended, Story 9.1)
 * ============================================================================
 *
 * - **Required Fields** (`RequiredFieldNames`: Due Date, Estimated
 *   Duration). Missing either holds the Task back entirely — reported in
 *   `incomplete`, never upgraded to `CompleteTask`.
 * - **Refining Fields** (`RefiningFieldNames`: Area, Energy). Missing one
 *   (or both) does NOT hold the Task back — it is still upgraded to
 *   `CompleteTask`, with the missing field(s) wrapped as
 *   `Refining<T> = {kind:"missing"}` rather than defaulted or left
 *   `undefined`. `toCompleteTask` below is the one place this wrapping
 *   happens.
 * - **Status** is not a gate field at all any more — `[PRD ASSUMPTION,
 *   adopted]` per epics.md: "empty Status = eligible" describes
 *   eligibility for planning generally, not a Refining tier. It rides
 *   through `CompleteTask` as the plain, optional `Task["status"]` it
 *   always was (`Omit<Task, RequiredFieldNames | RefiningFieldNames>`
 *   still carries it, since it's in neither alias).
 *
 * A Task missing a Required Field AND one or both Refining Fields is
 * reported ONLY in `incomplete` — Required-field-missing dominates; it is
 * never also counted toward `completeTasks`.
 *
 * Per AD-2 (core purity) and AD-8 (Result types), this file is a pure
 * `core/*.ts` module: no I/O, no module-level mutable state, same inputs
 * always produce the same outputs, and it never throws — it always returns
 * `Result<T, YohError>`. It does NOT call `memory-store.ts` and does not
 * persist anything itself — see `rituals/data-completeness.ts`'s
 * `syncDataCompletenessInteractionRequest` for the I/O wiring.
 *
 * Design choice, unchanged since Story 1.5: "missing" means the field is
 * `undefined` on the input `Task` — exactly the same optionality `Task`'s
 * own type declares. This file applies no additional validation (e.g.
 * rejecting an empty-string `area` or a zero-minute
 * `estimatedDurationMinutes`) — Story 1.5's acceptance criteria is about a
 * field being *missing*, not about validating a present field's value.
 */
import type { Area, CompleteTask, Energy, RequiredFieldNames, Result, Task, YohError } from "../types/domain.ts";

// ============================================================================
// Output shapes
// ============================================================================

/**
 * Reports exactly which Required Field(s) are missing on one Task — the
 * shape a caller (`rituals/data-completeness.ts`'s
 * `buildMissingFieldsPromptText`) turns into a combined open interaction
 * request naming exactly the missing field(s) on exactly that Task.
 */
export interface MissingFieldReport {
  readonly taskId: Task["id"];
  readonly taskTitle: string;
  /** In the fixed order `REQUIRED_FIELD_NAMES` below lists them — stable across calls, not input-object key order. */
  readonly missingFields: readonly RequiredFieldNames[];
}

/**
 * `checkDataCompleteness`'s successful result: `completeTasks` holds every
 * Task from the input that had both Required Fields present, upgraded to
 * `CompleteTask` (with its Refining Fields wrapped `Refining<T>` — present
 * or `{kind:"missing"}` alike); `incomplete` holds a `MissingFieldReport`
 * for every Task missing a Required Field. Every input Task appears in
 * exactly one of the two lists, in input order within each.
 */
export interface DataCompletenessGateResult {
  readonly completeTasks: readonly CompleteTask[];
  readonly incomplete: readonly MissingFieldReport[];
}

// ============================================================================
// checkDataCompleteness (AD-9's primary export; AD-11's sole CompleteTask producer)
// ============================================================================

/**
 * The two Required Fields (Story 9.1 / FR-4 amended), in the fixed order
 * missing-field reports list them. Area, Energy (Refining Fields) and
 * Status are deliberately absent from this list — see the file docstring's
 * "two tiers" section.
 */
const REQUIRED_FIELD_NAMES: readonly RequiredFieldNames[] = ["estimatedDurationMinutes", "dueDate"];

/**
 * Runs the Data-Completeness Gate over today's candidate Task set. For each
 * Task: if both Required Fields (Estimated Duration, Due Date) are present,
 * it's upgraded to `CompleteTask` (via `toCompleteTask`, below) and placed
 * in `completeTasks` — regardless of whether its Refining Fields (Area,
 * Energy) are present; otherwise it's left out entirely (per AD-11) and a
 * `MissingFieldReport` naming exactly its missing Required Field(s) is
 * placed in `incomplete`.
 *
 * Returns `ok: false` (`YohError.kind: "validation"`) only for malformed
 * input this gate cannot meaningfully attribute a missing-field report to —
 * specifically, two Tasks sharing the same `id` in the same candidate set.
 * A well-formed candidate set (the normal case) always returns `ok: true`,
 * even when every Task in it is incomplete.
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
    const missingFields = REQUIRED_FIELD_NAMES.filter((field) => task[field] === undefined);
    if (missingFields.length === 0) {
      completeTasks.push(toCompleteTask(task));
    } else {
      incomplete.push({ taskId: task.id, taskTitle: task.title, missingFields });
    }
  }

  return { ok: true, value: { completeTasks, incomplete } };
}

/**
 * Upgrades `task` to `CompleteTask` — the one place in the whole codebase
 * that performs this upgrade (AD-11), and the one place `Refining<T>`
 * wrapping happens (Story 9.1). Only ever called immediately after
 * `checkDataCompleteness` has confirmed both Required Fields are present on
 * `task`; Area/Energy are wrapped as `{kind:"set", value}` when present,
 * `{kind:"missing"}` when absent — never defaulted, never left
 * `T | undefined`.
 */
function toCompleteTask(task: Task): CompleteTask {
  const area: Area | undefined = task.area;
  const energy: Energy | undefined = task.energy;
  return {
    ...task,
    area: area === undefined ? { kind: "missing" } : { kind: "set", value: area },
    energy: energy === undefined ? { kind: "missing" } : { kind: "set", value: energy },
  } as CompleteTask;
}

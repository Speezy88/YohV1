/**
 * src/rituals/data-completeness.ts
 *
 * The Data-Completeness capability's orchestration layer (Story 1.5 / FR-4,
 * AD-5, AD-11): merge Spencer's stored answers onto the raw Tasks, run the
 * pure gate over the result, and persist or clear the single open
 * interaction request to match.
 *
 * ============================================================================
 * Why this file exists (and why the logic isn't in `chat-cli.ts` or
 * `morning-ritual.ts`)
 * ============================================================================
 *
 * This sequence has exactly two callers, in two different layers:
 * `shell/chat-cli.ts` (which surfaces the request and collects Spencer's
 * answers) and `rituals/morning-ritual.ts` (which needs the gated
 * `CompleteTask[]` to build a Plan from). It is also STATEFUL — it writes
 * and clears one singleton `"data-completeness"` row in `memory-store.ts` —
 * so two copies of it would be two writers of the same row, free to drift
 * apart.
 *
 * Task 5 originally wrote it inside `shell/chat-cli.ts`, and recorded why in
 * that file's own doc comment: "a `rituals/*.ts` file would be the more
 * natural home once one exists for this concern, but none is owned by this
 * task." Task 10 briefly moved it into `rituals/morning-ritual.ts`, which
 * fixed the layering (AD-1 forbids `rituals -> shell`) but broke AD-9: the
 * Data-Completeness Gate is its own capability and must not be bolted onto
 * the file that owns Plan generation. `chat-cli.ts` would also have had to
 * import the entire Morning Ritual and Plan-persistence surface just to
 * reach a field-label map and a record id.
 *
 * So it lives here, in its own file named for the capability it implements.
 * Both callers import from it directly (`shell -> rituals` per AD-1, no
 * cycle, no re-export shim), and neither drags in the other's surface.
 *
 * Per AD-2/AD-11 the pure gate itself stays in `core/data-completeness-gate.ts`
 * and knows nothing about storage; everything in this file is the I/O wiring
 * that gate is forbidden from doing.
 */
import {
  clearInteractionRequest,
  getOpenInteractionRequest,
  getTaskFieldOverride,
  putOpenInteractionRequest,
  type MemoryStore,
} from "../adapters/memory-store.ts";
import {
  checkDataCompleteness,
  type DataCompletenessGateResult,
  type MissingFieldReport,
} from "../core/data-completeness-gate.ts";
import { PLANNING_FIELD_LABELS } from "../core/planning-field-value.ts";
import type {
  InteractionRequest,
  Result,
  Task,
  TaskFieldOverride,
  YohError,
} from "../types/domain.ts";

// ============================================================================
// Prompt text
// ============================================================================

// `PLANNING_FIELD_LABELS` now lives in `core/planning-field-value.ts` (Story
// 8.1 review fix) — re-exported here (not just imported) so every existing
// `rituals/data-completeness.ts` consumer keeps working unchanged.
export { PLANNING_FIELD_LABELS };

/**
 * Turns the gate's `MissingFieldReport[]` into the single combined prompt
 * text UX-DR10 requires: "one prompt may cover multiple missing fields
 * across multiple Tasks if needed" — never a bulk "clean up your whole
 * database" request, and never one prompt per Task. Pure/no I/O; the caller
 * applies the accent-color wrapping when actually printing it.
 */
export function buildMissingFieldsPromptText(incomplete: readonly MissingFieldReport[]): string {
  const subject = incomplete.length === 1 ? "this Task" : "these Tasks";
  const lines = incomplete.map((report) => {
    const fields = report.missingFields.map((field) => PLANNING_FIELD_LABELS[field]).join(", ");
    return `  - "${report.taskTitle}": ${fields}`;
  });
  return [`I need a bit more before I can plan around ${subject}:`, ...lines].join("\n");
}

// ============================================================================
// TaskFieldOverride merging — the answer-application half of the cycle
// ============================================================================

/**
 * Merges a `TaskFieldOverride` onto `task`: every field the override sets
 * wins; every field it leaves unset keeps `task`'s own value (which may
 * itself still be `undefined`, if Spencer hasn't answered that one yet).
 * Pure — no I/O — but deliberately not inside `core/data-completeness-gate.ts`
 * per AD-2: the gate must not read `memory-store.ts`, so it cannot know
 * about overrides itself. The result is still a plain `Task`, never a
 * `CompleteTask` — AD-11 holds: only `checkDataCompleteness` may produce a
 * `CompleteTask`, and it's still the next call to it that does so once every
 * field is present, merged or otherwise.
 */
export function applyTaskFieldOverride(task: Task, override: TaskFieldOverride | undefined): Task {
  if (!override) return task;
  // `override`'s fields are typed as present-or-absent (not
  // present-with-possible-undefined) under `exactOptionalPropertyTypes`, so
  // spreading it after `task` only ever overwrites a field with a real
  // value, never with an explicit `undefined` — the cast documents that
  // runtime guarantee to the type checker, mirroring
  // `data-completeness-gate.ts`'s own `toCompleteTask` cast.
  return { ...task, ...override } as Task;
}

/**
 * Merges each Task's own stored `TaskFieldOverride` (if any) from
 * `memory-store.ts` onto it, returning the merged Task list — the
 * caller-side merge step applied before handing Tasks to the gate. A Task
 * with no stored override is returned unchanged.
 */
export function mergeStoredOverrides(store: MemoryStore, tasks: readonly Task[]): Task[] {
  return tasks.map((task) => applyTaskFieldOverride(task, getTaskFieldOverride(store, task.id)?.data));
}

// ============================================================================
// The gate -> memory-store wiring
// ============================================================================

/** The fixed, singleton `id` the Data-Completeness Gate's open interaction request is stored under (so multiple incomplete Tasks collapse into one request, per UX-DR10, rather than one row per Task). */
export const DATA_COMPLETENESS_REQUEST_ID = "data-completeness";

/**
 * Merges any stored `TaskFieldOverride`s onto `tasks` (so a
 * previously-answered field actually counts), runs the pure
 * Data-Completeness Gate over the result, then persists or clears the single
 * combined `"data-completeness"` interaction request in `memory-store.ts` to
 * match — and returns the gate's own result, so a caller can go on to plan
 * the Tasks that DID pass.
 *
 * - Every (merged) Task complete, no request currently open: no-op.
 * - Every (merged) Task complete, a request WAS open (Spencer answered the
 *   missing field(s), the override was stored, and the gate re-ran with the
 *   merged Task): the request is cleared — Story 1.5's "the interaction
 *   request is cleared" criterion.
 * - Any (merged) Task still incomplete: the request is opened (or replaced,
 *   if one is already open with stale content) naming exactly the missing
 *   field(s) on exactly the Tasks that have them — while the complete Tasks
 *   are still returned for planning (UX-DR10's "gate what you can, prompt
 *   for the rest").
 *
 * Returns the gate's `Result` rather than throwing on a malformed candidate
 * set (currently: duplicate Task ids), so a `rituals/*.ts` caller can convert
 * it per AD-8. `syncDataCompletenessInteractionRequest` below is the
 * throwing wrapper `shell/chat-cli.ts` uses.
 */
export function runDataCompletenessGate(
  store: MemoryStore,
  tasks: readonly Task[],
): Result<DataCompletenessGateResult, YohError> {
  const merged = mergeStoredOverrides(store, tasks);
  const result = checkDataCompleteness(merged);
  if (!result.ok) return result;

  const existing = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);

  if (result.value.incomplete.length === 0) {
    if (existing) {
      clearInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID, existing.version);
    }
    return result;
  }

  const request: InteractionRequest<{ incomplete: readonly MissingFieldReport[] }> = {
    requestKind: "data-completeness",
    promptText: buildMissingFieldsPromptText(result.value.incomplete),
    detail: { incomplete: result.value.incomplete },
    createdAt: new Date().toISOString(),
  };
  putOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID, request);
  return result;
}

/**
 * `runDataCompletenessGate` with the throw-on-malformed-input behavior
 * `shell/chat-cli.ts` established in Task 5 and its callers still expect.
 * Kept as a separate wrapper (rather than changing that behavior) because
 * AD-8's "never throws" rule binds `core/*.ts`, and chat-cli has no `Result`
 * channel to surface a duplicate-id bug through. The message names this
 * capability rather than either calling file — both layers raise it.
 */
export function syncDataCompletenessInteractionRequest(store: MemoryStore, tasks: readonly Task[]): void {
  const result = runDataCompletenessGate(store, tasks);
  if (!result.ok) {
    throw new Error(`data-completeness: gate rejected the candidate Task set: ${result.error.message}`);
  }
}

/**
 * src/app/update-task.ts
 *
 * Task 6B (FR-43, FR-24, AD-12). The Tasks page's inline edits.
 *
 * `updateTask` — one planning-field edit: the raw value from the cell
 * editor is parsed by the ONE planning-field parser
 * (`core/planning-field-value.ts`) and written through `updateTaskField` —
 * FR-24's direct write, reached through the adapter's own binder
 * (`bindNotionTaskWrites`), so the select guard (Area/Energy/Status resolved
 * against the LIVE options, never raw text) stays exactly as it is for
 * every other caller. Status → Completed is refused here (fix round,
 * AD-20): completing a Task always goes through `app/check-off.ts` — the
 * pending record, the Undo window, the Completion Log entry and the commit
 * sweep — whichever control Spencer used (the checkbox or the Status
 * select), so both give the identical outcome.
 *
 * `renameTask` — the title of an existing Task, through `updateTaskTitle`
 * (AD-12 amended 2026-09-27: the closed write surface's one addition, from
 * Spencer's own edit on the Tasks page only).
 *
 * Success returns a human-readable receipt ("Due Date set to Fri, Oct 2.",
 * "Energy set to Deep." — the LIVE Notion label, never an internal enum)
 * and appends one `tasks` outbox hint (AD-18); failure returns one plain
 * sentence and appends nothing. Nothing here ever deletes (AD-12).
 */
import type { LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { NotionTaskWriteBindings } from "../adapters/notion-adapter.ts";
import { appendOutboxInTx } from "../adapters/notification-store.ts";
import { errorCopy, errorCopyForThrown } from "../core/error-copy.ts";
import { PLANNING_FIELD_LABELS, parsePlanningFieldValue, parsePriorityValue } from "../core/planning-field-value.ts";
import { TASKS_TOPIC } from "./create-task.ts";
import type { RenameTaskRequest, RenameTaskResponse, UpdateTaskFieldRequest, UpdateTaskFieldResponse } from "../types/api.ts";
import type { EditableTaskField, Energy, PlanningFieldNames, Result, Task, TaskFieldOptions, TaskStatus, YohError } from "../types/domain.ts";

export interface UpdateTaskDeps {
  /** `bindNotionTaskWrites(...)`'s field write — the shell spreads the binder, never names the write itself. */
  readonly updateTaskField: NotionTaskWriteBindings["updateTaskField"];
  /** `bindNotionTaskWrites(...)`'s title write (AD-12 amended 2026-09-27). */
  readonly updateTaskTitle: NotionTaskWriteBindings["updateTaskTitle"];
  /** The live select options, so a receipt names Energy/Status the way Notion does. Optional; may throw (receipts then fall back to plain words). */
  readonly readFieldOptions?: () => Promise<TaskFieldOptions>;
  /** For the one `tasks` outbox hint after a successful write. */
  readonly connection?: SqliteConnection;
  readonly log?: (entry: LogEntry) => void;
}

export interface UpdateTaskInput extends UpdateTaskFieldRequest {
  readonly taskId: string;
}

export interface RenameTaskInput extends RenameTaskRequest {
  readonly taskId: string;
}

const FALLBACK_STATUS_WORDS: Record<TaskStatus, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
  slipped: "Slipped",
};

/** Task 7 binding ruling: `PLANNING_FIELD_LABELS` widened by one entry, ONLY for this file's own two "unknown field"/"needs a value" messages and the success receipt — `core/planning-field-value.ts`'s own `PLANNING_FIELD_LABELS` stays `PlanningFieldNames`-only (the gate/missing-data-count field set never grows). */
const EDITABLE_FIELD_LABELS: Record<EditableTaskField, string> = { ...PLANNING_FIELD_LABELS, priority: "Priority" };

function isEditableField(field: unknown): field is EditableTaskField {
  return typeof field === "string" && Object.hasOwn(EDITABLE_FIELD_LABELS, field);
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** "2026-10-02" → "Fri, Oct 2" — a calendar date, so formatted as one (no timezone shift). */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

async function liveOptions(deps: UpdateTaskDeps): Promise<TaskFieldOptions | undefined> {
  try {
    return await deps.readFieldOptions?.();
  } catch {
    return undefined;
  }
}

async function describe(deps: UpdateTaskDeps, field: EditableTaskField, value: NonNullable<Task[EditableTaskField]>): Promise<string> {
  switch (field) {
    case "dueDate":
      return humanDate(value as string);
    case "estimatedDurationMinutes":
      return `${value} min`;
    case "area":
      return String(value);
    case "energy": {
      const label = (await liveOptions(deps))?.energy.find((o) => o.value === (value as Energy))?.label;
      return capitalize(label ?? String(value));
    }
    case "status": {
      const label = (await liveOptions(deps))?.status.find((o) => o.value === (value as TaskStatus))?.label;
      return label ?? FALLBACK_STATUS_WORDS[value as TaskStatus];
    }
    case "priority":
      // The value IS the live option name already (`parsePriorityValue`), same as Area.
      return String(value);
  }
}

function hint(deps: UpdateTaskDeps, taskId: string): void {
  deps.connection?.writeTx((db) => appendOutboxInTx(db, { topic: TASKS_TOPIC, entityId: taskId }));
}

function invalid(message: string): { ok: false; error: YohError } {
  return { ok: false, error: { kind: "validation", message } };
}

export async function updateTask(deps: UpdateTaskDeps, input: UpdateTaskInput): Promise<Result<UpdateTaskFieldResponse, YohError>> {
  if (typeof input.taskId !== "string" || input.taskId.trim() === "") return invalid("That Task couldn't be found.");
  if (!isEditableField(input.field)) return invalid("That field can't be edited here.");
  if (typeof input.value !== "string") return invalid(`${EDITABLE_FIELD_LABELS[input.field]} needs a value.`);

  let value: NonNullable<Task[EditableTaskField]>;
  if (input.field === "priority") {
    // Task 7 binding ruling: Priority is a string equal to the live option
    // name (like Area), validated against the LIVE options — never a
    // `PlanningFieldNames` case.
    //
    // Task 9 (M1): unlike Energy/Status (which fall back to plain words),
    // Priority has no non-Notion fallback, so a failed options read and an
    // empty options list are two different, distinguishable failures — not
    // both silently folded into "no matching option" (`try one of: .`).
    let options: TaskFieldOptions | undefined;
    try {
      options = await deps.readFieldOptions?.();
    } catch (err) {
      return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
    }
    if (!options?.priority || options.priority.length === 0) {
      return invalid("Priority isn't set up in Notion.");
    }
    const parsed = parsePriorityValue(input.value, options.priority);
    if (!parsed.ok) return invalid(parsed.message);
    value = parsed.value;
  } else {
    const parsed = parsePlanningFieldValue(input.field, input.value);
    if (!parsed.ok) return invalid(parsed.message);
    value = parsed.value as NonNullable<Task[PlanningFieldNames]>;
  }

  // AD-20: completing a Task is always a check-off (Undo window + Completion Log), never a bare Status write.
  if (input.field === "status" && value === "completed") {
    return invalid("Check the box to complete a Task — that keeps its Undo window and its Completion Log entry.");
  }

  let written: Result<void, YohError>;
  try {
    written = await deps.updateTaskField(input.taskId, input.field, value);
  } catch (err) {
    written = { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }
  if (!written.ok) {
    deps.log?.({ level: "error", event: "update-task.write-failed", detail: { taskId: input.taskId, field: input.field, message: written.error.message } });
    return { ok: false, error: { kind: written.error.kind, message: errorCopy(written.error, { service: "Notion" }) } };
  }

  hint(deps, input.taskId);
  return { ok: true, value: { receipt: `${EDITABLE_FIELD_LABELS[input.field]} set to ${await describe(deps, input.field, value)}.` } };
}

export async function renameTask(deps: UpdateTaskDeps, input: RenameTaskInput): Promise<Result<RenameTaskResponse, YohError>> {
  if (typeof input.taskId !== "string" || input.taskId.trim() === "") return invalid("That Task couldn't be found.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0) return invalid("A Task's title can't be blank.");

  let written: Result<void, YohError>;
  try {
    written = await deps.updateTaskTitle(input.taskId, title);
  } catch (err) {
    written = { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }
  if (!written.ok) {
    deps.log?.({ level: "error", event: "update-task.rename-failed", detail: { taskId: input.taskId, message: written.error.message } });
    return { ok: false, error: { kind: written.error.kind, message: errorCopy(written.error, { service: "Notion" }) } };
  }

  hint(deps, input.taskId);
  return { ok: true, value: { receipt: `Renamed to "${title}".` } };
}

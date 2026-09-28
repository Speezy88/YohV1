/**
 * src/app/sandbox-submit.ts
 *
 * Story 9.2 (FR-38, AD-12 amended, E6): `submitSandboxCard` — a Sandbox
 * Card's direct write, no confirm step, no `Proposal`. Validates every
 * PROVIDED field through `core/planning-field-value.ts`'s
 * `parsePlanningFieldValue` before writing any of them; Area/Energy (if
 * present) are then written FIRST, through the exact same
 * `NotionTaskWriteBindings.updateTaskField` binder `app/update-task.ts`
 * already uses (same live-schema select-guard resolution, same rejection
 * message shape — no second guard invented), so the one field kind whose
 * write can fail on validity is always attempted before Due Date/Estimated
 * Duration. This does not make the whole card's write atomic across Notion
 * calls — if Area's write succeeds and Energy's then fails, Area is already
 * committed even though this function reports `ok:false` — but ordering the
 * one write kind that can fail its own live-schema check first means the
 * common failure case (a bad Area/Energy guess) never leaves the Required
 * fields written at all. Only once every provided field's write has
 * succeeded does this append one `tasks`-topic outbox hint (AD-18).
 *
 * Story 9.3 appends `finishSandboxSession` to this same file — the Finale's
 * one server round trip, raising the session's proof-of-action
 * notification from the client's own accumulated outcome list.
 */
import { appendOutboxInTx } from "../adapters/notification-store.ts";
import { errorCopy, errorCopyForThrown } from "../core/error-copy.ts";
import { PLANNING_FIELD_LABELS, parsePlanningFieldValue } from "../core/planning-field-value.ts";
import { firstCardView } from "../core/sandbox-card-view.ts";
import { TASKS_TOPIC } from "./create-task.ts";
import { sandboxQueue, type SandboxQueueDeps } from "./sandbox-queue.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { NotionTaskWriteBindings } from "../adapters/notion-adapter.ts";
import type { SandboxSaveResponse } from "../types/api.ts";
import type { PlanningFieldNames, Result, Task, YohError } from "../types/domain.ts";

export interface SandboxSubmitDeps {
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly updateTaskField: NotionTaskWriteBindings["updateTaskField"];
  readonly connection: SqliteConnection;
  /** Unused by `submitSandboxCard` itself — carried so Story 9.3's `finishSandboxSession` (this same file) shares one deps object. */
  readonly now: () => Date;
  readonly log?: (entry: LogEntry) => void;
}

export interface SandboxCardInput {
  readonly taskId: string;
  readonly dueDate: string;
  readonly estimatedDurationMinutes: string;
  readonly area?: string;
  readonly energy?: string;
}

export interface SandboxCardOutput {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly receipt: string;
}

function invalid(message: string): { ok: false; error: YohError } {
  return { ok: false, error: { kind: "validation", message } };
}

/** Parses every PROVIDED field up front — nothing is written until every one of these succeeds. */
function parseAll(input: SandboxCardInput): Result<
  { readonly dueDate: string; readonly estimatedDurationMinutes: number; readonly area?: string; readonly energy?: Task["energy"] },
  YohError
> {
  const dueDate = parsePlanningFieldValue("dueDate", input.dueDate);
  if (!dueDate.ok) return invalid(dueDate.message);
  const duration = parsePlanningFieldValue("estimatedDurationMinutes", input.estimatedDurationMinutes);
  if (!duration.ok) return invalid(duration.message);

  let area: string | undefined;
  if (input.area !== undefined) {
    const parsed = parsePlanningFieldValue("area", input.area);
    if (!parsed.ok) return invalid(parsed.message);
    area = parsed.value as string;
  }
  let energy: Task["energy"] | undefined;
  if (input.energy !== undefined) {
    const parsed = parsePlanningFieldValue("energy", input.energy);
    if (!parsed.ok) return invalid(parsed.message);
    energy = parsed.value as Task["energy"];
  }

  return {
    ok: true,
    value: { dueDate: dueDate.value as string, estimatedDurationMinutes: duration.value as number, ...(area !== undefined ? { area } : {}), ...(energy !== undefined ? { energy } : {}) },
  };
}

function hint(deps: SandboxSubmitDeps, taskId: string): void {
  deps.connection.writeTx((db) => appendOutboxInTx(db, { topic: TASKS_TOPIC, entityId: taskId }));
}

export async function submitSandboxCard(deps: SandboxSubmitDeps, input: SandboxCardInput): Promise<Result<SandboxCardOutput, YohError>> {
  const parsed = parseAll(input);
  if (!parsed.ok) return parsed;

  let tasks: readonly Task[];
  try {
    tasks = await deps.readTasks();
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }
  const task = tasks.find((t) => t.id === input.taskId);
  if (!task) return invalid("That Task couldn't be found.");

  // Area/Energy first (the one write kind whose live-schema resolution can
  // fail) — see this file's own doc comment for the full ordering rationale.
  const writes: Array<[PlanningFieldNames, NonNullable<Task[PlanningFieldNames]>]> = [];
  if (parsed.value.area !== undefined) writes.push(["area", parsed.value.area]);
  if (parsed.value.energy !== undefined) writes.push(["energy", parsed.value.energy]);
  writes.push(["dueDate", parsed.value.dueDate]);
  writes.push(["estimatedDurationMinutes", parsed.value.estimatedDurationMinutes]);

  const changed: PlanningFieldNames[] = [];
  for (const [field, value] of writes) {
    let written: Result<void, YohError>;
    try {
      written = await deps.updateTaskField(input.taskId, field, value);
    } catch (err) {
      written = { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
    }
    if (!written.ok) {
      deps.log?.({ level: "error", event: "sandbox-submit.write-failed", detail: { taskId: input.taskId, field, message: written.error.message } });
      return { ok: false, error: { kind: written.error.kind, message: errorCopy(written.error, { service: "Notion" }) } };
    }
    changed.push(field);
  }

  hint(deps, input.taskId);
  const receipt = `${changed.map((f) => PLANNING_FIELD_LABELS[f]).join(", ")} saved.`;
  return { ok: true, value: { taskId: input.taskId, taskTitle: task.title, receipt } };
}

/**
 * Chunk 9.2-B fix round 1: `POST /api/sandbox/:taskId/save`'s ONE app
 * function (AGENTS.md: a shell may call only one) — `submitSandboxCard`'s
 * write, then (only on success) `sandboxQueue` re-derived with the just-
 * saved `taskId` folded into `exclude`, built into the exact `{ receipt,
 * next }` wire shape the route used to assemble itself from two separate
 * calls. Reuses `SandboxSubmitDeps`/`SandboxQueueDeps` verbatim (no
 * duplicated deps shape) — the route's own merged `sandboxDeps` object
 * already satisfies both.
 */
export interface SaveSandboxCardDeps extends SandboxSubmitDeps, SandboxQueueDeps {}

export interface SaveSandboxCardInput extends SandboxCardInput {
  /** This session's already-handled taskIds, NOT including this card (mirrors `SandboxSaveRequest.exclude`). */
  readonly exclude: readonly string[];
}

export async function saveSandboxCardAndAdvance(deps: SaveSandboxCardDeps, input: SaveSandboxCardInput): Promise<Result<SandboxSaveResponse, YohError>> {
  const { exclude, ...cardInput } = input;
  const submitted = await submitSandboxCard(deps, cardInput);
  if (!submitted.ok) return submitted;

  const next = await sandboxQueue(deps, { exclude: [...exclude, input.taskId] });
  if (!next.ok) return next;

  return { ok: true, value: { receipt: submitted.value.receipt, next: firstCardView(next.value.items) } };
}

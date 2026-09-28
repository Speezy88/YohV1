/**
 * src/app/create-task.ts
 *
 * Task 6B (FR-43; AD-3/AD-12 amended 2026-09-27). A Task Spencer types
 * himself into the Tasks page's quick-add row is a DIRECT write — the same
 * tier as FR-24 — not a Yoh-drafted Proposal: his own typed line is the
 * confirmation. The Proposal/confirm path (`app/create-item.ts` →
 * `confirm-proposal.ts`) stays for anything Yoh drafts from Chat (FR-26).
 *
 * The line is parsed by the ONE quick-add parser (`core/quick-add.ts`), with
 * `#tag`s matched against the LIVE Area options (`closestOption`, the same
 * matcher the write-time select guard uses). The page is then validated
 * against the live schema twice, exactly as AD-12 requires for every
 * `createPage` caller: at draft time here
 * (`resolveNotionPageDraftProperties`) and again at write time inside
 * `createPage` itself. On success one `tasks` outbox hint tells every open
 * client to refetch (AD-18).
 *
 * `previewQuickAdd` is the same parse with no write at all: the chips the
 * quick-add row shows while Spencer types ("Yoh reads: Due Fri, Oct 2 · 90
 * min …") — the deterministic parse only. The Haiku fallback (below) runs
 * only on submit, never while typing, so a field it alone reads was never
 * shown as a chip first; it's disclosed after the fact instead, in the
 * success receipt's "— also read: ..." clause (Task 9, M4). It matches
 * `#tag`s against the Area options the page already holds from its last
 * list read, so a keystroke never costs a Notion call.
 */
import type { AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { appendOutboxInTx } from "../adapters/notification-store.ts";
import { closestOption } from "../adapters/notion-select-match.ts";
import {
  createPage,
  readTaskFieldOptions,
  resolveNotionPageDraftProperties,
  DEFAULT_ENERGY_OPTION_NAMES,
  DEFAULT_TASK_STATUS_OPTION_NAMES,
} from "../adapters/notion-adapter.ts";
import { errorCopy, errorCopyForThrown } from "../core/error-copy.ts";
import { hasUnresolvedFieldWords, matchAreaTag, parseQuickAdd, type QuickAddField, type QuickAddFields } from "../core/quick-add.ts";
import { normalizeQuickAdd, type NormalizeQuickAddDeps } from "./quick-add-normalize.ts";
import type { NotionCreatePageBindingFn } from "./create-item.ts";
import type { CreateTaskRequest, CreateTaskResponse, QuickAddPreviewRequest, QuickAddPreviewResponse, TaskListItem } from "../types/api.ts";
import type { PlanningFieldNames, Result, TaskFieldOptions, YohError } from "../types/domain.ts";

/** The outbox topic the Tasks page refetches on. */
export const TASKS_TOPIC = "tasks";

export interface CreateTaskDeps {
  /** Lazy Notion client/config (the same shape `app/create-item.ts` uses) — draft-time AND write-time resolution both run against it. */
  readonly getNotionCreatePageBinding: NotionCreatePageBindingFn;
  readonly now: () => Date;
  /** Host timezone: "fri"/"tomorrow" resolve against Spencer's calendar day, never UTC's. */
  readonly timeZone: string;
  /** For the one `tasks` outbox hint after a successful write. Absent: no hint (tests that don't care). */
  readonly connection?: SqliteConnection;
  readonly log?: (entry: LogEntry) => void;
  /**
   * Polish 4 Task 1: the Haiku fallback's Claude client — absent when
   * `CLAUDE_API_KEY` isn't configured, in which case the fallback is
   * simply skipped (the deterministic parse alone still creates the Task).
   */
  readonly llmClient?: AnthropicMessagesClient;
  readonly quickAddNormalizeTimeoutMs?: number;
  /** Injectable seam (tests only) — threaded straight through to `quick-add-normalize.ts`'s `normalizeQuickAdd`. */
  readonly normalize?: NormalizeQuickAddDeps["normalize"];
}

export type QuickAddPreviewDeps = Pick<CreateTaskDeps, "now" | "timeZone">;

/** A tag's exact/prefix match first (`matchAreaTag`), then the write guard's own typo-tolerant `closestOption`. */
function areaMatcher(areaOptions: readonly string[] | undefined): ((raw: string) => string | undefined) | undefined {
  if (areaOptions === undefined) return undefined; // Area is free text: the tag is used as typed
  return (raw) => matchAreaTag(raw, areaOptions) ?? closestOption(raw.replace(/[-_]+/g, " "), areaOptions);
}

function fail(kind: YohError["kind"], message: string): { ok: false; error: YohError } {
  return { ok: false, error: { kind, message } };
}

const NEW_TASK_FIELDS: readonly PlanningFieldNames[] = ["estimatedDurationMinutes", "area", "dueDate", "energy"];

/** Task 9 (M4): the receipt's "also read" clause lists fields in this order, regardless of the order Haiku returned them in. */
const HAIKU_RECEIPT_FIELD_ORDER: readonly QuickAddField[] = ["dueDate", "estimatedDurationMinutes", "area", "energy", "status", "priority"];

/**
 * The short words for one field Haiku alone read (the deterministic parse
 * left it undefined) — several may appear on the same receipt line, so
 * each stays brief; never the fuller "Due Date set to Fri, Oct 2." wording
 * `update-task.ts`'s single-field receipts use.
 */
function haikuFieldWords(field: QuickAddField, fields: QuickAddFields, options: TaskFieldOptions): string {
  switch (field) {
    case "dueDate": {
      const [y, m, d] = fields.dueDate!.split("-").map(Number);
      const weekday = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      return `Due ${weekday}`;
    }
    case "estimatedDurationMinutes":
      return `${fields.estimatedDurationMinutes} min`;
    case "area":
      return `Area ${fields.area}`;
    case "energy": {
      const label = options.energy.find((o) => o.value === fields.energy)?.label ?? DEFAULT_ENERGY_OPTION_NAMES[fields.energy!];
      return `Energy ${label}`;
    }
    case "status": {
      const label = options.status.find((o) => o.value === fields.status)?.label ?? DEFAULT_TASK_STATUS_OPTION_NAMES[fields.status!];
      return `Status ${label}`;
    }
    case "priority":
      return `Priority ${fields.priority}`;
  }
}

export async function previewQuickAdd(deps: QuickAddPreviewDeps, input: QuickAddPreviewRequest): Promise<Result<QuickAddPreviewResponse, YohError>> {
  const resolveArea = areaMatcher(input.areaOptions);
  const parsed = parseQuickAdd(input.text, {
    now: deps.now(),
    timeZone: deps.timeZone,
    ...(resolveArea ? { resolveArea } : {}),
    ...(input.areaOptions ? { areaOptions: input.areaOptions } : {}),
    ...(input.priorityOptions ? { priorityOptions: input.priorityOptions } : {}),
  });
  return { ok: true, value: { title: parsed.title, ...parsed.fields, unmatchedAreas: parsed.unmatchedAreas } };
}

export async function createTask(deps: CreateTaskDeps, input: CreateTaskRequest): Promise<Result<CreateTaskResponse, YohError>> {
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    return fail("validation", "Type a title for the new Task first.");
  }

  const binding = deps.getNotionCreatePageBinding();
  if (!binding.ok) return fail(binding.error.kind, errorCopy(binding.error, { service: "Notion" }));
  const { client, config } = binding.value;

  let options: TaskFieldOptions;
  try {
    options = await readTaskFieldOptions(client, config);
  } catch (err) {
    deps.log?.({ level: "error", event: "create-task.options-read-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
    return fail("unreachable", errorCopyForThrown(err, { service: "Notion" }));
  }

  const resolveArea = areaMatcher(options.area);
  const parsed = parseQuickAdd(input.text, {
    now: deps.now(),
    timeZone: deps.timeZone,
    ...(resolveArea ? { resolveArea } : {}),
    ...(options.area ? { areaOptions: options.area } : {}),
    ...(options.priority && options.priority.length > 0 ? { priorityOptions: options.priority } : {}),
  });

  // Polish 4 Task 1: submit-only Haiku fallback — never while typing
  // (`previewQuickAdd`, below, never calls this). Only reached when the
  // deterministic title STILL looks like it's carrying an unread field.
  // The deterministic value wins on any conflict; Haiku only fills gaps and
  // may clean up the title further. Any failure (not configured, invalid
  // JSON, an option that isn't actually live, or a timeout) falls back to
  // the deterministic parse alone — the Task is still created either way.
  let title = parsed.title;
  let fields: QuickAddFields = parsed.fields;
  // Task 9 (M4): fields Haiku set that the deterministic parse left
  // undefined — computed BEFORE the merge below (which lets `parsed.fields`
  // win on conflict), so a field both sides agree on is never listed twice.
  let haikuOnlyFields: readonly QuickAddField[] = [];
  if (hasUnresolvedFieldWords(parsed.title)) {
    const haiku = await normalizeQuickAdd(
      {
        now: deps.now,
        timeZone: deps.timeZone,
        ...(deps.llmClient ? { llmClient: deps.llmClient } : {}),
        ...(deps.connection ? { connection: deps.connection } : {}),
        ...(deps.quickAddNormalizeTimeoutMs !== undefined ? { timeoutMs: deps.quickAddNormalizeTimeoutMs } : {}),
        ...(deps.normalize ? { normalize: deps.normalize } : {}),
      },
      { text: input.text, options },
    );
    if (haiku.ok) {
      // Fix round 1: `haiku.value.title` is already validated (non-blank,
      // length-bounded, and checked to carry no leftover field-like word)
      // by `quick-add-normalize.ts` — `undefined` here means it failed that
      // check, so the deterministic title is kept untouched.
      if (haiku.value.title !== undefined) title = haiku.value.title;
      haikuOnlyFields = HAIKU_RECEIPT_FIELD_ORDER.filter(
        (field) => haiku.value.fields[field] !== undefined && parsed.fields[field] === undefined,
      );
      fields = { ...haiku.value.fields, ...parsed.fields };
    } else {
      deps.log?.({ level: "warn", event: "create-task.quick-add-normalize-failed", detail: { message: haiku.error.message } });
    }
  }

  // Yoh-internal field name -> raw value, the shape `createPage` resolves.
  const properties: Record<string, string> = { title };
  if (fields.dueDate !== undefined) properties["dueDate"] = fields.dueDate;
  if (fields.estimatedDurationMinutes !== undefined) properties["estimatedDurationMinutes"] = String(fields.estimatedDurationMinutes);
  if (fields.area !== undefined) properties["area"] = fields.area;
  if (fields.energy !== undefined) {
    // The live option name when the schema lists one; the known default otherwise (still resolved by `closestOption`).
    properties["energy"] = options.energy.find((o) => o.value === fields.energy)?.label ?? DEFAULT_ENERGY_OPTION_NAMES[fields.energy] ?? fields.energy;
  }
  if (fields.status !== undefined) {
    // Never Completed (`core/quick-add.ts` and `quick-add-normalize.ts` both already refuse to produce it) — the live option name when the schema lists one, the known default otherwise.
    properties["status"] = options.status.find((o) => o.value === fields.status)?.label ?? DEFAULT_TASK_STATUS_OPTION_NAMES[fields.status];
  }
  // Task 7: Priority is already the LIVE option name verbatim (`parsePriorityValue`) — no lookup needed, like Area.
  if (fields.priority !== undefined) properties["priority"] = fields.priority;

  // AD-12, draft time: never attempt a write the live schema would reject.
  const drafted = await resolveNotionPageDraftProperties(client, config, "Tasks", properties);
  if (!drafted.ok) return fail(drafted.error.kind, errorCopy(drafted.error, { service: "Notion" }));

  // AD-12, write time: `createPage` re-runs the same resolution itself.
  const created = await createPage(client, config, "Tasks", properties);
  if (!created.ok) {
    deps.log?.({ level: "error", event: "create-task.write-failed", detail: { message: created.error.message } });
    return fail(created.error.kind, errorCopy(created.error, { service: "Notion" }));
  }

  const pageId = created.value.pageId;
  deps.connection?.writeTx((db) => appendOutboxInTx(db, { topic: TASKS_TOPIC, entityId: pageId }));

  const task: TaskListItem = {
    id: pageId,
    title,
    ...fields,
    // Status is left to Notion's own default for a new page when quick-add didn't set one, so an absent Status isn't reported missing.
    missing: NEW_TASK_FIELDS.filter((field) => fields[field as keyof QuickAddFields] === undefined),
    overdue: false,
  };
  // Task 9 (M4): a field only Haiku read is disclosed here rather than
  // silently applied — it was never shown as a preview chip beforehand.
  const alsoRead = haikuOnlyFields.length > 0 ? ` — also read: ${haikuOnlyFields.map((field) => haikuFieldWords(field, fields, options)).join(", ")}.` : ".";
  return { ok: true, value: { task, receipt: `Added "${title}" to Tasks${alsoRead}` } };
}

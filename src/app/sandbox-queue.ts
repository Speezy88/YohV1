/**
 * src/app/sandbox-queue.ts
 *
 * Story 9.2 (AD-11, E5): the ONE computed source for `/sandbox`'s queue —
 * re-derives it from a live Notion read plus the Data-Completeness Gate
 * every time it's called. No new SQLite table, no new `InteractionRequest`
 * kind, no stored count anywhere. Every consumer (this story's card flow,
 * Task 4's Needs-Data Indicator, Task 4's `needs-data` notification count)
 * calls this function directly — none keeps its own count.
 *
 * Reuses `rituals/data-completeness.ts`'s `mergeStoredOverrides` (`app/` ->
 * `rituals/` is a permitted edge, precedent: `app/night-close-out.ts`
 * importing `rituals/night-ritual.ts`) rather than duplicating that merge
 * logic — a previously-answered field (through the blind FR-4 ask, or a
 * prior Sandbox Card save) counts here exactly as it does for the Morning
 * Plan.
 */
import { mergeStoredOverrides } from "../rituals/data-completeness.ts";
import { checkDataCompleteness } from "../core/data-completeness-gate.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { MemoryStore } from "../adapters/memory-store.ts";
import type { Energy, IsoDate, RequiredFieldNames, Result, Task, YohError } from "../types/domain.ts";

export interface SandboxQueueItem {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly dueDate?: IsoDate;
  readonly estimatedDurationMinutes?: number;
  readonly area?: string;
  readonly energy?: Energy;
  /** Always non-empty — which Required field(s) this Task is missing. */
  readonly missingFields: readonly RequiredFieldNames[];
}

export interface SandboxQueueDeps {
  readonly store: MemoryStore;
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

export interface SandboxQueueInput {
  /** taskIds to leave out — the CURRENT `/sandbox` session's already-handled cards. Omitted/`[]` for the "true" global count. */
  readonly exclude?: readonly string[];
}

export interface SandboxQueueResponse {
  readonly items: readonly SandboxQueueItem[];
}

/** Soonest-due-first; no-due-date last; ties broken by title (stable, locale-independent). */
function compareItems(a: SandboxQueueItem, b: SandboxQueueItem): number {
  if (a.dueDate === undefined && b.dueDate === undefined) return a.taskTitle < b.taskTitle ? -1 : a.taskTitle > b.taskTitle ? 1 : 0;
  if (a.dueDate === undefined) return 1;
  if (b.dueDate === undefined) return -1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.taskTitle < b.taskTitle ? -1 : a.taskTitle > b.taskTitle ? 1 : 0;
}

export async function sandboxQueue(deps: SandboxQueueDeps, input: SandboxQueueInput): Promise<Result<SandboxQueueResponse, YohError>> {
  let tasks: readonly Task[];
  try {
    tasks = await deps.readTasks();
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }

  const merged = mergeStoredOverrides(deps.store, tasks);
  const gated = checkDataCompleteness(merged);
  if (!gated.ok) return gated;

  const exclude = new Set(input.exclude ?? []);
  const byId = new Map(merged.map((t) => [t.id, t] as const));

  const items: SandboxQueueItem[] = gated.value.incomplete
    .filter((report) => !exclude.has(report.taskId))
    .map((report) => {
      const task = byId.get(report.taskId);
      return {
        taskId: report.taskId,
        taskTitle: report.taskTitle,
        ...(task?.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
        ...(task?.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: task.estimatedDurationMinutes } : {}),
        ...(task?.area !== undefined ? { area: task.area } : {}),
        ...(task?.energy !== undefined ? { energy: task.energy } : {}),
        missingFields: report.missingFields,
      };
    })
    .sort(compareItems);

  return { ok: true, value: { items } };
}

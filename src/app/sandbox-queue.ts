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
import { isOpenTask } from "../core/planning-field-value.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { MemoryStore } from "../adapters/memory-store.ts";
import type { SandboxCardOptions } from "../types/api.ts";
import type { Energy, IsoDate, RequiredFieldNames, Result, Task, TaskFieldOptions, YohError } from "../types/domain.ts";

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
  /**
   * Task 5 (polish-5): the SAME live-schema read `buildTasksDeps`
   * (`shell/server.ts`) already binds for the Tasks page's own inline
   * selects — the Sandbox Card's Area/Energy fields render as `<select>`s
   * from this, falling back to free text when it's absent, throws, or
   * returns `area: undefined` (`readSandboxCardOptions` below handles all
   * three identically to `app/tasks-view.ts`'s own `readFieldOptions`
   * catch). Optional so every existing `SandboxQueueDeps` literal (tests,
   * the fixture server before this task) stays valid — absent simply means
   * "no live options," never a hard failure. Only actually called when
   * `input.withOptions` is true (fix round 1) — never for a plain count.
   */
  readonly readFieldOptions?: () => Promise<TaskFieldOptions>;
}

export interface SandboxQueueInput {
  /** taskIds to leave out — the CURRENT `/sandbox` session's already-handled cards. Omitted/`[]` for the "true" global count. */
  readonly exclude?: readonly string[];
  /**
   * Fix round 1 (Task 5, polish-5): only a card-producing caller (the
   * `/sandbox` chat dispatch, `saveSandboxCardAndAdvance`, and the
   * `/api/sandbox/start`/`:taskId/skip` routes) sets this — it's the ONE
   * gate on `deps.readFieldOptions` ever being called. A plain count read
   * (`GET /api/sandbox/count`, and any future needs-data count) omits it,
   * so a live Notion schema read never rides along with a request that only
   * needs `items.length`. Omitted/false: `options` comes back as `{area:
   * [], energy: []}` without touching `deps.readFieldOptions` at all.
   */
  readonly withOptions?: boolean;
}

export interface SandboxQueueResponse {
  readonly items: readonly SandboxQueueItem[];
  /** Task 5 (polish-5): the live Area/Energy option lists every card `firstCardView` builds from this response's `items` carries (`SandboxCardView.options`). */
  readonly options: SandboxCardOptions;
}

/** Soonest-due-first; no-due-date last; ties broken by title (stable, locale-independent). */
function compareItems(a: SandboxQueueItem, b: SandboxQueueItem): number {
  if (a.dueDate === undefined && b.dueDate === undefined) return a.taskTitle < b.taskTitle ? -1 : a.taskTitle > b.taskTitle ? 1 : 0;
  if (a.dueDate === undefined) return 1;
  if (b.dueDate === undefined) return -1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.taskTitle < b.taskTitle ? -1 : a.taskTitle > b.taskTitle ? 1 : 0;
}

const EMPTY_OPTIONS: SandboxCardOptions = { area: [], energy: [] };

/**
 * Task 5 (polish-5), fix round 1: the ONE place `sandboxQueue` resolves
 * `deps.readFieldOptions` into the wire's `SandboxCardOptions` — absent dep
 * or a throw both fall back to `EMPTY_OPTIONS`; only the throw logs a warn
 * (an absent dep is simply "not configured," and `area: undefined` is a
 * legitimate live-schema answer — Area is a free-text property on this
 * workspace — never a failure worth logging).
 */
async function readSandboxCardOptions(deps: SandboxQueueDeps): Promise<SandboxCardOptions> {
  if (!deps.readFieldOptions) return EMPTY_OPTIONS;
  try {
    const options = await deps.readFieldOptions();
    return { area: options.area ?? [], energy: options.energy };
  } catch (err) {
    deps.log?.({ level: "warn", event: "sandbox-queue.options-read-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
    return EMPTY_OPTIONS;
  }
}

export async function sandboxQueue(deps: SandboxQueueDeps, input: SandboxQueueInput): Promise<Result<SandboxQueueResponse, YohError>> {
  let tasks: readonly Task[];
  try {
    tasks = await deps.readTasks();
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }

  // Final-review MUST-FIX 1: a completed Task needs nothing more placed —
  // exclude it before gating, so it never lands in the queue (nor its chip
  // count) just because it lacks a Due Date/Duration it will never need.
  const merged = mergeStoredOverrides(deps.store, tasks.filter(isOpenTask));
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

  // Fix round 1: a plain count (GET /api/sandbox/count, and any future
  // needs-data count) never sets `withOptions` — `deps.readFieldOptions` is
  // then never even called, so a live Notion schema read never rides along
  // with a request that only needs `items.length`.
  const options = input.withOptions ? await readSandboxCardOptions(deps) : EMPTY_OPTIONS;
  return { ok: true, value: { items, options } };
}

/**
 * src/app/tasks-view.ts
 *
 * Task 6B (FR-43, AD-17): the Tasks page's list, computed server-side.
 * Every Task in Notion — completed ones included — grouped Overdue / Today
 * / This week / Later / No date by default (a completed Task whose due date
 * has passed goes to "Done earlier" rather than "Overdue"), or by Area or
 * Status; filtered by a search query over title and Area; each row carrying
 * the planning fields Notion has no value for. "Today" is the host-timezone
 * date, never the browser's. "This week" is the next six days after today.
 *
 * Read-only: nothing here writes. The select options come from the Tasks
 * data source's live schema; if that read fails the list still loads, with
 * options built from what is already known (the write path's own select
 * guard still checks every value against the live schema).
 */
import type { LogEntry } from "../adapters/logger.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { taskMissingFields } from "../core/planning-field-value.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { TaskGroup, TaskListItem, TasksGroupBy, TasksListRequest, TasksMissingCountResponse, TasksViewResponse } from "../types/api.ts";
import type { IsoDate, Result, Task, TaskFieldOptions, TaskStatus, YohError } from "../types/domain.ts";

export interface TasksViewDeps {
  /** A live Notion read of every Task (`readNotionTasks`, bound). May throw. */
  readonly readTasks: () => Promise<readonly Task[]>;
  /** The live select options (`readTaskFieldOptions`, bound). May throw. */
  readonly readFieldOptions: () => Promise<TaskFieldOptions>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

/** "This week" = the six days after today. */
const THIS_WEEK_DAYS = 6;

const STATUS_ORDER: readonly TaskStatus[] = ["not-started", "in-progress", "slipped", "completed"];
const DEFAULT_STATUS_LABELS: Record<TaskStatus, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  slipped: "Slipped",
  completed: "Completed",
};
const FALLBACK_ENERGY: TaskFieldOptions["energy"] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

function addDays(iso: IsoDate, days: number): IsoDate {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

function toListItem(task: Task, today: IsoDate): TaskListItem {
  const completed = task.status === "completed";
  return {
    id: task.id,
    title: task.title,
    ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
    ...(task.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: task.estimatedDurationMinutes } : {}),
    ...(task.area !== undefined ? { area: task.area } : {}),
    ...(task.energy !== undefined ? { energy: task.energy } : {}),
    ...(task.status !== undefined ? { status: task.status } : {}),
    missing: taskMissingFields(task),
    overdue: !completed && task.dueDate !== undefined && task.dueDate < today,
  };
}

/** Open Tasks before completed ones, then soonest due (undated last), then title. */
function compareRows(a: TaskListItem, b: TaskListItem): number {
  const doneA = a.status === "completed" ? 1 : 0;
  const doneB = b.status === "completed" ? 1 : 0;
  if (doneA !== doneB) return doneA - doneB;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === undefined) return 1;
    if (b.dueDate === undefined) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.title.localeCompare(b.title);
}

interface GroupSpec {
  readonly key: string;
  readonly label: string;
  readonly tone: TaskGroup["tone"];
}

function dueGroup(item: TaskListItem, today: IsoDate): GroupSpec {
  const weekEnd = addDays(today, THIS_WEEK_DAYS);
  if (item.dueDate === undefined) return { key: "no-date", label: "No date", tone: "neutral" };
  if (item.dueDate < today) {
    return item.overdue ? { key: "overdue", label: "Overdue", tone: "danger" } : { key: "done-earlier", label: "Done earlier", tone: "neutral" };
  }
  if (item.dueDate === today) return { key: "today", label: "Today", tone: "accent" };
  if (item.dueDate <= weekEnd) return { key: "this-week", label: "This week", tone: "neutral" };
  return { key: "later", label: "Later", tone: "neutral" };
}

const DUE_ORDER = ["overdue", "today", "this-week", "later", "no-date", "done-earlier"];

function statusLabels(options: TaskFieldOptions): Record<TaskStatus, string> {
  const labels = { ...DEFAULT_STATUS_LABELS };
  for (const option of options.status) labels[option.value] = option.label;
  return labels;
}

function group(items: readonly TaskListItem[], groupBy: TasksGroupBy, today: IsoDate, options: TaskFieldOptions): TaskGroup[] {
  const buckets = new Map<string, { spec: GroupSpec; tasks: TaskListItem[] }>();
  const labels = statusLabels(options);
  for (const item of items) {
    let spec: GroupSpec;
    if (groupBy === "due") spec = dueGroup(item, today);
    else if (groupBy === "area") spec = item.area === undefined ? { key: "area:", label: "No area", tone: "neutral" } : { key: `area:${item.area}`, label: item.area, tone: "neutral" };
    else spec = item.status === undefined ? { key: "status:", label: "No status", tone: "neutral" } : { key: `status:${item.status}`, label: labels[item.status], tone: "neutral" };
    const bucket = buckets.get(spec.key) ?? { spec, tasks: [] };
    bucket.tasks.push(item);
    buckets.set(spec.key, bucket);
  }

  const rank = (key: string): number => {
    if (groupBy === "due") return DUE_ORDER.indexOf(key);
    if (groupBy === "status") return key === "status:" ? STATUS_ORDER.length : STATUS_ORDER.indexOf(key.slice("status:".length) as TaskStatus);
    return key === "area:" ? 1 : 0;
  };

  return [...buckets.values()]
    .sort((a, b) => rank(a.spec.key) - rank(b.spec.key) || a.spec.label.localeCompare(b.spec.label, undefined, { sensitivity: "base" }))
    .map(({ spec, tasks }) => ({ ...spec, tasks: tasks.sort(compareRows) }));
}

function fallbackOptions(tasks: readonly Task[]): TaskFieldOptions {
  const areas = [...new Set(tasks.flatMap((t) => (t.area === undefined ? [] : [t.area])))].sort((a, b) => a.localeCompare(b));
  return {
    area: areas,
    energy: FALLBACK_ENERGY,
    status: STATUS_ORDER.map((value) => ({ value, label: DEFAULT_STATUS_LABELS[value] })),
  };
}

export async function listTasks(deps: TasksViewDeps, input: TasksListRequest): Promise<Result<TasksViewResponse, YohError>> {
  const groupBy: TasksGroupBy = input.groupBy ?? "due";
  const query = (input.query ?? "").trim();
  const today = localIsoDate(deps.now(), deps.timeZone);

  let tasks: readonly Task[];
  try {
    tasks = await deps.readTasks();
  } catch (err) {
    deps.log?.({ level: "error", event: "tasks-view.read-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }

  let options: TaskFieldOptions;
  try {
    options = await deps.readFieldOptions();
  } catch (err) {
    deps.log?.({ level: "warn", event: "tasks-view.options-read-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
    options = fallbackOptions(tasks);
  }

  const needle = query.toLowerCase();
  const matching = needle.length === 0 ? tasks : tasks.filter((t) => t.title.toLowerCase().includes(needle) || (t.area ?? "").toLowerCase().includes(needle));
  const items = matching.map((t) => toListItem(t, today));

  return { ok: true, value: { today, groupBy, query, total: tasks.length, groups: group(items, groupBy, today, options), options } };
}

/**
 * Real-use fixes plan, Task 2: the Chat header's quiet "N tasks missing
 * data" chip. Deliberately a bare read + count over `taskMissingFields`
 * (the SAME rule `listTasks`'s rows already badge), not a second endpoint
 * that re-groups/re-filters — the chip needs nothing `listTasks` computes
 * beyond that one rule, so this never reads `readFieldOptions` at all.
 */
export interface TasksMissingCountDeps {
  /** A live Notion read of every Task (`readNotionTasks`, bound). May throw. */
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly log?: (entry: LogEntry) => void;
}

export async function countTasksMissingData(deps: TasksMissingCountDeps, _input: Record<string, never>): Promise<Result<TasksMissingCountResponse, YohError>> {
  let tasks: readonly Task[];
  try {
    tasks = await deps.readTasks();
  } catch (err) {
    deps.log?.({ level: "error", event: "tasks-view.missing-count-read-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }
  return { ok: true, value: { count: tasks.filter((t) => taskMissingFields(t).length > 0).length } };
}

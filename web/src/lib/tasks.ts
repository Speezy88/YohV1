/**
 * web/src/lib/tasks.ts
 *
 * Task 6B: the Tasks page's server calls and its list hook. Everything the
 * list means — the Due buckets, "today", what's missing, which options a
 * select offers — is computed server-side (`GET /api/tasks`, AD-17); this
 * file fetches it, keeps the last good list on screen while a newer one
 * loads, and refetches on a `tasks` or `plan` hint from the ONE shared
 * event bus (`eventBus.ts`, AD-18 — never a second EventSource). A `tasks`
 * hint follows every create or field write; a `plan` hint follows a
 * check-off commit, which changes a Task's Status.
 *
 * Every call resolves to an outcome and never throws: a rejected request
 * and an `{ok: false}` envelope both come back as `{ok: false, message}`,
 * so the caller always has a failure to render.
 *
 * The formatting helpers are presentation only: they turn the server's
 * ISO dates and minutes into the words a row shows ("Today", "Fri, Oct 2",
 * "90 min"), always relative to the server's own `today`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "./apiClient.ts";
import { onHint } from "./eventBus.ts";
import type {
  CreateTaskResponse,
  QuickAddPreviewResponse,
  RenameTaskResponse,
  TasksGroupBy,
  TasksViewResponse,
  UpdateTaskFieldResponse,
} from "../../../src/types/api.ts";
import type { PlanningFieldNames } from "../../../src/types/domain.ts";

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

async function settle<T>(request: () => Promise<{ json(): Promise<unknown> }>): Promise<Outcome<T>> {
  try {
    const res = await request();
    const result = (await res.json()) as { ok: true; value: T } | { ok: false; error: { message: string } };
    return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message };
  } catch {
    return { ok: false, message: "I couldn't reach Yoh's server just now; nothing was changed." };
  }
}

export function fetchTasks(groupBy: TasksGroupBy, query: string): Promise<Outcome<TasksViewResponse>> {
  return settle(() => apiClient.api.tasks.$get({ query: { groupBy, ...(query ? { query } : {}) } }));
}

export function requestCreateTask(text: string): Promise<Outcome<CreateTaskResponse>> {
  return settle(() => apiClient.api.tasks.$post({ json: { text } }));
}

export function requestQuickAddPreview(text: string, areaOptions: readonly string[] | undefined): Promise<Outcome<QuickAddPreviewResponse>> {
  return settle(() => apiClient.api.tasks.parse.$post({ json: { text, ...(areaOptions ? { areaOptions: [...areaOptions] } : {}) } }));
}

export function requestUpdateTaskField(taskId: string, field: PlanningFieldNames, value: string): Promise<Outcome<UpdateTaskFieldResponse>> {
  return settle(() => apiClient.api.tasks[":id"].field.$post({ param: { id: taskId }, json: { field, value } }));
}

export function requestRenameTask(taskId: string, title: string): Promise<Outcome<RenameTaskResponse>> {
  return settle(() => apiClient.api.tasks[":id"].title.$post({ param: { id: taskId }, json: { title } }));
}

// ============================================================================
// The list hook
// ============================================================================

export type TasksListState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: TasksViewResponse; readonly refreshFailed?: { readonly message: string; readonly at: Date } }
  | { readonly status: "error"; readonly message: string };

/** Hint topics that can change what the Tasks list shows. */
const REFETCH_TOPICS = new Set(["tasks", "plan"]);

/**
 * Fetches the list for `groupBy`/`query` (callers debounce `query`), then
 * refetches on a relevant hint. A failed refresh keeps the last good list
 * visible with `refreshFailed` set (EXPERIENCE.md: "Notion unreachable —
 * last-loaded Tasks stay visible"). Out-of-order responses are dropped:
 * only the newest request may land.
 */
export function useTasksList(groupBy: TasksGroupBy, query: string): { readonly state: TasksListState; refetch(): Promise<void> } {
  const [state, setState] = useState<TasksListState>({ status: "loading" });
  const latest = useRef(0);
  const params = useRef({ groupBy, query });
  params.current = { groupBy, query };

  const refetch = useCallback(async (): Promise<void> => {
    const seq = ++latest.current;
    const outcome = await fetchTasks(params.current.groupBy, params.current.query);
    if (seq !== latest.current) return;
    setState((prev) => {
      if (outcome.ok) return { status: "loaded", value: outcome.value };
      if (prev.status === "loaded") return { ...prev, refreshFailed: { message: outcome.message, at: new Date() } };
      return { status: "error", message: outcome.message };
    });
  }, []);

  useEffect(() => {
    void refetch();
  }, [groupBy, query, refetch]);

  useEffect(
    () =>
      onHint((hint) => {
        if (REFETCH_TOPICS.has(hint.topic)) void refetch();
      }),
    [refetch],
  );

  return { state, refetch };
}

// ============================================================================
// Presentation helpers
// ============================================================================

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** "Today", "Tomorrow", "Yesterday", or "Fri, Oct 2" — relative to the server's `today`, never the browser's clock. */
export function formatDue(dueDate: string, today: string): string {
  if (dueDate === today) return "Today";
  if (dueDate === addDays(today, 1)) return "Tomorrow";
  if (dueDate === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = dueDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDuration(minutes: number): string {
  return `${minutes} min`;
}

/** A live Notion option name as a label: "medium" → "Medium" (Spencer's own names, first letter up). */
export function optionLabel(label: string): string {
  return label.length === 0 ? label : label[0]!.toUpperCase() + label.slice(1);
}

/** The words on a missing-field badge. */
export const MISSING_BADGE: Record<PlanningFieldNames, string> = {
  dueDate: "Add due date",
  estimatedDurationMinutes: "Add time",
  area: "Add area",
  energy: "Add energy",
  status: "Add status",
};

/** Duration presets offered by the inline Duration editor. */
export const DURATION_PRESETS: readonly number[] = [15, 30, 45, 60, 90, 120];

/** Where the chosen grouping is remembered (EXPERIENCE.md: "The choice persists across visits"). Browser storage can throw; it's a convenience only. */
const GROUP_BY_KEY = "yoh.tasks.groupBy";

export function loadGroupBy(): TasksGroupBy {
  try {
    const stored = window.localStorage.getItem(GROUP_BY_KEY);
    return stored === "area" || stored === "status" || stored === "due" ? stored : "due";
  } catch {
    return "due";
  }
}

export function saveGroupBy(groupBy: TasksGroupBy): void {
  try {
    window.localStorage.setItem(GROUP_BY_KEY, groupBy);
  } catch {
    // A private window or blocked storage: the choice just isn't remembered.
  }
}

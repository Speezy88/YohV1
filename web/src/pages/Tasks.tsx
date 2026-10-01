/**
 * web/src/pages/Tasks.tsx — Task 6B (FR-43), the approved Tasks.dc.html
 * mockup: every Task in grouped, raised rows, a quick-add card, and a
 * search + Due/Area/Status grouping control.
 *
 * Polish-3 (Spencer's live-app report: "make the text box and filtering at
 * the bottom, and have the task db at the top"): the grouped table now sits
 * directly under the title, fills the available height, and scrolls
 * internally. The quick-add line and the search/grouping controls moved
 * into ONE bottom dock (`data-testid="tasks-dock"`), pinned below the table
 * by the same `pb-24` bottom clearance every page already reserves for the
 * floating Ask Yoh pill (`PageShell.tsx`/`AskYohPill.tsx`) — the dock never
 * scrolls away and the pill never covers it.
 *
 * Polish-4 addendum (Spencer: "remove this text too on the task page. its
 * redundant: Task Due Duration Area Energy Status"): the column-header row
 * (previously `position: sticky` above the rows) is gone entirely — the
 * group labels ("Overdue · 1") are the only heading left, and rows keep
 * their `TASK_ROW_GRID` column alignment on their own.
 *
 * Built to be as quick as Notion:
 *  - Arriving on the page focuses the quick-add line; `N` or `/` focuses it
 *    from anywhere on the page. One typed line + Enter creates a Task (a
 *    direct write, AD-12 amended 2026-09-27) — no dialog.
 *  - Every cell edits in place (`TaskRow.tsx`); ↑/↓ move between rows (the
 *    list captures them, so the page shell doesn't change pages), Tab moves
 *    between cells, Enter edits, Esc cancels.
 *  - The title renames in place too (AD-12 amended 2026-09-27).
 *  - Checking a box — or choosing Completed in the Status select, which
 *    takes the very same path — is the existing check-off + Undo (AD-20). A completed
 *    Task stays listed (FR-43); unchecking one sets its Status back.
 *    Nothing is ever deleted (AD-12).
 *
 * Optimism is visual only (AD-17): a new Task, an edited value, or a check
 * shows at once, then the server's list — refetched on the write's own
 * `tasks` hint, a `plan` hint, or directly after the write — takes over. A
 * failed write reverts, shows a plain failure notice, and is announced.
 * Every grouping, bucket, and "today" comes from the server.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { QuickAddPreviewResponse, TaskGroup, TaskListItem, TasksGroupBy } from "../../../src/types/api.ts";
import type { PlanningFieldNames } from "../../../src/types/domain.ts";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import { PAGES, isTextFieldFocused } from "../lib/pages.ts";
import { loadGroupBy, requestCreateTask, requestRenameTask, requestUpdateTaskField, saveGroupBy, useTasksList } from "../lib/tasks.ts";
import { remainingMs, requestCheckOff, requestUndo } from "../lib/checkOff.ts";
import { addLocalFailureNotice } from "../lib/notifications.ts";
import { setMissingDataFilterActive, useMissingDataFilterActive } from "../lib/missingDataFilter.ts";
import { CONTROL_TRANSITION, FIELD_FOCUS_WITHIN, FOCUS_RING } from "../lib/controlStyles.ts";
import { SearchGlyph } from "../components/icons/Glyphs.tsx";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { StateMessage } from "../components/StateMessage.tsx";
import { TaskRow, type TaskEditField } from "../components/TaskRow.tsx";
import { TaskQuickAdd } from "../components/TaskQuickAdd.tsx";
import { UndoToast } from "../components/UndoToast.tsx";

const TASKS_PAGE_INDEX = PAGES.findIndex((p) => p.id === "tasks");
const SEARCH_DEBOUNCE_MS = 200;
/** How long a saved-but-not-yet-listed value is kept on screen, waiting for Notion's list to catch up. */
const RECONCILE_GRACE_MS = 10_000;
/** How long a saved cell shows its check + "Saved" before the value returns. */
const SAVED_FLASH_MS = 1_500;

const GROUP_OPTIONS: ReadonlyArray<{ readonly value: TasksGroupBy; readonly label: string }> = [
  { value: "due", label: "Due" },
  { value: "area", label: "Area" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
];

const FIELD_LABEL: Record<TaskEditField, string> = {
  title: "the title",
  dueDate: "the due date",
  estimatedDurationMinutes: "the duration",
  area: "the Area",
  energy: "the Energy",
  status: "the Status",
  priority: "the Priority",
};

const TONE_CLASS: Record<TaskGroup["tone"], string> = {
  danger: "text-ink-danger",
  accent: "text-ink-accent",
  neutral: "text-ink-secondary",
};

type FieldValue = string | number;
interface FieldOverride {
  readonly value: FieldValue;
  readonly state: "saving" | "saved";
  readonly at: number;
}
type Overrides = ReadonlyMap<string, ReadonlyMap<TaskEditField, FieldOverride>>;

interface PendingCreate {
  readonly key: string;
  readonly item: TaskListItem;
  readonly state: "saving" | "saved";
  readonly at: number;
}

interface ToastState {
  readonly id: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly durationMs: number;
}

function withOverrides(item: TaskListItem, overrides: ReadonlyMap<TaskEditField, FieldOverride> | undefined, today: string): TaskListItem {
  if (!overrides || overrides.size === 0) return item;
  const next: Record<string, unknown> = { ...item };
  for (const [field, o] of overrides) next[field] = o.value;
  const merged = next as unknown as TaskListItem;
  const completed = merged.status === "completed";
  return {
    ...merged,
    missing: completed ? [] : item.missing.filter((f: PlanningFieldNames) => !overrides.has(f)),
    overdue: !completed && merged.dueDate !== undefined && merged.dueDate < today,
  };
}

function RowSkeleton({ reducedMotion }: { readonly reducedMotion: boolean }): React.JSX.Element {
  return <div data-testid="task-row-skeleton" className={`h-[58px] rounded-lg bg-surface-sunken ${reducedMotion ? "" : "animate-pulse"}`} />;
}

export default function TasksPage(): React.JSX.Element {
  const nav = useContext(PageNavigationContext);
  const isActive = nav === undefined || nav.index === TASKS_PAGE_INDEX;
  const reducedMotion = useReducedMotion();

  const [groupBy, setGroupBy] = useState<TasksGroupBy>(loadGroupBy);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const { state, refetch } = useTasksList(groupBy, query);
  const missingDataFilterActive = useMissingDataFilterActive();

  const [overrides, setOverrides] = useState<Overrides>(new Map());
  const [pending, setPending] = useState<readonly PendingCreate[]>([]);
  const [checks, setChecks] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ readonly taskId: string; readonly field: TaskEditField } | undefined>(undefined);
  const [toast, setToast] = useState<ToastState | undefined>(undefined);
  const [receipt, setReceipt] = useState("");
  /** Cells showing "Saved" right now, keyed `${taskId}|${field}`; each clears itself after SAVED_FLASH_MS. */
  const [savedCells, setSavedCells] = useState<ReadonlySet<string>>(new Set());
  const savedTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const rootRef = useRef<HTMLDivElement>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingCounter = useRef(0);

  useEffect(() => {
    const timers = savedTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const flashSaved = (taskId: string, field: TaskEditField): void => {
    const key = `${taskId}|${field}`;
    clearTimeout(savedTimers.current.get(key));
    setSavedCells((prev) => new Set(prev).add(key));
    savedTimers.current.set(
      key,
      setTimeout(() => {
        savedTimers.current.delete(key);
        setSavedCells((prev) => new Set([...prev].filter((k) => k !== key)));
      }, SAVED_FLASH_MS),
    );
  };

  const focusQuickAdd = useCallback(() => quickAddRef.current?.focus({ preventScroll: true }), []);

  // Arriving on the page puts the cursor in the quick-add line.
  useEffect(() => {
    if (isActive) focusQuickAdd();
  }, [isActive, focusQuickAdd]);

  // `N` or `/` focuses quick-add from anywhere on this page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isActive || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "n" && e.key !== "N" && e.key !== "/") return;
      const active = document.activeElement;
      if (isTextFieldFocused(active) || active?.tagName === "SELECT") return;
      if (rootRef.current?.closest('[aria-hidden="true"]')) return; // the Chat panel has the foreground
      e.preventDefault();
      focusQuickAdd();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isActive, focusQuickAdd]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const serverItems = useMemo(() => {
    const byId = new Map<string, TaskListItem>();
    if (state.status === "loaded") for (const g of state.value.groups) for (const t of g.tasks) byId.set(t.id, t);
    return byId;
  }, [state]);

  // Reconcile: once the server's list shows what we wrote, drop the local copy.
  useEffect(() => {
    if (state.status !== "loaded") return;
    const now = Date.now();
    setOverrides((prev) => {
      const next = new Map<string, Map<TaskEditField, FieldOverride>>();
      for (const [taskId, fields] of prev) {
        const server = serverItems.get(taskId);
        const kept = new Map([...fields].filter(([field, o]) => o.state === "saving" || (now - o.at < RECONCILE_GRACE_MS && server?.[field] !== o.value)));
        if (kept.size > 0) next.set(taskId, kept);
      }
      return next;
    });
    setPending((prev) => prev.filter((p) => !serverItems.has(p.item.id) && (p.state === "saving" || now - p.at < RECONCILE_GRACE_MS)));
    setChecks((prev) => new Set([...prev].filter((id) => serverItems.get(id)?.status !== "completed")));
  }, [state, serverItems]);

  const loaded = state.status === "loaded" ? state.value : undefined;
  const today = loaded?.today;
  const options = loaded?.options;

  const setOverride = (taskId: string, field: TaskEditField, override: FieldOverride | undefined): void => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const fields = new Map(next.get(taskId) ?? []);
      if (override) fields.set(field, override);
      else fields.delete(field);
      if (fields.size > 0) next.set(taskId, fields);
      else next.delete(taskId);
      return next;
    });
  };

  const commitField = async (item: TaskListItem, field: TaskEditField, raw: string): Promise<void> => {
    setEditing(undefined);
    // AD-20: Completed from the Status select is a check-off, exactly like the checkbox.
    if (field === "status" && raw === "completed") {
      if (item.status !== "completed" && !checks.has(item.id)) await checkOffTask(item);
      return;
    }
    const value: FieldValue = field === "estimatedDurationMinutes" ? Number(raw) : field === "title" ? raw.trim() : raw;
    const showable = field === "estimatedDurationMinutes" ? Number.isInteger(value) && (value as number) > 0 : field === "title" ? value !== "" : true;
    if (showable) setOverride(item.id, field, { value, state: "saving", at: Date.now() });
    const outcome = field === "title" ? await requestRenameTask(item.id, raw) : await requestUpdateTaskField(item.id, field, raw);
    if (outcome.ok) {
      if (showable) setOverride(item.id, field, { value, state: "saved", at: Date.now() });
      flashSaved(item.id, field);
      setReceipt(outcome.value.receipt);
      void refetch();
      return;
    }
    setOverride(item.id, field, undefined);
    const notice = `Couldn't change ${FIELD_LABEL[field]} for "${item.title}". ${outcome.message}`;
    addLocalFailureNotice(notice);
    setReceipt(notice);
  };

  const create = async (text: string, preview: QuickAddPreviewResponse | undefined): Promise<void> => {
    const key = `pending-${++pendingCounter.current}`;
    const { title = text, unmatchedAreas: _unmatched, ...fields } = preview ?? { unmatchedAreas: [] };
    const draft: TaskListItem = { id: key, title, ...fields, missing: [], overdue: false };
    setPending((prev) => [{ key, item: draft, state: "saving", at: Date.now() }, ...prev]);
    const outcome = await requestCreateTask(text);
    if (outcome.ok) {
      setPending((prev) => prev.map((p) => (p.key === key ? { key, item: outcome.value.task, state: "saved", at: Date.now() } : p)));
      setReceipt(outcome.value.receipt);
      void refetch();
      return;
    }
    setPending((prev) => prev.filter((p) => p.key !== key));
    const notice = `Couldn't add "${title}". ${outcome.message}`;
    addLocalFailureNotice(notice);
    setReceipt(notice);
  };

  const undo = async (shown: ToastState): Promise<void> => {
    const outcome = await requestUndo(shown.id);
    setToast((current) => (current?.id === shown.id ? undefined : current));
    if (outcome.ok) {
      setChecks((prev) => new Set([...prev].filter((id) => id !== shown.taskId)));
    } else {
      addLocalFailureNotice(`Couldn't undo ${shown.taskName}`);
    }
  };

  const toggleCheck = async (item: TaskListItem, checked: boolean): Promise<void> => {
    if (checked) {
      // Still inside its Undo window: unchecking IS the Undo.
      if (toast?.taskId === item.id) return undo(toast);
      // Already completed in Notion: set its Status back (never a delete).
      return commitField(item, "status", "not-started");
    }
    return checkOffTask(item);
  };

  /** The ONE way this page completes a Task: check-off with its pending record, Undo toast and commit sweep (AD-20). */
  const checkOffTask = async (item: TaskListItem): Promise<void> => {
    setChecks((prev) => new Set(prev).add(item.id));
    const outcome = await requestCheckOff(item.id);
    if (!outcome.ok) {
      setChecks((prev) => new Set([...prev].filter((id) => id !== item.id)));
      addLocalFailureNotice(`Couldn't check off ${item.title}`);
      return;
    }
    setToast({ id: outcome.value.id, taskId: item.id, taskName: item.title, durationMs: remainingMs(outcome.value) });
  };

  const focusRow = (rowIndex: number, col: string): boolean => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${rowIndex}"]`);
    if (!row) return false;
    const cell = row.querySelector<HTMLElement>(`[data-col="${col}"]`) ?? row.querySelector<HTMLElement>("[data-col]");
    const target = cell?.matches("button:not(:disabled)") ? cell : cell?.querySelector<HTMLElement>("button:not(:disabled), input, select");
    target?.focus({ preventScroll: false });
    return target !== undefined && target !== null;
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-cell-editor]")) return; // an open editor owns its keys
    const row = target.closest<HTMLElement>("[data-row-index]");
    if (!row) return;
    if (e.key === "Escape") {
      target.blur();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const index = Number(row.dataset["rowIndex"]);
    const col = target.closest<HTMLElement>("[data-col]")?.dataset["col"] ?? "0";
    const next = index + (e.key === "ArrowDown" ? 1 : -1);
    if (next < 0) focusQuickAdd();
    else focusRow(next, col);
  };

  // The rows on screen, in order: anything just added first, then the server's groups.
  const justAdded = pending.filter((p) => !serverItems.has(p.item.id));
  const allGroups: ReadonlyArray<{ readonly key: string; readonly label: string; readonly tone: TaskGroup["tone"]; readonly rows: ReadonlyArray<{ item: TaskListItem; creating: boolean }> }> = [
    ...(justAdded.length > 0 ? [{ key: "just-added", label: "Just added", tone: "accent" as const, rows: justAdded.map((p) => ({ item: p.item, creating: p.state === "saving" })) }] : []),
    ...(loaded?.groups ?? []).map((g) => ({ key: g.key, label: g.label, tone: g.tone, rows: g.tasks.map((t) => ({ item: t, creating: false })) })),
  ];
  // Polish-5, Task 4: the "Missing data" toolbar toggle — the SAME per-row
  // `missing` rule the "Add …" badges already show, filtered client-side
  // (the rows are already on screen; no extra server round trip). The
  // toggle button below arms and disarms `missingDataFilterActive` itself
  // (Story 9.4 chunk B re-pointed the Chat header chip at running
  // `/sandbox` instead, via `lib/missingData.ts`'s `openMissingData`, so
  // this filter needs its own always-visible control).
  const groups = missingDataFilterActive
    ? allGroups.map((g) => ({ ...g, rows: g.rows.filter(({ item }) => item.missing.length > 0) })).filter((g) => g.rows.length > 0)
    : allGroups;

  let rowIndex = 0;

  return (
    // Polish-2 (Spencer's live-app report: "I do not want to be able to
    // scroll pages while my cursor is in the tasks section"): the generic
    // wheel-nav opt-out (`lib/wheelNav.ts`) — a wheel gesture anywhere in
    // this subtree only ever scrolls Tasks' own content, even at an edge
    // that would otherwise trigger a page change. Sidebar clicks and the
    // ↑/↓ buttons/keys are unaffected.
    <div ref={rootRef} className="flex h-full flex-col gap-5 p-8 pb-24">
      <h1 className="m-0 shrink-0 font-body text-display font-bold tracking-tight text-ink-primary">Tasks</h1>

      {/* Polish-3 (Spencer: "make the text box and filtering at the bottom,
          and have the task db at the top"): the grouped Task table is now
          the first thing under the title, fills the space between the
          title and the bottom dock, and scrolls internally.
          Polish-4 addendum (Spencer: "remove this text too on the task
          page. its redundant: Task Due Duration Area Energy Status"): the
          column-header row is gone — the group labels ("Overdue · 1") are
          the only heading left; rows keep their `TASK_ROW_GRID` alignment.
          Polish-4 addendum (wheel paging only outside cards): this whole
          table region opts out of wheel page-navigation
          (`data-wheel-nav="off"`, `lib/wheelNav.ts`) — a wheel gesture over
          it always scrolls the table, never changes page, even at an edge;
          the page ROOT above no longer carries this, so a wheel gesture
          over the title still changes page. */}
      <section aria-label="All tasks" data-wheel-nav="off" className="flex min-h-0 flex-1 flex-col gap-2">
        {state.status === "loaded" && state.refreshFailed && (
          <p className="m-0 shrink-0 px-4 font-body text-small text-ink-secondary">
            Couldn't refresh from Notion — showing the list from {state.refreshFailed.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>
        )}
        <div ref={listRef} data-captures-arrow-keys="" onKeyDown={onListKeyDown} className="-mx-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4 pt-1">
          {state.status === "loading" && justAdded.length === 0 ? (
            [0, 1, 2, 3, 4].map((i) => <RowSkeleton key={i} reducedMotion={reducedMotion} />)
          ) : state.status === "error" && justAdded.length === 0 ? (
            <StateMessage variant="error" className="p-5" message="Couldn't load Tasks right now." detail={state.message} onRetry={() => void refetch()} />
          ) : groups.length === 0 ? (
            <StateMessage
              variant="empty"
              className="p-5"
              message={query ? `No Tasks match "${query}".` : missingDataFilterActive ? "No Tasks are missing data." : "No Tasks yet. Type one below and press Enter."}
            />
          ) : (
            groups.map((group) => (
              <section key={group.key} aria-label={group.label} className="flex flex-col gap-2">
                <h2 className={`m-0 px-4 pb-0.5 pt-2.5 font-body text-small font-bold uppercase tracking-wide ${TONE_CLASS[group.tone]}`}>
                  {group.label} · {group.rows.length}
                </h2>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {group.rows.map(({ item: raw, creating }) => {
                    const item = today ? withOverrides(raw, overrides.get(raw.id), today) : raw;
                    const checked = item.status === "completed" || checks.has(item.id);
                    const saving = new Set([...(overrides.get(raw.id) ?? [])].filter(([, o]) => o.state === "saving").map(([f]) => f));
                    const saved = new Set(([...savedCells].filter((k) => k.startsWith(`${raw.id}|`)).map((k) => k.slice(raw.id.length + 1))) as TaskEditField[]);
                    return (
                      <TaskRow
                        key={raw.id}
                        item={item}
                        rowIndex={rowIndex++}
                        today={today ?? ""}
                        options={options ?? { area: [], energy: [], status: [] }}
                        editing={editing?.taskId === raw.id ? editing.field : undefined}
                        saving={saving}
                        saved={saved}
                        checked={checked}
                        creating={creating}
                        onCheck={() => void toggleCheck(item, checked)}
                        onStartEdit={(field) => setEditing({ taskId: raw.id, field })}
                        onCommit={(field, value) => void commitField(item, field, value)}
                        onCancel={() => setEditing(undefined)}
                      />
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </section>

      {/* Polish-3: one bottom dock, pinned below the table (never scrolls
          away, keeps clear of the floating Ask Yoh pill via the same
          `pb-24` bottom clearance every page reserves for it) — quick-add
          full width on top, search + grouping on one row underneath. */}
      <div data-testid="tasks-dock" data-wheel-nav="off" className="flex shrink-0 flex-col gap-3 rounded-2xl bg-surface-raised px-4 py-4 shadow-extruded-lg">
        <TaskQuickAdd
          ref={quickAddRef}
          today={today}
          options={options}
          onSubmit={(text, preview) => void create(text, preview)}
          onArrowDown={() => focusRow(0, "0")}
          onPageUp={() => nav?.prev()}
          onPageDown={() => nav?.next()}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className={`flex h-12 w-[280px] items-center gap-2.5 rounded-full bg-surface-sunken px-4 shadow-inset ${FIELD_FOCUS_WITHIN}`}>
              <SearchGlyph size={18} className="shrink-0 text-ink-secondary" />
              <input
                type="search"
                aria-label="Search tasks"
                placeholder="Search tasks"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSearch("");
                  }
                }}
                className="min-w-0 flex-1 border-0 bg-transparent font-body text-small text-ink-primary outline-none placeholder:text-ink-secondary"
              />
            </label>
            {/* Polish-5, Task 4: the "Missing data" toggle — always visible,
                arms/disarms `missingDataFilterActive` itself. Pressed styling
                copies the Group-by buttons to its right. */}
            <button
              type="button"
              data-testid="tasks-filter-missing-data"
              aria-pressed={missingDataFilterActive}
              onClick={() => setMissingDataFilterActive(!missingDataFilterActive)}
              className={
                `h-9 rounded-full px-4 font-body text-small ${FOCUS_RING} ${CONTROL_TRANSITION} ` +
                (missingDataFilterActive
                  ? "bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end font-bold text-on-accent-solid shadow-extruded-sm hover:brightness-105 active:brightness-95"
                  : "bg-surface-sunken text-ink-secondary shadow-inset hover:text-ink-primary active:shadow-inset")
              }
            >
              Missing data
            </button>
          </div>
          <div role="group" aria-label="Group by" className="flex gap-1 rounded-lg bg-surface-sunken p-1 shadow-inset">
            {GROUP_OPTIONS.map((option) => {
              const pressed = option.value === groupBy;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => {
                    setGroupBy(option.value);
                    saveGroupBy(option.value);
                  }}
                  className={
                    `h-9 rounded-md px-4 font-body text-small ${FOCUS_RING} ${CONTROL_TRANSITION} ` +
                    (pressed
                      ? "bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end font-bold text-on-accent-solid shadow-extruded-sm hover:brightness-105 active:brightness-95"
                      : "text-ink-secondary hover:text-ink-primary")
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p role="status" className="sr-only">
        {receipt}
      </p>
      {toast && (
        <UndoToast
          key={toast.id}
          id={toast.id}
          taskName={toast.taskName}
          durationMs={toast.durationMs}
          onUndo={() => undo(toast)}
          onExpire={() => setToast((current) => (current?.id === toast.id ? undefined : current))}
        />
      )}
    </div>
  );
}

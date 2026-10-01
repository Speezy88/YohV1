/**
 * web/src/components/TaskRow.tsx — Task 6B, the approved Tasks.dc.html
 * mockup's `.row`: checkbox, title, then Due / Duration / Area / Energy /
 * Status cells on a raised row.
 *
 * Inline editing like Notion: the title and every cell is a real `<button>` (so Tab walks
 * the cells and Enter/Space opens one), and opening it swaps in an inset
 * editor in place — a text line for the title (fix round: AD-12 amended
 * 2026-09-27), a date picker for Due, a number with presets for
 * Duration, a select for Area/Energy/Status fed from the LIVE Notion
 * options the server sent (`TasksViewResponse.options`). Enter commits,
 * Esc cancels (focus returns to the cell either way), Tab commits and moves
 * on. A missing value shows as an "Add …" badge that opens the same editor.
 *
 * This component only renders and reports: the page owns what's being
 * edited, the optimistic value, and the write (`pages/Tasks.tsx`).
 * `data-row-index`/`data-col` let the page's list move focus with ↑/↓.
 */
import { useEffect, useRef, useState } from "react";
import type { TaskListItem } from "../../../src/types/api.ts";
import type { EditableTaskField, TaskFieldOptions } from "../../../src/types/domain.ts";
import { DURATION_PRESETS, MISSING_BADGE, PRIORITY_MISSING_BADGE, formatDue, formatDuration, optionLabel } from "../lib/tasks.ts";
import { CONTROL_TRANSITION, FOCUS_RING } from "../lib/controlStyles.ts";
import { CheckGlyph } from "./icons/Glyphs.tsx";
import { Checkbox } from "./Checkbox.tsx";

export const TASK_ROW_GRID = "grid grid-cols-[44px_minmax(0,1fr)_130px_100px_120px_100px_130px_130px] items-center gap-x-3";

/** The six editable cells, in column order (column 0 is the checkbox) — Task 7 binding ruling: widened past `PlanningFieldNames` by one, "priority". */
export const TASK_CELLS: readonly EditableTaskField[] = ["dueDate", "estimatedDurationMinutes", "area", "energy", "status", "priority"];

/** What a row can edit in place: a planning field, Priority, or the title. */
export type TaskEditField = EditableTaskField | "title";

const FIELD_NAMES: Record<EditableTaskField, string> = {
  dueDate: "Due",
  estimatedDurationMinutes: "Duration",
  area: "Area",
  energy: "Energy",
  status: "Status",
  priority: "Priority",
};

const EDITOR_BASE = `h-10 w-full min-w-0 rounded-md border-[length:var(--rim-width)] border-accent-solid bg-surface-sunken px-3 font-body text-ink-primary shadow-inset ${FOCUS_RING}`;
const EDITOR_CLASS = `${EDITOR_BASE} text-small`;
/** The title editor keeps the row title's own size and weight, so renaming doesn't visibly shrink the text. */
const TITLE_EDITOR_CLASS = `${EDITOR_BASE} -ml-2 text-body font-medium`;

export interface TaskRowProps {
  readonly item: TaskListItem;
  readonly rowIndex: number;
  readonly today: string;
  readonly options: TaskFieldOptions;
  /** The cell being edited in this row, if any. */
  readonly editing: TaskEditField | undefined;
  /** Cells with a write in flight (shown busy). */
  readonly saving: ReadonlySet<TaskEditField>;
  /** Cells whose write just succeeded: show a check + "Saved" in place of the value (the page clears it after ~1.5s). */
  readonly saved?: ReadonlySet<TaskEditField>;
  readonly checked: boolean;
  /** A just-typed Task still being created: nothing on it can be edited yet. */
  readonly creating?: boolean;
  onCheck(): void;
  onStartEdit(field: TaskEditField): void;
  onCommit(field: TaskEditField, value: string): void;
  onCancel(): void;
}

function displayValue(item: TaskListItem, field: EditableTaskField, today: string, options: TaskFieldOptions): string | undefined {
  switch (field) {
    case "dueDate":
      return item.dueDate === undefined ? undefined : formatDue(item.dueDate, today);
    case "estimatedDurationMinutes":
      return item.estimatedDurationMinutes === undefined ? undefined : formatDuration(item.estimatedDurationMinutes);
    case "area":
      return item.area;
    case "energy": {
      if (item.energy === undefined) return undefined;
      return optionLabel(options.energy.find((o) => o.value === item.energy)?.label ?? item.energy);
    }
    case "status": {
      if (item.status === undefined) return undefined;
      return options.status.find((o) => o.value === item.status)?.label ?? optionLabel(item.status.replace("-", " "));
    }
    case "priority":
      // The live option name already, emoji + word (e.g. "🔴 High") — shown verbatim, like Area.
      return item.priority;
  }
}

/** The raw value an editor starts from (what a write would send). */
function rawValue(item: TaskListItem, field: TaskEditField): string {
  const value = item[field];
  return value === undefined ? "" : String(value);
}

interface EditorProps {
  readonly field: TaskEditField;
  readonly initial: string;
  readonly label: string;
  readonly options: TaskFieldOptions;
  onCommit(value: string): void;
  onCancel(): void;
}

/** One inset editor, focused on mount. Enter commits, Esc cancels, blur commits a changed value (Tab moves on). */
function CellEditor({ field, initial, label, options, onCommit, onCancel }: EditorProps): React.JSX.Element {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const inputRef = useRef<HTMLInputElement & HTMLSelectElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const commit = (next: string): void => {
    if (done.current) return;
    done.current = true;
    if (next.trim() === "" || next === initial) onCancel();
    else onCommit(next);
  };
  const cancel = (): void => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  const selectOptions: ReadonlyArray<{ value: string; label: string }> | undefined =
    field === "energy"
      ? options.energy.map((o) => ({ value: o.value, label: optionLabel(o.label) }))
      : field === "status"
        ? options.status.map((o) => ({ value: o.value, label: o.label }))
        : field === "area" && options.area !== undefined
          ? options.area.map((a) => ({ value: a, label: a }))
          : field === "priority"
            ? (options.priority ?? []).map((p) => ({ value: p, label: p }))
            : undefined;

  if (selectOptions !== undefined) {
    return (
      <select
        ref={inputRef}
        data-cell-editor=""
        aria-label={label}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={cancel}
        className={EDITOR_CLASS}
      >
        {value === "" && <option value="">Choose…</option>}
        {selectOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (field === "estimatedDurationMinutes") {
    return (
      <div data-cell-editor="" className="relative">
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={1}
          step={5}
          aria-label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(value)}
          className={EDITOR_CLASS}
        />
        <div
          role="group"
          aria-label="Duration presets"
          className="absolute left-0 top-full z-(--z-popover) mt-2 flex gap-1.5 rounded-lg bg-surface-raised p-2 shadow-extruded-md"
        >
          {DURATION_PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              tabIndex={-1}
              // Keeps focus in the input so its blur doesn't commit first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(String(minutes))}
              className={`h-8 whitespace-nowrap rounded-full px-3 font-body text-small font-bold text-ink-primary shadow-extruded-sm hover:text-ink-accent ${FOCUS_RING}`}
            >
              {minutes}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      data-cell-editor=""
      type={field === "dueDate" ? "date" : "text"}
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => commit(value)}
      className={field === "title" ? TITLE_EDITOR_CLASS : EDITOR_CLASS}
    />
  );
}

export function TaskRow({
  item,
  rowIndex,
  today,
  options,
  editing,
  saving,
  saved,
  checked,
  creating = false,
  onCheck,
  onStartEdit,
  onCommit,
  onCancel,
}: TaskRowProps): React.JSX.Element {
  const completed = checked;
  const cellRefs = useRef(new Map<TaskEditField, HTMLButtonElement>());
  /** Set when an editor closed by Enter/Esc, so focus returns to its cell (Tab/blur leave focus where it went). */
  const returnFocusTo = useRef<TaskEditField | undefined>(undefined);
  const setCellRef = (field: TaskEditField) => (el: HTMLButtonElement | null) => {
    if (el) cellRefs.current.set(field, el);
    else cellRefs.current.delete(field);
  };
  const editorFor = (field: TaskEditField, label: string): React.JSX.Element => (
    <CellEditor
      field={field}
      initial={rawValue(item, field)}
      label={label}
      options={options}
      onCommit={(value) => {
        returnFocusTo.current = field;
        onCommit(field, value);
      }}
      onCancel={() => {
        returnFocusTo.current = field;
        onCancel();
      }}
    />
  );

  useEffect(() => {
    if (editing !== undefined || returnFocusTo.current === undefined) return;
    cellRefs.current.get(returnFocusTo.current)?.focus({ preventScroll: true });
    returnFocusTo.current = undefined;
  }, [editing]);

  return (
    <li
      data-testid="task-row"
      data-task-id={item.id}
      data-row-index={rowIndex}
      aria-busy={creating || saving.size > 0 || undefined}
      className={`${TASK_ROW_GRID} h-[58px] rounded-lg bg-surface-raised px-4 font-body text-small shadow-extruded-sm ${completed ? "opacity-55" : ""} ${creating ? "opacity-70" : ""}`}
    >
      <span data-col="0" className="flex items-center">
        <Checkbox label={item.title} checked={checked} disabled={creating} size="lg" onCheck={onCheck} />
      </span>
      <span data-col="title" className="min-w-0">
        {editing === "title" ? (
          editorFor("title", `Title of ${item.title}`)
        ) : (
          <button
            ref={setCellRef("title")}
            type="button"
            disabled={creating}
            aria-label={`Title: ${item.title}`}
            aria-busy={saving.has("title") || undefined}
            title={item.title}
            onClick={() => onStartEdit("title")}
            className={`-ml-2 flex h-10 w-[calc(100%+8px)] min-w-0 items-center rounded-md px-2 text-left hover:bg-surface-sunken disabled:hover:bg-transparent ${FOCUS_RING} ${CONTROL_TRANSITION} ${saving.has("title") ? "opacity-60" : ""}`}
          >
            <span className={`truncate text-body font-medium text-ink-primary ${completed ? "line-through" : ""}`}>{item.title}</span>
          </button>
        )}
      </span>
      {TASK_CELLS.map((field, i) => {
        const shown = displayValue(item, field, today, options);
        const label = `${FIELD_NAMES[field]} for ${item.title}`;
        if (editing === field) {
          return (
            <span key={field} data-col={i + 1} className="min-w-0">
              {editorFor(field, label)}
            </span>
          );
        }
        // Priority is never part of `item.missing` (Task 7 binding ruling:
        // not a Data-Completeness Gate field) — its empty pill is keyed
        // only on "no value shown", exactly like every other empty cell
        // otherwise looks, just without the gate's involvement.
        const missing = field === "priority" ? shown === undefined : shown === undefined && item.missing.includes(field);
        const busy = saving.has(field);
        const justSaved = saved?.has(field) === true && !busy;
        return (
          <span key={field} data-col={i + 1} className="min-w-0">
            <button
              ref={setCellRef(field)}
              type="button"
              disabled={creating}
              aria-label={`${label}: ${shown ?? "not set"}`}
              aria-busy={busy || undefined}
              onClick={() => onStartEdit(field)}
              className={`-mx-2 flex h-10 w-[calc(100%+16px)] min-w-0 items-center rounded-md px-2 text-left hover:bg-surface-sunken active:shadow-inset disabled:hover:bg-transparent ${FOCUS_RING} ${CONTROL_TRANSITION} ${busy ? "opacity-60" : ""}`}
            >
              {justSaved ? (
                <span data-testid="cell-saved" className="inline-flex items-center gap-1.5 font-bold text-ink-accent">
                  <CheckGlyph className="shrink-0" />
                  Saved
                </span>
              ) : missing ? (
                <span className="inline-flex min-h-6 items-center whitespace-nowrap rounded-full border-[length:var(--rim-width)] border-accent-solid px-2.5 text-label font-bold text-ink-accent">
                  {field === "priority" ? PRIORITY_MISSING_BADGE : MISSING_BADGE[field]}
                </span>
              ) : (
                <span className={`truncate ${field === "dueDate" || field === "estimatedDurationMinutes" ? "tabular-nums" : ""} ${field === "dueDate" && item.overdue ? "font-bold text-ink-danger" : "text-ink-secondary"}`}>{shown ?? "—"}</span>
              )}
            </button>
          </span>
        );
      })}
    </li>
  );
}

/**
 * web/src/components/TaskQuickAdd.tsx — Task 6B, the approved mockup's "Add
 * a task" card: an inset line with a gradient plus, "Enter to add", and a
 * "Yoh reads:" row of chips underneath.
 *
 * Type a title and press Enter: that's the whole flow — no dialog, no
 * required field beyond the title. While Spencer types, the line is parsed
 * server-side (`POST /api/tasks/parse`, the ONE parser in
 * `core/quick-add.ts`) and every field it would set is shown as a chip
 * BEFORE Enter, so nothing is read from the line without him seeing it. A
 * `#tag` that matches no Area says so. The preview is debounced and only
 * the newest one may land.
 *
 * Polish 4 Task 1 (Spencer): the "Add a date, a time like 30m, …" hint line
 * — and the row it sat in — is gone. This dock now shows the input only,
 * with search/grouping below it (`Tasks.tsx`); the "Yoh reads:" chips still
 * appear above the input, but ONLY when something was actually read — no
 * empty row is reserved for them. The same task adds a Status chip
 * (`preview.status`, only ever "not-started"/"in-progress" — quick-add
 * never sets Completed).
 *
 * Keys: Enter adds; ↓ moves into the list; ↑ on an empty line, Page Up and
 * Page Down hand back to page navigation (this is a text field, so the
 * page shell leaves those keys alone); Esc clears the line, or leaves it
 * when it's already empty.
 */
import { forwardRef, useEffect, useRef, useState } from "react";
import type { QuickAddPreviewResponse } from "../../../src/types/api.ts";
import { FIELD_FOCUS_WITHIN } from "../lib/controlStyles.ts";
import { PlusGlyph } from "./icons/Glyphs.tsx";
import { formatDue, formatDuration, optionLabel, requestQuickAddPreview } from "../lib/tasks.ts";
import type { TaskFieldOptions, TaskStatus } from "../../../src/types/domain.ts";

/** Fallback Status wording when the live options haven't loaded yet — quick-add only ever produces these two. */
const STATUS_FALLBACK_LABEL: Readonly<Record<TaskStatus, string>> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
  slipped: "Slipped",
};

/** How long typing must pause before the chips refresh. */
const PREVIEW_DEBOUNCE_MS = 150;

export interface TaskQuickAddProps {
  readonly today: string | undefined;
  readonly options: TaskFieldOptions | undefined;
  /** Enter with a non-empty line. The page clears nothing itself — this component already has. */
  onSubmit(text: string, preview: QuickAddPreviewResponse | undefined): void;
  /** ↓ from the line: focus the first row, if any. Returns false when there is none. */
  onArrowDown(): boolean;
  onPageUp(): void;
  onPageDown(): void;
}

function chipsFor(preview: QuickAddPreviewResponse, today: string | undefined, options: TaskFieldOptions | undefined): string[] {
  const chips: string[] = [];
  if (preview.dueDate) chips.push(`Due ${today ? formatDue(preview.dueDate, today) : preview.dueDate}`);
  if (preview.estimatedDurationMinutes !== undefined) chips.push(formatDuration(preview.estimatedDurationMinutes));
  if (preview.energy) {
    const live = options?.energy.find((o) => o.value === preview.energy)?.label;
    chips.push(`${optionLabel(live ?? preview.energy)} energy`);
  }
  if (preview.area) chips.push(`Area: ${preview.area}`);
  if (preview.status) {
    const live = options?.status.find((o) => o.value === preview.status)?.label;
    chips.push(`Status: ${live ?? STATUS_FALLBACK_LABEL[preview.status]}`);
  }
  if (preview.priority) chips.push(preview.priority); // already the live option label, emoji + word (e.g. "🔴 High")
  return chips;
}

export const TaskQuickAdd = forwardRef<HTMLInputElement, TaskQuickAddProps>(function TaskQuickAdd(
  { today, options, onSubmit, onArrowDown, onPageUp, onPageDown },
  ref,
) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ readonly text: string; readonly value: QuickAddPreviewResponse } | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === "") {
      setPreview(undefined);
      setPreviewFailed(false);
      return;
    }
    const seq = ++latest.current;
    const timer = setTimeout(() => {
      void requestQuickAddPreview(trimmed, options?.area, options?.priority).then((outcome) => {
        if (seq !== latest.current) return;
        if (outcome.ok) setPreview({ text: trimmed, value: outcome.value });
        setPreviewFailed(!outcome.ok);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, options?.area, options?.priority]);

  const current = preview !== undefined && preview.text === text.trim() ? preview.value : undefined;
  const chips = current ? chipsFor(current, today, options) : [];
  const hasReads = chips.length > 0 || (current?.unmatchedAreas.length ?? 0) > 0;

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    onSubmit(trimmed, current);
    setText("");
    setPreview(undefined);
    setPreviewFailed(false);
    latest.current++;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowDown") {
      if (onArrowDown()) e.preventDefault();
    } else if (e.key === "ArrowUp" && text === "") {
      e.preventDefault();
      onPageUp();
    } else if (e.key === "PageUp") {
      e.preventDefault();
      onPageUp();
    } else if (e.key === "PageDown") {
      e.preventDefault();
      onPageDown();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (text !== "") setText("");
      else e.currentTarget.blur();
    }
  };

  return (
    // Polish-3 (Spencer: "make the text box and filtering at the bottom, and
    // have the task db at the top"): this component no longer owns the
    // dock's outer card — `Tasks.tsx` wraps it (plus the search/grouping
    // row) in ONE bottom dock now — and the hint/chips row renders BEFORE
    // the input, since the input sits at the very bottom of the page.
    <section aria-label="Add a task" className="flex flex-col gap-3">
      {hasReads && (
        <div id="quick-add-reads" aria-live="polite" className="flex flex-wrap items-center gap-2.5 pl-1">
          <span className="font-body text-small text-ink-secondary">Yoh reads:</span>
          {chips.map((chip) => (
            <span
              key={chip}
              data-testid="quick-add-chip"
              className="inline-flex h-[30px] items-center rounded-full bg-surface-raised px-3 font-body text-small font-bold text-ink-primary shadow-extruded-sm"
            >
              {chip}
            </span>
          ))}
          {current?.unmatchedAreas.map((tag) => (
            <span key={tag} className="font-body text-small text-ink-secondary">
              #{tag} isn't an Area in Notion — it stays in the title.
            </span>
          ))}
        </div>
      )}
      {previewFailed && !hasReads && (
        <p aria-live="polite" className="m-0 pl-1 font-body text-small text-ink-secondary">
          Couldn't preview that — you can still add it.
        </p>
      )}
      <label
        className={
          "flex h-[58px] items-center gap-3.5 rounded-lg border-[length:var(--rim-width)] bg-surface-sunken px-4 shadow-inset " + FIELD_FOCUS_WITHIN + " " +
          (focused ? "border-accent-solid" : "border-transparent")
        }
      >
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end">
          <PlusGlyph className="text-on-accent-solid" />
        </span>
        <input
          ref={ref}
          type="text"
          aria-label="New task"
          {...(hasReads ? { "aria-describedby": "quick-add-reads" } : {})}
          placeholder="Add a task — e.g. Lab report due fri 90m high #bio"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-w-0 flex-1 border-0 bg-transparent font-body text-body text-ink-primary outline-none placeholder:text-ink-secondary"
        />
        <span className="shrink-0 font-body text-small text-ink-secondary">Enter to add</span>
      </label>
    </section>
  );
});

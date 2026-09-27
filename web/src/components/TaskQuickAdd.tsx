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
 * Keys: Enter adds; ↓ moves into the list; ↑ on an empty line, Page Up and
 * Page Down hand back to page navigation (this is a text field, so the
 * page shell leaves those keys alone); Esc clears the line, or leaves it
 * when it's already empty.
 */
import { forwardRef, useEffect, useRef, useState } from "react";
import type { QuickAddPreviewResponse } from "../../../src/types/api.ts";
import { formatDue, formatDuration, optionLabel, requestQuickAddPreview } from "../lib/tasks.ts";
import type { TaskFieldOptions } from "../../../src/types/domain.ts";

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
  return chips;
}

export const TaskQuickAdd = forwardRef<HTMLInputElement, TaskQuickAddProps>(function TaskQuickAdd(
  { today, options, onSubmit, onArrowDown, onPageUp, onPageDown },
  ref,
) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ readonly text: string; readonly value: QuickAddPreviewResponse } | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === "") {
      setPreview(undefined);
      return;
    }
    const seq = ++latest.current;
    const timer = setTimeout(() => {
      void requestQuickAddPreview(trimmed, options?.area).then((outcome) => {
        if (seq === latest.current && outcome.ok) setPreview({ text: trimmed, value: outcome.value });
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, options?.area]);

  const current = preview !== undefined && preview.text === text.trim() ? preview.value : undefined;
  const chips = current ? chipsFor(current, today, options) : [];

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    onSubmit(trimmed, current);
    setText("");
    setPreview(undefined);
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
      <div id="quick-add-reads" aria-live="polite" className="flex min-h-[30px] flex-wrap items-center gap-2.5 pl-1">
        {chips.length > 0 || (current?.unmatchedAreas.length ?? 0) > 0 ? (
          <>
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
          </>
        ) : (
          <span className="font-body text-small text-ink-secondary">Add a date, a time like 30m, high/medium/low, or a #area — Yoh shows what it reads here.</span>
        )}
      </div>
      <label
        className={
          "flex h-[58px] items-center gap-3.5 rounded-lg border-[length:var(--rim-width)] bg-surface-sunken px-4 shadow-inset " +
          (focused ? "border-accent-solid" : "border-transparent")
        }
      >
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" className="text-on-accent-solid">
            <path d="M12 5v14 M5 12h14" strokeWidth={2.6} strokeLinecap="round" />
          </svg>
        </span>
        <input
          ref={ref}
          type="text"
          aria-label="New task"
          aria-describedby="quick-add-reads"
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

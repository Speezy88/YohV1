/**
 * web/src/components/memory/SortFeedbackPanel.tsx
 * The inline panel a memory card opens from its "more" menu: is this the right
 * folder (Right / Wrong), why, and for Wrong optionally where it belongs. Owns
 * no writes; the row sends the answer and shows the outcome.
 */
import { useId, useState } from "react";
import { BUTTON_SECONDARY, CONTROL_DISABLED, CONTROL_SM, FOCUS_RING } from "../../lib/controlStyles.ts";
import type { MemoryItemView } from "../../../../src/types/api.ts";
import type { MemoryFolder } from "../../../../src/types/domain.ts";
import { STATED_ONLY, type FolderChoice } from "./ItemOverflowMenu.tsx";

/** Mirrors the server's limit (`MEMORY_SORT_REASON_MAX_CHARS`); the server is the judge. */
const REASON_MAX_CHARS = 280;

const SMALL_BUTTON = `${BUTTON_SECONDARY} ${CONTROL_SM}`;
const FIELD = `rounded-md bg-surface-sunken px-3 py-2 font-body text-body text-ink-primary shadow-inset ${CONTROL_DISABLED} ${FOCUS_RING}`;
const LABEL = "flex flex-col gap-1 font-body text-small text-ink-secondary";

export interface SortFeedbackAnswer {
  readonly verdict: "right" | "wrong";
  readonly reason: string;
  readonly belongsIn?: MemoryFolder;
}

export interface SortFeedbackPanelProps {
  readonly currentFolder: MemoryFolder;
  readonly origin: "stated" | "inferred";
  readonly folders: readonly FolderChoice[];
  /** The saved verdict, to start from. */
  readonly initial?: MemoryItemView["sortFeedback"];
  readonly busy: boolean;
  onSave(answer: SortFeedbackAnswer): void;
  onCancel(): void;
}

export function SortFeedbackPanel({ currentFolder, origin, folders, initial, busy, onSave, onCancel }: SortFeedbackPanelProps): React.JSX.Element {
  const [verdict, setVerdict] = useState<"right" | "wrong" | undefined>(initial?.verdict);
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [belongsIn, setBelongsIn] = useState<MemoryFolder | "">(initial?.belongsIn ?? "");
  const questionId = useId();
  const label = folders.find((f) => f.folder === currentFolder)?.label ?? currentFolder;
  const trimmed = reason.trim();
  const ready = verdict !== undefined && trimmed !== "";

  const verdictButton = (value: "right" | "wrong", text: string, autoFocus: boolean): React.JSX.Element => (
    <button
      type="button"
      autoFocus={autoFocus}
      aria-pressed={verdict === value}
      disabled={busy}
      onClick={() => setVerdict(value)}
      className={`${SMALL_BUTTON} aria-pressed:border-accent-solid aria-pressed:bg-surface-sunken aria-pressed:font-bold aria-pressed:text-ink-primary aria-pressed:shadow-inset`}
    >
      {text}
    </button>
  );

  return (
    <form
      role="group"
      aria-labelledby={questionId}
      className="flex flex-col gap-2 rounded-md bg-surface-sunken p-3 shadow-inset"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || busy) return;
        onSave({ verdict, reason: trimmed, ...(verdict === "wrong" && belongsIn !== "" ? { belongsIn } : {}) });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p id={questionId} className="m-0 font-body text-small font-bold text-ink-primary">
        Is {label} the right folder for this?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {verdictButton("right", "Right", true)}
        {verdictButton("wrong", "Wrong", false)}
      </div>
      {verdict === "wrong" && (
        <label className={LABEL}>
          Belongs in (optional)
          <select value={belongsIn} disabled={busy} onChange={(e) => setBelongsIn(e.target.value as MemoryFolder | "")} className={FIELD}>
            <option value="">Not sure</option>
            {folders
              .filter((f) => f.folder !== currentFolder)
              .map((f) => (
                <option key={f.folder} value={f.folder} disabled={origin === "inferred" && STATED_ONLY.includes(f.folder)}>
                  {f.label}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className={LABEL}>
        Why
        <textarea value={reason} disabled={busy} maxLength={REASON_MAX_CHARS} rows={2} onChange={(e) => setReason(e.target.value)} className={`resize-none ${FIELD}`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!ready || busy} className={SMALL_BUTTON}>
          Save
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={SMALL_BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}

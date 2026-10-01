/**
 * web/src/components/memory/MemoryItemRow.tsx — Story 13.9 (T10b Part 1).
 * One read-only memory item: the text, a meta caption (Stated/Inferred, date,
 * scope, expiry), pills for state (as words, never color alone), an earlier-
 * versions expander and the Source link. Actions arrive in T11b.
 */
import { useState } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";
import { editItem, markMemorySaved, moveItem, setExpiry, useMemorySaved } from "../../lib/memory.ts";
import { formatMemoryDay } from "../../lib/memoryFormat.ts";
import type { MemoryItemView } from "../../../../src/types/api.ts";
import { BUTTON_SECONDARY, CONTROL_DISABLED, CONTROL_SM, CONTROL_TRANSITION, FOCUS_RING } from "../../lib/controlStyles.ts";
import { ItemOverflowMenu, type FolderChoice } from "./ItemOverflowMenu.tsx";

const CAPTION = "font-body text-small text-ink-secondary";
const PILL = "rounded-full bg-surface-sunken px-2 py-0.5 font-body text-small text-ink-secondary";
const SMALL_BUTTON = `${BUTTON_SECONDARY} ${CONTROL_SM}`;
/** Underlined ink-primary text button (Undo-style link): pads out to the 24px minimum target. */
const LINK_BUTTON = `inline-flex min-h-6 items-center rounded-xs font-body text-small font-bold text-ink-primary underline underline-offset-2 ${FOCUS_RING} ${CONTROL_TRANSITION}`;

export const SMALL_BUTTON_CLASS = SMALL_BUTTON;
export const LINK_BUTTON_CLASS = LINK_BUTTON;

export interface MemoryItemRowProps {
  readonly item: MemoryItemView;
  /** Needs review only: why the item is listed. */
  readonly reason?: string;
  /** When given, the Source line is a button; otherwise it is plain text. */
  readonly onOpenSource?: (source: { conversationId: string; turnId: string }) => void;
  /** All eight folders; when given (with `onDelete`) the row is editable and shows the overflow menu. */
  readonly folders?: readonly FolderChoice[];
  onDelete?(item: MemoryItemView): void;
  /** Delete dissolve: the row collapses away (instantly under reduced motion) and is inert until restored. */
  readonly dissolving?: boolean;
  /** A failed delete send, shown in place once the row is back. */
  readonly error?: string;
  /** Extra buttons under the row (Needs review: Renew, Keep as history, Delete). */
  readonly actions?: React.ReactNode;
}

type Duplicate = { readonly id: string; readonly text: string };

export function MemoryItemRow({ item, reason, onOpenSource, folders, onDelete, dissolving = false, error, actions }: MemoryItemRowProps): React.JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [duplicate, setDuplicate] = useState<Duplicate | undefined>(undefined);
  const saved = useMemorySaved(item.id);
  const editable = folders !== undefined && onDelete !== undefined;
  const readOnlyPending = item.pendingChange;

  const startEdit = (): void => {
    setDraft(item.text);
    setFailure(undefined);
    setDuplicate(undefined);
    setEditing(true);
  };
  const cancel = (): void => {
    setEditing(false);
    setDuplicate(undefined);
  };

  /** Runs one edit request and shows its outcome in place; the field stays disabled while it runs. */
  const save = async (opts?: { mergeWithId?: string; allowDuplicate?: boolean }): Promise<void> => {
    const text = draft.trim();
    if (text === item.text && !opts) return cancel();
    setBusy(true);
    setFailure(undefined);
    setDuplicate(undefined);
    const outcome = await (opts ? editItem(item.id, text, opts) : editItem(item.id, text));
    setBusy(false);
    if (!outcome.ok) {
      setEditing(false);
      setFailure(outcome.message);
    } else if (outcome.value.status === "duplicate") {
      setDuplicate(outcome.value.other);
    } else {
      setEditing(false);
      markMemorySaved(outcome.value.itemId);
    }
  };

  /** Move and expiry are direct writes with the same visible result. */
  const direct = async (run: () => ReturnType<typeof moveItem>): Promise<void> => {
    setFailure(undefined);
    const outcome = await run();
    if (!outcome.ok) setFailure(outcome.message);
    else markMemorySaved(outcome.value.itemId ?? item.id);
  };

  if (dissolving && reducedMotion) return null;

  const meta = [
    ...(saved ? ["Saved"] : []),
    item.origin === "stated" ? "Stated" : "Inferred",
    formatMemoryDay(item.confirmedOn),
    ...(item.scope ? [item.scope] : []),
    ...(item.expiresOn ? [`Expires ${formatMemoryDay(item.expiresOn)}`] : []),
  ].join(" · ");
  const versions = item.earlierVersions.length;
  const source = item.source;

  return (
    <li
      id={`memory-item-${item.id}`}
      data-testid="memory-item"
      aria-hidden={dissolving || undefined}
      inert={dissolving || undefined}
      data-dissolving={dissolving || undefined}
      className={
        "group relative flex list-none flex-col gap-1.5 rounded-lg bg-surface-raised px-4 py-4 font-body shadow-extruded-sm hover:shadow-extruded-md " +
        "transition-[opacity,max-height,padding,margin,box-shadow] duration-[var(--duration-page-transition)] " +
        (dissolving ? "pointer-events-none my-0 max-h-0 overflow-hidden py-0 opacity-0" : "max-h-[600px]")
      }
    >
      <div className="flex items-start gap-2">
        {editing ? (
          <input
            autoFocus
            aria-label="Edit memory"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            className={`min-w-0 flex-1 rounded-md bg-surface-sunken px-3 py-2 font-body text-body text-ink-primary shadow-inset ${CONTROL_DISABLED} ${FOCUS_RING}`}
          />
        ) : editable && !readOnlyPending ? (
          <>
            <button type="button" tabIndex={-1} onClick={startEdit} className="m-0 min-w-0 flex-1 cursor-text border-0 bg-transparent p-0 text-left font-body text-body font-medium text-ink-primary">
              {item.text}
            </button>
            <button
              type="button"
              onClick={startEdit}
              className={`${LINK_BUTTON} opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100`}
            >
              Edit
            </button>
          </>
        ) : (
          <p className="m-0 min-w-0 flex-1 text-body font-medium text-ink-primary">{item.text}</p>
        )}
        {editable && !editing && (
          <ItemOverflowMenu
            itemText={item.text}
            currentFolder={item.folder}
            origin={item.origin}
            {...(item.expiresOn ? { expiresOn: item.expiresOn } : {})}
            folders={folders}
            deleteOnly={readOnlyPending}
            onMove={(folder) => void direct(() => moveItem(item.id, folder))}
            onSetExpiry={(expiresOn) => void direct(() => setExpiry(item.id, expiresOn))}
            onDelete={() => onDelete(item)}
          />
        )}
      </div>
      {duplicate && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-body text-small text-ink-primary">Merge with '{duplicate.text}'?</span>
          <button type="button" disabled={busy} onClick={() => void save({ mergeWithId: duplicate.id })} className={SMALL_BUTTON}>
            Yes
          </button>
          <button type="button" disabled={busy} onClick={() => void save({ allowDuplicate: true })} className={SMALL_BUTTON}>
            No
          </button>
        </div>
      )}
      {readOnlyPending && <p className={`m-0 ${CAPTION}`}>Waiting on your answer in Chat</p>}
      {(failure ?? error) && (
        <p role="alert" className="m-0 font-body text-small font-bold text-ink-danger">
          {failure ?? error}
        </p>
      )}
      <p className={`m-0 ${CAPTION}`}>{meta}</p>
      {reason && <p className="m-0 text-small text-ink-primary">{reason}</p>}
      {actions}
      {(item.notLoadedReason || item.status === "history" || item.declined || item.pendingChange) && (
        <div className="flex flex-wrap items-center gap-2">
          {item.notLoadedReason && <span className={PILL}>Not loaded</span>}
          {item.status === "history" && <span className={PILL}>History</span>}
          {item.declined && <span className={PILL}>Declined</span>}
          {item.pendingChange && <span className={PILL}>Change pending</span>}
          {item.notLoadedReason && <span className={CAPTION}>{item.notLoadedReason}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {versions > 0 && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className={LINK_BUTTON}>
            {versions} earlier {versions === 1 ? "version" : "versions"}
          </button>
        )}
        {source === "deleted" ? (
          <span className={CAPTION}>source deleted</span>
        ) : source ? (
          onOpenSource ? (
            <button type="button" onClick={() => onOpenSource(source)} className={LINK_BUTTON}>
              Source · {formatMemoryDay(source.date)}
            </button>
          ) : (
            <span className={CAPTION}>Source · {formatMemoryDay(source.date)}</span>
          )
        ) : null}
      </div>
      {expanded && (
        <ul className="m-0 flex flex-col gap-1 p-0">
          {item.earlierVersions.map((v) => (
            <li key={v.id} className={`list-none ${CAPTION}`}>
              {v.text} · {formatMemoryDay(v.confirmedOn)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

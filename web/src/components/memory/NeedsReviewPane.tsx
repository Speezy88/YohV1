/**
 * web/src/components/memory/NeedsReviewPane.tsx — Story 13.10 (T11b Part 2).
 * The Needs review list: each row shows its reason and offers Renew (only where
 * it applies), Edit (the row's own inline edit), Delete (the dissolve + Undo
 * flow) and Keep as history. An expired item's Renew opens a small inline
 * choice (a new expiry date, or no expiry); an unused item renews directly.
 * The server decides "expired"; the client only reads the reason it sent.
 */
import { useState } from "react";
import { markMemorySaved, reviewItem, type Outcome } from "../../lib/memory.ts";
import type { MemoryItemView, NeedsReviewItemView } from "../../../../src/types/api.ts";
import { FOCUS_RING } from "../../lib/controlStyles.ts";
import { MemoryItemRow, SMALL_BUTTON_CLASS } from "./MemoryItemRow.tsx";
import type { FolderChoice } from "./ItemOverflowMenu.tsx";

export interface NeedsReviewPaneProps {
  readonly items: readonly NeedsReviewItemView[];
  readonly folders: readonly FolderChoice[];
  onDelete(item: MemoryItemView): void;
  isDissolving(itemId: string): boolean;
  errorFor(itemId: string): string | undefined;
  onOpenSource(source: { conversationId: string; turnId: string }): void;
}

function ReviewActions({ item, onDelete }: { readonly item: NeedsReviewItemView; onDelete(item: MemoryItemView): void }): React.JSX.Element {
  const [choosing, setChoosing] = useState(false);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const expired = item.reason.startsWith("Expired");

  const run = async (action: "renew" | "keep", expiresOn?: string): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    const outcome: Outcome<{ readonly itemId?: string }> = await reviewItem(item.id, action, expiresOn);
    setBusy(false);
    if (!outcome.ok) setFailure(outcome.message);
    else {
      setChoosing(false);
      markMemorySaved(outcome.value.itemId ?? item.id);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {item.canRenew && (
          <button
            type="button"
            disabled={busy}
            aria-expanded={expired ? choosing : undefined}
            onClick={() => (expired ? setChoosing((v) => !v) : void run("renew"))}
            className={SMALL_BUTTON_CLASS}
          >
            Renew
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void run("keep")} className={SMALL_BUTTON_CLASS}>
          Keep as history
        </button>
        <button type="button" disabled={busy} onClick={() => onDelete(item)} className={SMALL_BUTTON_CLASS}>
          Delete
        </button>
      </div>
      {choosing && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 font-body text-small text-ink-primary">
            New expiry
            <input
              type="date"
              value={date}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
              className={`rounded-md bg-surface-sunken px-2 py-1 font-body text-small text-ink-primary shadow-inset ${FOCUS_RING}`}
            />
          </label>
          <button type="button" disabled={busy || date === ""} onClick={() => void run("renew", date)} className={SMALL_BUTTON_CLASS}>
            Set new expiry
          </button>
          <button type="button" disabled={busy} onClick={() => void run("renew")} className={SMALL_BUTTON_CLASS}>
            No expiry
          </button>
        </div>
      )}
      {failure && (
        <p role="alert" className="m-0 font-body text-small font-bold text-ink-danger">
          {failure}
        </p>
      )}
    </div>
  );
}

export function NeedsReviewPane({ items, folders, onDelete, isDissolving, errorFor, onOpenSource }: NeedsReviewPaneProps): React.JSX.Element {
  return (
    <ul aria-label="Needs review" className="m-0 flex flex-col gap-2 p-0">
      {items.map((i) => {
        const error = errorFor(i.id);
        return (
          <MemoryItemRow
            key={i.id}
            item={i}
            reason={i.reason}
            folders={folders}
            onDelete={onDelete}
            dissolving={isDissolving(i.id)}
            {...(error ? { error } : {})}
            onOpenSource={onOpenSource}
            actions={<ReviewActions item={i} onDelete={onDelete} />}
          />
        );
      })}
    </ul>
  );
}

/**
 * web/src/components/RememberedReceipt.tsx
 *
 * Story 13.4: the one muted line under a reply when Yoh files or forgets
 * something ("Remembered: ... · Undo"). The `aria-live="polite"` wrapper is
 * rendered on every finished assistant message (empty until a receipt
 * arrives) so the line's insertion is announced. Undo stays until Spencer's
 * next message; then the line settles, offering View in Memory once the
 * Memory page exists. The line fades in unless reduced motion is on.
 */
import { useState } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { hasMemoryPage, MEMORY_FOLDER_LABELS, undoMemoryReceipt, useOpenInMemory } from "../lib/memoryApi.ts";
import { setReceiptOutcome, type ReceiptState } from "../lib/chatStore.ts";
import type { RememberedReceipt as Receipt } from "../../../src/types/api.ts";

const CAPTION = "font-body text-small text-ink-secondary";
const LINK_BUTTON =
  "font-body text-small font-semibold text-ink-primary underline underline-offset-2 disabled:opacity-60 " +
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";

export const FILING_FAILED_COPY = "Couldn't save that to memory.";
export const UNDO_FAILED_COPY = "Couldn't undo that.";

export interface RememberedReceiptProps {
  readonly messageId: string;
  readonly receipt?: Receipt;
  readonly state: ReceiptState;
  /** The server's message after an Undo (or a refusal). */
  readonly note?: string;
  /** Overridable so a test can cover both branches; defaults to whether the Memory page exists. */
  readonly showViewInMemory?: boolean;
}

function itemLine(kind: Receipt["kind"], item: Receipt["items"][number]): string {
  if (kind === "forgot") return item.text;
  const parts = [item.text, MEMORY_FOLDER_LABELS[item.folder]];
  if (item.scope) parts.push(`for ${item.scope}`);
  if (item.expiresOn) parts.push(`until ${item.expiresOn}`);
  return parts.join(" · ");
}

function receiptText(receipt: Receipt): string {
  return `${receipt.kind === "forgot" ? "Forgot" : "Remembered"}: ${receipt.items.map((item) => itemLine(receipt.kind, item)).join(" ; ")}`;
}

export function RememberedReceipt({ messageId, receipt, state, note, showViewInMemory }: RememberedReceiptProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [undoFailed, setUndoFailed] = useState(false);
  const openInMemory = useOpenInMemory();
  const canViewInMemory = (showViewInMemory ?? hasMemoryPage()) && openInMemory !== undefined;

  const undo = async (): Promise<void> => {
    if (!receipt || busy) return;
    setBusy(true);
    setUndoFailed(false);
    const outcome = await undoMemoryReceipt(receipt.receiptId);
    setBusy(false);
    if (outcome.status === "ok") setReceiptOutcome(messageId, "removed", outcome.message);
    else if (outcome.status === "refused") setReceiptOutcome(messageId, "settled", outcome.message);
    else setUndoFailed(true);
  };

  let body: React.JSX.Element | null = null;
  if (receipt) {
    if (receipt.items.length === 0) {
      body = <>{FILING_FAILED_COPY}</>;
    } else if (state === "removed") {
      body = <>{note ?? "Removed from memory."}</>;
    } else {
      body = (
        <>
          {receiptText(receipt)}
          {state === "undoable" ? (
            <>
              {" · "}
              <button type="button" className={LINK_BUTTON} disabled={busy} onClick={() => void undo()}>
                Undo
              </button>
              {undoFailed && ` ${UNDO_FAILED_COPY}`}
            </>
          ) : (
            <>
              {note && ` · ${note}`}
              {canViewInMemory && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className={LINK_BUTTON}
                    onClick={() => {
                      const first = receipt.items[0];
                      if (first) openInMemory?.(first.id, first.folder);
                    }}
                  >
                    View in Memory
                  </button>
                </>
              )}
            </>
          )}
        </>
      );
    }
  }

  return (
    <div aria-live="polite">
      {body && (
        <p data-testid="remembered-receipt" className={`${CAPTION}${reduced ? "" : " receipt-fade"}`}>
          {body}
        </p>
      )}
    </div>
  );
}

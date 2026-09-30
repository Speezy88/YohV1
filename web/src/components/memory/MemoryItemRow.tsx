/**
 * web/src/components/memory/MemoryItemRow.tsx — Story 13.9 (T10b Part 1).
 * One read-only memory item: the text, a meta caption (Stated/Inferred, date,
 * scope, expiry), pills for state (as words, never color alone), an earlier-
 * versions expander and the Source link. Actions arrive in T11b.
 */
import { useState } from "react";
import { formatMemoryDay } from "../../lib/memoryFormat.ts";
import type { MemoryItemView } from "../../../../src/types/api.ts";

const CAPTION = "font-body text-small text-ink-secondary";
const PILL = "rounded-full bg-surface-sunken px-2 py-0.5 font-body text-small text-ink-secondary";
const LINK_BUTTON =
  "font-body text-small font-semibold text-ink-primary underline underline-offset-2 " +
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";

export interface MemoryItemRowProps {
  readonly item: MemoryItemView;
  /** Needs review only: why the item is listed. */
  readonly reason?: string;
  /** When given, the Source line is a button; otherwise it is plain text. */
  readonly onOpenSource?: (source: { conversationId: string; turnId: string }) => void;
}

export function MemoryItemRow({ item, reason, onOpenSource }: MemoryItemRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const meta = [
    item.origin === "stated" ? "Stated" : "Inferred",
    formatMemoryDay(item.confirmedAt),
    ...(item.scope ? [item.scope] : []),
    ...(item.expiresOn ? [`Expires ${formatMemoryDay(item.expiresOn)}`] : []),
  ].join(" · ");
  const versions = item.earlierVersions.length;
  const source = item.source;

  return (
    <li
      id={`memory-item-${item.id}`}
      data-testid="memory-item"
      className="flex list-none flex-col gap-1.5 rounded-lg bg-surface-raised px-[18px] py-4 font-body shadow-extruded-sm"
    >
      <p className="m-0 text-body font-medium text-ink-primary">{item.text}</p>
      <p className={`m-0 ${CAPTION}`}>{meta}</p>
      {reason && <p className="m-0 text-small text-ink-primary">{reason}</p>}
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
              {v.text} · {formatMemoryDay(v.confirmedAt)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

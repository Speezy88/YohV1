/**
 * web/src/components/memory/MemorySearch.tsx — Story 13.9 (T10b Part 2).
 * One keyword box over memories and chat turns (`useMemorySearch`) and its
 * results, which replace the list while text is present. Each hit shows its
 * folder or Conversation date and opens in place. Esc clears.
 */
import { FIELD_FOCUS_WITHIN, ROW_HOVER_RAISED } from "../../lib/controlStyles.ts";
import { LINK_BUTTON_CLASS } from "./MemoryItemRow.tsx";
import { StateMessage } from "../StateMessage.tsx";
import { MemorySkeletonRow } from "./MemorySkeletonRow.tsx";
import { formatConversationDay } from "../../lib/memoryFormat.ts";
import { MEMORY_FOLDER_LABELS } from "../../lib/memoryApi.ts";
import type { useMemorySearch } from "../../lib/memory.ts";

type Search = ReturnType<typeof useMemorySearch>;

const CAPTION = "font-body text-small text-ink-secondary";
const HIT = `flex w-full flex-col gap-1 rounded-lg bg-surface-raised px-4 py-4 text-left font-body shadow-extruded-sm ${ROW_HOVER_RAISED}`;

export function MemorySearchBox({ search }: { readonly search: Search }): React.JSX.Element {
  return (
    <div data-wheel-nav="off" className={`flex items-center gap-2 rounded-lg bg-surface-sunken px-4 py-2 shadow-inset ${FIELD_FOCUS_WITHIN}`}>
      <input
        type="search"
        aria-label="Search memory"
        placeholder="Search memories and chats"
        value={search.text}
        onChange={(e) => search.setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && search.text !== "") {
            e.preventDefault();
            e.stopPropagation();
            search.clear();
          }
        }}
        className="min-w-0 flex-1 border-0 bg-transparent font-body text-body text-ink-primary outline-none placeholder:text-ink-secondary"
      />
      {search.text !== "" && (
        <button
          type="button"
          onClick={search.clear}
          className={LINK_BUTTON_CLASS}
        >
          Clear search
        </button>
      )}
    </div>
  );
}

export function MemorySearchResults({
  search,
  onOpenItem,
  onOpenTurn,
}: {
  readonly search: Search;
  onOpenItem(itemId: string): void;
  onOpenTurn(conversationId: string, turnId: string): void;
}): React.JSX.Element {
  const words = search.text.trim();
  if (search.status === "error") {
    // Retry = run the current query again.
    return <StateMessage variant="error" message="Couldn't search memory right now." onRetry={() => search.setText(search.text)} className="p-5" />;
  }
  if (search.status === "loading" && !search.results) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <MemorySkeletonRow key={i} />
        ))}
      </div>
    );
  }
  const results = search.results;
  if (!results) return <></>;
  if (results.items.length === 0 && results.turns.length === 0) {
    return <StateMessage variant="empty" message={`No memories or chats match '${words}'.`} className="p-5" />;
  }
  return (
    <ul aria-label="Search results" className="m-0 flex flex-col gap-2 p-0">
      {results.items.map((i) => (
        <li key={`i-${i.id}`} className="list-none">
          <button type="button" className={HIT} onClick={() => onOpenItem(i.id)}>
            <span className="text-body font-medium text-ink-primary">{i.text}</span>
            <span className={CAPTION}>{MEMORY_FOLDER_LABELS[i.folder]}</span>
          </button>
        </li>
      ))}
      {results.turns.map((t) => (
        <li key={`t-${t.turnId}`} className="list-none">
          <button type="button" className={HIT} onClick={() => onOpenTurn(t.conversationId, t.turnId)}>
            <span className="text-body font-medium text-ink-primary">{t.snippet}</span>
            <span className={CAPTION}>
              Conversation {formatConversationDay(t.date)} · {t.role === "user" ? "You" : "Yoh"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

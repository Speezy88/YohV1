/**
 * web/src/components/memory/MemorySearch.tsx — Story 13.9 (T10b Part 2).
 * One keyword box over memories and chat turns (`useMemorySearch`) and its
 * results, which replace the list while text is present. Each hit shows its
 * folder or Conversation date and opens in place. Esc clears.
 */
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";
import { formatConversationDay } from "../../lib/memoryFormat.ts";
import { MEMORY_FOLDER_LABELS } from "../../lib/memoryApi.ts";
import type { useMemorySearch } from "../../lib/memory.ts";

type Search = ReturnType<typeof useMemorySearch>;

const CAPTION = "font-body text-small text-ink-secondary";
const HIT =
  "flex w-full flex-col gap-1 rounded-lg bg-surface-raised px-[18px] py-4 text-left font-body shadow-extruded-sm " +
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";

export function MemorySearchBox({ search }: { readonly search: Search }): React.JSX.Element {
  return (
    <div data-wheel-nav="off" className="flex items-center gap-2 rounded-xl bg-surface-sunken px-4 py-2 shadow-inset">
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
          className="rounded-sm font-body text-small font-semibold text-ink-primary underline underline-offset-2 focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
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
  const reducedMotion = useReducedMotion();
  const words = search.text.trim();
  if (search.status === "error") return <p className={`m-0 p-5 ${CAPTION}`}>Couldn't search memory right now.</p>;
  if (search.status === "loading" && !search.results) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <div key={i} data-testid="memory-skeleton" className={`h-[74px] rounded-lg bg-surface-sunken ${reducedMotion ? "" : "animate-pulse"}`} />
        ))}
      </div>
    );
  }
  const results = search.results;
  if (!results) return <></>;
  if (results.items.length === 0 && results.turns.length === 0) {
    return <p className={`m-0 p-5 text-body ${CAPTION}`}>No memories or chats match '{words}'.</p>;
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

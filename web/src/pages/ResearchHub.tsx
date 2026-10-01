/**
 * web/src/pages/ResearchHub.tsx — Task 6C (FR-43, UX-DR43): the fourth page
 * in the vertical stack, styled like Tasks and Home (a raised card list, an
 * inset ask box, gradient accents, the 40px page title) since no separate
 * mockup artboard exists for this page (Task 6A's placeholder note).
 *
 * Shows the most recent Research Vault items — title, date, source count —
 * each linking straight to its own Notion page. The list, its ordering, and
 * its cap are all computed server-side (`GET /api/research`, AD-17); this
 * component only renders what it's given, and refetches on the shared
 * event bus's `research` hint (AD-18 — no second EventSource), which
 * `app/save-search-result.ts` appends after a successful "save that".
 *
 * "Ask a research question" sends the question straight into the Chat
 * panel (`openChatPanel` + `chatStore.send`), which runs Chat's existing
 * search -> "save that" flow — the async `/research` job queue and the
 * richer in-page document view are Epic 11's job; only this page's shell
 * ships now. The caption under the box says exactly what happens today,
 * with no fake features: Chat may not have web search configured yet
 * (it needs a Perplexity key), and if it isn't, Chat itself says so.
 */
import { useRef, useState } from "react";
import { openChatPanel } from "../lib/chatPanel.ts";
import { send } from "../lib/chatStore.ts";
import { formatResearchDate, useResearchList } from "../lib/research.ts";
import { FIELD_FOCUS_WITHIN, ROW_HOVER_RAISED } from "../lib/controlStyles.ts";
import { ExternalLinkGlyph, SearchGlyph } from "../components/icons/Glyphs.tsx";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { StateMessage } from "../components/StateMessage.tsx";
import type { ResearchListItem } from "../../../src/types/api.ts";

function RowSkeleton({ reducedMotion }: { readonly reducedMotion: boolean }): React.JSX.Element {
  return <div data-testid="research-row-skeleton" className={`h-[74px] rounded-lg bg-surface-sunken ${reducedMotion ? "" : "animate-pulse"}`} />;
}

function ResearchRow({ item }: { readonly item: ResearchListItem }): React.JSX.Element {
  const sourceWord = item.sourceCount === 1 ? "source" : "sources";
  return (
    <a
      data-testid="research-row"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-4 py-4 font-body shadow-extruded-sm ${ROW_HOVER_RAISED}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-body font-medium text-ink-primary">{item.title}</span>
        <span className="text-small text-ink-secondary">
          {item.date ? `${formatResearchDate(item.date)} · ` : ""}
          {item.sourceCount} {sourceWord}
        </span>
      </div>
      <ExternalLinkGlyph size={18} className="shrink-0 text-ink-secondary" />
    </a>
  );
}

function AskResearchBox(): React.JSX.Element {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    openChatPanel();
    // Real-use fixes plan, Task 5 (Ruling): always send an explicit
    // "search: <question>" line — `core/search-intent.ts`'s
    // `parseSearchIntent` treats a leading "search:" as an explicit search
    // request, so this ask box never depends on chatTurn's classifier
    // (`classifyChatIntent`) to actually run a search.
    void send(`search: ${trimmed}`);
    setText("");
  };

  return (
    // Polish-4 addendum (wheel paging only outside cards): this raised card
    // opts out of wheel page-navigation (`data-wheel-nav="off"`,
    // `lib/wheelNav.ts`).
    <section aria-label="Ask a research question" data-wheel-nav="off" className="flex flex-col gap-3 rounded-2xl bg-surface-raised px-4 py-4 shadow-extruded-lg">
      <label
        className={
          "flex h-[58px] items-center gap-3.5 rounded-lg border-[length:var(--rim-width)] bg-surface-sunken px-4 shadow-inset " + FIELD_FOCUS_WITHIN + " " +
          (focused ? "border-accent-solid" : "border-transparent")
        }
      >
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end">
          <SearchGlyph className="text-on-accent-solid" />
        </span>
        <input
          ref={inputRef}
          type="text"
          aria-label="Ask a research question"
          placeholder="Ask a research question — e.g. AP Bio registration deadline"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && text !== "") {
              e.preventDefault();
              setText("");
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-w-0 flex-1 border-0 bg-transparent font-body text-body text-ink-primary outline-none placeholder:text-ink-secondary"
        />
        <span className="shrink-0 font-body text-small text-ink-secondary">Enter to ask</span>
      </label>
      <p className="m-0 pl-1 font-body text-small text-ink-secondary">
        Opens in Chat, where Yoh searches — say "save that" to file the answer here.
      </p>
    </section>
  );
}

export default function ResearchHubPage(): React.JSX.Element {
  const { state, refetch } = useResearchList();
  const reducedMotion = useReducedMotion();
  const items = state.status === "loaded" ? state.value.items : [];

  return (
    <div className="flex h-full flex-col gap-5 p-8 pb-24">
      <header>
        <h1 className="m-0 font-body text-display font-bold tracking-tight text-ink-primary">Research Hub</h1>
      </header>

      <AskResearchBox />

      {/* Polish-4 addendum (wheel paging only outside cards): same opt-out
          as the "Ask a research question" card above. */}
      <section aria-label="Recent research" data-wheel-nav="off" className="flex min-h-0 flex-1 flex-col gap-2">
        {state.status === "loaded" && state.refreshFailed && (
          <p className="m-0 px-4 font-body text-small text-ink-secondary">
            Couldn't refresh from Notion — showing the list from {state.refreshFailed.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>
        )}
        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4 pt-1">
          {state.status === "loading" ? (
            [0, 1, 2].map((i) => <RowSkeleton key={i} reducedMotion={reducedMotion} />)
          ) : state.status === "error" ? (
            <StateMessage variant="error" className="p-5" message="Couldn't load your Research Vault right now." detail={state.message} onRetry={() => void refetch()} />
          ) : items.length === 0 ? (
            <StateMessage variant="empty" className="p-5" message={'Nothing saved yet. Ask a question, then say "save that".'} />
          ) : (
            items.map((item) => <ResearchRow key={item.id} item={item} />)
          )}
        </div>
      </section>
    </div>
  );
}

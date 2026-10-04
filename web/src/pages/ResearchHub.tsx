/**
 * web/src/pages/ResearchHub.tsx — Task 6C (FR-43, UX-DR43): the fourth page
 * in the vertical stack, styled like Tasks and Home (a raised card list, an
 * inset ask box, gradient accents, the 40px page title) since no separate
 * mockup artboard exists for this page (Task 6A's placeholder note).
 *
 * Story 11.2: a Research Box above the library shows one document (title,
 * date, body, sources, "Open in Notion"); the newest by default. A library
 * row opens its document in the box without leaving the page, and
 * `openResearchDocument(id)` (a notification deep link) does the same by
 * id. The library lists the newest 20 rows; "Show more" adds 20 at a time.
 * The list, its ordering and its paging are all computed server-side
 * (`GET /api/research`, AD-17); this component only renders what it's
 * given, and refetches on the shared event bus's `research` hint (AD-18 —
 * no second EventSource), which `app/save-search-result.ts` appends after a
 * successful "save that".
 *
 * "Ask a research question" sends the question straight into the Chat
 * panel (`openChatPanel` + `chatStore.send`), which runs Chat's existing
 * search -> "save that" flow. The caption under the box says exactly what happens today,
 * with no fake features: Chat may not have web search configured yet
 * (it needs a Perplexity key), and if it isn't, Chat itself says so.
 */
import { useEffect, useRef, useState } from "react";
import { openChatPanel } from "../lib/chatPanel.ts";
import { send } from "../lib/chatStore.ts";
import { formatResearchDate, openResearchDocument, useResearchDocument, useResearchList, useSelectedResearchId } from "../lib/research.ts";
import { BUTTON_SECONDARY, CONTROL_MD, FIELD_FOCUS_WITHIN, ROW_HOVER_RAISED } from "../lib/controlStyles.ts";
import { ExternalLinkGlyph, SearchGlyph } from "../components/icons/Glyphs.tsx";
import { SafeMarkdown } from "../components/ChatMessage.tsx";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { StateMessage } from "../components/StateMessage.tsx";
import type { ResearchDocument, ResearchListItem } from "../../../src/types/api.ts";

function RowSkeleton({ reducedMotion }: { readonly reducedMotion: boolean }): React.JSX.Element {
  return <div data-testid="research-row-skeleton" className={`h-[74px] rounded-lg bg-surface-sunken ${reducedMotion ? "" : "animate-pulse"}`} />;
}

function ResearchRow({ item, current }: { readonly item: ResearchListItem; readonly current: boolean }): React.JSX.Element {
  const sourceWord = item.sourceCount === 1 ? "source" : "sources";
  return (
    <button
      type="button"
      data-testid="research-row"
      aria-current={current ? "true" : undefined}
      onClick={() => openResearchDocument(item.id)}
      className={`flex w-full items-center justify-between gap-4 rounded-lg border-l-[length:var(--rim-width)] bg-surface-raised px-4 py-4 text-left font-body shadow-extruded-sm ${current ? "border-accent-solid" : "border-transparent"} ${ROW_HOVER_RAISED}`}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-body font-medium text-ink-primary">{item.title}</span>
        <span className="text-small text-ink-secondary">
          {item.date ? `${formatResearchDate(item.date)} · ` : ""}
          {item.sourceCount} {sourceWord}
        </span>
      </span>
      {current && <span className="shrink-0 text-small font-medium text-ink-accent">Viewing</span>}
    </button>
  );
}

/** E11-R3: a source line that parses as an http(s) URL is a link; anything else is plain text. */
function isHttpUrl(line: string): boolean {
  try {
    const u = new URL(line);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function ResearchBoxContent({ doc }: { readonly doc: ResearchDocument }): React.JSX.Element {
  return (
    <section aria-label="Research document" data-wheel-nav="off" className="flex flex-col gap-4 rounded-2xl bg-surface-raised px-5 py-5 shadow-extruded-lg">
      <header className="flex flex-col gap-1">
        <h2 className="m-0 font-body text-title font-bold text-ink-primary">{doc.title}</h2>
        {doc.date && (
          <span data-testid="research-box-date" className="font-body text-small text-ink-secondary">
            {formatResearchDate(doc.date)}
          </span>
        )}
      </header>
      {doc.body.trim() !== "" && (
        <div data-testid="research-box-body" className="font-body text-body text-ink-primary">
          <SafeMarkdown text={doc.body} />
        </div>
      )}
      {doc.sources.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 font-body text-small font-bold text-ink-secondary">Sources</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 font-body text-small text-ink-primary">
            {doc.sources.map((line, i) => (
              <li key={i} className="break-words">
                {isHttpUrl(line) ? (
                  <a href={line} target="_blank" rel="noopener noreferrer" className="text-ink-accent underline">
                    {line}
                  </a>
                ) : (
                  line
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <a href={doc.url} target="_blank" rel="noopener noreferrer" className={`${BUTTON_SECONDARY} ${CONTROL_MD} self-start`}>
        Open in Notion
        <ExternalLinkGlyph size={16} />
      </a>
    </section>
  );
}

function ResearchBox({ state, onRetry, reducedMotion }: { readonly state: ReturnType<typeof useResearchDocument>["state"]; readonly onRetry: () => void; readonly reducedMotion: boolean }): React.JSX.Element | null {
  if (state.status === "loading") {
    return <div data-testid="research-box-skeleton" className={`h-[180px] shrink-0 rounded-2xl bg-surface-sunken ${reducedMotion ? "" : "animate-pulse"}`} />;
  }
  if (state.status === "error") {
    return <StateMessage variant="error" className="rounded-2xl bg-surface-raised p-5 shadow-extruded-lg" message="Couldn't load this document right now." onRetry={onRetry} />;
  }
  const doc = state.value.document;
  return doc ? <ResearchBoxContent doc={doc} /> : null;
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
    // request, so this ask box never depends on the chat model
    // choosing to run a search.
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
  const { state, refetch, showMore, moreFailed, loadingMore } = useResearchList();
  const document = useResearchDocument();
  const reducedMotion = useReducedMotion();
  const selectedId = useSelectedResearchId();
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // A row click or a deep link picks a document; the page scrolls as a whole, so bring the box into view.
  // Not on the initial load or a hint refresh (neither changes the selection). This scrolls the page's own
  // scroller by the `block: "nearest"` distance rather than calling `box.scrollIntoView`, which would also
  // scroll the page stack's overflow-hidden ancestors while a deep link's page transition is still running.
  // Not on mount with a selection that already exists (coming back to the page), only on a change after it.
  const previousSelectedId = useRef(selectedId);
  const announceNext = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (previousSelectedId.current === selectedId) return;
    previousSelectedId.current = selectedId;
    announceNext.current = selectedId !== undefined;
    const root = rootRef.current;
    const box = boxRef.current;
    if (selectedId === undefined || !root || !box) return;
    const r = root.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const delta = b.top < r.top ? b.top - r.top : b.bottom > r.bottom ? Math.min(b.bottom - r.bottom, b.top - r.top) : 0;
    if (delta !== 0) root.scrollBy?.({ top: delta, behavior: reducedMotion ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  // One always-mounted status region: said once when a row click or deep link has opened a document,
  // never on the initial load or a hint refresh.
  useEffect(() => {
    if (!announceNext.current || document.state.status !== "loaded") return;
    announceNext.current = false;
    const title = document.state.value.document?.title;
    if (title) setAnnouncement(`Showing ${title}`);
  }, [document.state]);
  const items = state.status === "loaded" ? state.value.items : [];
  const hasMore = state.status === "loaded" && state.value.hasMore;
  // The row marker follows the document actually returned, not the id asked for.
  const currentId = document.state.status === "loaded" ? document.state.value.document?.id : undefined;
  // No box for an empty vault or a failed list load: the library's own state speaks.
  const showBox = state.status !== "error" && !(state.status === "loaded" && items.length === 0);

  return (
    <div ref={rootRef} data-testid="research-scroller" className="flex h-full flex-col gap-5 overflow-y-auto p-8 pb-24">
      <header>
        <h1 className="m-0 font-body text-display font-bold tracking-tight text-ink-primary">Research Hub</h1>
      </header>

      <AskResearchBox />

      <div role="status" className="sr-only">
        {announcement}
      </div>

      {showBox && (
        <div ref={boxRef} data-testid="research-box">
          <ResearchBox state={document.state} onRetry={() => void document.refetch()} reducedMotion={reducedMotion} />
        </div>
      )}

      {/* Polish-4 addendum (wheel paging only outside cards): same opt-out
          as the "Ask a research question" card above. */}
      <section aria-label="Recent research" data-wheel-nav="off" className="flex shrink-0 flex-col gap-2">
        {state.status === "loaded" && state.refreshFailed && (
          <p className="m-0 px-4 font-body text-small text-ink-secondary">
            Couldn't refresh from Notion — showing the list from {state.refreshFailed.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>
        )}
        <div className="-mx-4 flex flex-col gap-2 px-4 pb-4 pt-1">
          {state.status === "loading" ? (
            [0, 1, 2].map((i) => <RowSkeleton key={i} reducedMotion={reducedMotion} />)
          ) : state.status === "error" ? (
            <StateMessage variant="error" className="p-5" message="Couldn't load your Research Vault right now." detail={state.message} onRetry={() => void refetch()} />
          ) : items.length === 0 ? (
            <StateMessage variant="empty" className="p-5" message={'Nothing saved yet. Ask a question, then say "save that".'} />
          ) : (
            <>
              {items.map((item) => (
                <ResearchRow key={item.id} item={item} current={item.id === currentId} />
              ))}
              {moreFailed && <p className="m-0 px-1 font-body text-small text-ink-primary">Couldn't load more.</p>}
              {(hasMore || moreFailed) && (
                <button type="button" disabled={loadingMore} onClick={() => void showMore()} className={`${BUTTON_SECONDARY} ${CONTROL_MD} self-start`}>
                  {moreFailed ? "Try again" : "Show more"}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

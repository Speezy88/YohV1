/**
 * web/src/pages/Memory.tsx — Story 13.9 (T10b Part 1): the fifth page. Two
 * panes: the Memory Rail and the selected list (a folder, Needs review or
 * Changed settings). Items edit in place (T11b Part 1); Needs review and Changed
 * settings actions arrive in Part 2. Data: `lib/memory.ts` (one fetch + the `memory`
 * hint on the shared event bus).
 */
import { useEffect } from "react";
import { ChatHistoryPane } from "../components/memory/ChatHistoryPane.tsx";
import { MemorySearchBox, MemorySearchResults } from "../components/memory/MemorySearch.tsx";
import { MemoryItemRow } from "../components/memory/MemoryItemRow.tsx";
import { useMemoryDelete, type MemoryDelete } from "../components/memory/MemoryDeleteToast.tsx";
import { MemoryRail } from "../components/memory/MemoryRail.tsx";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { clearPendingScroll, openMemoryItem, selectMemory, startMemoryStream, useMemorySearch, useMemoryView, type MemorySelection } from "../lib/memory.ts";
import { formatMemoryDay } from "../lib/memoryFormat.ts";
import type { MemoryViewResponse } from "../../../src/types/api.ts";

const openSource = (source: { conversationId: string; turnId: string }): void =>
  selectMemory({ kind: "history", conversationId: source.conversationId, turnId: source.turnId });

const MUTED = "m-0 p-5 font-body text-body text-ink-secondary";

function Skeleton({ reducedMotion }: { readonly reducedMotion: boolean }): React.JSX.Element {
  return <div data-testid="memory-skeleton" className={`h-[74px] rounded-lg bg-surface-sunken ${reducedMotion ? "" : "animate-pulse"}`} />;
}

function Pane({ view, selection, pendingScrollId, del }: { readonly view: MemoryViewResponse; readonly selection: MemorySelection; readonly pendingScrollId?: string; readonly del: MemoryDelete }): React.JSX.Element {
  const folderChoices = view.folders.map((f) => ({ folder: f.folder, label: f.label }));
  const rowProps = (id: string) => ({
    folders: folderChoices,
    onDelete: del.request,
    dissolving: del.isDissolving(id),
    ...(del.errorFor(id) ? { error: del.errorFor(id) } : {}),
  });
  useEffect(() => {
    if (!pendingScrollId) return;
    const el = document.getElementById(`memory-item-${pendingScrollId}`);
    if (el) {
      if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
      clearPendingScroll();
    }
  }, [pendingScrollId, selection]);

  if (selection.kind === "needs-review" && view.needsReview.length > 0) {
    return (
      <ul aria-label="Needs review" className="m-0 flex flex-col gap-2 p-0">
        {view.needsReview.map((i) => (
          <MemoryItemRow key={i.id} item={i} reason={i.reason} onOpenSource={openSource} {...rowProps(i.id)} />
        ))}
      </ul>
    );
  }
  if (selection.kind === "settings") {
    if (view.changedSettings.length === 0) return <p className={MUTED}>No settings changed.</p>;
    return (
      <ul aria-label="Changed settings" className="m-0 flex flex-col gap-2 p-0">
        {view.changedSettings.map((s) => (
          <li key={`${s.key}:${s.area ?? ""}`} className="flex list-none flex-col gap-1 rounded-lg bg-surface-raised px-[18px] py-4 font-body shadow-extruded-sm">
            <span className="text-body font-medium text-ink-primary">{s.label}</span>
            <span className="text-small text-ink-secondary">
              {s.value} · was {s.was} · changed {formatMemoryDay(s.changedAt)}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (selection.kind === "history") {
    return (
      <ChatHistoryPane
        {...(selection.conversationId ? { conversationId: selection.conversationId } : {})}
        {...(selection.turnId ? { turnId: selection.turnId } : {})}
        onOpen={(conversationId) => selectMemory({ kind: "history", conversationId })}
        onBack={() => selectMemory({ kind: "history" })}
      />
    );
  }
  const folderId = selection.kind === "folder" ? selection.folder : "feedback";
  const folder = view.folders.find((f) => f.folder === folderId) ?? view.folders[0];
  if (!folder) return <p className={MUTED}>Nothing here yet. Say "remember that ..." in Chat.</p>;
  const patterns = folder.folder === "patterns" ? view.pendingPatterns : [];
  if (folder.items.length === 0 && patterns.length === 0) {
    return (
      <p className={MUTED}>
        {folder.folder === "patterns" ? "No patterns yet. Yoh will ask before adding one." : 'Nothing here yet. Say "remember that ..." in Chat.'}
      </p>
    );
  }
  return (
    <ul aria-label={folder.label} className="m-0 flex flex-col gap-2 p-0">
      {patterns.map((q) => (
        <li key={q.requestId + q.questionId} className="list-none rounded-lg bg-surface-sunken px-[18px] py-4 font-body text-body text-ink-secondary">
          {q.text}
        </li>
      ))}
      {folder.items.map((i) => (
        <MemoryItemRow key={i.id} item={i} onOpenSource={openSource} {...rowProps(i.id)} />
      ))}
    </ul>
  );
}

export default function MemoryPage(): React.JSX.Element {
  const { view, selection, pendingScrollId } = useMemoryView();
  const reducedMotion = useReducedMotion();
  const search = useMemorySearch();
  const del = useMemoryDelete();
  const searching = search.text.trim() !== "";

  useEffect(() => startMemoryStream(), []);

  return (
    <div className="flex h-full flex-col gap-[22px] p-8 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 font-body text-display font-bold tracking-tight text-ink-primary">Memory</h1>
        {view.status === "loaded" && (
          <div className="w-full max-w-[360px]">
            <MemorySearchBox search={search} />
          </div>
        )}
      </header>
      <div className="flex min-h-0 flex-1 gap-5">
        {view.status === "loaded" ? (
          <>
            <MemoryRail view={view.value} selection={selection} onSelect={selectMemory} />
            <section aria-label="Memory items" data-wheel-nav="off" className="min-h-0 min-w-0 flex-1 overflow-y-auto px-1 pb-4 pt-1">
              {searching ? (
                <MemorySearchResults
                  search={search}
                  onOpenItem={(id) => {
                    openMemoryItem(id);
                    search.clear();
                  }}
                  onOpenTurn={(conversationId, turnId) => {
                    selectMemory({ kind: "history", conversationId, turnId });
                    search.clear();
                  }}
                />
              ) : (
                <Pane view={view.value} selection={selection} pendingScrollId={pendingScrollId} del={del} />
              )}
            </section>
          </>
        ) : view.status === "error" ? (
          <p className={MUTED}>Couldn't load memory right now.</p>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} reducedMotion={reducedMotion} />
            ))}
          </div>
        )}
      </div>
      {del.toast}
    </div>
  );
}

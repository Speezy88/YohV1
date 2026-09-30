/**
 * web/src/pages/Memory.tsx — Story 13.9 (T10b Part 1): the fifth page. Two
 * panes: the Memory Rail and the selected list (a folder, Needs review or
 * Changed settings). Items edit in place (T11b Part 1); Needs review actions and Changed
 * settings Revert live in their own panes (T11b Part 2). Data: `lib/memory.ts` (one fetch + the `memory`
 * hint on the shared event bus).
 */
import { useEffect } from "react";
import { ChatHistoryPane } from "../components/memory/ChatHistoryPane.tsx";
import { MemorySearchBox, MemorySearchResults } from "../components/memory/MemorySearch.tsx";
import { ChangedSettingsPane } from "../components/memory/ChangedSettingsPane.tsx";
import { NeedsReviewPane } from "../components/memory/NeedsReviewPane.tsx";
import { PendingPatterns } from "../components/memory/PendingPatterns.tsx";
import { MemoryItemRow } from "../components/memory/MemoryItemRow.tsx";
import { useMemoryDelete, type MemoryDelete } from "../components/memory/MemoryDeleteToast.tsx";
import { MemoryRail } from "../components/memory/MemoryRail.tsx";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { clearPendingScroll, openMemoryItem, selectMemory, startMemoryStream, useMemorySearch, useMemoryView, type MemorySelection } from "../lib/memory.ts";
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
      <NeedsReviewPane
        items={view.needsReview}
        folders={folderChoices}
        onDelete={del.request}
        isDissolving={del.isDissolving}
        errorFor={del.errorFor}
        onOpenSource={openSource}
      />
    );
  }
  if (selection.kind === "settings") return <ChangedSettingsPane settings={view.changedSettings} />;
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
  // The Patterns folder always mounts PendingPatterns, so an answered card's reply survives the refetch that empties it.
  if (folder.items.length === 0 && patterns.length === 0 && folder.folder !== "patterns") {
    return (
      <p className={MUTED}>
        Nothing here yet. Say "remember that ..." in Chat.
      </p>
    );
  }
  return (
    <ul aria-label={folder.label} className="m-0 flex flex-col gap-2 p-0">
      <PendingPatterns key={folder.folder} questions={patterns} {...(folder.folder === "patterns" && folder.items.length === 0 ? { emptyNote: "No patterns yet. Yoh will ask before adding one." } : {})} />
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

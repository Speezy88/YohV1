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
import { MemorySkeletonRow, MEMORY_LOAD_ERROR } from "../components/memory/MemorySkeletonRow.tsx";
import { StateMessage } from "../components/StateMessage.tsx";
import { clearPendingScroll, openMemoryItem, refetchMemory, selectMemory, startMemoryStream, useMemorySearch, useMemoryView, type MemorySelection } from "../lib/memory.ts";
import type { MemoryViewResponse } from "../../../src/types/api.ts";

const openSource = (source: { conversationId: string; turnId: string }): void =>
  selectMemory({ kind: "history", conversationId: source.conversationId, turnId: source.turnId });

const EMPTY_FOLDER = 'Nothing here yet. Say "remember that ..." in Chat.';

/** Mirrors MemoryRail (three captioned groups, then the tail) and the list column, so nothing shifts when data arrives. */
function LoadingLayout(): React.JSX.Element {
  const railRow = "h-9 rounded-lg";
  return (
    <>
      <div aria-hidden="true" data-testid="memory-skeleton-rail" className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto rounded-xl bg-surface-sunken p-2 shadow-inset">
        {[3, 3, 2].map((rows, g) => (
          <div key={g} className="flex flex-col gap-0.5 pt-3">
            {Array.from({ length: rows }, (_, i) => (
              <MemorySkeletonRow key={i} className={railRow} />
            ))}
          </div>
        ))}
        <div className="mt-2 flex flex-col gap-0.5">
          {[0, 1].map((i) => (
            <MemorySkeletonRow key={i} className={railRow} />
          ))}
        </div>
      </div>
      <section aria-hidden="true" data-testid="memory-skeleton-list" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-1 pb-4 pt-1">
        {[0, 1, 2].map((i) => (
          <MemorySkeletonRow key={i} />
        ))}
      </section>
    </>
  );
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
  if (!folder) return <StateMessage variant="empty" message={EMPTY_FOLDER} className="p-5" />;
  const patterns = folder.folder === "patterns" ? view.pendingPatterns : [];
  // The Patterns folder always mounts PendingPatterns, so an answered card's reply survives the refetch that empties it.
  if (folder.items.length === 0 && patterns.length === 0 && folder.folder !== "patterns") {
    return <StateMessage variant="empty" message={EMPTY_FOLDER} className="p-5" />;
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
          <StateMessage variant="error" message={MEMORY_LOAD_ERROR} onRetry={() => void refetchMemory()} className="p-5" />
        ) : (
          <LoadingLayout />
        )}
      </div>
      {del.toast}
    </div>
  );
}

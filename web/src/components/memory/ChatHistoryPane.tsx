/**
 * web/src/components/memory/ChatHistoryPane.tsx — Story 13.9 (T10b Part 2).
 * Chat history: the Conversation list (newest first), a read-only transcript,
 * "Delete conversation" behind an Undo Toast (the request is sent when the
 * toast closes; Undo cancels with no request; leaving the pane flushes it),
 * and an inline two-step "Clear all history".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { StateMessage } from "../StateMessage.tsx";
import { MemorySkeletonRow, MEMORY_LOAD_ERROR, MEMORY_WRITE_NOTE_CLASS } from "./MemorySkeletonRow.tsx";
import {
  clearHistory,
  deleteConversation,
  MEMORY_UNDO_WINDOW_MS,
  useChatConversation,
  useChatHistoryList,
} from "../../lib/memory.ts";
import { formatConversationDay } from "../../lib/memoryFormat.ts";
import { ROW_HOVER_RAISED } from "../../lib/controlStyles.ts";
import { UndoToast } from "../UndoToast.tsx";
import { LINK_BUTTON_CLASS, SMALL_BUTTON_CLASS } from "./MemoryItemRow.tsx";
import { TranscriptTurn } from "./TranscriptTurn.tsx";

const CAPTION = "font-body text-small text-ink-secondary";
const LINK_BUTTON = LINK_BUTTON_CLASS;
const ACTION_BUTTON = SMALL_BUTTON_CLASS;

function Skeletons(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <MemorySkeletonRow key={i} />
      ))}
    </div>
  );
}

function Transcript({ conversationId, turnId, onDelete }: { readonly conversationId: string; readonly turnId?: string; onDelete(): void }): React.JSX.Element {
  const { state, refetch } = useChatConversation(conversationId);
  const loaded = state.status === "loaded";

  useEffect(() => {
    if (!loaded || !turnId) return;
    const el = document.getElementById(`turn-${turnId}`);
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }, [loaded, turnId, conversationId]);

  if (state.status === "loading") return <Skeletons />;
  if (state.status === "error") return <StateMessage variant="error" message={MEMORY_LOAD_ERROR} onRetry={() => void refetch()} className="p-5" />;
  return (
    <section aria-label={`Conversation ${formatConversationDay(state.value.date)}`} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 font-body text-body font-medium text-ink-primary">{formatConversationDay(state.value.date)}</h2>
        <button type="button" onClick={onDelete} className={ACTION_BUTTON}>
          Delete conversation
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {state.value.turns.map((t) => (
          <TranscriptTurn key={t.id} turn={t} />
        ))}
      </div>
    </section>
  );
}

export function ChatHistoryPane({
  conversationId,
  turnId,
  onOpen,
  onBack,
}: {
  readonly conversationId?: string;
  readonly turnId?: string;
  onOpen(conversationId: string): void;
  onBack(): void;
}): React.JSX.Element {
  const { state, refetch } = useChatHistoryList();
  /** The conversation hidden from the list until its delete lands (or is undone). */
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  /** The Undo Toast is up only while the delete can still be cancelled. */
  const [toastId, setToastId] = useState<string | undefined>(undefined);
  const pending = useRef<string | undefined>(undefined);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  const commit = useCallback(async (id: string): Promise<void> => {
    if (pending.current === id) pending.current = undefined;
    const outcome = await deleteConversation(id);
    if (outcome.ok) await refetch();
    else setNote(outcome.message);
    setPendingId((cur) => (cur === id ? undefined : cur));
  }, [refetch]);

  // Leaving the pane with a delete still pending sends it (a reload leaves the item: the safe default).
  useEffect(
    () => () => {
      if (pending.current) void deleteConversation(pending.current);
    },
    [],
  );

  const requestDelete = (id: string): void => {
    if (pending.current && pending.current !== id) void commit(pending.current);
    pending.current = id;
    setPendingId(id);
    setToastId(id);
    setNote(undefined);
    onBack();
  };

  const clearAll = async (): Promise<void> => {
    const outcome = await clearHistory();
    if (outcome.ok) await refetch();
    setConfirmingClear(false);
    setNote(outcome.ok ? undefined : outcome.message);
  };

  const toast = toastId ? (
    <UndoToast
      key={toastId}
      id={toastId}
      label="Deleted conversation"
      serverHold={false}
      durationMs={MEMORY_UNDO_WINDOW_MS}
      onUndo={async () => {
        pending.current = undefined;
        setPendingId(undefined);
        setToastId(undefined);
      }}
      onExpire={() => {
        setToastId(undefined);
        void commit(toastId);
      }}
    />
  ) : null;

  if (conversationId && conversationId !== pendingId) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <button type="button" onClick={onBack} className={LINK_BUTTON}>
            All conversations
          </button>
        </div>
        <Transcript conversationId={conversationId} {...(turnId ? { turnId } : {})} onDelete={() => requestDelete(conversationId)} />
        {toast}
      </div>
    );
  }

  if (state.status === "loading") return <Skeletons />;
  if (state.status === "error") return <StateMessage variant="error" message={MEMORY_LOAD_ERROR} onRetry={() => void refetch()} className="p-5" />;
  const conversations = state.value.conversations.filter((c) => c.id !== pendingId);

  return (
    <div className="flex flex-col gap-3">
      {note && (
        <p role="alert" className={MEMORY_WRITE_NOTE_CLASS}>
          {note}
        </p>
      )}
      {conversations.length === 0 ? (
        <StateMessage variant="empty" message="No saved conversations." className="p-5" />
      ) : (
        <>
          <ul aria-label="Conversations" className="m-0 flex flex-col gap-2 p-0">
            {conversations.map((c) => (
              <li key={c.id} className="list-none">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className={`w-full rounded-lg bg-surface-raised px-4 py-4 text-left font-body text-body text-ink-primary shadow-extruded-sm ${ROW_HOVER_RAISED}`}
                >
                  {formatConversationDay(c.date)} · {c.turnCount} {c.turnCount === 1 ? "turn" : "turns"} · {c.firstLine}
                </button>
              </li>
            ))}
          </ul>
          {confirmingClear ? (
            <div role="group" aria-label="Clear all history" className="flex flex-wrap items-center gap-3">
              <span className={`text-body ${CAPTION}`}>Clear all chat history? This can't be undone. Memories stay.</span>
              <button type="button" onClick={() => void clearAll()} className={ACTION_BUTTON}>
                Clear history
              </button>
              <button type="button" onClick={() => setConfirmingClear(false)} className={LINK_BUTTON}>
                Cancel
              </button>
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setConfirmingClear(true)} className={LINK_BUTTON}>
                Clear all history
              </button>
            </div>
          )}
        </>
      )}
      {toast}
    </div>
  );
}

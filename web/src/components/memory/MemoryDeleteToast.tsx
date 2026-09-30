/**
 * web/src/components/memory/MemoryDeleteToast.tsx — Story 13.10 (T11b Part 1).
 * The delete flow for a memory item: the row dissolves at once, an Undo Toast
 * ("Deleted '{text}' · Undo") holds for MEMORY_UNDO_WINDOW_MS, Undo restores
 * the row with no request, and closing the toast sends the delete. One delete
 * pends at a time: a second one commits the first immediately. Leaving the
 * page with one pending sends it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteItem, MEMORY_UNDO_WINDOW_MS } from "../../lib/memory.ts";
import type { MemoryItemView } from "../../../../src/types/api.ts";
import { UndoToast } from "../UndoToast.tsx";

export interface MemoryDelete {
  /** True while the row is dissolved (toast up, or the send in flight). */
  isDissolving(itemId: string): boolean;
  /** The message from a failed send, for the row that re-appears. */
  errorFor(itemId: string): string | undefined;
  request(item: MemoryItemView): void;
  /** Render once, anywhere in the page. */
  readonly toast: React.JSX.Element | null;
}

export function useMemoryDelete(): MemoryDelete {
  const [pending, setPending] = useState<MemoryItemView | undefined>(undefined);
  const [toastOpen, setToastOpen] = useState(false);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const pendingRef = useRef<MemoryItemView | undefined>(undefined);

  const commit = useCallback(async (item: MemoryItemView): Promise<void> => {
    if (pendingRef.current?.id === item.id) pendingRef.current = undefined;
    const outcome = await deleteItem(item.id);
    if (!outcome.ok) setErrors((e) => ({ ...e, [item.id]: outcome.message }));
    setPending((cur) => (cur?.id === item.id ? undefined : cur));
  }, []);

  // Leaving the page with a delete still pending sends it.
  useEffect(
    () => () => {
      if (pendingRef.current) void deleteItem(pendingRef.current.id);
    },
    [],
  );

  const request = (item: MemoryItemView): void => {
    if (pendingRef.current && pendingRef.current.id !== item.id) void commit(pendingRef.current);
    pendingRef.current = item;
    setPending(item);
    setToastOpen(true);
    setErrors((e) => {
      const { [item.id]: _dropped, ...rest } = e;
      return rest;
    });
  };

  const toast = pending && toastOpen ? (
    <UndoToast
      key={pending.id}
      id={pending.id}
      label={`Deleted '${pending.text}'`}
      serverHold={false}
      durationMs={MEMORY_UNDO_WINDOW_MS}
      onUndo={async () => {
        pendingRef.current = undefined;
        setPending(undefined);
        setToastOpen(false);
      }}
      onExpire={() => {
        setToastOpen(false);
        void commit(pending);
      }}
    />
  ) : null;

  return {
    isDissolving: (id) => pending?.id === id,
    errorFor: (id) => errors[id],
    request,
    toast,
  };
}

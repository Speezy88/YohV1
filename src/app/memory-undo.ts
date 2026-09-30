/** `POST /api/memory/undo` (Story 13.4): reverse a Remembered Receipt while no later user turn exists. */
import type { ChatStore } from "../adapters/chat-store.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import type { UndoMemoryRequest, UndoMemoryResponse } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface UndoMemoryDeps {
  readonly memoryItems: MemoryItemStore;
  readonly chatHistory: ChatStore;
}

const conflict = (message: string): Result<never, YohError> => ({ ok: false, error: { kind: "conflict", message } });

export async function undoMemoryReceipt(deps: UndoMemoryDeps, input: UndoMemoryRequest): Promise<Result<UndoMemoryResponse, YohError>> {
  try {
    const receipt = deps.memoryItems.getReceipt(input.receiptId);
    if (!receipt || receipt.undoneAt) return conflict("That can't be undone any more.");
    if (deps.chatHistory.hasUserTurnAfter(receipt.conversationId, receipt.userTurnId)) return conflict("That can't be undone any more.");
    if (receipt.kind === "remembered") {
      for (const id of receipt.itemIds) deps.memoryItems.undoFiling(id);
    } else {
      deps.memoryItems.restore(receipt.chainIds);
    }
    deps.memoryItems.markReceiptUndone(receipt.receiptId);
    return {
      ok: true,
      value: { receiptId: receipt.receiptId, message: receipt.kind === "remembered" ? "Removed from memory." : "Restored to memory." },
    };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  }
}

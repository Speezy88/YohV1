/** `GET /api/chat-history/today` (Story 13.1): today's stored chat turns, in `YOH_TIMEZONE`. */
import type { ChatStore } from "../adapters/chat-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import type { ChatConversationView, ChatHistoryListResponse, ChatHistoryTodayResponse, RememberedReceipt } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface TodaysChatHistoryDeps {
  readonly chatHistory: ChatStore;
  readonly timeZone: string;
  readonly now: () => Date;
}

export async function todaysChatHistory(
  deps: TodaysChatHistoryDeps,
  _input: Record<string, never>,
): Promise<Result<ChatHistoryTodayResponse, YohError>> {
  try {
    const date = localIsoDate(deps.now(), deps.timeZone);
    const turns = deps.chatHistory.turnsForDate(date);
    const conversationId = turns[0]?.conversationId;
    return {
      ok: true,
      value: {
        ...(conversationId ? { conversationId } : {}),
        date,
        turns: turns.map((t) => ({ id: t.id, role: t.role, text: t.text, truncated: t.truncated, createdAt: t.createdAt })),
      },
    };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  }
}

const GONE: YohError = { kind: "conflict", message: "That conversation is already gone." };

function unreachable(error: unknown): { ok: false; error: YohError } {
  return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
}

/** `GET /api/chat-history`: every Conversation, newest first. */
export async function listChatHistory(
  deps: { readonly chatHistory: ChatStore },
  _input: Record<string, never>,
): Promise<Result<ChatHistoryListResponse, YohError>> {
  try {
    return { ok: true, value: { conversations: deps.chatHistory.listConversations() } };
  } catch (error) {
    return unreachable(error);
  }
}

/** `GET /api/chat-history/:conversationId`: one read-only transcript; receipts are re-attached from the receipt rows. */
export async function getChatConversation(
  deps: { readonly chatHistory: ChatStore; readonly memoryItems?: MemoryItemStore },
  input: { readonly conversationId: string },
): Promise<Result<ChatConversationView, YohError>> {
  try {
    const stored = deps.chatHistory.conversationTurns(input.conversationId);
    if (!stored) return { ok: false, error: GONE };
    const date = deps.chatHistory.listConversations().find((c) => c.id === input.conversationId)?.date;
    if (!date) return { ok: false, error: GONE };
    const receiptByUserTurn = new Map<string, RememberedReceipt>();
    for (const r of deps.memoryItems?.receiptsForConversation(input.conversationId) ?? []) {
      if (r.undoneAt !== undefined) continue;
      const items: RememberedReceipt["items"][number][] = [];
      for (const id of r.itemIds) {
        const i = deps.memoryItems!.getItem(id);
        if (!i) continue;
        items.push({
          id: i.id,
          text: i.text,
          folder: i.folder,
          ...(i.scope !== undefined ? { scope: i.scope } : {}),
          ...(i.expiresOn !== undefined ? { expiresOn: i.expiresOn } : {}),
        });
      }
      if (items.length > 0) receiptByUserTurn.set(r.userTurnId, { receiptId: r.receiptId, kind: r.kind, items });
    }
    const turns: ChatConversationView["turns"][number][] = [];
    stored.forEach((t, idx) => {
      const prev = stored[idx - 1];
      const receipt = t.role === "assistant" && prev?.role === "user" ? receiptByUserTurn.get(prev.id) : undefined;
      turns.push({ id: t.id, role: t.role, text: t.text, truncated: t.truncated, createdAt: t.createdAt, ...(receipt ? { receipt } : {}) });
    });
    return { ok: true, value: { id: input.conversationId, date, turns } };
  } catch (error) {
    return unreachable(error);
  }
}

/** `POST /api/chat-history/delete`: removes one Conversation's turns and index rows; memory items are untouched. */
export async function deleteChatConversation(
  deps: { readonly chatHistory: ChatStore },
  input: { readonly conversationId: string },
): Promise<Result<Record<string, never>, YohError>> {
  try {
    return deps.chatHistory.deleteConversation(input.conversationId) ? { ok: true, value: {} } : { ok: false, error: GONE };
  } catch (error) {
    return unreachable(error);
  }
}

/** `POST /api/chat-history/clear`: removes every Conversation; memory items are untouched. */
export async function clearChatHistory(
  deps: { readonly chatHistory: ChatStore },
  _input: Record<string, never>,
): Promise<Result<Record<string, never>, YohError>> {
  try {
    deps.chatHistory.clearAll();
    return { ok: true, value: {} };
  } catch (error) {
    return unreachable(error);
  }
}

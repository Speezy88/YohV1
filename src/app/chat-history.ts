/** `GET /api/chat-history/today` (Story 13.1): today's stored chat turns, in `YOH_TIMEZONE`. */
import type { ChatStore } from "../adapters/chat-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { ChatHistoryTodayResponse } from "../types/api.ts";
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

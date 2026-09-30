/** `GET /api/memory/search?q=` (Story 13.9): one keyword search over memories and chat turns. */
import type { ChatStore } from "../adapters/chat-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { toMemoryItemView } from "../core/memory-item-view.ts";
import { MEMORY_FOLDERS_IN_ORDER } from "../core/memory-folders.ts";
import type { MemorySearchResponse } from "../types/api.ts";
import type { Result, Task, YohError } from "../types/domain.ts";
import { recallMemoryContext } from "./memory-recall.ts";

export interface SearchMemoryDeps {
  readonly memoryItems: MemoryItemStore;
  readonly chatHistory?: ChatStore;
  readonly connection?: SqliteConnection;
  readonly readTasks?: () => Promise<readonly Task[]>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

const SEARCH_LIMIT = 20;
const QUERY_MAX_CHARS = 200;

export async function searchMemory(deps: SearchMemoryDeps, input: { readonly query: string }): Promise<Result<MemorySearchResponse, YohError>> {
  const query = input.query.trim();
  if (query.length < 1 || query.length > QUERY_MAX_CHARS) {
    return { ok: false, error: { kind: "validation", message: "Search for 1 to 200 characters." } };
  }
  try {
    const found = deps.memoryItems.searchRelevant(query, MEMORY_FOLDERS_IN_ORDER, SEARCH_LIMIT);
    const turns = deps.chatHistory?.searchTurns(query, SEARCH_LIMIT) ?? [];
    const recalled = await recallMemoryContext(
      {
        memoryItems: deps.memoryItems,
        ...(deps.readTasks ? { readTasks: deps.readTasks } : {}),
        now: deps.now,
        timeZone: deps.timeZone,
        ...(deps.log ? { log: deps.log } : {}),
      },
      { requestText: "" },
    );
    const states = new Map((recalled.ok && recalled.value ? recalled.value.states : []).map((s) => [s.itemId, s]));
    return { ok: true, value: { query, items: found.map((i) => {
          const turn = i.sourceTurnId !== undefined ? deps.chatHistory?.getTurn(i.sourceTurnId) : undefined;
          return toMemoryItemView(i, {
            state: states.get(i.id),
            ...(turn ? { sourceTurn: { conversationId: turn.conversationId, turnId: turn.id, date: turn.date } } : {}),
            chain: deps.memoryItems.chainOf(i.id),
          });
        }), turns } };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  }
}

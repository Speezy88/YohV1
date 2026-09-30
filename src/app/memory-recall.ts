/**
 * src/app/memory-recall.ts
 *
 * Story 13.6: the one gather step that turns the memory store into a
 * `MemoryContext` for a general answer or a Notion draft. Never blocks a
 * turn: an absent or failing store yields `undefined`, not an error.
 */
import type { LogEntry } from "../adapters/logger.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import { RELEVANT_FOLDERS, RELEVANT_MATCH_LIMIT, selectMemoryContext, type MemoryContext, type MemoryItemState } from "../core/memory-context.ts";
import type { Result, Task, YohError } from "../types/domain.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";

export interface RecallMemoryDeps {
  readonly memoryItems?: MemoryItemStore;
  readonly readTasks?: () => Promise<readonly Task[]>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

export async function recallMemoryContext(
  deps: RecallMemoryDeps,
  input: { readonly requestText: string },
): Promise<Result<{ context: MemoryContext; states: readonly MemoryItemState[] } | undefined, YohError>> {
  const store = deps.memoryItems;
  if (!store) return { ok: true, value: undefined };
  try {
    const current = store.listItems();
    const requestText = input.requestText.trim();
    const relevantMatches = requestText ? store.searchRelevant(requestText, RELEVANT_FOLDERS, RELEVANT_MATCH_LIMIT) : [];

    let tasks: Map<string, { status?: Task["status"] | undefined }> | undefined;
    if (deps.readTasks && current.some((i) => i.entityRef !== undefined)) {
      try {
        tasks = new Map((await deps.readTasks()).map((t) => [t.id, { ...(t.status ? { status: t.status } : {}) }]));
      } catch (error) {
        deps.log?.({ level: "warn", event: "memory-recall.tasks-unavailable", detail: error instanceof Error ? error.message : String(error) });
      }
    }

    const selected = selectMemoryContext({ current, relevantMatches, today: localIsoDate(deps.now(), deps.timeZone), ...(tasks ? { tasks } : {}) });
    if (requestText && selected.context.relevant.length > 0) store.touchMatched(selected.context.relevant.map((m) => m.id));
    return { ok: true, value: selected };
  } catch (error) {
    deps.log?.({ level: "warn", event: "memory-recall.failed", detail: error instanceof Error ? error.message : String(error) });
    return { ok: true, value: undefined };
  }
}

/** `GET /api/memory` (Story 13.9): everything the Memory Rail shows, in one read with no writes. */
import type { ChatStore } from "../adapters/chat-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import { getOpenInteractionRequest, type MemoryStore } from "../adapters/memory-store.ts";
import { listSettingRows } from "../adapters/settings-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { needsReviewLabel } from "../core/memory-context.ts";
import { localIsoDate } from "../core/local-time.ts";
import { toMemoryItemView } from "../core/memory-item-view.ts";
import { MEMORY_FOLDERS_IN_ORDER, memoryFolderLabel, memoryLoadClass } from "../core/memory-folders.ts";
import { buildProposalQuestion } from "../core/open-item-questions.ts";
import { currentRuleValue, defaultPlanningSettings } from "../core/planning-settings.ts";
import { formatRuleValue, ruleLabel } from "../core/rule-change.ts";
import type { ChangedSettingView, MemoryFolderView, MemoryItemView, MemoryViewResponse, NeedsReviewItemView } from "../types/api.ts";
import type { Proposal, Result, Task, YohError } from "../types/domain.ts";
import { recallMemoryContext } from "./memory-recall.ts";

export interface ViewMemoryDeps {
  readonly memoryItems: MemoryItemStore;
  readonly chatHistory?: ChatStore;
  readonly connection: SqliteConnection;
  readonly store?: MemoryStore;
  readonly readTasks?: () => Promise<readonly Task[]>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

export async function viewMemory(deps: ViewMemoryDeps, _input: Record<string, never>): Promise<Result<MemoryViewResponse, YohError>> {
  try {
    // Read first so a failing store is an error, not the recall step's silent "no memory".
    const items = deps.memoryItems.listItems({ status: ["current", "history"] });
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
    if (recalled.ok === false) return recalled;
    if (recalled.value === undefined) return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(new Error("memory unavailable")) } };
    const states = new Map(recalled.value.states.map((s) => [s.itemId, s]));

    const sortFeedback = new Map(deps.memoryItems.listSortFeedback().map((f) => [f.itemId, f]));

    const views = items.map((i) => {
      const turn = i.sourceTurnId !== undefined ? deps.chatHistory?.getTurn(i.sourceTurnId) : undefined;
      return toMemoryItemView(i, {
        state: states.get(i.id),
        ...(turn ? { sourceTurn: { conversationId: turn.conversationId, turnId: turn.id, date: turn.date } } : {}),
        chain: deps.memoryItems.chainOf(i.id),
        timeZone: deps.timeZone,
        sortFeedback: sortFeedback.get(i.id),
      });
    });
    const folders: MemoryFolderView[] = MEMORY_FOLDERS_IN_ORDER.map((folder) => {
      const inFolder = views.filter((v) => v.folder === folder);
      return {
        folder,
        label: memoryFolderLabel(folder),
        loadClass: memoryLoadClass(folder),
        count: inFolder.filter((v) => v.status === "current").length,
        items: inFolder,
      };
    });

    const needsReview: NeedsReviewItemView[] = [];
    for (const folder of folders) {
      for (const view of folder.items) {
        const reason = states.get(view.id)?.reason;
        if (view.status !== "current" || !reason) continue;
        needsReview.push({ ...view, reason: needsReviewLabel(reason), canRenew: reason.kind === "expired" || reason.kind === "unused" });
      }
    }

    const defaults = defaultPlanningSettings();
    const changedSettings: ChangedSettingView[] = listSettingRows(deps.connection.db).map((row) => ({
      key: row.key,
      ...(row.area !== undefined ? { area: row.area } : {}),
      label: ruleLabel(row.key, row.area),
      value: formatRuleValue(row.key, row.value),
      was: formatRuleValue(row.key, currentRuleValue(defaults, row.key, row.area)),
      changedAt: row.updatedAt,
      changedOn: localIsoDate(new Date(row.updatedAt), deps.timeZone),
    }));

    const pendingPatterns = [];
    if (deps.store) {
      for (const state of deps.memoryItems.listPatternStates()) {
        if (!state.pendingProposalId) continue;
        const requestId = `proposal:${state.pendingProposalId}`;
        const record = getOpenInteractionRequest(deps.store, requestId);
        const proposal = (record?.data.detail as { proposal?: Proposal<unknown> } | undefined)?.proposal;
        if (record && proposal) pendingPatterns.push(buildProposalQuestion(requestId, record.data.promptText, proposal));
      }
    }

    return { ok: true, value: { folders, needsReview, changedSettings, pendingPatterns } };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  }
}

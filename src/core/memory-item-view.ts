/** Pure builder for the Memory page's item shape (Story 13.9). The caller gathers the lookups. */
import type { MemoryItemView } from "../types/api.ts";
import type { MemoryItem, MemorySortFeedback } from "../types/domain.ts";
import { localIsoDate } from "./local-time.ts";
import { needsReviewLabel, type MemoryItemState } from "./memory-context.ts";
import { isImportTag } from "./memory-import.ts";

export interface MemoryItemViewLookups {
  readonly state?: MemoryItemState | undefined;
  /** The source turn's Conversation and date; undefined when the turn is gone. */
  readonly sourceTurn?: { readonly conversationId: string; readonly turnId: string; readonly date: string } | undefined;
  /** The item's chain (any order, may include itself and deleted rows). */
  readonly chain: readonly MemoryItem[];
  /** The host time zone: confirmation days are computed here, never sliced from the UTC instant. */
  readonly timeZone: string;
  /** The item's sorting verdict, if any; shown only while the item is still in the folder it judged. */
  readonly sortFeedback?: MemorySortFeedback | undefined;
}

export function toMemoryItemView(item: MemoryItem, lookups: MemoryItemViewLookups): MemoryItemView {
  const { state, sourceTurn, sortFeedback: fb } = lookups;
  const reason = state?.reason ? needsReviewLabel(state.reason) : undefined;
  const source: MemoryItemView["source"] =
    item.sourceTurnId === undefined || isImportTag(item.sourceTurnId) ? undefined : sourceTurn ? { conversationId: sourceTurn.conversationId, turnId: sourceTurn.turnId, date: sourceTurn.date } : "deleted";
  const earlierVersions = lookups.chain
    .filter((v) => v.id !== item.id && v.status !== "deleted")
    .sort((a, b) => (a.confirmedAt < b.confirmedAt ? 1 : a.confirmedAt > b.confirmedAt ? -1 : 0))
    .map((v) => ({ id: v.id, text: v.text, confirmedAt: v.confirmedAt, confirmedOn: localIsoDate(new Date(v.confirmedAt), lookups.timeZone) }));
  return {
    id: item.id,
    folder: item.folder,
    text: item.text,
    origin: item.origin,
    status: item.status === "history" ? "history" : "current",
    ...(item.scope !== undefined ? { scope: item.scope } : {}),
    ...(item.expiresOn !== undefined ? { expiresOn: item.expiresOn } : {}),
    declined: item.ruleChange === "declined",
    pendingChange: item.ruleChange === "pending",
    createdAt: item.createdAt,
    confirmedAt: item.confirmedAt,
    confirmedOn: localIsoDate(new Date(item.confirmedAt), lookups.timeZone),
    loaded: state?.loaded === true,
    ...(reason !== undefined ? { notLoadedReason: reason } : {}),
    ...(source !== undefined ? { source } : {}),
    earlierVersions,
    ...(fb && fb.folder === item.folder
      ? { sortFeedback: { verdict: fb.verdict, reason: fb.reason, ...(fb.belongsIn !== undefined ? { belongsIn: fb.belongsIn } : {}) } }
      : {}),
  };
}

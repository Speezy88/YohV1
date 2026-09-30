/**
 * web/src/lib/patternOffer.ts — Story 13.13 (T14b).
 * The Chat panel's first-open-of-day Pattern card. The server owns "one per
 * day across /morning and the panel" (`lastOfferedOn`), so this never guards
 * by date; it asks, and appends whatever question comes back through the
 * deduping proposal append. Never throws: any failure means no card.
 */
import { apiClient } from "./apiClient.ts";
import { appendProposalQuestion } from "./chatStore.ts";

export async function offerTodaysPattern(): Promise<void> {
  try {
    const res = await apiClient.api.memory["pattern-offer"].$get();
    const result = await res.json();
    if (result.ok && result.value.question) appendProposalQuestion(result.value.question);
  } catch {
    // No card is the honest degrade.
  }
}

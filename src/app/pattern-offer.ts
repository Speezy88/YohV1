/**
 * src/app/pattern-offer.ts
 *
 * Story 13.13 (E8, E9): offers at most ONE pending Pattern proposal per day
 * across `/morning` and the Chat panel's first open. The one-per-day rule is
 * server-side: `lastOfferedOn` on any pattern_state row blocks a second offer.
 * Expired proposals (older than `PATTERN_PROPOSAL_TTL_DAYS`) are withdrawn
 * lazily here and never shown. Never a push or notification.
 */
import { clearInteractionRequest, getOpenInteractionRequest, type MemoryStore } from "../adapters/memory-store.ts";
import type { MemoryItemStore, PatternState } from "../adapters/memory-item-store.ts";
import { buildProposalQuestion } from "../core/open-item-questions.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { isOlderThanDays, PATTERN_PROPOSAL_TTL_DAYS } from "../core/proposal-ttl.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { PatternOfferResponse } from "../types/api.ts";
import type { PatternProposal, Proposal, Result, YohError } from "../types/domain.ts";

export interface PatternOfferDeps {
  readonly memoryItems: MemoryItemStore;
  readonly store: MemoryStore;
  readonly now: () => Date;
  readonly timeZone: string;
}

/** Returns the day's Pattern question, or `{}` when none is pending or one was already offered today. */
export async function offerPattern(deps: PatternOfferDeps, _input: Record<string, never>): Promise<Result<PatternOfferResponse, YohError>> {
  try {
    const now = deps.now();
    const today = localIsoDate(now, deps.timeZone);

    interface Pending {
      readonly state: PatternState;
      readonly requestId: string;
      readonly promptText: string;
      readonly proposal: Proposal<PatternProposal>;
    }
    const pending: Pending[] = [];

    for (const state of deps.memoryItems.listPatternStates()) {
      const id = state.pendingProposalId;
      if (!id) continue;
      const { pendingProposalId: _cleared, ...rest } = state;
      const requestId = `proposal:${id}`;
      const record = getOpenInteractionRequest(deps.store, requestId);
      const proposal = (record?.data.detail as { proposal?: Proposal<PatternProposal> } | undefined)?.proposal;
      if (!record || !proposal) {
        deps.memoryItems.putPatternState(rest);
        continue;
      }
      if (isOlderThanDays(proposal.createdAt, now, PATTERN_PROPOSAL_TTL_DAYS)) {
        deps.memoryItems.putPatternState({ ...rest, declinedAt: now.toISOString() });
        clearInteractionRequest(deps.store, requestId, record.version);
        continue;
      }
      pending.push({ state, requestId, promptText: record.data.promptText, proposal });
    }

    if (deps.memoryItems.listPatternStates().some((s) => s.lastOfferedOn === today)) return { ok: true, value: {} };

    pending.sort((a, b) => Date.parse(a.proposal.createdAt) - Date.parse(b.proposal.createdAt));
    const first = pending[0];
    if (!first) return { ok: true, value: {} };
    deps.memoryItems.putPatternState({ ...first.state, lastOfferedOn: today });
    return { ok: true, value: { question: buildProposalQuestion(first.requestId, first.promptText, first.proposal) } };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  }
}

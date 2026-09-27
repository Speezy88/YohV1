/**
 * src/app/open-proposal.ts
 *
 * Story 8.2 (forward-looking infrastructure for Story 8.4's create-item/
 * calendar-edit resumable flow, AD-3/AD-5). Persists a `Proposal` as an
 * open `requestKind: "proposal"` interaction request, id `proposal:<proposal.id>`,
 * with a fixed single-question cursor (`questionId: "confirm"` — C4). Rejects
 * with `conflict` when an open proposal already targets the same
 * `(kind, entityId)` pair — AD-5 Phase 2's conflict rule: only a genuinely
 * conflicting write is blocked; an unrelated entity's proposal is unaffected.
 * A create-type proposal's `entityId` is its own `id` (controller ruling),
 * so two independent create drafts never collide even into the same
 * database/entity name.
 */
import { listOpenInteractionRequests, putOpenInteractionRequest, type MemoryStore } from "../adapters/memory-store.ts";
import { buildProposalQuestion, PROPOSAL_QUESTION_ID } from "../core/open-item-questions.ts";
import type { OpenItemQuestion } from "../types/api.ts";
import type { Proposal, Result, YohError } from "../types/domain.ts";

export interface OpenProposalDeps {
  readonly store: MemoryStore;
  readonly now?: () => Date;
}

export interface OpenProposalInput {
  readonly proposal: Proposal<unknown>;
}

function findConflictingOpenProposal(store: MemoryStore, kind: string, entityId: string): boolean {
  return listOpenInteractionRequests(store).some((record) => {
    if (record.data.requestKind !== "proposal") return false;
    const stored = (record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined)?.proposal;
    return stored !== undefined && stored.kind === kind && stored.entityId === entityId;
  });
}

export async function openProposal(
  deps: OpenProposalDeps,
  input: OpenProposalInput,
): Promise<Result<OpenItemQuestion, YohError>> {
  const { proposal } = input;

  if (findConflictingOpenProposal(deps.store, proposal.kind, proposal.entityId)) {
    return {
      ok: false,
      error: {
        kind: "conflict",
        message: `open-proposal: an open proposal already targets "${proposal.kind}:${proposal.entityId}"`,
        detail: { kind: proposal.kind, entityId: proposal.entityId },
      },
    };
  }

  const requestId = `proposal:${proposal.id}`;
  const createdAt = (deps.now ?? (() => new Date()))().toISOString();
  putOpenInteractionRequest(deps.store, requestId, {
    requestKind: "proposal",
    promptText: proposal.reason,
    detail: { proposal, cursor: { questionId: PROPOSAL_QUESTION_ID } },
    createdAt,
  });

  // `core/open-item-questions.ts`'s `buildProposalQuestion` is the ONE place
  // that assembles a proposal's confirm-question shape (Controller Ruling
  // 1) — `app/surface-open-items.ts`'s `buildForRecord` builds the exact
  // same shape from this same stored record on every later surface/re-ask,
  // so this initial return can never drift from what a later read shows.
  return { ok: true, value: buildProposalQuestion(requestId, proposal.reason, proposal) };
}

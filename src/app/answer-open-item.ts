/**
 * src/app/answer-open-item.ts
 *
 * Story 8.1 (C3). The ONE entry shells call. Story 8.2 adds the
 * `"proposal"` case (`answerProposalOpenItem`) — every request kind now
 * flows through this same dispatch; `chat-cli.ts` no longer special-cases
 * `"proposal"` with its own `answerProposalRequest`. Any kind this file
 * still doesn't recognize keeps the pre-Epic-8 generic behavior.
 */
import { clearInteractionRequest, getOpenInteractionRequest, type InteractionRequest, type MemoryStore, type StoredRecord } from "../adapters/memory-store.ts";
import { errorCopy, serviceForProposalKind } from "../core/error-copy.ts";
import { parseProposalAnswer } from "../core/open-item-answers.ts";
import { PROPOSAL_QUESTION_ID } from "../core/open-item-questions.ts";
import { answerDataCompleteness, type AnswerDataCompletenessDeps } from "./answer-data-completeness.ts";
import { answerNightCloseOut, type AnswerNightCloseOutDeps } from "./answer-night-close-out.ts";
import { answerSelfCheck, type AnswerSelfCheckDeps } from "./answer-self-check.ts";
import { confirmProposal } from "./confirm-proposal.ts";
import { buildOpenItemQuestion } from "./surface-open-items.ts";
import type { CalendarEditChange, NotionDatabaseTarget, Proposal, Result, YohError } from "../types/domain.ts";
import type { AnswerOpenItemRequest, AnswerOpenItemResponse } from "../types/api.ts";

export interface AnswerOpenItemDeps extends AnswerDataCompletenessDeps, AnswerNightCloseOutDeps, AnswerSelfCheckDeps {
  readonly store: MemoryStore;
  /** `notion-adapter.ts`'s `createPage`, pre-bound — needed only if an open `"proposal"` item is a `"notion-page-draft"` kind (Story 8.4's first real user of this path). Widens this deps object so it also structurally satisfies `confirm-proposal.ts`'s `ConfirmProposalDeps`. */
  readonly createPage?: (
    database: NotionDatabaseTarget,
    properties: Readonly<Record<string, string>>,
  ) => Promise<Result<{ readonly pageId: string; readonly url?: string }, YohError>>;
  /** `calendar-adapter.ts`'s `applyCalendarEdit`, pre-bound — needed only if an open `"proposal"` item is a `"calendar-edit"` kind. */
  readonly applyCalendarEdit?: (
    proposal: Proposal<CalendarEditChange>,
  ) => Promise<Result<{ readonly eventId: string; readonly calendarId: string }, YohError>>;
}

/**
 * Answers the single `"confirm"` question of an open `requestKind: "proposal"`
 * item (Story 8.2). Unlike the other three request kinds, a proposal has
 * exactly one question — its own re-prompt IS the same question, never a
 * different one — so an unrecognized answer re-fetches the SAME
 * `OpenItemQuestion` via `buildOpenItemQuestion` (Story 8.1) rather than
 * hand-constructing one here, keeping that file the one place that builds
 * an `OpenItemQuestion`'s shape. The server-stored proposal (`record.data
 * .detail.proposal`) is authoritative here — never a client-echoed one
 * (FR-25's own echo mechanism is a separate, narrower case in
 * `answer-data-completeness.ts`).
 *
 * **Controller fix:** `input.questionId` is checked against the request's
 * one fixed pending question (`core/open-item-questions.ts`'s
 * `PROPOSAL_QUESTION_ID`, `"confirm"`) before anything else — the same
 * "an answer naming a question that isn't the current pending one is a
 * conflict, and writes nothing" rule every other `answer-*.ts` file already
 * enforces for its own (moving) cursor (C4). A proposal's cursor never
 * moves, but the check still matters: it's what stops a stale/replayed
 * answer built against a DIFFERENT already-resolved question (or a
 * completely unrelated one) from ever reaching `confirmProposal`.
 */
async function answerProposalOpenItem(
  deps: AnswerOpenItemDeps,
  input: AnswerOpenItemRequest,
  record: StoredRecord<InteractionRequest>,
): Promise<Result<AnswerOpenItemResponse, YohError>> {
  if (input.questionId !== PROPOSAL_QUESTION_ID) {
    return { ok: false, error: { kind: "conflict", message: "answer-open-item: that question is no longer pending" } };
  }

  const detail = record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined;
  const proposal = detail?.proposal;

  if (!proposal) {
    clearInteractionRequest(deps.store, record.id, record.version);
    return { ok: true, value: { message: "I don't recognize this proposal any more — dismissing it.", receipts: [], next: "done" } };
  }

  const parsed = parseProposalAnswer(input.answer);
  if (parsed === undefined) {
    const next = await buildOpenItemQuestion(deps, { requestId: record.id });
    if (!next.ok) return next;
    return { ok: true, value: { message: 'Please answer "yes" or "no".', receipts: [], next: next.value } };
  }

  const result = await confirmProposal(deps, { proposal, accept: parsed, requestId: record.id });
  if (!result.ok) {
    const service = serviceForProposalKind(proposal.kind);
    return {
      ok: true,
      value: { message: errorCopy(result.error, service !== undefined ? { service } : {}), receipts: [], next: "done" },
    };
  }

  return {
    ok: true,
    value: {
      ...(result.value.applied ? {} : { message: "Okay — I won't make that change." }),
      receipts: result.value.receipts,
      next: "done",
    },
  };
}

async function answerGeneric(store: MemoryStore, requestId: string): Promise<Result<AnswerOpenItemResponse, YohError>> {
  const record = getOpenInteractionRequest(store, requestId);
  if (!record) return { ok: false, error: { kind: "conflict", message: "answer-open-item: no open interaction request" } };
  clearInteractionRequest(store, requestId, record.version);
  return { ok: true, value: { message: "Got it — thanks.", receipts: [], next: "done" } };
}

export async function answerOpenItem(deps: AnswerOpenItemDeps, input: AnswerOpenItemRequest): Promise<Result<AnswerOpenItemResponse, YohError>> {
  const record = getOpenInteractionRequest(deps.store, input.requestId);
  if (!record) return { ok: false, error: { kind: "conflict", message: `answer-open-item: no open interaction request ${input.requestId}` } };
  switch (record.data.requestKind) {
    case "data-completeness":
      return answerDataCompleteness(deps, input);
    case "night-close-out":
      return answerNightCloseOut(deps, input);
    case "self-check":
      return answerSelfCheck(deps, input);
    case "proposal":
      return answerProposalOpenItem(deps, input, record);
    default:
      return answerGeneric(deps.store, input.requestId);
  }
}

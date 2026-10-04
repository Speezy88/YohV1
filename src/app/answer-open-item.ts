/**
 * src/app/answer-open-item.ts
 *
 * Story 8.1 (C3). The ONE entry shells call. Story 8.2 adds the
 * `"proposal"` case (`answerProposalOpenItem`) — every request kind now
 * flows through this same dispatch; `chat-cli.ts` no longer special-cases
 * `"proposal"` with its own `answerProposalRequest`. Any kind this file
 * still doesn't recognize keeps the pre-Epic-8 generic behavior.
 */
import { clearInteractionRequest, getOpenInteractionRequest, withdrawRuleProposal, type InteractionRequest, type MemoryStore, type StoredRecord } from "../adapters/memory-store.ts";
import type { ChatStore } from "../adapters/chat-store.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import { NIGHT_CLOSE_OUT_REQUEST_ID } from "../rituals/night-ritual.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import { errorCopy, serviceForProposalKind } from "../core/error-copy.ts";
import { parseProposalAnswer } from "../core/open-item-answers.ts";
import { MEMORY_FORGET_NONE, MEMORY_FORGET_QUESTION_ID, NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID, PROPOSAL_QUESTION_ID } from "../core/open-item-questions.ts";
import { answerDataCompleteness, type AnswerDataCompletenessDeps } from "./answer-data-completeness.ts";
import { answerNightCloseOut, type AnswerNightCloseOutDeps } from "./answer-night-close-out.ts";
import { confirmProposal, type ConfirmProposalDeps } from "./confirm-proposal.ts";
import { buildOpenItemQuestion } from "./surface-open-items.ts";
import type { CalendarEditChange, NotionDatabaseTarget, Proposal, Result, YohError } from "../types/domain.ts";
import type { AnswerOpenItemRequest, AnswerOpenItemResponse } from "../types/api.ts";

export interface AnswerOpenItemDeps extends AnswerDataCompletenessDeps, AnswerNightCloseOutDeps {
  readonly store: MemoryStore;
  /** E5: when set with `timeZone`, the answer and Yoh's reply are stored as today's chat turns. Store failures are logged, never surfaced. */
  readonly chatHistory?: ChatStore;
  readonly timeZone?: string;
  /** Story 13.4: needed only to answer an open `"memory-forget"` request. */
  readonly memoryItems?: MemoryItemStore;
  readonly log?: (entry: LogEntry) => void;
  /** Needed only to approve an open `"reshuffle"` proposal: everything `approveReshuffle` needs besides `store`. */
  readonly reshuffle?: NonNullable<ConfirmProposalDeps["reshuffle"]>;
  /** Needed only to approve an open `"change-set"` proposal: the pre-bound write paths `applyChangeSet` calls. */
  readonly changeSet?: NonNullable<ConfirmProposalDeps["changeSet"]>;
  /** Needed only to answer Yes to an open `"research-offer"` proposal: what `queueResearch` needs. */
  readonly research?: NonNullable<ConfirmProposalDeps["research"]>;
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
    const copy = errorCopy(result.error, service !== undefined ? { service } : {});
    // These two kinds claim the request before their one write, so a failure closes the card: say how to retry.
    const askAgain = proposal.kind === "notion-page-draft" || proposal.kind === "calendar-edit" ? " Ask again if you still want it." : "";
    return { ok: true, value: { message: `${copy}${askAgain}`, receipts: [], next: "done" } };
  }

  return {
    ok: true,
    value: {
      ...(result.value.message
        ? { message: result.value.message }
        : result.value.applied || result.value.question
          ? {}
          : { message: "Okay — I won't make that change." }),
      receipts: result.value.receipts,
      ...(result.value.receipt ? { receipt: result.value.receipt } : {}),
      next: result.value.question ?? "done",
    },
  };
}

async function answerGeneric(store: MemoryStore, requestId: string): Promise<Result<AnswerOpenItemResponse, YohError>> {
  const record = getOpenInteractionRequest(store, requestId);
  if (!record) return { ok: false, error: { kind: "conflict", message: "answer-open-item: no open interaction request" } };
  clearInteractionRequest(store, requestId, record.version);
  return { ok: true, value: { message: "Got it — thanks.", receipts: [], next: "done" } };
}

async function answerMemoryForget(deps: AnswerOpenItemDeps, input: AnswerOpenItemRequest, record: StoredRecord<InteractionRequest>): Promise<Result<AnswerOpenItemResponse, YohError>> {
  if (input.questionId !== MEMORY_FORGET_QUESTION_ID) return { ok: false, error: { kind: "conflict", message: "answer-open-item: not the pending question" } };
  const answer = input.answer.trim();
  const itemIds = (record.data.detail as { readonly itemIds?: readonly string[] } | undefined)?.itemIds ?? [];
  if (answer !== MEMORY_FORGET_NONE && !itemIds.includes(answer)) return { ok: false, error: { kind: "validation", message: "answer-open-item: not one of the offered items" } };
  let message = "Okay, nothing removed.";
  if (answer !== MEMORY_FORGET_NONE) {
    const store = deps.memoryItems;
    if (!store) return { ok: false, error: { kind: "unreachable", message: "Couldn't reach memory right now." } };
    try {
      const item = store.getItem(answer);
      if (item && item.status === "current") {
        for (const id of store.forget(answer).chainIds) withdrawRuleProposal(deps.store, id);
        message = `Forgot: ${item.text}.`;
      } else {
        message = "That item is already gone.";
      }
    } catch (error) {
      deps.log?.({ level: "warn", event: "answer-open-item.memory-forget-failed", detail: error instanceof Error ? error.message : String(error) });
      return { ok: false, error: { kind: "unreachable", message: "Couldn't reach memory right now." } };
    }
  }
  clearInteractionRequest(deps.store, input.requestId, record.version);
  return { ok: true, value: { message, receipts: [], next: "done" } };
}

async function dispatchAnswer(deps: AnswerOpenItemDeps, input: AnswerOpenItemRequest): Promise<Result<AnswerOpenItemResponse, YohError>> {
  // The close-out's "anything else?" step is answered after its request was already cleared.
  if (input.requestId === NIGHT_CLOSE_OUT_REQUEST_ID && input.questionId === NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID) return answerNightCloseOut(deps, input);
  const record = getOpenInteractionRequest(deps.store, input.requestId);
  if (!record) return { ok: false, error: { kind: "conflict", message: `answer-open-item: no open interaction request ${input.requestId}` } };
  switch (record.data.requestKind) {
    case "data-completeness":
      return answerDataCompleteness(deps, input);
    case "night-close-out":
      return answerNightCloseOut(deps, input);
    case "proposal":
      return answerProposalOpenItem(deps, input, record);
    case "memory-forget":
      return answerMemoryForget(deps, input, record);
    default:
      return answerGeneric(deps.store, input.requestId);
  }
}

export async function answerOpenItem(deps: AnswerOpenItemDeps, input: AnswerOpenItemRequest): Promise<Result<AnswerOpenItemResponse, YohError>> {
  const result = await dispatchAnswer(deps, input);
  const store = deps.chatHistory;
  if (!result.ok || !store || !deps.timeZone) return result;
  try {
    const at = (deps.now ?? (() => new Date()))();
    const date = localIsoDate(at, deps.timeZone);
    const { message, next } = result.value;
    const reply = [message, next !== "done" ? next.text : undefined].filter((t): t is string => !!t && t.trim() !== "").join("\n\n");
    store.appendTurn({ date, role: "user", text: input.answer.trim(), at: at.toISOString() });
    if (reply !== "") store.appendTurn({ date, role: "assistant", text: reply, at: at.toISOString() });
  } catch (error) {
    deps.log?.({ level: "warn", event: "answer-open-item.history-write-failed", detail: error instanceof Error ? error.message : String(error) });
  }
  return result;
}

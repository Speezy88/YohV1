/**
 * src/app/answer-open-item.ts
 *
 * Story 8.1 (C3). The ONE entry shells call. Unknown kinds (including
 * `"proposal"` until Task 3 adds its branch) keep chat-cli's pre-Epic-8
 * generic behavior. `chat-cli.ts` never routes a `"proposal"` request
 * through here (Task 10) — it stays on its own `answerProposalRequest` path.
 */
import { clearInteractionRequest, getOpenInteractionRequest, type MemoryStore } from "../adapters/memory-store.ts";
import { answerDataCompleteness, type AnswerDataCompletenessDeps } from "./answer-data-completeness.ts";
import { answerNightCloseOut, type AnswerNightCloseOutDeps } from "./answer-night-close-out.ts";
import { answerSelfCheck, type AnswerSelfCheckDeps } from "./answer-self-check.ts";
import type { Result, YohError } from "../types/domain.ts";
import type { AnswerOpenItemRequest, AnswerOpenItemResponse } from "../types/api.ts";

export interface AnswerOpenItemDeps extends AnswerDataCompletenessDeps, AnswerNightCloseOutDeps, AnswerSelfCheckDeps {
  readonly store: MemoryStore;
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
    default:
      return answerGeneric(deps.store, input.requestId);
  }
}

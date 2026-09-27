/**
 * src/app/answer-self-check.ts
 *
 * Story 8.1. Self-Check is always exactly one question — no cursor.
 */
import { clearInteractionRequest, getOpenInteractionRequest } from "../adapters/memory-store.ts";
import { errorCopy } from "../core/error-copy.ts";
import { applySelfCheckAnswer, SELF_CHECK_REQUEST_ID } from "../rituals/self-check.ts";
import { parseSelfCheckAnswer } from "../core/open-item-answers.ts";
import { buildOpenItemQuestion, type SurfaceOpenItemsDeps } from "./surface-open-items.ts";
import type { IsoDate, Result, YohError } from "../types/domain.ts";
import type { AnswerOpenItemRequest, AnswerOpenItemResponse } from "../types/api.ts";

export interface AnswerSelfCheckDeps extends SurfaceOpenItemsDeps {
  readonly today: IsoDate;
  readonly random: () => number;
}

export async function answerSelfCheck(deps: AnswerSelfCheckDeps, input: AnswerOpenItemRequest): Promise<Result<AnswerOpenItemResponse, YohError>> {
  const record = getOpenInteractionRequest(deps.store, SELF_CHECK_REQUEST_ID);
  if (!record) return { ok: false, error: { kind: "conflict", message: "answer-self-check: no open Self-Check request" } };
  if (input.questionId !== "score") return { ok: false, error: { kind: "conflict", message: "answer-self-check: unexpected questionId" } };

  const parsed = parseSelfCheckAnswer(input.answer);
  if (!parsed) {
    const next = await buildOpenItemQuestion(deps, { requestId: record.id });
    return {
      ok: true,
      value: { message: "Just send a number from 1 to 10, plus an optional reason.", receipts: [], next: next.ok && next.value !== "done" ? next.value : "done" },
    };
  }
  const applied = applySelfCheckAnswer(deps.store, { today: deps.today, score: parsed.score, reason: parsed.reason, random: deps.random });
  if (!applied.ok) {
    const next = await buildOpenItemQuestion(deps, { requestId: record.id });
    return {
      ok: true,
      value: {
        message: `${errorCopy(applied.error)} Try again.`,
        receipts: [],
        next: next.ok && next.value !== "done" ? next.value : "done",
      },
    };
  }
  clearInteractionRequest(deps.store, SELF_CHECK_REQUEST_ID, record.version);
  // M2 (final-review): echo the parsed score so a misread (e.g. a nearby
  // number the parser picked over Spencer's actual score) is visible
  // instead of hidden behind a generic "got it" — the score already drives
  // `scheduleNextSelfCheck` by this point, so this is a receipt, not a
  // chance to change it.
  return { ok: true, value: { message: `Logged ${parsed.score}/10. I'll check in again before too long.`, receipts: [], next: "done" } };
}

/**
 * src/app/answer-night-close-out.ts
 *
 * Story 8.1. Answers exactly ONE close-out Task per call (AD-16). Persists
 * the resolved/skipped cursor BEFORE delegating to `buildOpenItemQuestion`
 * for `next`, so the recompute always reflects this turn's own answer.
 * The last Task's answer is followed by one "anything else?" question.
 */
import { clearNightCloseOutDone, getOpenInteractionRequest, updateInteractionRequestDetail, type MemoryStore } from "../adapters/memory-store.ts";
import {
  applyNightCloseOutConfirmation,
  clearNightCloseOutRequestIfOpen,
  NIGHT_CLOSE_OUT_REQUEST_ID,
  recordNightCloseOutDone,
  recordNightCloseOutHandledWithoutPrompt,
  type NightCloseOutRequestDetail,
} from "../rituals/night-ritual.ts";
import { writeStructuredLog } from "../adapters/logger.ts";
import { isSkipAnswer, parseNightCloseOutAnswer } from "../core/open-item-answers.ts";
import { errorCopy } from "../core/error-copy.ts";
import {
  buildNightCloseOutAnythingElseQuestion,
  nextNightCloseOutTask,
  NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID,
  type NightCloseOutCursor,
} from "../core/open-item-questions.ts";
import { buildOpenItemQuestion, type SurfaceOpenItemsDeps } from "./surface-open-items.ts";
import type { ExternalId, IsoDate, Result, Task, TaskStatus, YohError } from "../types/domain.ts";
import type { RecordCompletionInput } from "../adapters/completion-log.ts";
import type { AnswerOpenItemRequest, AnswerOpenItemResponse } from "../types/api.ts";

export interface AnswerNightCloseOutDeps extends SurfaceOpenItemsDeps {
  readonly setTaskStatus: (taskId: ExternalId, status: TaskStatus) => Promise<Result<void, YohError>>;
  readonly recordCompletion: (input: RecordCompletionInput) => void;
  readonly lookupTask: (taskId: ExternalId) => Promise<Task | undefined>;
}

function readCursor(detail: (NightCloseOutRequestDetail & { readonly cursor?: NightCloseOutCursor }) | undefined) {
  return { resolvedTaskIds: new Set(detail?.cursor?.resolvedTaskIds ?? []), skippedTaskIds: new Set(detail?.cursor?.skippedTaskIds ?? []) };
}

/** Stands in for a close-out request that carries no date; never recorded as a finished night. */
const UNKNOWN_CLOSE_OUT_DATE: IsoDate = "1970-01-01";

async function withNext(
  deps: AnswerNightCloseOutDeps,
  requestId: string,
  closeOutDate: IsoDate,
  tasks: NightCloseOutRequestDetail["tasks"],
  resolvedTaskIds: ReadonlySet<string>,
  skippedTaskIds: ReadonlySet<string>,
  message: string | undefined,
  receipts: readonly string[],
): Promise<Result<AnswerOpenItemResponse, YohError>> {
  const current = getOpenInteractionRequest(deps.store, requestId);
  if (current) {
    try {
      updateInteractionRequestDetail<NightCloseOutRequestDetail & { cursor: NightCloseOutCursor }>(deps.store, requestId, current.version, () => ({
        date: closeOutDate,
        tasks,
        cursor: { resolvedTaskIds: [...resolvedTaskIds], skippedTaskIds: [...skippedTaskIds] },
      }));
    } catch {
      return { ok: false, error: { kind: "conflict", message: "answer-night-close-out: the request changed concurrently" } };
    }
  }
  const next = await buildOpenItemQuestion(deps, { requestId });
  if (!next.ok) return next;
  if (next.value === "done") {
    clearNightCloseOutRequestIfOpen(deps.store, { resolveUncheckedDay: skippedTaskIds.size === 0 });
    // Story 8.7 (AD-5 Phase 2): the close-out is now fully answered — record
    // it in the SAME memory-store.ts record night-escalate already reads,
    // keyed to the NIGHT this close-out was about (closeOutDate), not
    // necessarily the day it happened to be answered on. Written
    // unconditionally (skip or not — a deliberate, documented trade-off: a
    // skip already unblocks the chat session today, and this doesn't change
    // that), so night-prompt will not re-ask tonight even for a skipped Task.
    recordNightCloseOutHandledWithoutPrompt(deps.store, closeOutDate, new Date().toISOString());
    // Ruling E12-R1: a close-out finished with nothing skipped is a "done" night. A failed write never fails the close-out.
    // Not when the request vanished mid-answer (its other Tasks may be unanswered) or carried no date.
    if (skippedTaskIds.size === 0 && current !== undefined && closeOutDate !== UNKNOWN_CLOSE_OUT_DATE) {
      recordNightCloseOutDone(deps.store, closeOutDate, new Date().toISOString(), "answered", writeStructuredLog);
    } else if (skippedTaskIds.size > 0 && closeOutDate !== UNKNOWN_CLOSE_OUT_DATE) {
      // Ruling E12-R11: an earlier `/night` may have recorded this date as done; a skip now means it was not. A failed removal never fails the close-out.
      try {
        clearNightCloseOutDone(deps.store, closeOutDate);
      } catch (err) {
        writeStructuredLog({ level: "warn", event: "night-close-out.done-clear-failed", detail: { date: closeOutDate, error: err instanceof Error ? err.message : String(err) } });
      }
    }
    const skippedTitles = tasks.filter((t) => skippedTaskIds.has(t.taskId)).map((t) => t.taskTitle);
    const closing =
      skippedTitles.length === 0
        ? "Got it — thanks. I've updated Notion and factored this into tomorrow's plan."
        : `Got it — thanks. I've updated Notion for the rest; skipped for now: ${skippedTitles.join(", ")}.`;
    // The Tasks are settled and the request is cleared above; the one thing
    // left is the "anything else?" step, which is deliberately NOT a stored
    // request (leaving it unanswered must never look like an unanswered
    // close-out to night-escalate).
    return { ok: true, value: { message: message ?? closing, receipts, next: buildNightCloseOutAnythingElseQuestion(requestId) } };
  }
  return { ok: true, value: { ...(message !== undefined ? { message } : {}), receipts, next: next.value } };
}

export async function answerNightCloseOut(deps: AnswerNightCloseOutDeps, input: AnswerOpenItemRequest): Promise<Result<AnswerOpenItemResponse, YohError>> {
  // The final "anything else?" step is stateless — it is answered after the
  // request was cleared (or beside a newer night's request, from an old card),
  // so it is handled before, and never touches, the stored request.
  if (input.questionId === NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID) {
    return { ok: true, value: { message: "Closed out for tonight.", receipts: [], next: "done" } };
  }
  const record = getOpenInteractionRequest(deps.store, NIGHT_CLOSE_OUT_REQUEST_ID);
  if (!record) return { ok: false, error: { kind: "conflict", message: "answer-night-close-out: no open close-out request" } };
  const detail = record.data.detail as (NightCloseOutRequestDetail & { readonly cursor?: NightCloseOutCursor }) | undefined;
  const tasks = detail?.tasks ?? [];
  const closeOutDate: IsoDate = detail?.date ?? UNKNOWN_CLOSE_OUT_DATE;
  const { resolvedTaskIds, skippedTaskIds } = readCursor(detail);
  const pending = nextNightCloseOutTask({ tasks, resolvedTaskIds, skippedTaskIds });
  if (!pending || pending.taskId !== input.questionId) {
    return { ok: false, error: { kind: "conflict", message: "answer-night-close-out: that Task is no longer the pending one" } };
  }

  if (isSkipAnswer(input.answer)) {
    return withNext(
      deps,
      record.id,
      closeOutDate,
      tasks,
      resolvedTaskIds,
      new Set([...skippedTaskIds, pending.taskId]),
      `Skipping "${pending.taskTitle}" for now — nothing was recorded for it tonight.`,
      [],
    );
  }
  const parsed = parseNightCloseOutAnswer(input.answer);
  if (!parsed) {
    return withNext(deps, record.id, closeOutDate, tasks, resolvedTaskIds, skippedTaskIds, `I didn't understand "${input.answer}" — try "completed", "slipped", or "skip" to leave it for now.`, []);
  }
  const applied = await applyNightCloseOutConfirmation(
    { store: deps.store, setTaskStatus: deps.setTaskStatus, recordCompletion: deps.recordCompletion, lookupTask: deps.lookupTask },
    pending.taskId,
    pending.taskTitle,
    parsed,
    closeOutDate,
    new Date().toISOString(),
  );
  if (!applied.ok) {
    return withNext(
      deps,
      record.id,
      closeOutDate,
      tasks,
      resolvedTaskIds,
      skippedTaskIds,
      `${errorCopy(applied.error, { service: "Notion" })} Try again, or type "skip" to leave it for now and move on.`,
      [],
    );
  }
  return withNext(deps, record.id, closeOutDate, tasks, new Set([...resolvedTaskIds, pending.taskId]), skippedTaskIds, undefined, [`Recorded "${pending.taskTitle}" as ${parsed}.`]);
}

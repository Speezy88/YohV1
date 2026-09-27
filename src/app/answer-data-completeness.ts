/**
 * src/app/answer-data-completeness.ts
 *
 * Story 8.1. Answers exactly ONE data-completeness question per call
 * (AD-16). Mutates state (or not, on failure) then delegates to
 * `buildOpenItemQuestion` for `next` — nothing here re-derives "what's
 * pending" independently, so a re-ask always reflects the true current
 * state (Controller Ruling 1).
 */
import { clearInteractionRequest, getOpenInteractionRequest, getTaskFieldOverride, mergeTaskFieldOverride, updateInteractionRequestDetail, type MemoryStore } from "../adapters/memory-store.ts";
import { parsePlanningFieldValue, PLANNING_FIELD_LABELS } from "../core/planning-field-value.ts";
import { parseProposalAnswer } from "../core/open-item-answers.ts";
import { buildDataCompletenessQuestion, declinedSuggestionKey, nextDataCompletenessQuestion, type DataCompletenessCursor } from "../core/open-item-questions.ts";
import type { MissingFieldReport } from "../core/data-completeness-gate.ts";
import { DATA_COMPLETENESS_REQUEST_ID } from "../rituals/data-completeness.ts";
import { confirmProposal } from "./confirm-proposal.ts";
import { buildOpenItemQuestion, type SurfaceOpenItemsDeps } from "./surface-open-items.ts";
import type { ExternalId, FieldValueSuggestion, PlanningFieldNames, Result, Task, TaskFieldOverride, YohError } from "../types/domain.ts";
import type { AnswerOpenItemRequest, AnswerOpenItemResponse } from "../types/api.ts";

export interface AnswerDataCompletenessDeps extends SurfaceOpenItemsDeps {
  readonly updateTaskField: (taskId: ExternalId, field: PlanningFieldNames, value: NonNullable<Task[PlanningFieldNames]>) => Promise<Result<void, YohError>>;
}

function overridesFor(store: MemoryStore, incomplete: readonly MissingFieldReport[]): Map<string, TaskFieldOverride> {
  const map = new Map<string, TaskFieldOverride>();
  for (const report of incomplete) {
    const stored = getTaskFieldOverride(store, report.taskId);
    if (stored) map.set(report.taskId, stored.data);
  }
  return map;
}

/** Builds `next` from the CURRENT stored state (never re-derived independently) and, once every field is answered, clears the request and reports the closing receipt. */
async function withNext(
  deps: AnswerDataCompletenessDeps,
  requestId: string,
  message: string | undefined,
  receipts: readonly string[],
): Promise<Result<AnswerOpenItemResponse, YohError>> {
  const next = await buildOpenItemQuestion(deps, { requestId });
  if (!next.ok) return next;
  if (next.value === "done") {
    const current = getOpenInteractionRequest(deps.store, requestId);
    if (current) clearInteractionRequest(deps.store, requestId, current.version);
    return { ok: true, value: { message: message ?? "Got it — thanks. I'll factor that in next time I plan.", receipts, next: "done" } };
  }
  return { ok: true, value: { ...(message !== undefined ? { message } : {}), receipts, next: next.value } };
}

export async function answerDataCompleteness(deps: AnswerDataCompletenessDeps, input: AnswerOpenItemRequest): Promise<Result<AnswerOpenItemResponse, YohError>> {
  const record = getOpenInteractionRequest(deps.store, DATA_COMPLETENESS_REQUEST_ID);
  if (!record) return { ok: false, error: { kind: "conflict", message: "answer-data-completeness: no open data-completeness request" } };

  const detail = record.data.detail as { readonly incomplete?: readonly MissingFieldReport[]; readonly cursor?: DataCompletenessCursor } | undefined;
  const incomplete = detail?.incomplete ?? [];
  const overridesByTaskId = overridesFor(deps.store, incomplete);
  const declinedSuggestions = new Set(detail?.cursor?.declinedSuggestions ?? []);
  const pending = nextDataCompletenessQuestion({ incomplete, overridesByTaskId, declinedSuggestions });
  if (!pending) {
    return { ok: false, error: { kind: "conflict", message: "answer-data-completeness: that question is no longer pending" } };
  }
  // Review fix: an EXACT match against the current pending question's id —
  // built the same way `core/open-item-questions.ts` builds it for display —
  // not a mere `startsWith`. Without this, a stale/replayed answer to an
  // already-DECLINED `:suggest` question (e.g. a second surface racing a
  // decline that already landed) would still match on the shared
  // `taskId:field` prefix and write the field — exactly the conflict rule
  // (C4) this is supposed to prevent.
  const blindQuestionId = buildDataCompletenessQuestion(record.id, pending).questionId;
  const isCurrentQuestion =
    input.questionId === blindQuestionId || (!pending.suggestionDeclined && input.questionId === `${blindQuestionId}:suggest`);
  if (!isCurrentQuestion) {
    return { ok: false, error: { kind: "conflict", message: "answer-data-completeness: that question is no longer pending" } };
  }
  const label = PLANNING_FIELD_LABELS[pending.field];

  if (input.questionId.endsWith(":suggest")) {
    const answeredYes = parseProposalAnswer(input.answer) === true;
    if (answeredYes) {
      // Final-review fix (Important #1): the echoed `proposal`'s claimed
      // identity is untyped JSON from the network — it must name the SAME
      // (taskId, field) this suggest question is actually pending on, or a
      // client could steer the write at an arbitrary Task's arbitrary
      // planning field while still answering the correct `questionId`.
      // `confirmProposal`'s own `"field-value"` branch re-validates the
      // suggested VALUE (defense in depth) but never cross-checks identity —
      // that check belongs here, the one place that actually knows what's
      // pending.
      const suggested = input.proposal?.kind === "field-value" ? (input.proposal.suggested as FieldValueSuggestion) : undefined;
      const matchesPending = suggested !== undefined && suggested.taskId === pending.taskId && suggested.field === pending.field;
      if (!matchesPending) {
        return {
          ok: false,
          error: {
            kind: "conflict",
            message: "answer-data-completeness: the echoed proposal doesn't match the pending question",
          },
        };
      }
      // Story 8.2: the write itself now goes through `confirmProposal` — the
      // ONE confirm path every Proposal kind resolves through, whichever
      // surface confirmed it (FR-48). `confirmProposal` re-validates the
      // suggested value through `parsePlanningFieldValue` itself (defense in
      // depth against a tampered echoed Proposal) and, on success, writes via
      // `updateTaskField` + merges the `TaskFieldOverride` — this file no
      // longer does either directly.
      const confirmed = await confirmProposal(deps, { proposal: input.proposal!, accept: true });
      if (confirmed.ok && confirmed.value.applied) {
        return withNext(deps, record.id, undefined, confirmed.value.receipts);
      }
    }
    // Anything other than a confirmed, re-validated "yes" declines — never
    // re-prompts the suggest question itself (Review Focus #2).
    try {
      updateInteractionRequestDetail<{ incomplete: readonly MissingFieldReport[]; cursor: DataCompletenessCursor }>(
        deps.store,
        DATA_COMPLETENESS_REQUEST_ID,
        record.version,
        (currentDetail) => ({
          incomplete,
          cursor: { declinedSuggestions: [...(currentDetail?.cursor?.declinedSuggestions ?? []), declinedSuggestionKey(pending.taskId, pending.field)] },
        }),
      );
    } catch {
      return { ok: false, error: { kind: "conflict", message: "answer-data-completeness: the request changed concurrently" } };
    }
    return withNext(deps, record.id, undefined, []);
  }

  const parsed = parsePlanningFieldValue(pending.field, input.answer);
  if (!parsed.ok) return withNext(deps, record.id, parsed.message, []);
  const written = await deps.updateTaskField(pending.taskId, pending.field, parsed.value as NonNullable<Task[PlanningFieldNames]>);
  if (!written.ok) return withNext(deps, record.id, `I couldn't record that in Notion: ${written.error.message} — try again with a value closer to what's already in Notion.`, []);
  mergeTaskFieldOverride(deps.store, pending.taskId, { [pending.field]: parsed.value } as TaskFieldOverride);
  return withNext(deps, record.id, undefined, [`${pending.taskTitle} — ${label}: set to "${parsed.value}".`]);
}

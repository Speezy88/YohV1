/**
 * src/core/open-item-questions.ts
 *
 * Story 8.1 (Controller Ruling 1). Pure cursor arithmetic — "which
 * (Task, field) pair or Task is currently pending" — plus pure
 * `OpenItemQuestion` assembly, given an already-fetched FR-25 suggestion as
 * plain data (never fetched here — that's `app/surface-open-items.ts`'s
 * `buildOpenItemQuestion`, the one impure call site). Shared by
 * `surfaceOpenItems`/`buildOpenItemQuestion` (building the CURRENT/NEXT
 * question) and every `app/answer-*.ts`'s own conflict-check (recomputing
 * "is this answer's questionId still pending").
 */
import type { MissingFieldReport } from "./data-completeness-gate.ts";
import type { NightCloseOutTaskDetail } from "../rituals/night-ritual.ts";
import { PLANNING_FIELD_LABELS } from "./planning-field-value.ts";
import type { FieldValueSuggestion, PlanningFieldNames, Proposal, TaskFieldOverride } from "../types/domain.ts";
import type { OpenItemQuestion } from "../types/api.ts";

// ---- data-completeness cursor ---------------------------------------------

export interface DataCompletenessCursor {
  readonly declinedSuggestions: readonly string[];
}

/** The stable key an FR-25 decline is recorded/looked-up under: `"<taskId>:<field>"`. */
export function declinedSuggestionKey(taskId: string, field: PlanningFieldNames): string {
  return `${taskId}:${field}`;
}

export interface NextDataCompletenessQuestionInput {
  readonly incomplete: readonly MissingFieldReport[];
  readonly overridesByTaskId: ReadonlyMap<string, TaskFieldOverride>;
  readonly declinedSuggestions: ReadonlySet<string>;
}

export interface NextDataCompletenessQuestionResult {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly field: PlanningFieldNames;
  readonly suggestionDeclined?: true;
}

/**
 * Finds the first (Task, field) pair — in `incomplete`'s own order, then
 * `missingFields`' own order — that has no stored `TaskFieldOverride` value
 * yet. Returns `undefined` once every field across every Task has been
 * answered. Reports `suggestionDeclined: true` when this exact pair's FR-25
 * suggestion was already declined this round (Controller Ruling: a decline
 * moves straight to the blind ask, no re-prompt).
 */
export function nextDataCompletenessQuestion(input: NextDataCompletenessQuestionInput): NextDataCompletenessQuestionResult | undefined {
  for (const report of input.incomplete) {
    const override = input.overridesByTaskId.get(report.taskId);
    for (const field of report.missingFields) {
      if (override?.[field] !== undefined) continue;
      const declined = input.declinedSuggestions.has(declinedSuggestionKey(report.taskId, field));
      return { taskId: report.taskId, taskTitle: report.taskTitle, field, ...(declined ? { suggestionDeclined: true as const } : {}) };
    }
  }
  return undefined;
}

// ---- night-close-out cursor ------------------------------------------------

export interface NightCloseOutCursor {
  readonly resolvedTaskIds: readonly string[];
  readonly skippedTaskIds: readonly string[];
}

export interface NextNightCloseOutTaskInput {
  readonly tasks: readonly NightCloseOutTaskDetail[];
  readonly resolvedTaskIds: ReadonlySet<string>;
  readonly skippedTaskIds: ReadonlySet<string>;
}

/** Finds the first Task (in `tasks`' own order) that has been neither resolved nor skipped yet. `undefined` once every Task has been either. */
export function nextNightCloseOutTask(input: NextNightCloseOutTaskInput): NightCloseOutTaskDetail | undefined {
  return input.tasks.find((t) => !input.resolvedTaskIds.has(t.taskId) && !input.skippedTaskIds.has(t.taskId));
}

// ---- pure question assembly ------------------------------------------------

/**
 * Builds the current data-completeness question for `pending` — the plain
 * blind ask when no `suggestion` is given (or it was already declined), or
 * the FR-25 "sound right?" suggest question, carrying a
 * `Proposal<FieldValueSuggestion>` an answer can echo back
 * (`AnswerOpenItemRequest.proposal`) for re-validation. `entityVersion` is
 * the fixed literal `"field-value"` — there's no natural "live version" for
 * this kind; integrity comes from re-parsing via `parsePlanningFieldValue` +
 * `updateTaskField`'s select guard, not a re-read (Assumption 5).
 *
 * `createdAt` is required whenever `suggestion` is given — this file stays
 * I/O-free (AD-2, matching `core/time-budget.ts`'s own documented "never
 * `new Date()` internally" convention), so the caller
 * (`app/surface-open-items.ts`, the one impure call site) stamps it.
 */
export function buildDataCompletenessQuestion(requestId: string, pending: NextDataCompletenessQuestionResult): OpenItemQuestion;
export function buildDataCompletenessQuestion(
  requestId: string,
  pending: NextDataCompletenessQuestionResult,
  suggestion: FieldValueSuggestion,
  createdAt: string,
): OpenItemQuestion;
export function buildDataCompletenessQuestion(
  requestId: string,
  pending: NextDataCompletenessQuestionResult,
  suggestion?: FieldValueSuggestion,
  createdAt?: string,
): OpenItemQuestion {
  const label = PLANNING_FIELD_LABELS[pending.field];
  if (suggestion) {
    const proposal: Proposal<FieldValueSuggestion> = {
      id: `field-value:${pending.taskId}:${pending.field}`,
      kind: "field-value",
      entityId: pending.taskId,
      entityVersion: "field-value",
      suggested: suggestion,
      reason: suggestion.reason,
      createdAt: createdAt ?? "",
    };
    return {
      requestId,
      questionId: `${pending.taskId}:${pending.field}:suggest`,
      text: `${pending.taskTitle} — ${label}: I think it's "${suggestion.value}" — ${suggestion.reason}. Sound right?`,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
      allowsFreeText: true,
      proposal: proposal as Proposal<unknown>,
    };
  }
  return {
    requestId,
    questionId: `${pending.taskId}:${pending.field}`,
    text: `${pending.taskTitle} — ${label}`,
    options: [],
    allowsFreeText: true,
  };
}

export function buildNightCloseOutQuestion(requestId: string, task: NightCloseOutTaskDetail): OpenItemQuestion {
  return {
    requestId,
    questionId: task.taskId,
    text: `${task.taskTitle} — completed, slipped, or skip?`,
    options: [
      { label: "Completed", value: "completed" },
      { label: "Slipped", value: "slipped" },
      { label: "Skip", value: "skip" },
    ],
    allowsFreeText: true,
  };
}

export function buildSelfCheckQuestion(requestId: string): OpenItemQuestion {
  return {
    requestId,
    questionId: "score",
    text: 'Score (1-10) + a short reason, e.g. "7 feeling on top of things"',
    options: [],
    allowsFreeText: true,
  };
}

/** The fallback question for any `requestKind` this file doesn't otherwise recognize — mirrors `chat-cli.ts`'s pre-Epic-8 generic surface-then-clear-on-any-non-empty-answer behavior. */
export function buildGenericQuestion(requestId: string): OpenItemQuestion {
  return { requestId, questionId: "generic", text: "", options: [], allowsFreeText: true };
}

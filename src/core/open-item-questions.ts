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
import { RESEARCH_OFFER_KIND } from "./research-offer.ts";
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
    // Polish 4 Task 3 (Spencer: the question copy leaked model-internal,
    // third-person reasoning — "Spencer explicitly stated 'status not
    // started'…"). `suggestion.reason` is Claude's own free-text
    // explanation (`llm-adapter.ts`'s `suggestFieldValue` prompt literally
    // asks for one "quoting or paraphrasing what Spencer said"), so it can
    // never be trusted as second-person, Spencer-facing copy — dropped from
    // the rendered question entirely rather than risk relaying it verbatim.
    // `suggestion.reason` is still carried on the attached `Proposal` for
    // anything else that wants it; only this displayed string changes.
    return {
      requestId,
      questionId: `${pending.taskId}:${pending.field}:suggest`,
      text: `${pending.taskTitle} — ${label}: I think it's "${suggestion.value}". Sound right?`,
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

/** The fixed `questionId` of the close-out's final "anything else?" step — never a Task id, so `answerNightCloseOut` can tell it apart from a per-Task answer. */
export const NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID = "anything-else";

/**
 * The close-out's last step, asked once every Task is answered. Button-only
 * on purpose: anything Spencer wants to add is typed into Chat itself and
 * handled as an ordinary turn, so the card carries just the way to finish.
 */
export function buildNightCloseOutAnythingElseQuestion(requestId: string): OpenItemQuestion {
  return {
    requestId,
    questionId: NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID,
    text: "Anything else to add before closing out? Type it in chat, or choose Nothing else.",
    options: [{ label: "Nothing else", value: "nothing else" }],
    allowsFreeText: false,
  };
}

/** The fallback question for any `requestKind` this file doesn't otherwise recognize — mirrors `chat-cli.ts`'s pre-Epic-8 generic surface-then-clear-on-any-non-empty-answer behavior. */
export function buildGenericQuestion(requestId: string): OpenItemQuestion {
  return { requestId, questionId: "generic", text: "", options: [], allowsFreeText: true };
}

// ---- proposal confirm question (Story 8.2, AD-3, C4) -----------------------

/**
 * The fixed `questionId` an open `requestKind: "proposal"` item's single
 * confirm question always uses — a Proposal has exactly one question, and
 * its own re-prompt IS that same question, never a different one. Shared by
 * `buildProposalQuestion` (below), `app/open-proposal.ts` (which persists a
 * proposal under this same cursor), and `app/answer-open-item.ts` (which
 * checks an incoming answer's `questionId` against this literal before
 * dispatching to `confirmProposal` — the same "answer must name the current
 * pending question, or it's a conflict" rule every other request kind
 * enforces, C4).
 */
export const PROPOSAL_QUESTION_ID = "confirm";

/**
 * Story 8.8 AC3, final-review fix (Important #2): a generic Yes/No reads
 * oddly for "did you want me to CREATE this" — every `notion-page-draft`
 * confirm leads with "Create", pre-focused by `StructuredQuestion.tsx` so
 * Enter alone confirms it. The VALUES are unchanged ("yes"/"no") — only the
 * label changes; `answerOpenItem`/`parseProposalAnswer` read the value,
 * never the label. Every other proposal kind keeps the generic Yes/No.
 */
const CREATE_CANCEL_OPTIONS = [
  { label: "Create", value: "yes" },
  { label: "Cancel", value: "no" },
] as const;
/** Reshuffle previews read Approve / Discard; "approve"/"discard" parse like yes/no (`parseProposalAnswer`). */
const APPROVE_DISCARD_OPTIONS = [
  { label: "Approve", value: "approve" },
  { label: "Discard", value: "discard" },
] as const;
const YES_NO_OPTIONS = [
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
] as const;

/**
 * Builds an open `"proposal"` item's one confirm question — text is the
 * request's own stored `promptText` (already the complete "here's what I
 * want to do, and why" line `chat-cli.ts` used to show verbatim, whichever
 * wiring built it: `rituals/morning-ritual.ts`'s
 * `buildTimeBudgetProposalPromptText` for a Time-Budget-change Proposal, or
 * `app/open-proposal.ts`'s own `proposal.reason` for anything opened through
 * that path). `proposal` is attached so a caller (a re-ask, or a fresh
 * surface) always has it at hand without a second store read — mirrors
 * FR-25's own suggest-question carrying its `Proposal<FieldValueSuggestion>`
 * the same way.
 *
 * Final-review fix (Important #2): this is the ONE place every
 * `"proposal"` OpenItemQuestion is assembled (Controller Ruling 1) — a
 * fresh `app/create-item.ts` draft (via `app/open-proposal.ts`'s own return)
 * AND a later `app/surface-open-items.ts` re-surface (a page load, poll
 * tick, or post-answer refetch) both call this same function, so the
 * `notion-page-draft` -> Create/Cancel relabeling below can never drift
 * between the two the way it did when `create-item.ts` relabeled only its
 * own direct return value.
 */
export function buildProposalQuestion(requestId: string, promptText: string, proposal: Proposal<unknown>): OpenItemQuestion {
  return {
    requestId,
    questionId: PROPOSAL_QUESTION_ID,
    text: promptText,
    options:
      proposal.kind === "notion-page-draft"
        ? CREATE_CANCEL_OPTIONS
        : proposal.kind === "reshuffle" || proposal.kind === "change-set"
          ? APPROVE_DISCARD_OPTIONS
          : YES_NO_OPTIONS,
    allowsFreeText: proposal.kind !== "rule-change" && proposal.kind !== "pattern" && proposal.kind !== "change-set" && proposal.kind !== RESEARCH_OFFER_KIND,
    proposal,
  };
}

// ---- memory-forget disambiguation (Story 13.4) -----------------------------

/** The one question a `requestKind: "memory-forget"` item carries. */
export const MEMORY_FORGET_QUESTION_ID = "pick";
/** The option value that clears a memory-forget request without deleting anything. */
export const MEMORY_FORGET_NONE = "none";

/** Options are `{label, value: itemId}` per candidate, then "None of these"; no free text. */
export function buildMemoryForgetQuestion(
  requestId: string,
  text: string,
  candidates: readonly { readonly id: string; readonly label: string }[],
): OpenItemQuestion {
  return {
    requestId,
    questionId: MEMORY_FORGET_QUESTION_ID,
    text,
    options: [...candidates.map((c) => ({ label: c.label, value: c.id })), { label: "None of these", value: MEMORY_FORGET_NONE }],
    allowsFreeText: false,
  };
}

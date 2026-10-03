/**
 * Tests for `src/core/open-item-questions.ts` (Story 8.1, Controller
 * Ruling 1) — pure cursor arithmetic + pure `OpenItemQuestion` assembly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDataCompletenessQuestion,
  buildGenericQuestion,
  buildNightCloseOutQuestion,
  buildProposalQuestion,
  nextDataCompletenessQuestion,
  nextNightCloseOutTask,
  PROPOSAL_QUESTION_ID,
} from "../src/core/open-item-questions.ts";
import type { MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import type { NightCloseOutTaskDetail } from "../src/rituals/night-ritual.ts";
import type { Proposal, TaskFieldOverride } from "../src/types/domain.ts";

// Story 9.1: `MissingFieldReport.missingFields` narrowed to `RequiredFieldNames`
// (`"estimatedDurationMinutes" | "dueDate"`) — these fixtures use only those
// two field names now (previously "area"/"energy", which the two-tier gate
// can no longer report as missing).
const REPORTS: readonly MissingFieldReport[] = [
  { taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes", "dueDate"] },
  { taskId: "t2", taskTitle: "Plan trip", missingFields: ["dueDate"] },
];

test("nextDataCompletenessQuestion returns the first (task, field) pair with no stored override, in order", () => {
  const next = nextDataCompletenessQuestion({ incomplete: REPORTS, overridesByTaskId: new Map<string, TaskFieldOverride>(), declinedSuggestions: new Set() });
  assert.deepEqual(next, { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes" });
});

test("nextDataCompletenessQuestion skips a pair that already has a stored override", () => {
  const next = nextDataCompletenessQuestion({ incomplete: REPORTS, overridesByTaskId: new Map([["t1", { estimatedDurationMinutes: 90 }]]), declinedSuggestions: new Set() });
  assert.deepEqual(next, { taskId: "t1", taskTitle: "Call dentist", field: "dueDate" });
});

test("nextDataCompletenessQuestion returns undefined once every field has an override", () => {
  const next = nextDataCompletenessQuestion({
    incomplete: REPORTS,
    overridesByTaskId: new Map([
      ["t1", { estimatedDurationMinutes: 90, dueDate: "2026-09-01" }],
      ["t2", { dueDate: "2026-09-05" }],
    ]),
    declinedSuggestions: new Set(),
  });
  assert.equal(next, undefined);
});

test("nextDataCompletenessQuestion reports whether this pair's suggestion was already declined", () => {
  const next = nextDataCompletenessQuestion({ incomplete: REPORTS, overridesByTaskId: new Map(), declinedSuggestions: new Set(["t1:estimatedDurationMinutes"]) });
  assert.deepEqual(next, { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes", suggestionDeclined: true });
});

const TASKS: readonly NightCloseOutTaskDetail[] = [
  { taskId: "t1", taskTitle: "Draft the memo" },
  { taskId: "t2", taskTitle: "Book the flights" },
];

test("nextNightCloseOutTask returns the first unresolved, unskipped Task in order", () => {
  assert.deepEqual(nextNightCloseOutTask({ tasks: TASKS, resolvedTaskIds: new Set(), skippedTaskIds: new Set() }), TASKS[0]);
});

test("nextNightCloseOutTask skips resolved and skipped Tasks alike", () => {
  assert.deepEqual(nextNightCloseOutTask({ tasks: TASKS, resolvedTaskIds: new Set(["t1"]), skippedTaskIds: new Set() }), TASKS[1]);
});

test("nextNightCloseOutTask returns undefined once every Task is resolved or skipped", () => {
  assert.equal(nextNightCloseOutTask({ tasks: TASKS, resolvedTaskIds: new Set(["t1"]), skippedTaskIds: new Set(["t2"]) }), undefined);
});

test("buildDataCompletenessQuestion with no suggestion builds the blind ask", () => {
  const q = buildDataCompletenessQuestion("data-completeness", { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes" });
  assert.equal(q.questionId, "t1:estimatedDurationMinutes");
  assert.equal(q.options.length, 0);
  assert.equal(q.proposal, undefined);
});

test("buildDataCompletenessQuestion with a suggestion builds the suggest question, with a field-value Proposal attached", () => {
  const suggestion = { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes" as const, value: 30, reason: "half an hour" };
  const q = buildDataCompletenessQuestion(
    "data-completeness",
    { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes" },
    suggestion,
    "2026-09-25T00:00:00.000Z",
  );
  assert.equal(q.questionId, "t1:estimatedDurationMinutes:suggest");
  assert.match(q.text, /I think it's "30"/);
  assert.deepEqual(q.options.map((o) => o.value), ["yes", "no"]);
  assert.equal(q.proposal?.kind, "field-value");
});

// Polish 4 Task 3 (Spencer: the question copy leaked model-internal,
// third-person reasoning, e.g. "Spencer explicitly stated 'status not
// started'…"). `suggestion.reason` is Claude's own free-text explanation —
// never trustworthy as second-person, Spencer-facing copy — so it must
// never appear in the rendered question text, however third-person or
// name-dropping the reason is.
test("buildDataCompletenessQuestion's suggest question never includes the LLM-supplied reason (no third-person leak)", () => {
  const suggestion = {
    taskId: "t1",
    taskTitle: "Call dentist",
    field: "status" as const,
    value: "not-started",
    reason: "Spencer explicitly stated the status is not started in his last message.",
  };
  const q = buildDataCompletenessQuestion(
    "data-completeness",
    { taskId: "t1", taskTitle: "Call dentist", field: "status" },
    suggestion,
    "2026-09-25T00:00:00.000Z",
  );
  assert.doesNotMatch(q.text, /Spencer/);
  assert.doesNotMatch(q.text, new RegExp(suggestion.reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(q.text, 'Call dentist — Status: I think it\'s "not-started". Sound right?');
});

test("buildNightCloseOutQuestion builds the fixed completed/slipped/skip options", () => {
  const q = buildNightCloseOutQuestion("night-close-out", { taskId: "t1", taskTitle: "Draft the memo" });
  assert.equal(q.questionId, "t1");
  assert.deepEqual(q.options.map((o) => o.value), ["completed", "slipped", "skip"]);
});

test("buildGenericQuestion builds its fixed shape", () => {
  assert.equal(buildGenericQuestion("x").questionId, "generic");
});

test("buildProposalQuestion (Story 8.2, C4) builds the fixed confirm shape: 'confirm' questionId, the given promptText as text, yes/no options, allowsFreeText, and the proposal attached", () => {
  const proposal: Proposal<unknown> = {
    id: "time-budget-change-1",
    kind: "time-budget-change",
    entityId: "current",
    entityVersion: "1",
    suggested: { totalMinutes: 480 },
    reason: "Tasks have been deferred for 3 consecutive days.",
    createdAt: "2026-08-24T09:00:00.000Z",
  };
  const promptText = 'Tasks have been deferred for 3 consecutive days. Reply "yes" to apply this change, or "no" to dismiss it.';
  const q = buildProposalQuestion("time-budget-proposal", promptText, proposal);
  assert.equal(PROPOSAL_QUESTION_ID, "confirm");
  assert.deepEqual(q, {
    requestId: "time-budget-proposal",
    questionId: "confirm",
    text: promptText,
    options: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ],
    allowsFreeText: true,
    proposal,
  });
});

test("final-review fix (Important #2): buildProposalQuestion relabels a 'notion-page-draft' proposal's options to Create/Cancel, 'Create' first — the ONE place OpenItemQuestion shapes are assembled, so this holds regardless of which caller builds the question (a fresh draft OR a later re-surface)", () => {
  const proposal: Proposal<unknown> = {
    id: "create-Tasks-1",
    kind: "notion-page-draft",
    entityId: "create-Tasks-1",
    entityVersion: "new",
    suggested: { database: "Tasks", properties: { title: "Buy hiking boots" } },
    reason: "Here's what I'll create in Tasks:\n  title: Buy hiking boots",
    createdAt: "2026-09-26T18:00:00.000Z",
  };
  const q = buildProposalQuestion("proposal:create-Tasks-1", proposal.reason, proposal);
  assert.deepEqual(q.options, [
    { label: "Create", value: "yes" },
    { label: "Cancel", value: "no" },
  ]);
});

test("final-review fix (Important #2): every OTHER proposal kind keeps the generic Yes/No labels", () => {
  const calendarProposal: Proposal<unknown> = {
    id: "calendar-edit-1",
    kind: "calendar-edit",
    entityId: "evt-1",
    entityVersion: "etag-1",
    suggested: {},
    reason: "Move it",
    createdAt: "2026-09-26T18:00:00.000Z",
  };
  const q = buildProposalQuestion("proposal:calendar-edit-1", calendarProposal.reason, calendarProposal);
  assert.deepEqual(q.options.map((o) => o.value), ["yes", "no"]);
  assert.deepEqual(q.options.map((o) => o.label), ["Yes", "No"]);
});

test("buildProposalQuestion: a reshuffle proposal's chips read Approve / Discard", () => {
  const proposal: Proposal<unknown> = {
    id: "reshuffle-1", kind: "reshuffle", entityId: "2026-09-29", entityVersion: "1:abc",
    suggested: {}, reason: "Moves 1 block.", createdAt: "2026-09-29T18:00:00.000Z",
  };
  const q = buildProposalQuestion("proposal:reshuffle-1", proposal.reason, proposal);
  assert.deepEqual(q.options, [
    { label: "Approve", value: "approve" },
    { label: "Discard", value: "discard" },
  ]);
});

test("buildProposalQuestion: a pattern proposal is Yes/No only (no free text)", () => {
  const q = buildProposalQuestion("proposal:pattern-1", "x", { id: "pattern-1", kind: "pattern", entityId: "k", entityVersion: "new", suggested: {}, reason: "x", createdAt: "2026-09-30T00:00:00.000Z" });
  assert.equal(q.allowsFreeText, false);
});

test("buildProposalQuestion: a change-set proposal reads Approve / Discard with no free text", () => {
  const q = buildProposalQuestion("proposal:cs-1", "x", { id: "cs-1", kind: "change-set", entityId: "chat", entityVersion: "", suggested: { items: [] }, reason: "x", createdAt: "2026-10-03T00:00:00.000Z" });
  assert.deepEqual(q.options, [
    { label: "Approve", value: "approve" },
    { label: "Discard", value: "discard" },
  ]);
  assert.equal(q.allowsFreeText, false);
});

/**
 * Tests for `src/app/answer-data-completeness.ts` (Story 8.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, getOpenInteractionRequest, getTaskFieldOverride, mergeTaskFieldOverride, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { answerDataCompleteness } from "../src/app/answer-data-completeness.ts";
import type { MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import type { Result, YohError } from "../src/types/domain.ts";

function tempStore() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db); // Task 7 (Epic 8): interaction-request writes now append an outbox row.
  return createMemoryStore(connection);
}
function session() {
  return { recentMessages: [], lastSearchAnswer: undefined };
}
function openReq(store: ReturnType<typeof tempStore>, incomplete: MissingFieldReport[]) {
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete }, createdAt: "2026-09-25T00:00:00.000Z" });
}
function makeUpdateTaskField(failOnce: readonly string[] = []) {
  const calls: Array<{ taskId: string; field: string; value: unknown }> = [];
  const failed = new Set<string>();
  const fn = async (taskId: string, field: string, value: unknown): Promise<Result<void, YohError>> => {
    calls.push({ taskId, field, value });
    if (failOnce.includes(field) && !failed.has(field)) {
      failed.add(field);
      return { ok: false, error: { kind: "validation", message: "notion-adapter: no confident match" } };
    }
    return { ok: true, value: undefined };
  };
  return Object.assign(fn, { calls });
}

test("a valid blind-ask answer writes through updateTaskField, merges the override, and reports a receipt", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] }]);
  const updateTaskField = makeUpdateTaskField();
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:area", answer: "Health" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(updateTaskField.calls, [{ taskId: "t1", field: "area", value: "Health" }]);
  assert.equal(getTaskFieldOverride(store, "t1")?.data.area, "Health");
  assert.equal(result.value.receipts.length, 1);
  assert.equal(result.value.next, "done");
  assert.equal(getOpenInteractionRequest(store, "data-completeness"), undefined);
  store.close();
});

test("an unparseable answer is rejected, writes nothing, and re-asks the SAME question", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Write report", missingFields: ["estimatedDurationMinutes"] }]);
  const updateTaskField = makeUpdateTaskField();
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes", answer: "not-a-number" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(updateTaskField.calls.length, 0);
  assert.match(result.value.message ?? "", /didn't understand|invalid|couldn't/i);
  if (result.value.next !== "done") assert.equal(result.value.next.questionId, "t1:estimatedDurationMinutes");
  store.close();
});

test("a Notion write failure re-asks the SAME question — the override is never stored until the write succeeds", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] }]);
  const updateTaskField = makeUpdateTaskField(["area"]);
  const first = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:area", answer: "Astronomy" });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.notEqual(first.value.next, "done");
    assert.equal(getTaskFieldOverride(store, "t1"), undefined);
  }
  const second = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:area", answer: "Health" });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.value.next, "done");
  store.close();
});

test("multiple missing fields are answered one call at a time, each landing as its own override, each offered its own FR-25 attempt", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Plan trip", missingFields: ["area", "dueDate"] }]);
  const updateTaskField = makeUpdateTaskField();
  const first = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:area", answer: "Health" });
  assert.equal(first.ok, true);
  if (first.ok && first.value.next !== "done") assert.equal(first.value.next.questionId, "t1:dueDate");
  const second = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:dueDate", answer: "2026-09-01" });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.value.next, "done");
  store.close();
});

test("a confirmed 'yes' on the suggest question re-validates and writes the suggested value through updateTaskField, echoed via the proposal", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }]);
  const updateTaskField = makeUpdateTaskField();
  const proposal = {
    id: "field-value:t1:estimatedDurationMinutes",
    kind: "field-value" as const,
    entityId: "t1",
    entityVersion: "field-value",
    suggested: { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes" as const, value: 30, reason: "half an hour" },
    reason: "half an hour",
    createdAt: "2026-09-25T00:00:00.000Z",
  };
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "yes", proposal });
  assert.equal(result.ok, true);
  if (result.ok) {
    // Important fix: an accepted FR-25 suggestion must read identically to
    // a typed FR-24 answer to the same field — same human-readable label,
    // quoted value, trailing period.
    assert.deepEqual(result.value.receipts, ['Call dentist — Estimated Duration: set to "30".']);
  }
  assert.deepEqual(updateTaskField.calls, [{ taskId: "t1", field: "estimatedDurationMinutes", value: 30 }]);
  store.close();
});

test("a tampered echoed proposal (out-of-range value) is refused by confirmProposal's re-validation — updateTaskField is never called (Review Focus #1)", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }]);
  const updateTaskField = makeUpdateTaskField();
  const tamperedProposal = {
    id: "field-value-t1-estimatedDurationMinutes",
    kind: "field-value" as const,
    entityId: "t1",
    entityVersion: "display-time",
    suggested: { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes" as const, value: -5, reason: "x" },
    reason: "x",
    createdAt: "2026-08-24T09:00:00.000Z",
  };

  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "yes", proposal: tamperedProposal });
  assert.equal(result.ok, true);
  assert.equal(updateTaskField.calls.length, 0);
  assert.equal(getTaskFieldOverride(store, "t1"), undefined);
  store.close();
});

test("ANY non-'yes' answer to the suggest question (including garbage) declines it and moves straight to the blind ask, no re-prompt", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }]);
  const updateTaskField = makeUpdateTaskField();
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "banana" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(updateTaskField.calls.length, 0);
  assert.equal(result.value.message, undefined);
  if (result.value.next !== "done") assert.equal(result.value.next.questionId, "t1:estimatedDurationMinutes");
  store.close();
});

test("declining a suggestion persists the decline so a later surface never re-offers it", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }]);
  await answerDataCompleteness({ store, session: session(), updateTaskField: makeUpdateTaskField() }, { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "no" });
  const record = getOpenInteractionRequest(store, "data-completeness")!;
  assert.deepEqual((record.data.detail as { cursor: { declinedSuggestions: string[] } }).cursor.declinedSuggestions, ["t1:estimatedDurationMinutes"]);
  store.close();
});

test("review fix: a stale/replayed 'yes' to an ALREADY-DECLINED suggest question returns conflict and writes nothing, rather than matching on the shared taskId:field prefix", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }]);
  const updateTaskField = makeUpdateTaskField();
  const proposal = {
    id: "field-value:t1:estimatedDurationMinutes",
    kind: "field-value" as const,
    entityId: "t1",
    entityVersion: "field-value",
    suggested: { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes" as const, value: 30, reason: "half an hour" },
    reason: "half an hour",
    createdAt: "2026-09-25T00:00:00.000Z",
  };

  // First surface's suggest question is declined (e.g. a "no", or any
  // non-"yes" answer per Review Focus #2) — this persists
  // `cursor.declinedSuggestions`, moving the CURRENT pending question to the
  // blind ask.
  const declined = await answerDataCompleteness(
    { store, session: session(), updateTaskField },
    { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "no" },
  );
  assert.equal(declined.ok, true);

  // A second, STALE answer to the very same (now-declined) `:suggest`
  // questionId — as if a second surface had raced the decline and Spencer's
  // client replayed an earlier "yes" — must be rejected as conflict and must
  // NOT write anything, even though `t1:estimatedDurationMinutes:suggest`
  // still shares the `taskId:field` prefix with the now-current blind-ask
  // question (`t1:estimatedDurationMinutes`).
  const replayed = await answerDataCompleteness(
    { store, session: session(), updateTaskField },
    { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "yes", proposal },
  );
  assert.equal(replayed.ok, false);
  if (!replayed.ok) assert.equal(replayed.error.kind, "conflict");
  assert.equal(updateTaskField.calls.length, 0, "the replayed 'yes' must never reach updateTaskField");
  assert.equal(getTaskFieldOverride(store, "t1"), undefined);
  store.close();
});

test("final-review fix: a 'yes' whose echoed proposal names a DIFFERENT task is refused as conflict — updateTaskField is never called", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }]);
  const updateTaskField = makeUpdateTaskField();
  const proposal = {
    id: "field-value:t1:estimatedDurationMinutes",
    kind: "field-value" as const,
    entityId: "t1",
    entityVersion: "field-value",
    // Same field, but a DIFFERENT task than the one actually pending (t1).
    suggested: { taskId: "t2", taskTitle: "Some other task", field: "estimatedDurationMinutes" as const, value: 30, reason: "half an hour" },
    reason: "half an hour",
    createdAt: "2026-09-25T00:00:00.000Z",
  };
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "yes", proposal });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "conflict");
  assert.equal(updateTaskField.calls.length, 0);
  assert.equal(getTaskFieldOverride(store, "t1"), undefined);
  store.close();
});

test("final-review fix: a 'yes' whose echoed proposal names a DIFFERENT field is refused as conflict — updateTaskField is never called", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }]);
  const updateTaskField = makeUpdateTaskField();
  const proposal = {
    id: "field-value:t1:estimatedDurationMinutes",
    kind: "field-value" as const,
    entityId: "t1",
    entityVersion: "field-value",
    // Same task, but a DIFFERENT field than the one actually pending (estimatedDurationMinutes).
    suggested: { taskId: "t1", taskTitle: "Call dentist", field: "dueDate" as const, value: "2026-12-31", reason: "x" },
    reason: "x",
    createdAt: "2026-09-25T00:00:00.000Z",
  };
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "yes", proposal });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "conflict");
  assert.equal(updateTaskField.calls.length, 0);
  assert.equal(getTaskFieldOverride(store, "t1"), undefined);
  store.close();
});

test("final-review fix: a 'yes' whose echoed proposal is a DIFFERENT kind (not field-value) is refused as conflict — updateTaskField is never called", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }]);
  const updateTaskField = makeUpdateTaskField();
  const proposal = {
    id: "time-budget-change-1",
    kind: "time-budget-change" as const,
    entityId: "current",
    entityVersion: "1",
    suggested: { totalMinutes: 480 },
    reason: "x",
    createdAt: "2026-09-25T00:00:00.000Z",
  };
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:estimatedDurationMinutes:suggest", answer: "yes", proposal: proposal as never });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "conflict");
  assert.equal(updateTaskField.calls.length, 0);
  assert.equal(getTaskFieldOverride(store, "t1"), undefined);
  store.close();
});

test("an answer to a questionId that is no longer pending returns conflict and writes nothing", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Plan trip", missingFields: ["area", "dueDate"] }]);
  mergeTaskFieldOverride(store, "t1", { area: "Health" });
  const updateTaskField = makeUpdateTaskField();
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField }, { requestId: "data-completeness", questionId: "t1:area", answer: "Personal" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "conflict");
  assert.equal(updateTaskField.calls.length, 0);
  store.close();
});

test("an answer to a request that no longer exists returns conflict", async () => {
  const store = tempStore();
  const result = await answerDataCompleteness({ store, session: session(), updateTaskField: makeUpdateTaskField() }, { requestId: "data-completeness", questionId: "t1:area", answer: "Health" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "conflict");
  store.close();
});

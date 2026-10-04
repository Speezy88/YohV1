/**
 * Tests for `src/app/answer-night-close-out.ts` (Story 8.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, getOpenInteractionRequest, getRitualRun, getSlipHistory, getUncheckedDay, putOpenInteractionRequest, putUncheckedDay } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, listUnreadNotifications } from "../src/adapters/notification-store.ts";
import { answerNightCloseOut } from "../src/app/answer-night-close-out.ts";
import { NIGHT_PROMPT_RITUAL_ID, type NightCloseOutTaskDetail } from "../src/rituals/night-ritual.ts";
import { NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID } from "../src/core/open-item-questions.ts";
import type { Result, TaskStatus, YohError } from "../src/types/domain.ts";

function tempStore() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  return createMemoryStore(c);
}
function makeSetTaskStatus(overrides: Record<string, boolean> = {}) {
  const calls: Array<{ taskId: string; status: TaskStatus }> = [];
  const fn = async (taskId: string, status: TaskStatus): Promise<Result<void, YohError>> => {
    calls.push({ taskId, status });
    if (overrides[taskId] === false) return { ok: false, error: { kind: "unreachable", message: "notion: 500" } };
    return { ok: true, value: undefined };
  };
  return Object.assign(fn, { calls });
}
function openReq(store: ReturnType<typeof tempStore>, tasks: NightCloseOutTaskDetail[], date = "2026-08-22") {
  putOpenInteractionRequest(store, "night-close-out", { requestKind: "night-close-out", promptText: "x", detail: { date, tasks }, createdAt: "x" });
}
const deps = (store: ReturnType<typeof tempStore>, setTaskStatus = makeSetTaskStatus()) => ({
  store,
  session: { recentMessages: [], lastSearchAnswer: undefined, researchOffered: new Set<string>() },
  setTaskStatus,
  recordCompletion: () => {},
  lookupTask: async () => undefined,
});

test("a 'completed' answer applies and reports the next Task", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }, { taskId: "t2", taskTitle: "Book the flights" }]);
  const setTaskStatus = makeSetTaskStatus();
  const result = await answerNightCloseOut(deps(store, setTaskStatus), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(setTaskStatus.calls, [{ taskId: "t1", status: "completed" }]);
  if (result.value.next !== "done") assert.equal(result.value.next.questionId, "t2");
  store.close();
});

test("a Notion write failure is reported as a plain sentence naming Notion, ending properly so the appended 'Try again...' follow-up never reads as a run-on (review fix)", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const setTaskStatus = makeSetTaskStatus({ t1: false });
  const result = await answerNightCloseOut(deps(store, setTaskStatus), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.message ?? "", /Notion/);
  assert.doesNotMatch(result.value.message ?? "", /notion: 500/);
  assert.match(result.value.message ?? "", /\. Try again/);
  store.close();
});

test("'skip' leaves the Task unresolved and moves on, with no Notion call and no Slip-Bump write", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const setTaskStatus = makeSetTaskStatus();
  const result = await answerNightCloseOut(deps(store, setTaskStatus), { requestId: "night-close-out", questionId: "t1", answer: "skip" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next !== "done" && result.value.next.questionId, NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID);
  assert.equal(setTaskStatus.calls.length, 0);
  assert.equal(getSlipHistory(store, "t1"), undefined);
  store.close();
});

test("an unrecognized answer re-asks the SAME Task", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "huh?" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.value.message ?? "", /didn'?t understand|try/i);
    if (result.value.next !== "done") assert.equal(result.value.next.questionId, "t1");
  }
  store.close();
});

test("a Notion write failure re-asks the SAME Task rather than silently moving on", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const result = await answerNightCloseOut(deps(store, makeSetTaskStatus({ t1: false })), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.message ?? "", /notion|couldn'?t/i);
  assert.equal(getSlipHistory(store, "t1"), undefined);
  store.close();
});

test("every Task resolved (no skips) clears the request and resolves a matching UncheckedDay record", async () => {
  const store = tempStore();
  putUncheckedDay(store, { date: "2026-08-22", rolledForwardTasks: [], recordedAt: "2026-08-23T04:00:00.000Z" });
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next !== "done" && result.value.next.questionId, NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID);
  assert.equal(getOpenInteractionRequest(store, "night-close-out"), undefined);
  assert.equal(getUncheckedDay(store, "2026-08-22"), undefined);
  store.close();
});

test("at least one skip leaves a matching UncheckedDay record intact", async () => {
  const store = tempStore();
  putUncheckedDay(store, { date: "2026-08-22", rolledForwardTasks: [], recordedAt: "2026-08-23T04:00:00.000Z" });
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }, { taskId: "t2", taskTitle: "Book the flights" }]);
  await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t2", answer: "skip" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next !== "done" && result.value.next.questionId, NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID);
  assert.ok(getUncheckedDay(store, "2026-08-22"));
  store.close();
});

test("a close-out answered against the Plan's own stored date records the Slip-Bump against THAT date", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }], "2026-08-20");
  await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "slipped" });
  assert.equal(getSlipHistory(store, "t1")?.data.lastSlipDate, "2026-08-20");
  store.close();
});

test("an intermediate answer (more Tasks remain) preserves detail.date in the persisted cursor", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "A" }, { taskId: "t2", taskTitle: "B" }], "2026-08-20");
  await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  const record = getOpenInteractionRequest(store, "night-close-out")!;
  assert.equal((record.data.detail as { date: string }).date, "2026-08-20");
  store.close();
});

test("answering a stale questionId (a Task already resolved by a concurrent turn) returns conflict, writes nothing", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "slipped" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "conflict");
  store.close();
});

test("no in-app notification is raised while answering a close-out request (AD-5)", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  assert.deepEqual(listUnreadNotifications(store as never), []);
  store.close();
});

// ============================================================================
// Story 8.7: once the close-out is fully answered, the SAME RitualRun record
// night-escalate reads is written — see rituals/night-ritual.ts's
// recordNightCloseOutHandledWithoutPrompt.
// ============================================================================

test("Story 8.7: once every named Task is answered, the SAME RitualRun record night-escalate reads is written, keyed to the request's own detail.date", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }], "2026-09-25");
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next !== "done" && result.value.next.questionId, NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID);
  const run = getRitualRun(store, NIGHT_PROMPT_RITUAL_ID);
  assert.equal(run?.data.date, "2026-09-25", "written against the NIGHT the close-out was ABOUT, not the day it happened to be answered");
  store.close();
});

// --- Review Focus #3: a partial (skipped) close-out still marks night-prompt as handled — a deliberate, documented trade-off ---
test("a partially-skipped close-out still writes the marker once the loop concludes — night-prompt will not re-ask tonight even for the skipped Task", async () => {
  const store = tempStore();
  openReq(store, [
    { taskId: "t1", taskTitle: "Draft the memo" },
    { taskId: "t2", taskTitle: "Book the flights" },
  ]);
  await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t2", answer: "skip" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next !== "done" && result.value.next.questionId, NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID);
  const run = getRitualRun(store, NIGHT_PROMPT_RITUAL_ID);
  assert.ok(run, "the marker is written unconditionally at the loop's conclusion, skip or not — see this story's own Review Focus #3");
  store.close();
});

// --- the final "anything else?" step ---
test("the last Task's answer keeps its closing message and asks 'anything else' as one button-only question", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  assert.equal(result.ok, true);
  if (!result.ok || result.value.next === "done") return assert.fail("expected the anything-else question");
  assert.match(result.value.message ?? "", /Got it — thanks\. I've updated Notion/);
  assert.equal(result.value.next.requestId, "night-close-out");
  assert.match(result.value.next.text, /Anything else to add before closing out\?/);
  assert.deepEqual(result.value.next.options, [{ label: "Nothing else", value: "nothing else" }]);
  assert.equal(result.value.next.allowsFreeText, false);
  store.close();
});

test("a skipped Task is still named in the closing message ahead of the 'anything else' question", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: "t1", answer: "skip" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.message ?? "", /Draft the memo/);
  assert.notEqual(result.value.next, "done");
  store.close();
});

test("'Nothing else' closes out with no open request needed, and writes nothing", async () => {
  const store = tempStore();
  const setTaskStatus = makeSetTaskStatus();
  const result = await answerNightCloseOut(deps(store, setTaskStatus), { requestId: "night-close-out", questionId: NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID, answer: "nothing else" });
  assert.deepEqual(result, { ok: true, value: { message: "Closed out for tonight.", receipts: [], next: "done" } });
  assert.deepEqual(setTaskStatus.calls, []);
  assert.equal(getRitualRun(store, NIGHT_PROMPT_RITUAL_ID), undefined);
  store.close();
});

test("'Nothing else' on an old card leaves a newer night's open request untouched", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }], "2026-08-23");
  const before = getOpenInteractionRequest(store, "night-close-out");
  const result = await answerNightCloseOut(deps(store), { requestId: "night-close-out", questionId: NIGHT_CLOSE_OUT_ANYTHING_ELSE_QUESTION_ID, answer: "nothing else" });
  assert.equal(result.ok && result.value.next, "done");
  assert.deepEqual(getOpenInteractionRequest(store, "night-close-out"), before);
  store.close();
});

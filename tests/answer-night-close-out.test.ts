/**
 * Tests for `src/app/answer-night-close-out.ts` (Story 8.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, getOpenInteractionRequest, getSlipHistory, getUncheckedDay, putOpenInteractionRequest, putUncheckedDay } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, listUnreadNotifications } from "../src/adapters/notification-store.ts";
import { answerNightCloseOut } from "../src/app/answer-night-close-out.ts";
import type { NightCloseOutTaskDetail } from "../src/rituals/night-ritual.ts";
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
  session: { recentMessages: [], lastSearchAnswer: undefined },
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

test("'skip' leaves the Task unresolved and moves on, with no Notion call and no Slip-Bump write", async () => {
  const store = tempStore();
  openReq(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const setTaskStatus = makeSetTaskStatus();
  const result = await answerNightCloseOut(deps(store, setTaskStatus), { requestId: "night-close-out", questionId: "t1", answer: "skip" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next, "done");
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
  if (result.ok) assert.equal(result.value.next, "done");
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
  if (result.ok) assert.equal(result.value.next, "done");
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

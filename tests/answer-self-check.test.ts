/**
 * Tests for `src/app/answer-self-check.ts` (Story 8.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, getOpenInteractionRequest, getSelfCheckState, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, listUnreadNotifications } from "../src/adapters/notification-store.ts";
import { answerSelfCheck } from "../src/app/answer-self-check.ts";

function tempStore() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  return createMemoryStore(c);
}
function openReq(store: ReturnType<typeof tempStore>) {
  putOpenInteractionRequest(store, "self-check", { requestKind: "self-check", promptText: "How are things going?", createdAt: "x" });
}
const deps = (store: ReturnType<typeof tempStore>) => ({ store, session: { recentMessages: [], lastSearchAnswer: undefined }, today: "2026-08-22", random: () => 0 });

test("a complete answer persists it, clears the request, and reports 'done'", async () => {
  const store = tempStore();
  openReq(store);
  const result = await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "8 things are going well" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next, "done");
  assert.equal(getSelfCheckState(store)?.data.lastScore, 8);
  assert.equal(getOpenInteractionRequest(store, "self-check"), undefined);
  store.close();
});

test("UX-DR15: a bare number with no reason is rejected and re-asks the SAME question", async () => {
  const store = tempStore();
  openReq(store);
  const result = await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "7" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.value.message ?? "", /reason|both/i);
    if (result.value.next !== "done") assert.equal(result.value.next.questionId, "score");
  }
  assert.equal(getSelfCheckState(store)?.data.lastScore, undefined);
  store.close();
});

test("a low score genuinely shortens the next scheduled interval via the real shared curve", async () => {
  const store = tempStore();
  openReq(store);
  await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "2 really struggling" });
  const state = getSelfCheckState(store);
  const days = (Date.parse(`${state!.data.nextDueDate}T00:00:00.000Z`) - Date.parse("2026-08-22T00:00:00.000Z")) / 86_400_000;
  assert.equal(days, 2);
  store.close();
});

test("an answer to a request that no longer exists, or to the wrong questionId, returns conflict", async () => {
  const store = tempStore();
  const missing = await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "8 fine" });
  assert.equal(missing.ok, false);
  openReq(store);
  const wrong = await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "not-score", answer: "8 fine" });
  assert.equal(wrong.ok, false);
  store.close();
});

test("no in-app notification is raised while answering a Self-Check request (AD-5)", async () => {
  const store = tempStore();
  openReq(store);
  await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "8 fine" });
  assert.deepEqual(listUnreadNotifications(store as never), []);
  store.close();
});

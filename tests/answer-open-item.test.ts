/**
 * Tests for `src/app/answer-open-item.ts` (Story 8.1) — the one entry
 * shells call, dispatching on `requestKind`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { answerOpenItem } from "../src/app/answer-open-item.ts";

function tempStore() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  return createMemoryStore(c);
}
function fullDeps(store: ReturnType<typeof tempStore>) {
  return {
    store,
    session: { recentMessages: [], lastSearchAnswer: undefined },
    updateTaskField: async () => ({ ok: true as const, value: undefined }),
    setTaskStatus: async () => ({ ok: true as const, value: undefined }),
    recordCompletion: () => {},
    lookupTask: async () => undefined,
    today: "2026-08-22",
    random: () => 0,
  };
}

test("answerOpenItem dispatches a data-completeness request to answerDataCompleteness", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete: [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] }] }, createdAt: "x" });
  const result = await answerOpenItem(fullDeps(store), { requestId: "data-completeness", questionId: "t1:area", answer: "Health" });
  assert.equal(result.ok, true);
  store.close();
});

test("answerOpenItem dispatches a night-close-out request to answerNightCloseOut", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "night-close-out", { requestKind: "night-close-out", promptText: "x", detail: { date: "2026-08-22", tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] }, createdAt: "x" });
  const result = await answerOpenItem(fullDeps(store), { requestId: "night-close-out", questionId: "t1", answer: "completed" });
  assert.equal(result.ok, true);
  store.close();
});

test("answerOpenItem dispatches a self-check request to answerSelfCheck", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "self-check", { requestKind: "self-check", promptText: "x", createdAt: "x" });
  const result = await answerOpenItem(fullDeps(store), { requestId: "self-check", questionId: "score", answer: "8 fine" });
  assert.equal(result.ok, true);
  store.close();
});

test("answerOpenItem's generic catch-all clears an unrecognized-kind request on any answer", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "future-thing", { requestKind: "some-future-kind", promptText: "x", createdAt: "x" });
  const result = await answerOpenItem(fullDeps(store), { requestId: "future-thing", questionId: "generic", answer: "yes" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next, "done");
  store.close();
});

test("answerOpenItem returns conflict for a requestId that doesn't exist", async () => {
  const store = tempStore();
  const result = await answerOpenItem(fullDeps(store), { requestId: "nope", questionId: "generic", answer: "yes" });
  assert.equal(result.ok, false);
  store.close();
});

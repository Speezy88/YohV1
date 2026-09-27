/**
 * Tests for `src/app/answer-self-check.ts` (Story 8.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConflictError, createMemoryStore, getOpenInteractionRequest, getSelfCheckState, putOpenInteractionRequest, type MemoryStore } from "../src/adapters/memory-store.ts";
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

/** Wraps `store` so `putSelfCheckState`'s own `readModifyWrite` call always throws `ConflictError` (AD-10) — simulates a genuine concurrent write, without needing a second real writer racing it. */
function wrapWithSimulatedConflict(store: MemoryStore): MemoryStore {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "readModifyWrite") {
        return () => {
          throw new ConflictError("memory-store: simulated concurrent write");
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as MemoryStore;
}

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

test("Task 6: a bare number with no reason is now accepted (natural reply), persists it, and reports 'done'", async () => {
  const store = tempStore();
  openReq(store);
  const result = await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "7" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next, "done");
  assert.equal(getSelfCheckState(store)?.data.lastScore, 7);
  assert.equal(getSelfCheckState(store)?.data.lastReason, "");
  store.close();
});

// M2 (final-review): the reply used to say "Thanks — got it." without ever
// echoing the parsed score, so a misread (e.g. a number word instead of the
// digit Spencer actually meant) was invisible. It now leads with the
// logged score, keeping the existing follow-up text after it.
test("M2 (final-review): a successful answer's reply echoes the logged score", async () => {
  const store = tempStore();
  openReq(store);
  const result = await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "7, feeling good" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.message, "Logged 7/10. I'll check in again before too long.");
  store.close();
});

test("Task 6: a reply with no 1-10 number at all is rejected, re-asks the SAME question, and says plainly what's needed", async () => {
  const store = tempStore();
  openReq(store);
  const result = await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "not sure" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.message, "Just send a number from 1 to 10, plus an optional reason.");
    if (result.value.next !== "done") assert.equal(result.value.next.questionId, "score");
  }
  assert.equal(getSelfCheckState(store)?.data.lastScore, undefined);
  store.close();
});

test("Task 6: \"7, feeling good\" resolves the request with the natural reply's score and reason", async () => {
  const store = tempStore();
  openReq(store);
  const result = await answerSelfCheck(deps(store), { requestId: "self-check", questionId: "score", answer: "7, feeling good" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next, "done");
  assert.equal(getSelfCheckState(store)?.data.lastScore, 7);
  assert.equal(getSelfCheckState(store)?.data.lastReason, "feeling good");
  assert.equal(getOpenInteractionRequest(store, "self-check"), undefined);
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

test("a concurrent-write failure while recording the answer is reported as a plain sentence ending properly, so the appended 'Try again.' follow-up never reads as a run-on (review fix)", async () => {
  const store = tempStore();
  openReq(store);
  const conflictingStore = wrapWithSimulatedConflict(store);
  const result = await answerSelfCheck(deps(conflictingStore), { requestId: "self-check", questionId: "score", answer: "8 fine" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.doesNotMatch(result.value.message ?? "", /simulated concurrent write/);
  assert.doesNotMatch(result.value.message ?? "", /memory-store:/);
  assert.match(result.value.message ?? "", /\. Try again\.$/);
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

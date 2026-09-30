/**
 * Tests for `src/app/answer-open-item.ts` (Story 8.1) — the one entry
 * shells call, dispatching on `requestKind`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, getCurrentTimeBudget, getOpenInteractionRequest, putOpenInteractionRequest, putTimeBudget } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createChatStore, initChatStoreSchema } from "../src/adapters/chat-store.ts";
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

test("answerOpenItem answers a leftover retired-kind (self-check) request generically and clears it", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "self-check", { requestKind: "self-check", promptText: "x", createdAt: "x" });
  const result = await answerOpenItem(fullDeps(store), { requestId: "self-check", questionId: "generic", answer: "8 fine" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.next, "done");
  assert.equal(getOpenInteractionRequest(store, "self-check"), undefined);
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

// ============================================================================
// "proposal" requestKind (Story 8.2) — dispatches through confirmProposal
// ============================================================================

function openTimeBudgetProposal(store: ReturnType<typeof tempStore>): void {
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 });
  putOpenInteractionRequest(store, "time-budget-proposal", {
    requestKind: "proposal",
    promptText: 'Raise your Time Budget to 480 minutes? Reply "yes" to apply, or "no" to dismiss.',
    detail: {
      proposal: {
        id: "time-budget-change-1",
        kind: "time-budget-change",
        entityId: "current",
        entityVersion: "1",
        suggested: { totalMinutes: 480 },
        reason: "Tasks have been deferred for 3 consecutive days.",
        createdAt: "2026-08-24T09:00:00.000Z",
      },
      cursor: { questionId: "confirm" },
    },
    createdAt: "2026-08-24T09:00:00.000Z",
  });
}

test("answerOpenItem: 'yes' to an open Proposal applies it, clears the request, and returns next:'done'", async () => {
  const store = tempStore();
  openTimeBudgetProposal(store);
  const result = await answerOpenItem(fullDeps(store), { requestId: "time-budget-proposal", questionId: "confirm", answer: "yes" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.next, "done");
  assert.deepEqual(result.value.receipts, ["Done — I've updated your Time Budget."]);
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 480);
  assert.equal(getOpenInteractionRequest(store, "time-budget-proposal"), undefined);
  store.close();
});

test("answerOpenItem: 'no' to an open Proposal declines it, clears the request, and returns next:'done' with no receipts", async () => {
  const store = tempStore();
  openTimeBudgetProposal(store);
  const result = await answerOpenItem(fullDeps(store), { requestId: "time-budget-proposal", questionId: "confirm", answer: "no" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.next, "done");
  assert.deepEqual(result.value.receipts, []);
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 360);
  store.close();
});

test("answerOpenItem: an unrecognized answer to an open Proposal re-prompts with the SAME question, rather than guessing", async () => {
  const store = tempStore();
  openTimeBudgetProposal(store);
  const result = await answerOpenItem(fullDeps(store), { requestId: "time-budget-proposal", questionId: "confirm", answer: "maybe later" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.value.next, "done");
  // Important fix (C4): the re-prompt is the FULL confirm-question shape —
  // same questionId, same text (the request's own promptText), yes/no
  // options, allowsFreeText, and the proposal re-attached — never the
  // blank-text generic fallback.
  assert.deepEqual(result.value.next, {
    requestId: "time-budget-proposal",
    questionId: "confirm",
    text: 'Raise your Time Budget to 480 minutes? Reply "yes" to apply, or "no" to dismiss.',
    options: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ],
    allowsFreeText: true,
    proposal: {
      id: "time-budget-change-1",
      kind: "time-budget-change",
      entityId: "current",
      entityVersion: "1",
      suggested: { totalMinutes: 480 },
      reason: "Tasks have been deferred for 3 consecutive days.",
      createdAt: "2026-08-24T09:00:00.000Z",
    },
  });
  assert.ok(getOpenInteractionRequest(store, "time-budget-proposal"), "the request is NOT cleared on an unrecognized answer");
  store.close();
});

test("answerOpenItem: an answer naming a questionId OTHER than 'confirm' against an open Proposal is a conflict — nothing is written (controller fix)", async () => {
  const store = tempStore();
  openTimeBudgetProposal(store);
  const result = await answerOpenItem(fullDeps(store), { requestId: "time-budget-proposal", questionId: "generic", answer: "yes" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "conflict");
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 360, "nothing was applied");
  assert.ok(getOpenInteractionRequest(store, "time-budget-proposal"), "the request is NOT cleared on a mismatched questionId");
  store.close();
});

test("answerOpenItem: a stale Time Budget proposal is reported plainly and the request is cleared", async () => {
  const store = tempStore();
  openTimeBudgetProposal(store);
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 200, workMinutes: 70, breakMinutes: 15 }); // moved on since the proposal was generated
  const result = await answerOpenItem(fullDeps(store), { requestId: "time-budget-proposal", questionId: "confirm", answer: "yes" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.next, "done");
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 200);
  assert.equal(getOpenInteractionRequest(store, "time-budget-proposal"), undefined);
  // Task 4 (real-use fixes plan): the ONE fixed, honest sentence for
  // `kind: "stale-proposal"` — via `core/error-copy.ts`, never a message
  // that claims something else went wrong.
  assert.equal(result.value.message, "That changed since I suggested it, so I didn't apply it.");
  store.close();
});

// ============================================================================
// Task 4 (real-use fixes plan): honest, plain-language error messages. The
// incident this fixes — Spencer confirmed a "notion-page-draft" proposal
// (an unresolved literal-text Due Date that slipped past Task 3's own
// draft-time date resolution) and saw "I can't apply that any more —
// notion-adapter: could not create the "Tasks" page — body failed
// validation: body.properties.Due Date.date.start should be a valid ISO
// 8601 date string, instead was `"tomorrow at 10:45 AM"`." — wording that
// falsely claimed the proposal was stale AND leaked raw Notion API/JSON-path
// text. `answerProposalOpenItem` (src/app/answer-open-item.ts) now routes
// every `confirmProposal` failure through `core/error-copy.ts`'s
// `errorCopy`, which never repeats "any more" and never leaks `body.`/
// `properties.` text.
// ============================================================================

test("answerOpenItem: a notion-page-draft proposal that fails Notion's own validation at write time is reported as a plain sentence naming the field — never 'any more', never raw body./properties. text (the incident)", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "create-tasks-proposal", {
    requestKind: "proposal",
    promptText: "Create this in Tasks?",
    detail: {
      proposal: {
        id: "create-Tasks-1",
        kind: "notion-page-draft",
        entityId: "create-Tasks-1",
        entityVersion: "new",
        suggested: { database: "Tasks", properties: { title: "Draft the memo", dueDate: "tomorrow at 10:45 AM" } },
        reason: 'Here\'s what I\'ll create in Tasks:\n  title: Draft the memo\n  dueDate: tomorrow at 10:45 AM',
        createdAt: "2026-09-27T12:00:00.000Z",
      },
    },
    createdAt: "2026-09-27T12:00:00.000Z",
  });
  const deps = {
    ...fullDeps(store),
    createPage: async () => ({
      ok: false as const,
      error: {
        kind: "validation" as const,
        message:
          'notion-adapter: could not create the "Tasks" page — body failed validation: body.properties.Due Date.date.start should be a valid ISO 8601 date string, instead was `"tomorrow at 10:45 AM"`.',
      },
    }),
  };
  const result = await answerOpenItem(deps, { requestId: "create-tasks-proposal", questionId: "confirm", answer: "yes" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.next, "done");
  assert.match(result.value.message ?? "", /Due Date/);
  assert.doesNotMatch(result.value.message ?? "", /\bbody\./);
  assert.doesNotMatch(result.value.message ?? "", /\bproperties\./);
  assert.doesNotMatch(result.value.message ?? "", /notion-adapter/);
  assert.doesNotMatch(result.value.message ?? "", /any more/i);
  assert.doesNotMatch(result.value.message ?? "", /stale/i);
  store.close();
});

test("answerOpenItem stores the answer and the reply as today's chat turns (E5)", async () => {
  const store = tempStore();
  const cc = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(cc.db);
  initChatStoreSchema(cc.db);
  const chatHistory = createChatStore(cc);
  putOpenInteractionRequest(store, "future-thing", { requestKind: "some-future-kind", promptText: "x", createdAt: "x" });
  const result = await answerOpenItem(
    { ...fullDeps(store), chatHistory, timeZone: "UTC", now: () => new Date("2026-08-22T10:00:00Z") },
    { requestId: "future-thing", questionId: "generic", answer: "yes" },
  );
  assert.equal(result.ok, true);
  const turns = chatHistory.turnsForDate("2026-08-22");
  assert.deepEqual(turns.map((t) => [t.role, t.text]), [["user", "yes"], ["assistant", "Got it — thanks."]]);
  store.close();
});

test("answerOpenItem still returns its Result when the chat store throws (E5)", async () => {
  const store = tempStore();
  const logged: string[] = [];
  const chatHistory = { appendTurn() { throw new Error("disk full"); }, turnsForDate: () => [], clearAll() {}, hasUserTurnAfter: () => false };
  putOpenInteractionRequest(store, "future-thing", { requestKind: "some-future-kind", promptText: "x", createdAt: "x" });
  const result = await answerOpenItem(
    { ...fullDeps(store), chatHistory, timeZone: "UTC", now: () => new Date("2026-08-22T10:00:00Z"), log: (e: { event: string }) => { logged.push(e.event); } },
    { requestId: "future-thing", questionId: "generic", answer: "yes" },
  );
  assert.equal(result.ok, true);
  assert.equal(logged.length > 0, true);
  store.close();
});

/**
 * Tests for `src/app/surface-open-items.ts` (Story 8.1) —
 * `surfaceOpenItems`/`buildOpenItemQuestion`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, mergeTaskFieldOverride, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { buildOpenItemQuestion, surfaceOpenItems } from "../src/app/surface-open-items.ts";
import type { ChatSession } from "../src/app/chat-session.ts";
import type { MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import type { NightCloseOutTaskDetail } from "../src/rituals/night-ritual.ts";

function tempStore() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db); // Task 7 (Epic 8): interaction-request writes now append an outbox row.
  return createMemoryStore(connection);
}
function makeSession(): ChatSession {
  return { recentMessages: [], lastSearchAnswer: undefined };
}

test("surfaceOpenItems returns no items when nothing is open", async () => {
  const store = tempStore();
  const result = await surfaceOpenItems({ store, session: makeSession() }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.items, []);
  store.close();
});

test("surfaceOpenItems builds the blind-ask question for a fresh (no-cursor) data-completeness request", async () => {
  const store = tempStore();
  // Story 9.1: `MissingFieldReport.missingFields` narrowed to `RequiredFieldNames` — "area" replaced with "estimatedDurationMinutes" throughout this file.
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }];
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete: reports }, createdAt: "2026-09-25T00:00:00.000Z" });
  const result = await surfaceOpenItems({ store, session: makeSession() }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0]!.question.questionId, "t1:estimatedDurationMinutes");
  store.close();
});

test("surfaceOpenItems skips an already-overridden field", async () => {
  const store = tempStore();
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes", "dueDate"] }];
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete: reports }, createdAt: "2026-09-25T00:00:00.000Z" });
  mergeTaskFieldOverride(store, "t1", { estimatedDurationMinutes: 90 });
  const result = await surfaceOpenItems({ store, session: makeSession() }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0]!.question.questionId, "t1:dueDate");
  store.close();
});

test("surfaceOpenItems attaches an FR-25 suggestion when the LLM confidently infers a value", async () => {
  const store = tempStore();
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }];
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete: reports }, createdAt: "2026-09-25T00:00:00.000Z" });
  const session: ChatSession = { recentMessages: ["that dentist call will take about half an hour"], lastSearchAnswer: undefined };
  const llmClient = { messages: { create: async () => ({ content: [{ type: "text", text: "CONFIDENT: 30 | Spencer said it'll take about half an hour", citations: null }] }) } } as never;
  const result = await surfaceOpenItems({ store, session, llmClient }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0]!.question.questionId, "t1:estimatedDurationMinutes:suggest");
  store.close();
});

test("surfaceOpenItems falls straight to the blind ask when a suggestion was already declined", async () => {
  const store = tempStore();
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }];
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete: reports, cursor: { declinedSuggestions: ["t1:estimatedDurationMinutes"] } }, createdAt: "2026-09-25T00:00:00.000Z" });
  const llmClient = { messages: { create: async () => { throw new Error("must not be called"); } } } as never;
  const result = await surfaceOpenItems({ store, session: { recentMessages: ["x"], lastSearchAnswer: undefined }, llmClient }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0]!.question.questionId, "t1:estimatedDurationMinutes");
  store.close();
});

test("surfaceOpenItems builds the fixed question for night-close-out requests, and a generic one for an unknown or retired kind", async () => {
  const store = tempStore();
  const tasks: NightCloseOutTaskDetail[] = [{ taskId: "t1", taskTitle: "Draft the memo" }];
  putOpenInteractionRequest(store, "night-close-out", { requestKind: "night-close-out", promptText: "x", detail: { date: "2026-09-25", tasks }, createdAt: "x" });
  putOpenInteractionRequest(store, "self-check", { requestKind: "self-check", promptText: "x", createdAt: "x" });
  putOpenInteractionRequest(store, "future", { requestKind: "some-future-kind", promptText: "x", createdAt: "x" });
  const result = await surfaceOpenItems({ store, session: makeSession() }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const byId = Object.fromEntries(result.value.items.map((i) => [i.requestId, i.question.questionId]));
  assert.equal(byId["night-close-out"], "t1");
  assert.equal(byId["self-check"], "generic");
  assert.equal(byId["future"], "generic");
  store.close();
});

test("surfaceOpenItems builds the FULL confirm-question shape for an open 'proposal' request (Important fix, C4)", async () => {
  const store = tempStore();
  const proposal = {
    id: "time-budget-change-1",
    kind: "time-budget-change" as const,
    entityId: "current",
    entityVersion: "1",
    suggested: { totalMinutes: 480 },
    reason: "Tasks have been deferred for 3 consecutive days.",
    createdAt: "2026-08-24T09:00:00.000Z",
  };
  const promptText = 'Tasks have been deferred for 3 consecutive days. Reply "yes" to apply this change, or "no" to dismiss it.';
  putOpenInteractionRequest(store, "time-budget-proposal", {
    requestKind: "proposal",
    promptText,
    detail: { proposal, cursor: { questionId: "confirm" } },
    createdAt: "2026-08-24T09:00:00.000Z",
  });
  const result = await surfaceOpenItems({ store, session: makeSession() }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const question = result.value.items[0]!.question;
  assert.deepEqual(question, {
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
  store.close();
});

test("final-review fix (Important #2): re-surfacing a stored 'notion-page-draft' proposal keeps its Create/Cancel chip labels, not the generic Yes/No — the SAME shape a fresh draftItem() turn returns, since both go through the ONE buildProposalQuestion assembly point", async () => {
  const store = tempStore();
  const proposal = {
    id: "create-Tasks-1",
    kind: "notion-page-draft" as const,
    entityId: "create-Tasks-1",
    entityVersion: "new",
    suggested: { database: "Tasks", properties: { title: "Buy hiking boots" } },
    reason: "Here's what I'll create in Tasks:\n  title: Buy hiking boots",
    createdAt: "2026-09-26T18:00:00.000Z",
  };
  putOpenInteractionRequest(store, "proposal:create-Tasks-1", {
    requestKind: "proposal",
    promptText: proposal.reason,
    detail: { proposal, cursor: { questionId: "confirm" } },
    createdAt: "2026-09-26T18:00:00.000Z",
  });
  const result = await surfaceOpenItems({ store, session: makeSession() }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const question = result.value.items[0]!.question;
  assert.deepEqual(question.options, [
    { label: "Create", value: "yes" },
    { label: "Cancel", value: "no" },
  ]);
  store.close();
});

test("surfaceOpenItems falls back to the generic question for a 'proposal' request with no stored proposal (malformed/legacy record)", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "orphan-proposal", { requestKind: "proposal", promptText: "x", detail: {}, createdAt: "x" });
  const result = await surfaceOpenItems({ store, session: makeSession() }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0]!.question.questionId, "generic");
  store.close();
});

test("buildOpenItemQuestion returns 'done' when the request no longer exists", async () => {
  const store = tempStore();
  const result = await buildOpenItemQuestion({ store, session: makeSession() }, { requestId: "nope" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "done");
  store.close();
});

test("surfaceOpenItems drops an expired reshuffle proposal but keeps a fresh one", async () => {
  const store = tempStore();
  const proposal = (id: string, createdAt: string) => ({ id, kind: "reshuffle", entityId: "2026-09-28", entityVersion: "1:h", suggested: {}, reason: "r", createdAt });
  putOpenInteractionRequest(store, "proposal:old", { requestKind: "proposal", promptText: "old", detail: { proposal: proposal("old", "2026-09-28T10:00:00.000Z") }, createdAt: "2026-09-28T10:00:00.000Z" });
  putOpenInteractionRequest(store, "proposal:new", { requestKind: "proposal", promptText: "new", detail: { proposal: proposal("new", "2026-09-28T10:25:00.000Z") }, createdAt: "2026-09-28T10:25:00.000Z" });
  const result = await surfaceOpenItems({ store, session: makeSession(), now: () => new Date("2026-09-28T10:30:00.000Z") }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.items.map((i) => i.requestId), ["proposal:new"]);
  store.close();
});

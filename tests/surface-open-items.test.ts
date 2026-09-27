/**
 * Tests for `src/app/surface-open-items.ts` (Story 8.1) —
 * `surfaceOpenItems`/`buildOpenItemQuestion`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, mergeTaskFieldOverride, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { buildOpenItemQuestion, surfaceOpenItems } from "../src/app/surface-open-items.ts";
import type { ChatSession } from "../src/app/chat-session.ts";
import type { MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import type { NightCloseOutTaskDetail } from "../src/rituals/night-ritual.ts";

function tempStore() {
  return createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
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
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] }];
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete: reports }, createdAt: "2026-09-25T00:00:00.000Z" });
  const result = await surfaceOpenItems({ store, session: makeSession() }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0]!.question.questionId, "t1:area");
  store.close();
});

test("surfaceOpenItems skips an already-overridden field", async () => {
  const store = tempStore();
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["area", "dueDate"] }];
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete: reports }, createdAt: "2026-09-25T00:00:00.000Z" });
  mergeTaskFieldOverride(store, "t1", { area: "Health" });
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
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] }];
  putOpenInteractionRequest(store, "data-completeness", { requestKind: "data-completeness", promptText: "x", detail: { incomplete: reports, cursor: { declinedSuggestions: ["t1:area"] } }, createdAt: "2026-09-25T00:00:00.000Z" });
  const llmClient = { messages: { create: async () => { throw new Error("must not be called"); } } } as never;
  const result = await surfaceOpenItems({ store, session: { recentMessages: ["x"], lastSearchAnswer: undefined }, llmClient }, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0]!.question.questionId, "t1:area");
  store.close();
});

test("surfaceOpenItems builds the fixed question for night-close-out and self-check requests, and a generic one for an unknown kind", async () => {
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
  assert.equal(byId["self-check"], "score");
  assert.equal(byId["future"], "generic");
  store.close();
});

test("buildOpenItemQuestion returns 'done' when the request no longer exists", async () => {
  const store = tempStore();
  const result = await buildOpenItemQuestion({ store, session: makeSession() }, { requestId: "nope" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "done");
  store.close();
});

/**
 * Tests for `src/app/chat-turn.ts` (Story 8.3).
 *
 * Covers what no single moved test, by itself, pins (Review Focus #1, #5,
 * #6 of this story's plan): `chatTurn` never calls `classifyChatIntent`
 * itself (a recognized command costs zero LLM calls; an unmatched line
 * costs exactly one — `answerQuestion`'s own call), it never itself emits a
 * `"done"`/`"error"` stream event, its own history trim enforces
 * `MAX_CHAT_HISTORY_TURNS` even for an untrimmed caller, and it records into
 * `session.recentMessages`.
 *
 * Later tasks (8.4, 8.5, ...) append more tests to this same file — see the
 * task-4 brief.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getCurrentTimeBudget, putOpenInteractionRequest, putPlan, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { chatTurn, MAX_CHAT_HISTORY_TURNS, STATUS_THINKING, type ChatTurnDeps } from "../src/app/chat-turn.ts";
import { COMMANDS } from "../src/app/commands.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import type { ChatSession } from "../src/app/chat-session.ts";
import type { ChatStreamEvent } from "../src/types/api.ts";
import type { ChatTurn, Plan, Task } from "../src/types/domain.ts";

const TEST_TIME_ZONE = "America/New_York";

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

/** A fake `AnthropicMessagesClient` — records every call; returns a fixed non-streaming response, or streams it word-by-word when `stream: true`. */
function makeFakeLlmClient(responseText = "I don't have a specific answer for that.") {
  const calls: any[] = [];
  return {
    calls,
    messages: {
      create: async (params: any) => {
        calls.push(params);
        if (params.stream) {
          async function* events() {
            for (const word of responseText.split(" ")) {
              yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${word} ` } };
            }
          }
          return events();
        }
        return {
          id: "msg_test",
          container: null,
          model: params.model,
          role: "assistant",
          type: "message",
          content: [{ type: "text", text: responseText, citations: null }],
          stop_details: null,
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            server_tool_use: null,
            service_tier: null,
          },
        };
      },
    },
  } as unknown as AnthropicMessagesClient & { readonly calls: any[] };
}

function makeSession(): ChatSession {
  return { recentMessages: [], lastSearchAnswer: undefined };
}

function baseDeps(overrides: Partial<ChatTurnDeps> = {}): ChatTurnDeps {
  return {
    store: tempStore(),
    timeZone: TEST_TIME_ZONE,
    now: () => new Date("2026-08-22T18:00:00.000Z"),
    readTasks: async () => {
      throw new Error("chat-turn test: readTasks not configured for this test");
    },
    llmClient: makeFakeLlmClient(),
    session: makeSession(),
    // Story 8.7 (FR-41): /night's exclusion rule — a throws-only-if-invoked
    // default (same convention as every other optional-ish seam here), since
    // most tests in this file never dispatch /night.
    getCompletedTaskIdsToday: () => new Set(),
    // Story 8.4's four new capabilities' own dependencies — throws-only-if-
    // invoked stubs (same convention as `readTasks` above, and as
    // `shell/chat-cli.ts`'s own defaults) for every test in this file that
    // doesn't exercise create-item/calendar-edit/search.
    getNotionCreatePageBinding: () => ({
      ok: false,
      error: { kind: "missing-field", message: "chat-turn test: no Notion binding configured for this test" },
    }),
    readCalendarEventsFn: async () => {
      throw new Error("chat-turn test: readCalendarEventsFn not configured for this test");
    },
    resolveCalendarEditRouteFn: async () => {
      throw new Error("chat-turn test: resolveCalendarEditRouteFn not configured for this test");
    },
    proposeCalendarEditFn: async () => {
      throw new Error("chat-turn test: proposeCalendarEditFn not configured for this test");
    },
    proposeNewCalendarEventFn: () => {
      throw new Error("chat-turn test: proposeNewCalendarEventFn not configured for this test");
    },
    searchFn: async () => {
      throw new Error("chat-turn test: searchFn not configured for this test");
    },
    ...overrides,
  };
}

// ============================================================================
// Dispatch order (Story 8.3, restored to its original priority by Story 8.4):
// a recognized deterministic command never calls the LLM client at all; an
// unmatched line costs exactly two LLM calls — chatTurn's OWN
// classifyChatIntent call (Story 8.4), then answerQuestion's own call.
// ============================================================================

test("chatTurn recognizes a Time Budget command and never calls the LLM client", async () => {
  const llmClient = makeFakeLlmClient();
  const store = tempStore();
  const deps = baseDeps({ llmClient, store });

  const result = await chatTurn(deps, { message: "time budget 6h", history: [] });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /360|6h|6 hours?/i);
  assert.equal((llmClient as any).calls.length, 0, "a recognized Time Budget command must never call the LLM client");
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 360);
});

test("Story 8.4: a recognized Plan-view command never reaches classifyChatIntent at all — zero Claude calls, same as every other Task-4/8.3 recognizer", async () => {
  const llmClient = makeFakeLlmClient();
  const deps = baseDeps({ llmClient });

  const result = await chatTurn(deps, { message: "what's my plan", history: [] });

  assert.equal(result.ok, true);
  assert.equal((llmClient as any).calls.length, 0, "a Task-4 recognizer match must short-circuit BEFORE classifyChatIntent ever runs");
});

test("chatTurn falls through to answerQuestion for an unmatched line, costing exactly two LLM calls (Story 8.4: chatTurn's own classifyChatIntent, then answerQuestion's own call)", async () => {
  const llmClient = makeFakeLlmClient("It's sunny where you are, probably.");
  const deps = baseDeps({ llmClient });

  const result = await chatTurn(deps, { message: "what's the weather", history: [{ role: "user", content: "what's the weather" }] });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "It's sunny where you are, probably.");
  assert.equal((llmClient as any).calls.length, 2, "expected exactly two Claude calls for the unmatched input: classifyChatIntent, then the general-qa answer");
});

// ============================================================================
// History trim (Review Focus #5): chatTurn enforces MAX_CHAT_HISTORY_TURNS
// itself, even for a caller that doesn't pre-trim.
// ============================================================================

test("chatTurn trims an untrimmed history down to MAX_CHAT_HISTORY_TURNS before sending it to Claude, keeping it starting with a user turn", async () => {
  const llmClient = makeFakeLlmClient("answer");
  const deps = baseDeps({ llmClient });

  const longHistory: ChatTurn[] = Array.from({ length: 50 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn-${i}`,
  }));

  await chatTurn(deps, { message: "turn-49", history: longHistory });

  // calls[0] is chatTurn's own classifyChatIntent call (Story 8.4, sent
  // only the current line, not the history); calls[1] is answerQuestion's
  // own call, the one this test is actually about.
  const sentMessages = (llmClient as any).calls[1].messages as ReadonlyArray<{ role: string; content: string }>;
  assert.equal(sentMessages.length, MAX_CHAT_HISTORY_TURNS);
  assert.deepEqual(sentMessages, longHistory.slice(longHistory.length - MAX_CHAT_HISTORY_TURNS));
  assert.equal(sentMessages[0]!.role, "user", "trimming must remove complete pairs, never leaving an assistant turn first");
});

test("Story 8.6 (Task 7): trimming drops a leading assistant turn if one slips through — a dropped empty reply (chatStore.ts's own historyOf() filter) can break strict [user,assistant] alternation, and the Messages API rejects a history starting with 'assistant'", async () => {
  const llmClient = makeFakeLlmClient("answer");
  const deps = baseDeps({ llmClient });

  // 50 conceptual turns, alternating user/assistant from i=0, but i=5 (an
  // assistant reply) is missing — e.g. it streamed to "" and
  // `web/`'s `chatStore.ts` never appended it. That single gap shifts every
  // later turn's role one slot out of phase with its ARRAY position, so the
  // naive "always remove complete [user,assistant] pairs from the front"
  // trim (stepping the start index by 2 every time) can land on an
  // assistant turn even though it always started from position 0.
  const history: ChatTurn[] = [];
  for (let i = 0; i < 50; i++) {
    if (i === 5) continue;
    history.push({ role: i % 2 === 0 ? "user" : "assistant", content: `turn-${i}` });
  }
  assert.equal(history.length, 49);

  await chatTurn(deps, { message: "turn-49", history });

  const sentMessages = (llmClient as any).calls[1].messages as ReadonlyArray<{ role: string; content: string }>;
  assert.equal(sentMessages[0]!.role, "user", "the trimmed history handed to the Messages API must never start with 'assistant'");
});

// ============================================================================
// session.recentMessages recording
// ============================================================================

test("chatTurn records the current message into session.recentMessages", async () => {
  const session = makeSession();
  const deps = baseDeps({ session });

  await chatTurn(deps, { message: "  time budget 6h  ", history: [] });

  assert.deepEqual(session.recentMessages, ["time budget 6h"]);
});

test("chatTurn does not record a blank message", async () => {
  const session = makeSession();
  const deps = baseDeps({ session });

  await chatTurn(deps, { message: "   ", history: [] });

  assert.deepEqual(session.recentMessages, []);
});

// ============================================================================
// Status/stream events: STATUS_THINKING first on every turn; never a
// done/error event across any dispatch branch (Controller ruling).
// ============================================================================

test("chatTurn emits STATUS_THINKING first when deps.emit is present, for a recognized command", async () => {
  const events: ChatStreamEvent[] = [];
  const deps = baseDeps({ emit: (e) => events.push(e) });

  await chatTurn(deps, { message: "what's my plan", history: [] });

  assert.ok(events.length > 0);
  assert.deepEqual(events[0], { type: "status", text: STATUS_THINKING });
});

test("chatTurn never emits a done/error event itself, across a recognized command, a general question, and a streamed general question", async () => {
  const tasks: Task[] = [];

  // Branch 1: a recognized command (Plan-view).
  const events1: ChatStreamEvent[] = [];
  await chatTurn(baseDeps({ emit: (e) => events1.push(e) }), { message: "what's my plan", history: [] });
  assert.ok(events1.every((e) => e.type === "status" || e.type === "delta"));

  // Branch 2: a recognized command that reads Tasks (Mid-Day Re-Flow — no
  // Plan stored, so it resolves cleanly with the "no plan yet" reply).
  const events2: ChatStreamEvent[] = [];
  await chatTurn(baseDeps({ emit: (e) => events2.push(e), readTasks: async () => tasks }), { message: "reflow my day", history: [] });
  assert.ok(events2.every((e) => e.type === "status" || e.type === "delta"));

  // Branch 3: the general-question fallback, non-streaming call still under
  // the hood (chatTurn always forwards deps.emit, so this exercises the
  // streaming path in app/general-question.ts too).
  const events3: ChatStreamEvent[] = [];
  const llmClient = makeFakeLlmClient("Two plus two is four.");
  await chatTurn(baseDeps({ emit: (e) => events3.push(e), llmClient }), {
    message: "what's 2+2",
    history: [{ role: "user", content: "what's 2+2" }],
  });
  assert.ok(events3.every((e) => e.type === "status" || e.type === "delta"));
});

test("chatTurn emits an additional capability-specific status before a Tasks-reading command does its read", async () => {
  const events: ChatStreamEvent[] = [];
  const deps = baseDeps({ emit: (e) => events.push(e), readTasks: async () => [] });

  await chatTurn(deps, { message: "reflow my day", history: [] });

  assert.ok(events.length >= 2, "expected STATUS_THINKING plus a capability-specific status");
  assert.equal(events[0]!.type, "status");
  assert.equal(events[1]!.type, "status");
  assert.notEqual((events[1] as { readonly text: string }).text, STATUS_THINKING);
});

// ============================================================================
// Story 8.4: the four new dispatch branches (save-search-result, create-item,
// calendar-edit, classify->search/general), F6 ordering, the calendar
// NONE-fallback convention, and session threading across two chatTurn calls.
// ============================================================================

test("Review Focus #3 (F6, Epic 6 retro): 'save that to my notion research vault' routes to saveSearchResult, never draftItem", async () => {
  const llmClient = makeFakeLlmClient();
  const session = makeSession();
  session.lastSearchAnswer = { query: "hiking boots", answer: { answer: "x", citations: [] } };
  const deps = baseDeps({ llmClient, session });

  const result = await chatTurn(deps, { message: "save that to my notion research vault", history: [] });

  assert.equal(result.ok, true);
  assert.equal(
    (llmClient as any).calls.length,
    0,
    "draftItem (create-item) must never be reached for this line — it would call draftNotionPageFields via the LLM client",
  );
});

test("Review Focus #4: a calendar-edit line whose draft is NONE falls through to classify/answerQuestion, not an empty reply", async () => {
  const llmClient = makeFakeLlmClient("NONE");
  const deps = baseDeps({ llmClient, readCalendarEventsFn: async () => [] });

  const result = await chatTurn(deps, {
    message: "move on to the next topic",
    history: [{ role: "user", content: "move on to the next topic" }],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // draftCalendarEditRequest's own call returns "NONE" -> proposeCalendarEdit
  // returns the empty fall-through convention -> classifyChatIntent (also
  // "NONE", not "SEARCH: ...", so GENERAL) -> answerQuestion, which answers
  // with this same fake client's fixed response text.
  assert.equal(result.value.reply, "NONE");
  assert.equal(
    (llmClient as any).calls.length,
    3,
    "expected draftCalendarEditRequest, then classifyChatIntent, then answerQuestion — the empty fall-through must never be handed back to Spencer as a real (blank) answer",
  );
});

test("an ordinary message classified as general-question never calls search(), and still answers via the general-qa path", async () => {
  const searchCalls: string[] = [];
  const llmClient = makeFakeLlmClient("Yoh's own answer.");
  const deps = baseDeps({
    llmClient,
    searchFn: async (query) => {
      searchCalls.push(query);
      return { ok: true, value: { answer: "", citations: [] } };
    },
  });

  const result = await chatTurn(deps, {
    message: "what should I have for lunch",
    history: [{ role: "user", content: "what should I have for lunch" }],
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reply, "Yoh's own answer.");
  assert.equal(searchCalls.length, 0);
});

test("Review Focus #5: session is threaded by reference across two chatTurn calls — search, then 'save that' on the NEXT turn", async () => {
  const session = makeSession();
  const deps1 = baseDeps({
    session,
    llmClient: makeFakeLlmClient("SEARCH: best hiking boots"),
    searchFn: async () => ({ ok: true, value: { answer: "Salomon test well.", citations: [] } }),
  });
  await chatTurn(deps1, { message: "search for the best hiking boots", history: [] });
  assert.ok(session.lastSearchAnswer, "expected the first turn to set session.lastSearchAnswer");

  const createPageBindingCalls: unknown[] = [];
  const deps2 = baseDeps({
    session,
    getNotionCreatePageBinding: () => {
      createPageBindingCalls.push(true);
      return { ok: false, error: { kind: "missing-field", message: "no Notion config configured for this test" } };
    },
  });
  await chatTurn(deps2, { message: "save that", history: [] });
  assert.equal(
    createPageBindingCalls.length,
    1,
    "expected the SECOND turn's saveSearchResult to see the FIRST turn's lastSearchAnswer and attempt to file it",
  );
});

test("Story 8.4: session.recentMessages records every line that reaches chatTurn — including a save-search-result/create-item/calendar-edit/search line, none of which bypass chatTurn any more", async () => {
  for (const message of ["save that", "create a task to buy milk", "move team sync to 6pm", "search for something"]) {
    const session = makeSession();
    const deps = baseDeps({
      session,
      llmClient: makeFakeLlmClient("NONE"),
      readCalendarEventsFn: async () => [],
    });
    await chatTurn(deps, { message, history: [] });
    assert.deepEqual(session.recentMessages, [message], `expected "${message}" to be recorded into session.recentMessages`);
  }
});

// ============================================================================
// Story 8.7: slash-dispatch through the command registry — /morning, /night,
// unknown-command, and the "never leak a raw proposal" pinning test.
// ============================================================================

function samplePlanFixture(): Plan {
  return {
    id: "plan-2026-08-22",
    date: "2026-08-22",
    blocks: [{ id: "work-0", kind: "work", start: "2026-08-22T18:00:00.000Z", end: "2026-08-22T19:00:00.000Z", label: "Draft the memo", taskId: "t1" }],
    reasoning: '"Draft the memo" leads today.',
    version: 1,
    createdAt: "2026-08-22T12:00:00.000Z",
    updatedAt: "2026-08-22T12:00:00.000Z",
  };
}

test("/morning dispatches to morningView and formats its response as chat text — never touches the LLM", async () => {
  const llmClient = makeFakeLlmClient();
  const store = tempStore();
  putPlan(store, samplePlanFixture());
  const deps = baseDeps({ llmClient, store });

  const result = await chatTurn(deps, { message: "/morning", history: [] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.equal((llmClient as any).calls.length, 0, "a recognized /morning command must never call the LLM client");
});

test("/night dispatches to startNightCloseOut and surfaces its question", async () => {
  const store = tempStore();
  putPlan(store, samplePlanFixture());
  const deps = baseDeps({ store });

  const result = await chatTurn(deps, { message: "/night", history: [] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.value.question);
});

test("an unknown command gets a neutral reply listing every real command, never an error", async () => {
  const deps = baseDeps();
  const result = await chatTurn(deps, { message: "/frobnicate", history: [] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /No command named "\/frobnicate"/);
  for (const c of COMMANDS) assert.ok(result.value.reply.includes(c.name));
});

test("command matching is case-insensitive, and a trailing word after the command name is ignored", async () => {
  const store = tempStore();
  putPlan(store, samplePlanFixture());
  const deps = baseDeps({ store });
  const result = await chatTurn(deps, { message: "/MORNING please", history: [] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.doesNotMatch(result.value.reply, /No command named/);
});

// --- Review Focus #4: /morning's formatted reply must never leak a raw proposal object ---
test("/morning's reply embeds only an open item's promptText, never a raw proposal object, even when one is pending", async () => {
  const store = tempStore();
  putPlan(store, samplePlanFixture());
  putOpenInteractionRequest(store, "data-completeness", {
    requestKind: "data-completeness",
    promptText: "I need a bit more before I can plan around Draft the memo.",
    createdAt: "2026-08-22T12:00:00.000Z",
    detail: { incomplete: [{ taskId: "t1", taskTitle: "Draft the memo", missingFields: ["area"] }] },
  });
  const deps = baseDeps({ store });

  const result = await chatTurn(deps, { message: "/morning", history: [] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.reply.includes("[object Object]"), false);
  assert.equal(/"kind"\s*:/.test(result.value.reply), false, "no raw JSON of a Proposal leaks into the chat reply");
});

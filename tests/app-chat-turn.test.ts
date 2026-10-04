/**
 * Tests for `src/app/chat-turn.ts` (Story 8.3).
 *
 * Covers what no single moved test, by itself, pins (Review Focus #1, #5,
 * #6 of this story's plan): a recognized command costs zero LLM calls; an
 * unmatched line goes to the `chatAgent` tool loop (one call when the model
 * answers directly); `chatTurn` never itself emits a
 * `"done"`/`"error"` stream event, its own history trim enforces
 * `MAX_CHAT_HISTORY_TURNS` even for an untrimmed caller, and it records into
 * `session.recentMessages`.
 *
 * Later tasks (8.4, 8.5, ...) append more tests to this same file — see the
 * task-4 brief.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initRoutineStoreSchema } from "../src/adapters/routine-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getCurrentTimeBudget, getOpenInteractionRequest, getPlan, putOpenInteractionRequest, putPlan, putTimeBudget, type MemoryStore } from "../src/adapters/memory-store.ts";
import { createChatStore, initChatStoreSchema, type ChatStore } from "../src/adapters/chat-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { initJobStoreSchema } from "../src/adapters/job-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { PLAN_EDIT_HOW_TO_REPLY } from "../src/core/plan-edit-commands.ts";
import { confirmProposal } from "../src/app/confirm-proposal.ts";
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
  return { recentMessages: [], lastSearchAnswer: undefined, researchOffered: new Set<string>() };
}

/** A real chat store on in-memory SQLite, pre-seeded with today's (2026-08-22, New York) turns. */
function seededChatStore(turns: readonly { role: "user" | "assistant"; text: string }[]): ChatStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  const store = createChatStore(connection);
  turns.forEach((t, i) => {
    store.appendTurn({ date: "2026-08-22", role: t.role, text: t.text, at: new Date(Date.UTC(2026, 7, 22, 12, 0, i)).toISOString() });
  });
  return store;
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
    // Real-use fixes plan, Task 5 ("what's happening tomorrow"): same
    // throws-only-if-invoked convention as `readCalendarEventsFn` above, for
    // every test in this file that doesn't exercise the day-view recognizer.
    readCalendarEventsForDate: async () => {
      throw new Error("chat-turn test: readCalendarEventsForDate not configured for this test");
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
    // Review fix (real-use fixes plan, Task 5 fix, FR-42): defaults to
    // available — every test in this file that doesn't specifically
    // exercise the "search isn't configured" behavior gets the pre-existing
    // (search-available) capability text and search-trigger dispatch.
    webSearchAvailable: true,
    searchFn: async () => {
      throw new Error("chat-turn test: searchFn not configured for this test");
    },
    ...overrides,
  };
}

/**
 * A scripted client for the tool loop. A request with `tools` (the loop's)
 * gets the next scripted turn; any other request (a draft parser's own call
 * before a line falls through) gets "NONE", which every draft parser reads
 * as "no draft".
 */
function toolLoopClient(turns: unknown[][]) {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  const client = {
    messages: {
      create: (async (params: Record<string, unknown>) => {
        calls.push(params);
        const tools = params["tools"] as { name: string }[] | undefined;
        const content = tools && tools[0]?.name === "list_tasks" ? turns[Math.min(i++, turns.length - 1)]! : [{ type: "text", text: "NONE" }];
        return { content, stop_reason: content.some((c) => (c as { type: string }).type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
      }) as unknown as AnthropicMessagesClient["messages"]["create"],
    },
  };
  return { client: client as AnthropicMessagesClient, calls, loopCalls: () => calls.filter((c) => Array.isArray(c["tools"]) && (c["tools"] as { name: string }[])[0]?.name === "list_tasks") };
}

test("an unmatched line goes to the tool loop in one model call, with tools attached", async () => {
  const { client, calls } = toolLoopClient([[{ type: "text", text: "Napoleon was a French general." }]]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "who was napoleon" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reply, "Napoleon was a French general.");
  assert.equal(calls.length, 1);
  assert.ok(Array.isArray(calls[0]!["tools"]));
});

test("'add the workout and dinner to my google calendar for today' reaches the tool loop, not a Tasks draft", async () => {
  const { client } = toolLoopClient([
    [
      { type: "tool_use", id: "1", name: "create_event", input: { title: "Workout", date: "2026-08-22", startTime: "13:10", endTime: "14:50" } },
      { type: "tool_use", id: "2", name: "create_event", input: { title: "Dinner", date: "2026-08-22", startTime: "18:00", endTime: "19:00" } },
    ],
    [{ type: "text", text: "Staged." }],
  ]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "add the workout and dinner to my google calendar for today" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.doesNotMatch(result.value.reply, /couldn't tell what you want/i);
    assert.equal((result.value.question?.proposal as { kind?: string } | undefined)?.kind, "change-set");
  }
});

test("a create-item line whose draft finds nothing reaches the tool loop", async () => {
  const { client, loopCalls } = toolLoopClient([[{ type: "text", text: "Here is what I would add." }]]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "create a task to email Alex" });
  assert.equal(loopCalls().length, 1);
  if (result.ok) assert.equal(result.value.reply, "Here is what I would add.");
});

test("a create-item draft with an unresolvable date returns the clarifying reply as-is, with zero tool-loop calls", async () => {
  const llmClient = fakeCaptureRoutingClient({ draftFields: "title=Lab report draft\ndueDate=sometime soon" });
  const result = await chatTurn(baseDeps({ llmClient }), { message: "create a task for the lab report" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /When is "Lab report draft" due\?/);
  assert.equal((llmClient as any).calls.filter((c: any) => Array.isArray(c.tools)).length, 0);
});

test("a create-item draft that asks a question is returned as-is, with zero tool-loop calls", async () => {
  const llmClient = fakeCaptureRoutingClient({});
  const deps = baseDeps({
    llmClient,
    getNotionCreatePageBinding: () => ({
      ok: true,
      value: {
        client: fakeTasksNotionCreateClient(),
        config: { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds", researchVaultDataSourceId: "vault-ds" },
      },
    }),
  });
  const result = await chatTurn(deps, { message: "create a task for the lab report" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.question?.text ?? "", /Here's what I'll create in Tasks/);
  assert.equal((llmClient as any).calls.filter((c: any) => Array.isArray(c.tools)).length, 0);
});

test("cancel / delete / remove calendar phrasings each reach the tool loop instead of a fixed refusal", async () => {
  for (const message of ["delete my meeting with Alex tomorrow at 3", "cancel the meeting with Alex tomorrow", "remove my meeting with Alex at 3pm"]) {
    const { client, calls } = toolLoopClient([[{ type: "text", text: "I can only delete events Yoh created." }]]);
    const result = await chatTurn(baseDeps({ llmClient: client }), { message });
    assert.equal(calls.length, 1, `expected "${message}" to cost one loop call`);
    assert.equal(result.ok && result.value.reply, "I can only delete events Yoh created.");
  }
});

test("a deterministic command still costs zero model calls", async () => {
  const { client, calls } = toolLoopClient([[{ type: "text", text: "unused" }]]);
  await chatTurn(baseDeps({ llmClient: client }), { message: "plan" });
  assert.equal(calls.length, 0);
});

test("a turn answered by the tool loop is not marked handledDeterministically", async () => {
  const { client } = toolLoopClient([[{ type: "text", text: "Hi." }]]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "hello there" });
  assert.equal(result.ok, true);
  if (result.ok) assert.notEqual(result.value.handledDeterministically, true);
});

// ============================================================================
// Dispatch order (Story 8.3, restored to its original priority by Story 8.4):
// a recognized deterministic command never calls the LLM client at all; an
// unmatched line goes to the chatAgent tool loop (one LLM call when the
// model answers directly).
// ============================================================================

test("chatTurn recognizes a Time Budget command and never calls the LLM client", async () => {
  const llmClient = makeFakeLlmClient();
  const store = tempStore();
  const deps = baseDeps({ llmClient, store });

  const result = await chatTurn(deps, { message: "time budget 6h" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /360|6h|6 hours?/i);
  assert.equal((llmClient as any).calls.length, 0, "a recognized Time Budget command must never call the LLM client");
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 360);
});

test("Story 8.4: a recognized Plan-view command never reaches classifyChatIntent at all — zero Claude calls, same as every other Task-4/8.3 recognizer", async () => {
  const llmClient = makeFakeLlmClient();
  const deps = baseDeps({ llmClient });

  const result = await chatTurn(deps, { message: "what's my plan" });

  assert.equal(result.ok, true);
  assert.equal((llmClient as any).calls.length, 0, "a Task-4 recognizer match must short-circuit BEFORE classifyChatIntent ever runs");
});

test("chatTurn falls through to the tool loop for an unmatched line, costing exactly one LLM call when the model answers directly", async () => {
  const llmClient = makeFakeLlmClient("Reheat the leftovers, probably.");
  const deps = baseDeps({ llmClient });

  // Real-use fixes plan, Task 5: "what's the weather" now matches
  // `core/search-intent.ts`'s deterministic pre-check ("weather" is one of
  // its current-information cues) and short-circuits BEFORE either
  // classifier ever runs — see the "current-information-cue line" tests
  // above. This test needs a genuinely unmatched line (no search verb, no
  // current-info cue, no planning-recognizer shape) to keep pinning the
  // tool-loop fall-through it's actually about.
  const result = await chatTurn(deps, {
    message: "what should I do about the dishes",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "Reheat the leftovers, probably.");
  assert.equal(
    (llmClient as any).calls.length,
    1,
    "expected exactly one Claude call for the unmatched input: the tool loop's single answering turn",
  );
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
  const chatHistory = seededChatStore(longHistory.map((t) => ({ role: t.role, text: t.content })));

  await chatTurn({ ...deps, chatHistory }, { message: "turn-50" });

  // calls[0] is the tool loop's own (and only) call.
  const sentMessages = (llmClient as any).calls[0].messages as ReadonlyArray<{ role: string; content: string | ReadonlyArray<{ text: string }> }>;
  // Real-use fixes plan, Task 9: the LAST message carries the conversation-
  // history cache breakpoint (`llm-adapter.ts`'s `toCacheableMessages`), so
  // its `content` is a one-element text-block array rather than a bare
  // string — normalize back to plain text before comparing to `longHistory`.
  const normalized = sentMessages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content[0]!.text }));
  // The store's last 40 turns plus the appended current message (`turn-50`) exceed the cap, so one pair is trimmed.
  assert.equal(normalized.length, MAX_CHAT_HISTORY_TURNS - 1);
  assert.deepEqual(normalized, [...longHistory.slice(longHistory.length - MAX_CHAT_HISTORY_TURNS + 2), { role: "user", content: "turn-50" }]);
  assert.equal(normalized[0]!.role, "user", "trimming must remove complete pairs, never leaving an assistant turn first");
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
  const chatHistory = seededChatStore(history.map((t) => ({ role: t.role, text: t.content })));

  await chatTurn({ ...deps, chatHistory }, { message: "turn-49" });

  // calls[0] is the tool loop's own (and only) call.
  const sentMessages = (llmClient as any).calls[0].messages as ReadonlyArray<{ role: string; content: string }>;
  assert.equal(sentMessages[0]!.role, "user", "the trimmed history handed to the Messages API must never start with 'assistant'");
});

// ============================================================================
// session.recentMessages recording
// ============================================================================

test("chatTurn records the current message into session.recentMessages", async () => {
  const session = makeSession();
  const deps = baseDeps({ session });

  await chatTurn(deps, { message: "  time budget 6h  " });

  assert.deepEqual(session.recentMessages, ["time budget 6h"]);
});

test("chatTurn does not record a blank message", async () => {
  const session = makeSession();
  const deps = baseDeps({ session });

  await chatTurn(deps, { message: "   " });

  assert.deepEqual(session.recentMessages, []);
});

// ============================================================================
// Status/stream events: STATUS_THINKING first on every turn; never a
// done/error event across any dispatch branch (Controller ruling).
// ============================================================================

test("chatTurn emits STATUS_THINKING first when deps.emit is present, for a recognized command", async () => {
  const events: ChatStreamEvent[] = [];
  const deps = baseDeps({ emit: (e) => events.push(e) });

  await chatTurn(deps, { message: "what's my plan" });

  assert.ok(events.length > 0);
  assert.deepEqual(events[0], { type: "status", text: STATUS_THINKING });
});

test("chatTurn never emits a done/error event itself, across a recognized command, a general question, and a streamed general question", async () => {
  const tasks: Task[] = [];

  // Branch 1: a recognized command (Plan-view).
  const events1: ChatStreamEvent[] = [];
  await chatTurn(baseDeps({ emit: (e) => events1.push(e) }), { message: "what's my plan" });
  assert.ok(events1.every((e) => e.type === "status" || e.type === "delta"));

  // Branch 2: a recognized command that reads Tasks (Mid-Day Re-Flow — no
  // Plan stored, so it resolves cleanly with the "no plan yet" reply).
  const events2: ChatStreamEvent[] = [];
  await chatTurn(baseDeps({ emit: (e) => events2.push(e), readTasks: async () => tasks }), { message: "reflow my day" });
  assert.ok(events2.every((e) => e.type === "status" || e.type === "delta"));

  // Branch 3: the general-question fallback, non-streaming call still under
  // the hood (chatTurn always forwards deps.emit, so this exercises the
  // streaming path in app/general-question.ts too).
  const events3: ChatStreamEvent[] = [];
  const llmClient = makeFakeLlmClient("Two plus two is four.");
  await chatTurn(baseDeps({ emit: (e) => events3.push(e), llmClient }), {
    message: "what's 2+2",
  });
  assert.ok(events3.every((e) => e.type === "status" || e.type === "delta"));
});

test("chatTurn emits an additional capability-specific status before a Tasks-reading command does its read", async () => {
  const events: ChatStreamEvent[] = [];
  const deps = baseDeps({ emit: (e) => events.push(e), readTasks: async () => [] });

  await chatTurn(deps, { message: "reflow my day" });

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

  const result = await chatTurn(deps, { message: "save that to my notion research vault" });

  assert.equal(result.ok, true);
  assert.equal(
    (llmClient as any).calls.length,
    0,
    "draftItem (create-item) must never be reached for this line — it would call draftNotionPageFields via the LLM client",
  );
});

test("Review Focus #4 / Ruling P4: a calendar-edit-shaped line with no draft reaches the tool loop, not an empty reply", async () => {
  const { client, calls, loopCalls } = toolLoopClient([[{ type: "text", text: "Which topic?" }]]);
  const deps = baseDeps({ llmClient: client, readCalendarEventsFn: async () => [] });

  const result = await chatTurn(deps, { message: "move on to the next topic" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "Which topic?");
  assert.equal(loopCalls().length, 1);
  assert.equal(calls.length, 2, "the calendar drafter's own call, then the tool loop's one call");
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
  await chatTurn(deps1, { message: "search for the best hiking boots" });
  assert.ok(session.lastSearchAnswer, "expected the first turn to set session.lastSearchAnswer");

  const createPageBindingCalls: unknown[] = [];
  const deps2 = baseDeps({
    session,
    getNotionCreatePageBinding: () => {
      createPageBindingCalls.push(true);
      return { ok: false, error: { kind: "missing-field", message: "no Notion config configured for this test" } };
    },
  });
  await chatTurn(deps2, { message: "save that" });
  assert.equal(
    createPageBindingCalls.length,
    1,
    "expected the SECOND turn's saveSearchResult to see the FIRST turn's lastSearchAnswer and attempt to file it",
  );
});

// ============================================================================
// Real-use fixes plan, Task 5 ("the web search is not working"): a
// deterministic pre-check (`core/search-intent.ts`'s `parseSearchIntent`),
// checked AFTER every existing deterministic recognizer and BEFORE
// classifyCapture/classifyChatIntent — a search-shaped line never spends
// either paid classifier call at all.
// ============================================================================

test('chatTurn routes a current-information-cue line ("what\'s the latest AI news") straight to search — ZERO LLM calls (neither classifyCapture nor classifyChatIntent ever runs)', async () => {
  const llmClient = makeFakeLlmClient("GENERAL");
  const searchCalls: string[] = [];
  const deps = baseDeps({
    llmClient,
    searchFn: async (query) => {
      searchCalls.push(query);
      return { ok: true, value: { answer: "Some AI shipped something.", citations: ["https://example.com/ai-news"] } };
    },
  });

  const result = await chatTurn(deps, { message: "what's the latest AI news" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /Some AI shipped something\./);
  assert.deepEqual(searchCalls, ["what's the latest AI news"], "the pre-check keeps the whole line as the query for a cue-only match");
  assert.equal(
    (llmClient as any).calls.length,
    0,
    "a pre-check hit must short-circuit BEFORE classifyCapture or classifyChatIntent ever runs — zero LLM calls",
  );
});

test('chatTurn strips the search verb from an explicit-verb line ("search for the best hiking boots" -> query "the best hiking boots") and never calls the classifier', async () => {
  const llmClient = makeFakeLlmClient("GENERAL");
  const searchCalls: string[] = [];
  const deps = baseDeps({
    llmClient,
    searchFn: async (query) => {
      searchCalls.push(query);
      return { ok: true, value: { answer: "Salomon test well.", citations: [] } };
    },
  });

  await chatTurn(deps, { message: "search for the best hiking boots" });

  assert.deepEqual(searchCalls, ["the best hiking boots"]);
  assert.equal((llmClient as any).calls.length, 0, "the pre-check must catch this line before classifyCapture/classifyChatIntent");
});

test('chatTurn treats a leading "search:" prefix (what Research Hub\'s ask box always sends) as an explicit search, query = the rest', async () => {
  const llmClient = makeFakeLlmClient("GENERAL");
  const searchCalls: string[] = [];
  const deps = baseDeps({
    llmClient,
    searchFn: async (query) => {
      searchCalls.push(query);
      return { ok: true, value: { answer: "AP Bio registers in the fall.", citations: [] } };
    },
  });

  await chatTurn(deps, { message: "search: AP Bio registration deadline" });

  assert.deepEqual(searchCalls, ["AP Bio registration deadline"]);
  assert.equal((llmClient as any).calls.length, 0, "an explicit search: prefix never depends on the classifier");
});

test("M6 (final-review): an explicit \"search:\" prefix always searches, even when the rest of the line reads like a create-item command", async () => {
  const llmClient = makeFakeLlmClient("GENERAL");
  const searchCalls: string[] = [];
  const deps = baseDeps({
    llmClient,
    searchFn: async (query) => {
      searchCalls.push(query);
      return { ok: true, value: { answer: "Here's how the Notion API create-a-page endpoint works.", citations: [] } };
    },
  });

  const result = await chatTurn(deps, { message: "search: add a new task in notion via api" });

  assert.equal(result.ok, true);
  assert.deepEqual(searchCalls, ["add a new task in notion via api"]);
  assert.equal((llmClient as any).calls.length, 0, "search: must be checked before create-item, without any classifier call");
});

test("chatTurn's search pre-check never swallows a planning line that happens to contain a cue word (\"today's plan\") — falls through to the classifier same as before", async () => {
  const llmClient = makeFakeLlmClient("GENERAL");
  const searchCalls: string[] = [];
  const deps = baseDeps({
    llmClient,
    searchFn: async (query) => {
      searchCalls.push(query);
      return { ok: true, value: { answer: "should never be reached", citations: [] } };
    },
  });

  const result = await chatTurn(deps, {
    message: "today's plan",
  });

  assert.equal(result.ok, true);
  assert.equal(searchCalls.length, 0, '"today\'s plan" must never be treated as a search — it stays on the general/capture path');
});

// ============================================================================
// Review fix (real-use fixes plan, Task 5 fix, FR-42): when web search isn't
// actually configured (no PERPLEXITY_API_KEY), chatTurn must never let a
// search-trigger line attempt a search, and general chat's capability text
// must say so plainly rather than claiming it can search.
// ============================================================================

test("a search-trigger line replies plainly that web search isn't set up, and never calls searchFn, when webSearchAvailable is false", async () => {
  let searchCalls = 0;
  const deps = baseDeps({
    llmClient: makeFakeLlmClient("SEARCH: best hiking boots"),
    webSearchAvailable: false,
    searchFn: async () => {
      searchCalls++;
      return { ok: true, value: { answer: "should never be reached", citations: [] } };
    },
  });

  const result = await chatTurn(deps, { message: "search for the best hiking boots" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "Web search isn't set up yet (it needs a Perplexity key).");
  assert.equal(searchCalls, 0, "searchFn must never be called when webSearchAvailable is false");
});

test("general chat's capability text says web search isn't set up (never claims it) when webSearchAvailable is false", async () => {
  const llmClient = makeFakeLlmClient("I can't do that yet.");
  const deps = baseDeps({ llmClient, webSearchAvailable: false });

  await chatTurn(deps, { message: "what can you do" });

  const lastCall = (llmClient as any).calls.at(-1);
  assert.ok(lastCall, "expected the tool loop's own Claude call");
  const system: string = typeof lastCall.system === "string" ? lastCall.system : (lastCall.system ?? []).map((b: { text: string }) => b.text).join("\n");
  assert.match(system, /web search isn't set up yet \(it needs a perplexity key\)/i);
  assert.doesNotMatch(system, /search the web for a factual/i);
});

test("Story 8.4: session.recentMessages records every line that reaches chatTurn — including a save-search-result/create-item/calendar-edit/search line, none of which bypass chatTurn any more", async () => {
  for (const message of ["save that", "create a task to buy milk", "move team sync to 6pm", "search for something"]) {
    const session = makeSession();
    const deps = baseDeps({
      session,
      llmClient: makeFakeLlmClient("NONE"),
      readCalendarEventsFn: async () => [],
      // Real-use fixes plan, Task 5: "search for something" now matches
      // `core/search-intent.ts`'s deterministic pre-check (an explicit
      // "search for" verb) and reaches `searchWeb` directly — this test is
      // only about `session.recentMessages`, so a trivial always-succeeds
      // stub is enough.
      searchFn: async () => ({ ok: true, value: { answer: "x", citations: [] } }),
    });
    await chatTurn(deps, { message });
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

  const result = await chatTurn(deps, { message: "/morning" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.equal((llmClient as any).calls.length, 0, "a recognized /morning command must never call the LLM client");
});

test("/morning with no Plan yet points Spencer at /plan (real-use fixes plan, Task 1) — it still never generates a Plan itself (FR-1)", async () => {
  const deps = baseDeps();
  const result = await chatTurn(deps, { message: "/morning" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.reply, 'No Plan yet today. Type /plan (or say "plan my day") and I\'ll build it now.');
});

// ============================================================================
// Real-use fixes plan, Task 1: "plan my day" (generate) — both the slash
// command and the deterministic "plan my day" family route to planDay.
// ============================================================================

const TEST_TODAY = "2026-08-22"; // matches baseDeps()'s pinned `now` (2026-08-22T18:00:00.000Z)

function completeTask(): Task {
  return {
    id: "t1",
    title: "Draft the memo",
    createdAt: "2026-08-22T12:00:00.000Z",
    updatedAt: "2026-08-22T12:00:00.000Z",
    estimatedDurationMinutes: 30,
    area: "Work",
    dueDate: TEST_TODAY,
    status: "not-started",
    energy: "medium",
  };
}

function planDayReadyDeps(overrides: Partial<ChatTurnDeps> = {}): ChatTurnDeps {
  const store = tempStore();
  putTimeBudget(store, { date: TEST_TODAY, totalMinutes: 240, workMinutes: 70, breakMinutes: 15 });
  return baseDeps({
    store,
    readTasks: async () => [completeTask()],
    readCalendarEventsFn: async () => [],
    ...overrides,
  });
}

test("/plan dispatches to planDay and never calls the LLM client", async () => {
  const llmClient = makeFakeLlmClient();
  const deps = planDayReadyDeps({ llmClient });

  const result = await chatTurn(deps, { message: "/plan" });

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.equal((llmClient as any).calls.length, 0, "a recognized /plan command must never call the LLM client");
  assert.ok(getPlan(deps.store, TEST_TODAY), "the Plan is genuinely persisted");
});

test("chatTurn recognizes the 'plan my day' family (deterministic, zero LLM calls) and dispatches to planDay", async () => {
  for (const line of ["plan my day", "make my plan", "generate today's plan", "plan today"]) {
    const llmClient = makeFakeLlmClient();
    const deps = planDayReadyDeps({ llmClient });

    const result = await chatTurn(deps, { message: line });

    assert.ok(result.ok, `expected "${line}" to succeed`);
    if (!result.ok) continue;
    assert.match(result.value.reply, /Draft the memo/, `expected "${line}" to route to planDay's rendered Plan`);
    assert.equal((llmClient as any).calls.length, 0, `"${line}" must never call the LLM client`);
  }
});

test("a Plan-view request ('what's my plan') is never mistaken for a Plan-day (generate) request", async () => {
  const deps = planDayReadyDeps();
  const result = await chatTurn(deps, { message: "what's my plan" });
  assert.ok(result.ok);
  if (!result.ok) return;
  // isPlanViewCommand wins here (checked first) — showPlan, not planDay — so
  // nothing is generated or persisted.
  assert.equal(getPlan(deps.store, TEST_TODAY), undefined);
});

// ============================================================================
// Real-use fixes plan, Task 5: "what's happening tomorrow" (read any day) —
// the day-view recognizer, checked among the planning recognizers, and its
// two non-swallow guarantees (calendar-edit lines, and isPlanViewCommand's
// own "what's my plan" territory).
// ============================================================================

test("chatTurn recognizes 'what's happening tomorrow' deterministically (zero LLM calls) and routes to dayView for the resolved date", async () => {
  const llmClient = makeFakeLlmClient();
  const calendarCalls: string[] = [];
  const deps = baseDeps({
    llmClient,
    readCalendarEventsForDate: async (date) => {
      calendarCalls.push(date);
      return [{ id: "e1", title: "Study session", start: "2026-08-23T14:00:00.000Z", end: "2026-08-23T15:00:00.000Z" }];
    },
  });

  const result = await chatTurn(deps, { message: "what's happening tomorrow" });

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Study session/);
  assert.deepEqual(calendarCalls, ["2026-08-23"], "expected dayView to read TOMORROW's (2026-08-23) window, resolved against baseDeps' fixed 'now'/timeZone");
  assert.equal((llmClient as any).calls.length, 0, "a recognized day-view command must never call the LLM client");
});

test("chatTurn's day-view recognizer never swallows a calendar-EDIT line ('move my 3pm tomorrow to 4') — that still routes to the calendar-edit drafter", async () => {
  const llmClient = makeFakeLlmClient("NONE");
  const dayViewCalls: string[] = [];
  const deps = baseDeps({
    llmClient,
    readCalendarEventsFn: async () => [{ id: "e1", title: "3pm sync", start: "2026-08-23T19:00:00.000Z", end: "2026-08-23T20:00:00.000Z" }],
    readCalendarEventsForDate: async (date) => {
      dayViewCalls.push(date);
      return [];
    },
  });

  const result = await chatTurn(deps, {
    message: "move my 3pm tomorrow to 4",
  });

  assert.ok(result.ok);
  assert.equal(dayViewCalls.length, 0, "day-view's own Calendar read must never fire for a calendar-EDIT line");
  assert.ok((llmClient as any).calls.length >= 1, "expected the line to still reach draftCalendarEditRequest (the calendar-edit path), not dayView");
});

test("chatTurn's day-view recognizer never swallows isPlanViewCommand's own bare 'what's my plan' territory (checked first, unchanged)", async () => {
  const dayViewCalls: string[] = [];
  const deps = baseDeps({
    readCalendarEventsForDate: async (date) => {
      dayViewCalls.push(date);
      return [];
    },
  });

  const result = await chatTurn(deps, { message: "what's my plan" });

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(dayViewCalls.length, 0, "isPlanViewCommand must win first — dayView must never be reached for this exact phrase");
  assert.match(result.value.reply, /no plan/i);
});

test("chatTurn's day-view recognizer falls through to the ordinary chat path when the trailing phrase doesn't resolve to a real date", async () => {
  const llmClient = makeFakeLlmClient("Just thinking out loud.");
  const dayViewCalls: string[] = [];
  const deps = baseDeps({
    llmClient,
    readCalendarEventsForDate: async (date) => {
      dayViewCalls.push(date);
      return [];
    },
  });

  const result = await chatTurn(deps, { message: "what's on your mind" });

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(dayViewCalls.length, 0, "an unresolvable trailing phrase must never reach dayView's Calendar read");
  assert.equal(result.value.reply, "Just thinking out loud.", "expected the line to fall through to the ordinary classify/general-chat path");
});

test("/night dispatches to startNightCloseOut and surfaces its question", async () => {
  const store = tempStore();
  putPlan(store, samplePlanFixture());
  const deps = baseDeps({ store });

  const result = await chatTurn(deps, { message: "/night" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.value.question);
});

test("an unknown command gets a neutral reply listing every real command, never an error", async () => {
  const deps = baseDeps();
  const result = await chatTurn(deps, { message: "/frobnicate" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /No command named "\/frobnicate"/);
  for (const c of COMMANDS) assert.ok(result.value.reply.includes(c.name));
});

test("command matching is case-insensitive, and a trailing word after the command name is ignored", async () => {
  const store = tempStore();
  putPlan(store, samplePlanFixture());
  const deps = baseDeps({ store });
  const result = await chatTurn(deps, { message: "/MORNING please" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.doesNotMatch(result.value.reply, /No command named/);
});

// ============================================================================
// Story 8.8 (FR-26 extended): task capture. The classifier step is gone; a
// free-text task line now reaches the tool loop, which stages a create_task
// change set. An explicit "create a task ..." line still goes through
// draftItem's SAME confirm-then-write pipeline an explicit "create a task
// ..." command uses; a genuine question or an ordinary statement must never
// be captured.
// ============================================================================

/**
 * Dispatches a fake client's response by a distinguishing substring of the
 * system prompt — classifyCapture's, draftNotionPageFields',
 * draftCalendarEditRequest's, and classifyChatIntent's system prompts are
 * each worded distinctly (mirrors how each real function's own prompt
 * already reads distinctly to a human). `capture` drives classifyCapture's
 * own response ("TASK"/"EVENT"/"NONE" — real-use fixes plan, Task 2's 3-way
 * classifier); `calendarDraft` drives draftCalendarEditRequest's response,
 * for tests that exercise the "event" -> calendar-create fallback.
 */
function fakeCaptureRoutingClient(opts: {
  readonly capture?: "TASK" | "EVENT" | "NONE";
  readonly draftFields?: string;
  readonly calendarDraft?: string;
} = {}) {
  const capture = opts.capture ?? "NONE";
  const draftFields = opts.draftFields ?? "title=Lab report draft";
  const calendarDraft = opts.calendarDraft ?? "NONE";
  const calls: any[] = [];
  return {
    calls,
    messages: {
      create: async (params: any) => {
        calls.push(params);
        // Real-use fixes plan, Task 9: `params.system` is now an ARRAY of
        // `TextBlockParam`s (a cache-control breakpoint lives on one of
        // them), not a bare string — join every block's own `.text` to get
        // back the same plain text this fixture always matched against.
        const system: string = typeof params.system === "string" ? params.system : (params.system ?? []).map((b: { text: string }) => b.text).join("\n");
        const text = system.includes("task/event-capture classifier")
          ? capture
          : system.includes("structured draft for a new")
            ? draftFields
            : system.includes("structured Calendar edit")
              ? calendarDraft
              : "GENERAL";
        return {
          id: "msg_test",
          container: null,
          content: [{ type: "text", text, citations: null }],
          model: "test-model",
          role: "assistant",
          stop_details: null,
          stop_reason: "end_turn",
          stop_sequence: null,
          type: "message",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null, service_tier: null },
        };
      },
    },
  } as unknown as AnthropicMessagesClient & { readonly calls: any[] };
}

/** A minimal real-shaped `NotionCreatePageClient` fake for the Tasks database (mirrors `tests/create-item.test.ts`'s own `fakeTasksClient` fixture — `isFullDataSource` needs every one of these fields, not just `properties`). */
function fakeTasksNotionCreateClient() {
  const schema = {
    object: "data_source",
    id: "tasks-ds",
    title: [],
    description: [],
    parent: { type: "database_id", database_id: "tasks-ds-db" },
    database_parent: { type: "database_id", database_id: "tasks-ds-db" },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: "2026-08-01T09:00:00.000Z",
    last_edited_time: "2026-08-01T09:00:00.000Z",
    created_by: { object: "user", id: "user-1" },
    last_edited_by: { object: "user", id: "user-1" },
    icon: null,
    cover: null,
    url: "https://notion.so/tasks-ds",
    public_url: null,
    properties: {
      Name: { id: "title", name: "Name", description: null, type: "title", title: {} },
    },
  } as any;
  return {
    dataSources: { retrieve: async () => schema },
    pages: { create: async () => ({ object: "page", id: "new-page-id", url: "https://notion.so/new-page-id" }) as any },
  };
}

test("a free-text task description reaches the tool loop, which stages a create_task change set", async () => {
  const { client, loopCalls } = toolLoopClient([
    [{ type: "tool_use", id: "1", name: "create_task", input: { title: "Lab report draft", dueDate: "2026-08-27" } }],
    [{ type: "text", text: "Staged." }],
  ]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "Lab report draft, due Thursday" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(loopCalls().length, 2);
  const proposal = result.value.question?.proposal as { kind?: string; suggested?: { items: { kind: string }[] } } | undefined;
  assert.equal(proposal?.kind, "change-set");
  assert.equal(proposal?.suggested?.items[0]?.kind, "create-task");
});

test("chatTurn does NOT capture a question — it falls through to the ordinary chat/search path", async () => {
  const llmClient = fakeCaptureRoutingClient({ capture: "NONE" });
  const deps = baseDeps({ llmClient });
  const result = await chatTurn(deps, {
    message: "What's my next meeting?",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined);
});

test("chatTurn does NOT capture an ordinary statement", async () => {
  const llmClient = fakeCaptureRoutingClient({ capture: "NONE" });
  const deps = baseDeps({ llmClient });
  const result = await chatTurn(deps, {
    message: "That lecture ran long today.",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined);
});

test("chatTurn's capture check runs AFTER every deterministic recognizer — an explicit time-budget line never reaches any LLM call, capture included", async () => {
  const llmClient = fakeCaptureRoutingClient({ capture: "NONE" });
  const deps = baseDeps({ llmClient });
  await chatTurn(deps, { message: "time budget 6h" });
  assert.equal((llmClient as any).calls.length, 0, "a deterministic time-budget line must never reach any LLM call, capture included");
});

// ============================================================================
// Real-use fixes plan, Task 2: calendar requests create calendar events,
// never a Notion Task. The incident: "make a event at 10:45 am tommorow to
// meet with alex. itll go for an hour and a half" fell through the old,
// narrower isCalendarEditCommand trigger and was captured as a Notion Task
// whose Due Date ended up as the literal (unresolved) text "tomorrow at
// 10:45 AM". These pin the fix at chatTurn's own dispatch level: the
// broadened deterministic recognizer catches the incident line and its
// siblings BEFORE any LLM call, each with a correct ISO start/end for a
// fixed `now`/timeZone; "Lab report draft, due Thursday" (no calendar shape
// at all) now reaches the tool loop (classifyCapture no longer runs).
// ============================================================================

/** A fake LLM client that only ever answers draftCalendarEditRequest's own CREATE line — every other call (there should be none, for a line the deterministic recognizer catches) throws, so an accidental capture-classifier call surfaces loudly instead of silently. */
function fakeCalendarCreateClient(createLine: string) {
  const calls: any[] = [];
  return {
    calls,
    messages: {
      create: async (params: any) => {
        calls.push(params);
        const system: string = typeof params.system === "string" ? params.system : (params.system ?? []).map((b: { text: string }) => b.text).join("\n");
        if (!system.includes("structured Calendar edit")) {
          throw new Error(`unexpected LLM call for a deterministically-recognized calendar line — system prompt: ${system.slice(0, 80)}`);
        }
        return {
          id: "msg_test",
          container: null,
          content: [{ type: "text", text: createLine, citations: null }],
          model: params.model,
          role: "assistant",
          stop_details: null,
          stop_reason: "end_turn",
          stop_sequence: null,
          type: "message",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null, service_tier: null },
        };
      },
    },
  } as unknown as AnthropicMessagesClient & { readonly calls: any[] };
}

// baseDeps()'s pinned `now` (2026-08-22T18:00:00.000Z) is 2026-08-22 14:00
// local in America/New_York (EDT) — Saturday, so "today" = 2026-08-22 and
// "tomorrow" = 2026-08-23 (Sunday) for every line below.
test("the broadened deterministic calendar recognizer routes the incident line and its siblings straight to calendar create — zero LLM calls beyond draftCalendarEditRequest itself, with a correct ISO start/end", async () => {
  const cases: ReadonlyArray<{ readonly message: string; readonly createLine: string; readonly start: string; readonly end: string }> = [
    {
      message: "make a event at 10:45 am tommorow to meet with alex. itll go for an hour and a half",
      createLine: "CREATE: Meet with Alex | 2026-08-23T14:45:00.000Z | 2026-08-23T16:15:00.000Z | EXPLICIT",
      start: "2026-08-23T14:45:00.000Z",
      end: "2026-08-23T16:15:00.000Z",
    },
    {
      message: "schedule a meeting with Alex tomorrow at 3",
      createLine: "CREATE: Meeting with Alex | 2026-08-23T19:00:00.000Z | 2026-08-23T20:00:00.000Z | ASSUMED",
      start: "2026-08-23T19:00:00.000Z",
      end: "2026-08-23T20:00:00.000Z",
    },
    {
      message: "add dentist appointment Friday 2pm",
      createLine: "CREATE: Dentist appointment | 2026-08-28T18:00:00.000Z | 2026-08-28T19:00:00.000Z | ASSUMED",
      start: "2026-08-28T18:00:00.000Z",
      end: "2026-08-28T19:00:00.000Z",
    },
    {
      message: "put a study block at 4 today",
      createLine: "CREATE: Study block | 2026-08-22T20:00:00.000Z | 2026-08-22T21:00:00.000Z | ASSUMED",
      start: "2026-08-22T20:00:00.000Z",
      end: "2026-08-22T21:00:00.000Z",
    },
    {
      message: "create an event for coffee with Sam tomorrow at 9am",
      createLine: "CREATE: Coffee with Sam | 2026-08-23T13:00:00.000Z | 2026-08-23T14:00:00.000Z | ASSUMED",
      start: "2026-08-23T13:00:00.000Z",
      end: "2026-08-23T14:00:00.000Z",
    },
  ];

  for (const { message, createLine, start, end } of cases) {
    const llmClient = fakeCalendarCreateClient(createLine);
    const deps = baseDeps({
      llmClient,
      readCalendarEventsFn: async () => [],
      proposeNewCalendarEventFn: (change) => ({
        id: `calendar-create-${change.title}`,
        kind: "calendar-edit",
        entityId: "new-event",
        entityVersion: "new",
        suggested: { kind: "create", calendarId: change.calendarId, title: change.title, start: change.start, end: change.end },
        reason: "adapter reason",
        createdAt: "2026-08-22T18:00:00.000Z",
      }),
    });

    const result = await chatTurn(deps, { message });

    assert.equal(result.ok, true, `expected "${message}" to succeed`);
    if (!result.ok) continue;
    assert.ok(result.value.question, `expected "${message}" to open a calendar-create confirm question`);
    const proposal = result.value.question!.proposal as { readonly suggested: { readonly kind: string; readonly start: string; readonly end: string } };
    assert.equal(proposal.suggested.kind, "create");
    assert.equal(proposal.suggested.start, start, `expected "${message}" to resolve to the correct ISO start`);
    assert.equal(proposal.suggested.end, end, `expected "${message}" to resolve to the correct ISO end`);
    assert.equal((llmClient as any).calls.length, 1, `expected exactly one LLM call (draftCalendarEditRequest) for "${message}" — the deterministic recognizer must short-circuit classifyCapture`);
    // The system prompt gets today's host-TZ date and timezone, not the browser/UTC clock.
    const rawSystem = (llmClient as any).calls[0].system;
    const system: string = typeof rawSystem === "string" ? rawSystem : (rawSystem ?? []).map((b: { text: string }) => b.text).join("\n");
    assert.match(system, /2026-08-22/, `expected "${message}"'s draft call to be anchored on today's host-TZ date`);
    assert.match(system, /America\/New_York/);
  }
});

function throwingLlmClient(): AnthropicMessagesClient {
  return {
    messages: {
      create: (async () => {
        throw new Error("unexpected LLM call for a deterministically-recognized line");
      }) as AnthropicMessagesClient["messages"]["create"],
    },
  };
}

test("'add a task to email Alex tomorrow', 'create a project for the science fair', and 'remind me to call Alex' do NOT route to Calendar", async () => {
  const cases: ReadonlyArray<{ readonly message: string; readonly capture: "TASK" | "NONE" }> = [
    { message: "add a task to email Alex tomorrow", capture: "TASK" },
    { message: "create a project for the science fair", capture: "TASK" },
    { message: "remind me to call Alex", capture: "TASK" },
  ];
  for (const { message, capture } of cases) {
    const llmClient = fakeCaptureRoutingClient({ capture });
    const deps = baseDeps({
      llmClient,
      getNotionCreatePageBinding: () => ({
        ok: true,
        value: {
          client: fakeTasksNotionCreateClient(),
          config: { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds", researchVaultDataSourceId: "vault-ds" },
        },
      }),
    });

    const result = await chatTurn(deps, { message });

    assert.equal(result.ok, true, `expected "${message}" to succeed`);
    if (!result.ok) continue;
    if (result.value.question) {
      const proposal = result.value.question.proposal as { readonly kind?: string; readonly suggested?: { readonly kind?: string } } | undefined;
      assert.notEqual(proposal?.suggested?.kind, "create", `expected "${message}" NOT to open a calendar-create confirm question`);
      assert.notEqual(proposal?.suggested?.kind, "move", `expected "${message}" NOT to open a calendar-edit confirm question`);
    }
  }
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

  const result = await chatTurn(deps, { message: "/morning" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.reply.includes("[object Object]"), false);
  assert.equal(/"kind"\s*:/.test(result.value.reply), false, "no raw JSON of a Proposal leaks into the chat reply");
});

// ============================================================================
// Story 9.2: /sandbox in chat — dispatches to sandboxQueue/firstCardView,
// never the LLM client.
// ============================================================================

function tasksMissingDueDate(): Task[] {
  return [
    {
      id: "t1",
      title: "Chem problem set",
      estimatedDurationMinutes: 45,
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z",
    },
  ];
}

test("/sandbox with a non-empty queue returns the first card as ChatTurnResponse.sandboxCard, empty reply, no LLM call", async () => {
  const llmClient = makeFakeLlmClient();
  const deps = baseDeps({ readTasks: async () => tasksMissingDueDate(), llmClient });
  const result = await chatTurn(deps, { message: "/sandbox" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "");
  assert.deepEqual(result.value.sandboxCard, {
    taskId: "t1",
    taskTitle: "Chem problem set",
    estimatedDurationMinutes: 45,
    remaining: 0,
    options: { area: [], energy: [] },
  });
  assert.equal((llmClient as any).calls.length, 0, "a recognized /sandbox command must never call the LLM client");
});

// Review Focus #5 — an empty queue must never carry a falsy-but-present sandboxCard.
test("/sandbox with an empty queue replies plainly and carries NO sandboxCard key at all (Review Focus #5)", async () => {
  const deps = baseDeps({ readTasks: async () => [] });
  const result = await chatTurn(deps, { message: "/sandbox" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "Nothing's missing a Due Date or Duration.");
  assert.equal("sandboxCard" in result.value, false);
});

test("/sandbox is case-insensitive and ignores a trailing word, matching every other slash command", async () => {
  const deps = baseDeps({ readTasks: async () => tasksMissingDueDate() });
  const result = await chatTurn(deps, { message: "/SANDBOX please" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.sandboxCard);
});

test("an unparseable plan-change request gets the how-to reply, with zero LLM calls and no Task draft", async () => {
  const deps = baseDeps({ llmClient: throwingLlmClient() });
  const result = await chatTurn(deps, { message: "can you update my plan" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, PLAN_EDIT_HOW_TO_REPLY);
  assert.equal(result.value.question, undefined);
});

// ============================================================================
// Epic 10 (T4b): "I'm behind" previews before applying; a blocker still
// re-flows immediately.
// ============================================================================

function reshuffleFixture() {
  const now = new Date("2026-08-22T18:00:00.000Z");
  const iso = (mins: number): string => new Date(now.getTime() + mins * 60_000).toISOString();
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-22", totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  const plan: Plan = {
    id: "plan-2026-08-22", date: "2026-08-22", version: 1, reasoning: "x", createdAt: iso(-60), updatedAt: iso(-60),
    blocks: [{ id: "v1-work-1", kind: "work", start: iso(30), end: iso(60), label: "Future", taskId: "t2" }],
  };
  putPlan(store, plan);
  const tasks = ["t2", "t3"].map((id) => ({
    id, title: id, createdAt: iso(-60), updatedAt: iso(-60), estimatedDurationMinutes: 30, area: "Work",
    dueDate: "2026-08-22", status: "not-started", energy: "medium",
  })) as Task[];
  return { store, plan, deps: baseDeps({ store, now: () => now, readTasks: async () => tasks, readCalendarEventsFn: async () => [] }) };
}

test("chatTurn: \"I'm behind\" returns an Approve/Discard question and writes no Plan", async () => {
  const { store, plan, deps } = reshuffleFixture();
  const result = await chatTurn(deps, { message: "I'm behind" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.value.question?.options.map((o) => o.label), ["Approve", "Discard"]);
  assert.equal(result.value.question?.proposal?.kind, "reshuffle");
  assert.deepEqual(getPlan(store, "2026-08-22")?.data, plan);
});

test("chatTurn: a blocker report still re-flows immediately, with no preview", async () => {
  const { store, deps } = reshuffleFixture();
  const result = await chatTurn(deps, { message: "something came up" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined);
});

// ============================================================================
// Epic 10 (T7): chat plan edits preview before applying
// ============================================================================

function planEditFixture(opts: { withPlan?: boolean } = {}) {
  const now = new Date("2026-08-22T18:00:00.000Z");
  const iso = (mins: number): string => new Date(now.getTime() + mins * 60_000).toISOString();
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initRoutineStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  putTimeBudget(store, { date: "2026-08-22", totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  if (opts.withPlan !== false) {
    putPlan(store, {
      id: "plan-2026-08-22", date: "2026-08-22", version: 1, reasoning: "x", createdAt: iso(-60), updatedAt: iso(-60),
      blocks: [
        { id: "v1-work-0", kind: "work", start: iso(30), end: iso(60), label: "History labs", taskId: "t-labs" },
        { id: "v1-work-1", kind: "work", start: iso(90), end: iso(120), label: "Math set", taskId: "t-math" },
        { id: "v1-work-2", kind: "work", start: iso(150), end: iso(180), label: "Math quiz prep", taskId: "t-quiz" },
      ],
    });
  }
  const titles: Record<string, string> = { "t-labs": "History labs", "t-math": "Math set", "t-quiz": "Math quiz prep", "t-poster": "Indigenous poster" };
  const tasks = Object.entries(titles).map(([id, title]) => ({
    id, title, createdAt: iso(-60), updatedAt: iso(-60), estimatedDurationMinutes: 30, area: "Work",
    dueDate: "2026-08-22", status: "not-started", energy: "medium",
  })) as Task[];
  return { store, deps: baseDeps({ store, connection, now: () => now, readTasks: async () => tasks, readCalendarEventsFn: async () => [], llmClient: throwingLlmClient() }) };
}

test("chatTurn: \"work on X instead of Y\" previews a swap as Approve/Discard", async () => {
  const { store, deps } = planEditFixture();
  const result = await chatTurn(deps, { message: "work on the poster instead of the labs" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.value.question?.options.map((o) => o.label), ["Approve", "Discard"]);
  assert.deepEqual((result.value.question?.proposal?.suggested as { request: unknown })?.request, { kind: "swap", addTaskId: "t-poster", removeTaskId: "t-labs" });
  assert.equal(getPlan(store, "2026-08-22")?.data.version, 1);
});

test("chatTurn: \"drop X today\" and \"unpin X\" preview; \"move X after lunch\" previews a move", async () => {
  const cases: [string, unknown][] = [
    ["drop the labs today", { kind: "drop-task", taskId: "t-labs" }],
    ["unpin history labs", { kind: "unpin-task", taskId: "t-labs" }],
  ];
  for (const [message, request] of cases) {
    const { deps } = planEditFixture();
    const result = await chatTurn(deps, { message });
    assert.ok(result.ok, message);
    if (!result.ok) return;
    assert.deepEqual((result.value.question?.proposal?.suggested as { request: unknown })?.request, request, message);
  }
  const { deps } = planEditFixture();
  const moved = await chatTurn(deps, { message: "move the labs to 8pm" });
  assert.ok(moved.ok);
  if (!moved.ok) return;
  assert.ok(moved.value.question, moved.value.reply);
  assert.equal(((moved.value.question?.proposal?.suggested as { request: { kind: string } })).request.kind, "move-block");
});

test("chatTurn: an ambiguous plan-edit name asks which, listing up to three titles", async () => {
  const { deps } = planEditFixture();
  const result = await chatTurn(deps, { message: "drop math today" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined);
  assert.match(result.value.reply, /Math set/);
  assert.match(result.value.reply, /Math quiz prep/);
});

test("chatTurn: an unknown plan-edit name says it couldn't find it", async () => {
  const { deps } = planEditFixture();
  const result = await chatTurn(deps, { message: "drop the unicorn today" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.reply, "I couldn't find unicorn in today's Plan.");
});

test("chatTurn: plan edits and re-flow with no Plan today reply plainly instead of erroring", async () => {
  for (const message of ["drop the labs today", "I'm behind"]) {
    const { deps } = planEditFixture({ withPlan: false });
    const result = await chatTurn(deps, { message });
    assert.ok(result.ok, message);
    if (!result.ok) return;
    assert.equal(result.value.reply, "There's no Plan for today yet. Say \"plan my day\" to make one.", message);
  }
});

test("chatTurn: a routine line still routes to routines, not plan edits", async () => {
  const { deps } = planEditFixture();
  const result = await chatTurn(deps, { message: "my study block is 3-3:30 on weekdays" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined);
  assert.notEqual(result.value.reply, PLAN_EDIT_HOW_TO_REPLY);
  assert.match(result.value.reply, /study block/i);
  const listed = await chatTurn(deps, { message: "what are my routines" });
  assert.ok(listed.ok);
  if (listed.ok) assert.match(listed.value.reply, /study block/i);
});

test("chatTurn: a plan edit the refit rejects replies with the reason, opens no proposal, and is not an error", async () => {
  const { store, deps } = planEditFixture();
  const busy = [{ id: "e1", title: "Dentist", start: "2026-08-22T00:00:00.000Z", end: "2026-08-23T12:00:00.000Z" }];
  const result = await chatTurn({ ...deps, readCalendarEventsFn: async () => busy }, { message: "move the labs to 8pm" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined);
  assert.match(result.value.reply, /Dentist/);
  assert.equal(getPlan(store, "2026-08-22")?.data.version, 1);
});

test("chatTurn falls back to just the current message when the chat store throws on read", async () => {
  const llmClient = makeFakeLlmClient("answer");
  const logged: string[] = [];
  const chatHistory = {
    appendTurn: () => { throw new Error("boom"); },
    turnsForDate: () => { throw new Error("boom"); },
    clearAll: () => {},
    hasUserTurnAfter: () => false, getTurn: () => undefined, searchTurns: () => [], listConversations: () => [], conversationTurns: () => undefined, deleteConversation: () => false,
  } as ChatStore;
  const result = await chatTurn(baseDeps({ llmClient, chatHistory, log: (e) => logged.push(e.event) }), { message: "what should I do about the dishes" });
  assert.equal(result.ok, true);
  const sent = (llmClient as any).calls[0].messages as ReadonlyArray<{ role: string; content: string | ReadonlyArray<{ text: string }> }>;
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.role, "user");
  assert.ok(logged.includes("chat-turn.history-read-failed"));
});

test("chatTurn without a chat store sends just the current message as history", async () => {
  const llmClient = makeFakeLlmClient("answer");
  await chatTurn(baseDeps({ llmClient }), { message: "what should I do about the dishes" });
  const sent = (llmClient as any).calls[0].messages as ReadonlyArray<{ role: string }>;
  assert.equal(sent.length, 1);
});

test("history for the model always ends with the current message, even when the user-turn write failed", async () => {
  const llmClient = makeFakeLlmClient("answer");
  const prior = seededChatStore([{ role: "user", text: "earlier" }, { role: "assistant", text: "reply" }]);
  const chatHistory = { appendTurn: () => { throw new Error("boom"); }, turnsForDate: prior.turnsForDate, clearAll: () => {}, hasUserTurnAfter: () => false, getTurn: () => undefined, searchTurns: () => [], listConversations: () => [], conversationTurns: () => undefined, deleteConversation: () => false } as ChatStore;
  await chatTurn(baseDeps({ llmClient, chatHistory }), { message: "what should I do about the dishes" });
  const sent = (llmClient as any).calls[0].messages as ReadonlyArray<{ role: string; content: string | ReadonlyArray<{ text: string }> }>;
  const norm = sent.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content[0]!.text }));
  assert.deepEqual(norm.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(norm[2]!.content, "what should I do about the dishes");
});

test("consecutive same-role stored turns (an orphaned user turn) are merged before going to the model", async () => {
  const llmClient = makeFakeLlmClient("answer");
  const chatHistory = seededChatStore([
    { role: "user", text: "first" },
    { role: "user", text: "what should I do about the dishes" },
  ]);
  await chatTurn(baseDeps({ llmClient, chatHistory }), { message: "what should I do about the dishes" });
  const sent = (llmClient as any).calls[0].messages as ReadonlyArray<{ role: string; content: string | ReadonlyArray<{ text: string }> }>;
  assert.equal(sent.length, 1);
  const c = sent[0]!.content;
  assert.equal(typeof c === "string" ? c : c[0]!.text, "first\n\nwhat should I do about the dishes");
});

test("Story 13.5: handledDeterministically is set for a slash command and unset once an LLM classification step runs", async () => {
  const slash = await chatTurn(baseDeps({ llmClient: makeFakeLlmClient("x") }), { message: "/nonexistent" });
  assert.ok(slash.ok && slash.value.handledDeterministically === true);
  const general = await chatTurn(baseDeps({ llmClient: makeFakeLlmClient("Reheat it.") }), { message: "what should I do about the dishes" });
  assert.ok(general.ok && general.value.handledDeterministically === undefined);
});

// Story 13.6: memory reaches only the general answer, and a store that throws never blocks it.
test("chatTurn general answer carries always-loaded memory in the tool loop's call", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  memoryItems.insert({ folder: "about-you", text: "Prefers plain words", origin: "stated" });
  const llmClient = makeFakeLlmClient("Do them tonight.");
  const result = await chatTurn(baseDeps({ llmClient, memoryItems }), { message: "what should I do about the dishes" });
  assert.equal(result.ok, true);
  const calls = (llmClient as any).calls as any[];
  assert.equal(calls.length, 1);
  const has = (c: any) => JSON.stringify(c.system).includes("Prefers plain words");
  assert.deepEqual(calls.map(has), [true]);
  connection.close();
});

test("chatTurn answers without memory when the memory store throws", async () => {
  const llmClient = makeFakeLlmClient("Do them tonight.");
  const memoryItems = { listItems: () => { throw new Error("store down"); } } as never;
  const result = await chatTurn(baseDeps({ llmClient, memoryItems }), { message: "what should I do about the dishes" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reply, "Do them tonight.");
});

// ---- Story 13.11: which turns are substantive ----
test("substantive: /morning, /plan, a researched answer and a tool turn are marked; a plain loop answer is not", async () => {
  const store = tempStore();
  putPlan(store, samplePlanFixture());
  const morning = await chatTurn(baseDeps({ llmClient: makeFakeLlmClient(), store }), { message: "/morning" });
  assert.ok(morning.ok && morning.value.substantive === true);
  const plan = await chatTurn(planDayReadyDeps({ llmClient: makeFakeLlmClient() }), { message: "/plan" });
  assert.ok(plan.ok && plan.value.substantive === true);
  const searched = await chatTurn(
    baseDeps({ llmClient: makeFakeLlmClient("GENERAL"), searchFn: async () => ({ ok: true, value: { answer: "Fall.", citations: [] } }) }),
    { message: "search: AP Bio registration deadline" },
  );
  assert.ok(searched.ok && searched.value.substantive === true);
  const chat = await chatTurn(baseDeps({ llmClient: makeFakeLlmClient("GENERAL") }), { message: "how are you" });
  assert.ok(chat.ok && !("substantive" in chat.value), "a plain loop answer with no tool call is not substantive (P12)");
  const { client } = toolLoopClient([[{ type: "tool_use", id: "1", name: "list_tasks", input: {} }], [{ type: "text", text: "Nothing open." }]]);
  const withTool = await chatTurn(baseDeps({ llmClient: client, readTasks: async () => [] }), { message: "how many tasks do I have" });
  assert.ok(withTool.ok && withTool.value.substantive === true, "a turn that ran a tool is substantive");
});

test("Story 13.13: /morning carries the day's Pattern question as `question`; a second /morning the same day does not", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  const store = createMemoryStore(connection);
  const createdAt = "2026-08-21T12:00:00.000Z";
  const proposal = { id: "pattern-m", kind: "pattern", entityId: "area-overrun:History", entityVersion: "new", suggested: { kind: "area-overrun", area: "History", occurrences: 5, paddingMinutes: 30 }, reason: "h\ne\nPlan for that?", createdAt };
  putOpenInteractionRequest(store, "proposal:pattern-m", { requestKind: "proposal", promptText: proposal.reason, detail: { proposal, cursor: { questionId: "confirm" } }, createdAt });
  memoryItems.putPatternState({ kind: "area-overrun", area: "History", pendingProposalId: "pattern-m" });
  const deps = baseDeps({ store, memoryItems });

  const first = await chatTurn(deps, { message: "/morning" });
  assert.ok(first.ok);
  if (first.ok) assert.equal(first.value.question?.requestId, "proposal:pattern-m");
  const second = await chatTurn(deps, { message: "/morning" });
  assert.ok(second.ok);
  if (second.ok) assert.equal(second.value.question, undefined);
  connection.close();
});

test("a bare yes or discard while a change set is open points at the card: zero model calls, no write, not substantive", async () => {
  const llmClient = makeFakeLlmClient();
  const store = tempStore();
  putOpenInteractionRequest(store, "proposal:cs", {
    requestKind: "proposal",
    promptText: "Here's what I'd change:",
    detail: { proposal: { id: "cs", kind: "change-set", entityId: "chat", entityVersion: "", suggested: { items: [{ kind: "plan-day" }] }, reason: "r", createdAt: "2026-08-22T12:00:00.000Z" }, cursor: { questionId: "confirm" } },
    createdAt: "2026-08-22T12:00:00.000Z",
  });
  const deps = baseDeps({ llmClient, store });
  for (const message of ["yes", "Approve", "no", "discard"]) {
    const result = await chatTurn(deps, { message });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.reply, "Use Approve or Discard on the card above.");
    assert.equal(result.value.substantive, undefined);
    assert.deepEqual(result.value.receipts, []);
  }
  assert.equal((llmClient as any).calls.length, 0);
  assert.ok(getOpenInteractionRequest(store, "proposal:cs"), "the card stays open");
});

test("a bare yes with only an earlier day's change set open does not point at a card that is no longer shown", async () => {
  const store = tempStore();
  const createdAt = "2026-08-20T12:00:00.000Z";
  putOpenInteractionRequest(store, "proposal:cs", {
    requestKind: "proposal",
    promptText: "Here's what I'd change:",
    detail: { proposal: { id: "cs", kind: "change-set", entityId: "chat", entityVersion: "", suggested: { items: [{ kind: "plan-day" }] }, reason: "r", createdAt }, cursor: { questionId: "confirm" } },
    createdAt,
  });
  const result = await chatTurn(baseDeps({ llmClient: makeFakeLlmClient(), store }), { message: "yes" });
  assert.notEqual(result.ok && result.value.reply, "Use Approve or Discard on the card above.");
});

// ---- Story 11.3: /research queues a background job ----
function researchDeps(over: Partial<ChatTurnDeps> = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initJobStoreSchema(connection.db);
  const llm = makeFakeLlmClient();
  let searchCalls = 0;
  const deps = baseDeps({
    connection,
    llmClient: llm as unknown as AnthropicMessagesClient,
    searchFn: async () => {
      searchCalls++;
      return { ok: true, value: { answer: "x", citations: [] } };
    },
    ...over,
  });
  const jobs = () => (connection.db.prepare("SELECT question, status FROM research_jobs").all() as Array<{ question: string; status: string }>).map((r) => ({ ...r }));
  return { deps, llm, jobs, searchCalls: () => searchCalls };
}
const vaultReady = { getNotionCreatePageBinding: () => ({ ok: true as const, value: { client: {} as never, config: { researchVaultDataSourceId: "ds" } as never } }) };

test("/research queues a job, acknowledges, and never searches or calls a model", async () => {
  const t = researchDeps(vaultReady);
  const r = await chatTurn(t.deps, { message: "/research best budget laptops for college" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.reply, "Queued. You'll get a notification when it's on Research Hub.");
  assert.deepEqual(t.jobs(), [{ question: "best budget laptops for college", status: "queued" }]);
  assert.equal(t.llm.calls.length, 0);
  assert.equal(t.searchCalls(), 0);
});

test("/research with no question, no vault, or no search replies plainly and queues nothing", async () => {
  const empty = researchDeps(vaultReady);
  const a = await chatTurn(empty.deps, { message: "/research" });
  assert.ok(a.ok && a.value.reply === "Say what to research, like /research best budget laptops for college.");
  const noVault = researchDeps();
  const b = await chatTurn(noVault.deps, { message: "/research laptops" });
  assert.ok(b.ok && b.value.reply === "The Research Vault isn't set up yet, so there's nowhere to file research.");
  const noSearch = researchDeps({ ...vaultReady, webSearchAvailable: false });
  const c = await chatTurn(noSearch.deps, { message: "/research laptops" });
  assert.ok(c.ok && c.value.reply === "Web search isn't set up yet (it needs a Perplexity key).");
  assert.deepEqual([empty.jobs(), noVault.jobs(), noSearch.jobs()], [[], [], []]);
  assert.equal(empty.llm.calls.length + noVault.llm.calls.length + noSearch.llm.calls.length, 0);
});

// ---- Story 11.4: a research-sized message gets a one-time offer ----
function researchOfferDeps(t: ReturnType<typeof researchDeps>) {
  return { connection: t.deps.connection!, webSearchAvailable: true, getNotionCreatePageBinding: vaultReady.getNotionCreatePageBinding, now: () => new Date("2026-08-22T18:00:00.000Z") };
}

test("a research-sized message gets a Yes/No offer: no model call, no search, nothing queued", async () => {
  const t = researchDeps(vaultReady);
  const r = await chatTurn(t.deps, { message: "give me a deep dive on heat pumps" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.question?.text, "Do you want to do research on this?");
  assert.deepEqual(r.value.question?.options.map((o) => o.label), ["Yes", "No"]);
  assert.equal(r.value.question?.allowsFreeText, false);
  assert.equal(r.value.question?.proposal?.kind, "research-offer");
  assert.deepEqual(r.value.question?.proposal?.suggested, { question: "give me a deep dive on heat pumps" });
  assert.equal(t.llm.calls.length, 0);
  assert.equal(t.searchCalls(), 0);
  assert.deepEqual(t.jobs(), []);
});

test("an imperative 'research X' line offers first and searches at once only when sent a second time", async () => {
  const t = researchDeps(vaultReady);
  const first = await chatTurn(t.deps, { message: "research best budget laptops" });
  assert.ok(first.ok && first.value.question?.proposal?.kind === "research-offer");
  assert.equal(t.searchCalls(), 0);
  const second = await chatTurn(t.deps, { message: "  Research   best budget laptops " });
  assert.ok(second.ok);
  assert.equal(t.searchCalls(), 1);
  assert.equal(t.jobs().length, 0);
});

test("answering Yes to the offer queues exactly one job; No queues nothing", async () => {
  const t = researchDeps(vaultReady);
  const offer = await chatTurn(t.deps, { message: "pros and cons of nuclear power" });
  assert.ok(offer.ok && offer.value.question);
  const q = offer.value.question!;
  const yes = await confirmProposal({ store: t.deps.store, research: researchOfferDeps(t) }, { proposal: q.proposal!, accept: true, requestId: q.requestId });
  assert.ok(yes.ok);
  assert.equal(yes.ok && yes.value.message, "Queued. You'll get a notification when it's on Research Hub.");
  assert.deepEqual(t.jobs(), [{ question: "pros and cons of nuclear power", status: "queued" }]);

  const t2 = researchDeps(vaultReady);
  const offer2 = await chatTurn(t2.deps, { message: "pros and cons of nuclear power" });
  assert.ok(offer2.ok && offer2.value.question);
  const q2 = offer2.value.question!;
  const no = await confirmProposal({ store: t2.deps.store }, { proposal: q2.proposal!, accept: false, requestId: q2.requestId });
  assert.ok(no.ok);
  assert.equal(no.ok && no.value.message, "Okay. Nothing queued.");
  assert.deepEqual(t2.jobs(), []);
});

test("Yes with no research deps replies that research is unavailable and queues nothing", async () => {
  const t = researchDeps(vaultReady);
  const offer = await chatTurn(t.deps, { message: "pros and cons of nuclear power" });
  assert.ok(offer.ok && offer.value.question);
  const q = offer.value.question!;
  const yes = await confirmProposal({ store: t.deps.store }, { proposal: q.proposal!, accept: true, requestId: q.requestId });
  assert.equal(yes.ok && yes.value.message, "Background research isn't available right now.");
  assert.deepEqual(t.jobs(), []);
});

test("an offer still open for the same question falls through to the normal path", async () => {
  const t = researchDeps(vaultReady);
  const a = await chatTurn(t.deps, { message: "research best budget laptops" });
  assert.ok(a.ok && a.value.question);
  t.deps.session.researchOffered.clear(); // e.g. a restart: the session forgot, the store did not
  const b = await chatTurn(t.deps, { message: "research best budget laptops" });
  assert.ok(b.ok);
  assert.equal(b.ok && b.value.question, undefined);
  assert.equal(t.searchCalls(), 1);
});

test("plain factual questions get no offer", async () => {
  const t = researchDeps(vaultReady);
  const r = await chatTurn(t.deps, { message: "what's the latest AI news" });
  assert.ok(r.ok && r.value.question === undefined);
  assert.equal(t.searchCalls(), 1);
});

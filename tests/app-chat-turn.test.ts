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
import { createMemoryStore, getCurrentTimeBudget, getPlan, putOpenInteractionRequest, putPlan, putTimeBudget, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { CALENDAR_DELETE_NOT_SUPPORTED_REPLY, chatTurn, MAX_CHAT_HISTORY_TURNS, STATUS_THINKING, type ChatTurnDeps } from "../src/app/chat-turn.ts";
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

test("chatTurn falls through to answerQuestion for an unmatched line, costing exactly three LLM calls (chatTurn's own classifyCapture, then classifyChatIntent, then answerQuestion's own call)", async () => {
  const llmClient = makeFakeLlmClient("It's sunny where you are, probably.");
  const deps = baseDeps({ llmClient });

  const result = await chatTurn(deps, { message: "what's the weather", history: [{ role: "user", content: "what's the weather" }] });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "It's sunny where you are, probably.");
  assert.equal(
    (llmClient as any).calls.length,
    3,
    "expected exactly three Claude calls for the unmatched input: classifyCapture, classifyChatIntent, then the general-qa answer",
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

  await chatTurn(deps, { message: "turn-49", history: longHistory });

  // calls[0] is chatTurn's own classifyCapture call, calls[1]
  // is its classifyChatIntent call (Story 8.4, sent only the current line,
  // not the history); calls[2] is answerQuestion's own call, the one this
  // test is actually about.
  const sentMessages = (llmClient as any).calls[2].messages as ReadonlyArray<{ role: string; content: string }>;
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

  // calls[0] is classifyCapture, calls[1] is classifyChatIntent, calls[2] is answerQuestion (see the test above).
  const sentMessages = (llmClient as any).calls[2].messages as ReadonlyArray<{ role: string; content: string }>;
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
  // returns the empty fall-through convention -> classifyCapture (also
  // "NONE") -> classifyChatIntent (also "NONE", not "SEARCH: ...",
  // so GENERAL) -> answerQuestion, which answers with this same fake
  // client's fixed response text.
  assert.equal(result.value.reply, "NONE");
  assert.equal(
    (llmClient as any).calls.length,
    4,
    "expected draftCalendarEditRequest, then classifyCapture, then classifyChatIntent, then answerQuestion — the empty fall-through must never be handed back to Spencer as a real (blank) answer",
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

test("/morning with no Plan yet points Spencer at /plan (real-use fixes plan, Task 1) — it still never generates a Plan itself (FR-1)", async () => {
  const deps = baseDeps();
  const result = await chatTurn(deps, { message: "/morning", history: [] });
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

  const result = await chatTurn(deps, { message: "/plan", history: [] });

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

    const result = await chatTurn(deps, { message: line, history: [] });

    assert.ok(result.ok, `expected "${line}" to succeed`);
    if (!result.ok) continue;
    assert.match(result.value.reply, /Draft the memo/, `expected "${line}" to route to planDay's rendered Plan`);
    assert.equal((llmClient as any).calls.length, 0, `"${line}" must never call the LLM client`);
  }
});

test("a Plan-view request ('what's my plan') is never mistaken for a Plan-day (generate) request", async () => {
  const deps = planDayReadyDeps();
  const result = await chatTurn(deps, { message: "what's my plan", history: [] });
  assert.ok(result.ok);
  if (!result.ok) return;
  // isPlanViewCommand wins here (checked first) — showPlan, not planDay — so
  // nothing is generated or persisted.
  assert.equal(getPlan(deps.store, TEST_TODAY), undefined);
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

// ============================================================================
// Story 8.8 (FR-26 extended): capture detection — inserted after every
// deterministic recognizer, before classifyChatIntent. A hit routes through
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
        const system = typeof params.system === "string" ? params.system : "";
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

test("chatTurn routes a captured Task description through draftItem's Tasks-database path, not general chat", async () => {
  const llmClient = fakeCaptureRoutingClient({ capture: "TASK" });
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

  const result = await chatTurn(deps, { message: "Lab report draft, due Thursday", history: [] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.question?.text ?? "", /Here's what I'll create in Tasks/);
  assert.deepEqual(
    result.value.question?.options.map((o) => o.label),
    ["Create", "Cancel"],
  );
});

test("chatTurn does NOT capture a question — it falls through to the ordinary chat/search path", async () => {
  const llmClient = fakeCaptureRoutingClient({ capture: "NONE" });
  const deps = baseDeps({ llmClient });
  const result = await chatTurn(deps, {
    message: "What's my next meeting?",
    history: [{ role: "user", content: "What's my next meeting?" }],
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
    history: [{ role: "user", content: "That lecture ran long today." }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined);
});

test("chatTurn's capture check runs AFTER every deterministic recognizer — an explicit time-budget line never reaches any LLM call, capture included", async () => {
  const llmClient = fakeCaptureRoutingClient({ capture: "NONE" });
  const deps = baseDeps({ llmClient });
  await chatTurn(deps, { message: "time budget 6h", history: [] });
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
// at all) still routes to a Task via classifyCapture.
// ============================================================================

/** A fake LLM client that only ever answers draftCalendarEditRequest's own CREATE line — every other call (there should be none, for a line the deterministic recognizer catches) throws, so an accidental capture-classifier call surfaces loudly instead of silently. */
function fakeCalendarCreateClient(createLine: string) {
  const calls: any[] = [];
  return {
    calls,
    messages: {
      create: async (params: any) => {
        calls.push(params);
        const system = typeof params.system === "string" ? params.system : "";
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

    const result = await chatTurn(deps, { message, history: [] });

    assert.equal(result.ok, true, `expected "${message}" to succeed`);
    if (!result.ok) continue;
    assert.ok(result.value.question, `expected "${message}" to open a calendar-create confirm question`);
    const proposal = result.value.question!.proposal as { readonly suggested: { readonly kind: string; readonly start: string; readonly end: string } };
    assert.equal(proposal.suggested.kind, "create");
    assert.equal(proposal.suggested.start, start, `expected "${message}" to resolve to the correct ISO start`);
    assert.equal(proposal.suggested.end, end, `expected "${message}" to resolve to the correct ISO end`);
    assert.equal((llmClient as any).calls.length, 1, `expected exactly one LLM call (draftCalendarEditRequest) for "${message}" — the deterministic recognizer must short-circuit classifyCapture`);
    // The system prompt gets today's host-TZ date and timezone, not the browser/UTC clock.
    const system = (llmClient as any).calls[0].system as string;
    assert.match(system, /2026-08-22/, `expected "${message}"'s draft call to be anchored on today's host-TZ date`);
    assert.match(system, /America\/New_York/);
  }
});

test("'Lab report draft, due Thursday' still routes to a Task, not a calendar event — no calendar shape at all", async () => {
  const llmClient = fakeCaptureRoutingClient({ capture: "TASK" });
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

  const result = await chatTurn(deps, { message: "Lab report draft, due Thursday", history: [] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.question?.text ?? "", /Here's what I'll create in Tasks/);
  const proposal = result.value.question!.proposal as { readonly kind: string };
  assert.equal(proposal.kind, "notion-page-draft");
});

test("classifyCapture's 'event' outcome is the backstop for a calendar-shaped line that slips past the deterministic recognizer — it still routes to calendar create, never a Task", async () => {
  const llmClient = fakeCaptureRoutingClient({
    capture: "EVENT",
    calendarDraft: "CREATE: Dinner with Jamie | 2026-08-23T23:00:00.000Z | 2026-08-24T00:00:00.000Z | ASSUMED",
  });
  const deps = baseDeps({
    llmClient,
    readCalendarEventsFn: async () => [],
    proposeNewCalendarEventFn: (change) => ({
      id: "calendar-create-1",
      kind: "calendar-edit",
      entityId: "new-event",
      entityVersion: "new",
      suggested: { kind: "create", calendarId: change.calendarId, title: change.title, start: change.start, end: change.end },
      reason: "adapter reason",
      createdAt: "2026-08-22T18:00:00.000Z",
    }),
  });

  // Deliberately outside isCalendarEditCommand's own trigger shapes (no
  // create-verb-at-start, no event/meeting/appointment/call/block noun, no
  // "meet with"/"meeting with") — this is exactly the free-text case
  // classifyCapture's "event" outcome exists to catch.
  const result = await chatTurn(deps, { message: "dinner with Jamie tomorrow night", history: [] });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.question, "expected the 'event' classification to open a calendar-create confirm question");
  const proposal = result.value.question!.proposal as { readonly suggested: { readonly kind: string } };
  assert.equal(proposal.suggested.kind, "create");
});

test("classifyCapture's 'event' outcome falls through to general chat (never a blank reply) when draftCalendarEditRequest itself comes back NONE", async () => {
  const llmClient = fakeCaptureRoutingClient({ capture: "EVENT", calendarDraft: "NONE" });
  const deps = baseDeps({ llmClient, readCalendarEventsFn: async () => [] });

  const result = await chatTurn(deps, {
    message: "dinner with Jamie tomorrow night",
    history: [{ role: "user", content: "dinner with Jamie tomorrow night" }],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined);
  assert.notEqual(result.value.reply, "", "a double-miss (event, then NONE draft) must never surface a blank reply");
});

// ============================================================================
// Post-review fix, Important #1 (AD-13): a cancel/delete/remove/clear
// Calendar request gets a plain, honest reply — no draft, and (this is the
// point of the fix) no LLM call at all, not even classifyCapture's own
// "event" backstop. A fake LLM client that throws on ANY call proves this.
// ============================================================================

function throwingLlmClient(): AnthropicMessagesClient {
  return {
    messages: {
      create: (async () => {
        throw new Error("unexpected LLM call for a deterministically-recognized cancel/delete request");
      }) as AnthropicMessagesClient["messages"]["create"],
    },
  };
}

test("a cancel/delete/remove Calendar request gets a plain 'can't delete' reply, with zero LLM calls and no draft", async () => {
  for (const message of ["delete my meeting with Alex tomorrow at 3", "cancel the meeting with Alex tomorrow", "remove my meeting with Alex at 3pm"]) {
    const deps = baseDeps({ llmClient: throwingLlmClient() });

    const result = await chatTurn(deps, { message, history: [] });

    assert.equal(result.ok, true, `expected "${message}" to succeed`);
    if (!result.ok) continue;
    assert.equal(result.value.reply, CALENDAR_DELETE_NOT_SUPPORTED_REPLY, `expected "${message}" to get the plain can't-delete reply`);
    assert.equal(result.value.question, undefined, `expected "${message}" to open no draft/confirm question`);
  }
});

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

    const result = await chatTurn(deps, { message, history: [] });

    assert.equal(result.ok, true, `expected "${message}" to succeed`);
    if (!result.ok) continue;
    assert.notEqual(result.value.reply, CALENDAR_DELETE_NOT_SUPPORTED_REPLY, `expected "${message}" NOT to get the can't-delete reply`);
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

  const result = await chatTurn(deps, { message: "/morning", history: [] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.reply.includes("[object Object]"), false);
  assert.equal(/"kind"\s*:/.test(result.value.reply), false, "no raw JSON of a Proposal leaks into the chat reply");
});

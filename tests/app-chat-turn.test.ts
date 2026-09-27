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
import { createMemoryStore, getCurrentTimeBudget, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { chatTurn, MAX_CHAT_HISTORY_TURNS, STATUS_THINKING, type ChatTurnDeps } from "../src/app/chat-turn.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import type { ChatSession } from "../src/app/chat-session.ts";
import type { ChatStreamEvent } from "../src/types/api.ts";
import type { ChatTurn, Task } from "../src/types/domain.ts";

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
    ...overrides,
  };
}

// ============================================================================
// Dispatch order: a recognized command never calls the LLM client at all;
// an unmatched line costs exactly one LLM call (answerQuestion's — chatTurn
// itself never calls classifyChatIntent).
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

test("chatTurn falls through to answerQuestion for an unmatched line, costing exactly one LLM call", async () => {
  const llmClient = makeFakeLlmClient("It's sunny where you are, probably.");
  const deps = baseDeps({ llmClient });

  const result = await chatTurn(deps, { message: "what's the weather", history: [{ role: "user", content: "what's the weather" }] });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "It's sunny where you are, probably.");
  assert.equal((llmClient as any).calls.length, 1, "chatTurn itself must never call classifyChatIntent — only answerQuestion's own call");
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

  const sentMessages = (llmClient as any).calls[0].messages as ReadonlyArray<{ role: string; content: string }>;
  assert.equal(sentMessages.length, MAX_CHAT_HISTORY_TURNS);
  assert.deepEqual(sentMessages, longHistory.slice(longHistory.length - MAX_CHAT_HISTORY_TURNS));
  assert.equal(sentMessages[0]!.role, "user", "trimming must remove complete pairs, never leaving an assistant turn first");
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

/**
 * Tests for `src/app/general-question.ts` (Story 8.3).
 *
 * Moved+adapted from `tests/chat-cli.test.ts`'s Tone/model-routing/error
 * unit tests (minus the `classifyChatIntent` call-counting, which belongs to
 * `chat-turn.ts` — see `tests/app-chat-turn.test.ts`), plus new streaming
 * tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion } from "../src/app/general-question.ts";
import { CLAUDE_CHAT_MODEL_CAPABLE, CLAUDE_CHAT_MODEL_FAST, type AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { COMMANDS } from "../src/app/commands.ts";
import { resolveToneSystemPrompt } from "../src/core/tone.ts";
import type { ChatStreamEvent } from "../src/types/api.ts";

/** Real-use fixes plan, Task 9: `params.system` is now an ARRAY of `TextBlockParam`s (a cache-control breakpoint lives on one of them), not a bare string — join every block's own `.text` to recover the plain text these assertions compare against `resolveToneSystemPrompt`'s own output. */
function systemText(system: unknown): string {
  if (typeof system === "string") return system;
  return ((system as ReadonlyArray<{ text: string }>) ?? []).map((b) => b.text).join("\n");
}

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

test("answerQuestion (non-streaming) returns Claude's real response", async () => {
  const llmClient = makeFakeLlmClient("It's sunny where you are, probably.");
  const result = await answerQuestion({ llmClient }, { message: "what's the weather", history: [{ role: "user", content: "what's the weather" }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "It's sunny where you are, probably.");
  assert.deepEqual(result.value.receipts, []);
});

test("answerQuestion passes core/tone.ts's resolveToneSystemPrompt(message) as the systemPrompt", async () => {
  const llmClient = makeFakeLlmClient("hey yourself");
  await answerQuestion({ llmClient }, { message: "hey, what's up", history: [{ role: "user", content: "hey, what's up" }] });
  assert.equal(systemText(llmClient.calls[0]!.system), resolveToneSystemPrompt("hey, what's up", true, COMMANDS));
});

test("an ordinary casual message routes to CLAUDE_CHAT_MODEL_FAST (Haiku)", async () => {
  const llmClient = makeFakeLlmClient("hey yourself");
  await answerQuestion({ llmClient }, { message: "hey, what's up", history: [{ role: "user", content: "hey, what's up" }] });
  assert.equal(llmClient.calls[0]!.model, CLAUDE_CHAT_MODEL_FAST);
});

test("a factual/analytical message escalates to CLAUDE_CHAT_MODEL_CAPABLE (Sonnet)", async () => {
  const llmClient = makeFakeLlmClient("TCP is connection-oriented; UDP is not.");
  await answerQuestion(
    { llmClient },
    { message: "What's the difference between TCP and UDP?", history: [{ role: "user", content: "What's the difference between TCP and UDP?" }] },
  );
  assert.equal(llmClient.calls[0]!.model, CLAUDE_CHAT_MODEL_CAPABLE);
});

test("catches a thrown error from the Claude call and returns it as a Result, never a rejection", async () => {
  const llmClient = {
    messages: {
      create: async () => {
        throw new Error("simulated API failure");
      },
    },
  } as unknown as AnthropicMessagesClient;
  const result = await answerQuestion({ llmClient }, { message: "what's the weather", history: [{ role: "user", content: "what's the weather" }] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  // Task 4 (real-use fixes plan): never the raw thrown message — a plain,
  // honest sentence from `core/error-copy.ts` instead.
  assert.equal(result.error.message, "I couldn't reach Claude right now; nothing was changed.");
  assert.doesNotMatch(result.error.message, /simulated API failure/);
});

test("with emit present, answerQuestion streams deltas and returns the concatenated full reply", async () => {
  const llmClient = makeFakeLlmClient("Two plus two is four.");
  const events: ChatStreamEvent[] = [];
  const result = await answerQuestion(
    { llmClient, emit: (e) => events.push(e) },
    { message: "what's 2+2", history: [{ role: "user", content: "what's 2+2" }] },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "Two plus two is four. ");
  assert.ok(events.every((e) => e.type === "delta"), "answerQuestion must never itself emit a status/done/error event");
  assert.ok(events.length > 1, "expected more than one delta chunk");
});

test("with no emit, answerQuestion never calls the streaming path", async () => {
  const llmClient = makeFakeLlmClient("hi");
  await answerQuestion({ llmClient }, { message: "hi", history: [{ role: "user", content: "hi" }] });
  assert.equal(llmClient.calls[0]!.stream, undefined);
});

// ============================================================================
// Review fix (real-use fixes plan, Task 5 fix, FR-42): webSearchAvailable
// threading — defaults to true (unchanged prior behavior) when omitted, and
// the capability text must actually change when it's explicitly false.
// ============================================================================

test("answerQuestion defaults webSearchAvailable to true when omitted, matching resolveToneSystemPrompt's own default", async () => {
  const llmClient = makeFakeLlmClient("hey yourself");
  await answerQuestion({ llmClient }, { message: "hey, what's up", history: [{ role: "user", content: "hey, what's up" }] });
  assert.equal(systemText(llmClient.calls[0]!.system), resolveToneSystemPrompt("hey, what's up", true, COMMANDS));
});

test("answerQuestion passes webSearchAvailable: false through to resolveToneSystemPrompt, so the capability text says search isn't set up", async () => {
  const llmClient = makeFakeLlmClient("hey yourself");
  await answerQuestion({ llmClient, webSearchAvailable: false }, { message: "hey, what's up", history: [{ role: "user", content: "hey, what's up" }] });
  assert.equal(systemText(llmClient.calls[0]!.system), resolveToneSystemPrompt("hey, what's up", false, COMMANDS));
  assert.match(systemText(llmClient.calls[0]!.system), /web search isn't set up yet/i);
});

test("answerQuestion sends a first system block that names /remember, and passes memory blocks after it", async () => {
  const client = makeFakeLlmClient();
  const memory = {
    always: [{ id: "m1", folder: "about-you", text: "Senior at SAAS", origin: "stated", ruleChange: "none", status: "current", createdAt: "2026-09-01T00:00:00.000Z", confirmedAt: "2026-09-01T00:00:00.000Z" }],
    relevant: [],
  } as const;
  const result = await answerQuestion({ llmClient: client }, { message: "hey", history: [{ role: "user", content: "hey" }], memory: memory as never });
  assert.equal(result.ok, true);
  const system = client.calls[0].system as Array<{ text: string }>;
  assert.match(system[0]!.text, /\/remember/);
  assert.equal(system.length, 2);
  assert.match(system[1]!.text, /Senior at SAAS/);
});

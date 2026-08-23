/**
 * Tests for `src/adapters/llm-adapter.ts` (Story 2.1 / Task 13).
 *
 * No live Claude API key is available in this environment, so every test
 * injects a fake `AnthropicMessagesClient` (the adapter's injectable-client
 * seam) rather than hitting the real network — the same pattern
 * `notification-adapter.ts`'s `FetchLike` and `notion-adapter.ts`'s
 * `NotionDataSourceClient` already use. The fake's response shape mirrors
 * `@anthropic-ai/sdk`'s real `Message`/`TextBlock` types (checked directly
 * against `node_modules/@anthropic-ai/sdk`'s `.d.ts` files rather than
 * guessed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  answerGeneralQuestion,
  loadLlmAdapterConfigFromEnv,
  CLAUDE_CHAT_MODEL,
  type AnthropicMessagesClient,
} from "../src/adapters/llm-adapter.ts";

/** A minimal real-shaped `Anthropic.Message` carrying a single text block. */
function textMessage(text: string): Anthropic.Message {
  return {
    id: "msg_test",
    container: null,
    content: [{ type: "text", text, citations: null }],
    model: CLAUDE_CHAT_MODEL,
    role: "assistant",
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    } as Anthropic.Usage,
  };
}

interface RecordedCall {
  readonly params: Anthropic.MessageCreateParamsNonStreaming;
}

function fakeClient(response: Anthropic.Message | (() => Anthropic.Message)): {
  readonly calls: RecordedCall[];
  readonly client: AnthropicMessagesClient;
} {
  const calls: RecordedCall[] = [];
  const client: AnthropicMessagesClient = {
    messages: {
      create: async (params) => {
        calls.push({ params });
        return typeof response === "function" ? response() : response;
      },
    },
  };
  return { calls, client };
}

// ============================================================================
// answerGeneralQuestion — the real Claude call (injectable client)
// ============================================================================

test("answerGeneralQuestion calls the injected client's messages.create and returns Claude's text, not a placeholder", async () => {
  const { calls, client } = fakeClient(textMessage("Paris is the capital of France."));

  const response = await answerGeneralQuestion(client, "what's the capital of France");

  assert.equal(calls.length, 1, "expected exactly one Claude call");
  assert.equal(response, "Paris is the capital of France.");
  assert.doesNotMatch(response, /free-text routing arrives in a later task/);
});

test("answerGeneralQuestion sends the input as the user turn and a model/system prompt", async () => {
  const { calls, client } = fakeClient(textMessage("An answer."));

  await answerGeneralQuestion(client, "what time is it in Tokyo");

  const params = calls[0]!.params;
  assert.equal(params.model, CLAUDE_CHAT_MODEL);
  assert.ok(params.max_tokens > 0);
  assert.deepEqual(params.messages, [{ role: "user", content: "what time is it in Tokyo" }]);
  assert.ok(typeof params.system === "string" && params.system.length > 0);
});

test("answerGeneralQuestion accepts an overriding system prompt (Task 14's Tone integration seam)", async () => {
  const { calls, client } = fakeClient(textMessage("An answer."));

  await answerGeneralQuestion(client, "hello", "Custom tone instruction.");

  assert.equal(calls[0]!.params.system, "Custom tone instruction.");
});

test("answerGeneralQuestion throws (AD-8) rather than returning an empty string when Claude returns no text content", async () => {
  const { client } = fakeClient(() => ({ ...textMessage(""), content: [] }));

  await assert.rejects(() => answerGeneralQuestion(client, "hello"));
});

test("answerGeneralQuestion propagates a rejected client call unchanged (AD-8)", async () => {
  const client: AnthropicMessagesClient = {
    messages: {
      create: async () => {
        throw new Error("simulated network failure");
      },
    },
  };

  await assert.rejects(() => answerGeneralQuestion(client, "hello"), /simulated network failure/);
});

test("answerGeneralQuestion still returns a real response for a general/factual question with no matching specific intent (never errors/refuses)", async () => {
  const { client } = fakeClient(textMessage("Water boils at 100°C at sea level."));

  const response = await answerGeneralQuestion(client, "at what temperature does water boil");

  assert.ok(response.length > 0);
});

// ============================================================================
// loadLlmAdapterConfigFromEnv — config loading (AD-10)
// ============================================================================

test("loadLlmAdapterConfigFromEnv reads CLAUDE_API_KEY", () => {
  const config = loadLlmAdapterConfigFromEnv({ CLAUDE_API_KEY: "sk-test-123" });
  assert.equal(config.apiKey, "sk-test-123");
});

test("loadLlmAdapterConfigFromEnv throws when CLAUDE_API_KEY is missing", () => {
  assert.throws(() => loadLlmAdapterConfigFromEnv({}), /CLAUDE_API_KEY/);
});

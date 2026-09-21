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
  classifyChatIntent,
  draftCalendarEditRequest,
  draftNotionPageFields,
  loadLlmAdapterConfigFromEnv,
  suggestFieldValue,
  CLAUDE_CHAT_MODEL,
  type AnthropicMessagesClient,
} from "../src/adapters/llm-adapter.ts";
import type { FieldValueSuggestion } from "../src/types/domain.ts";

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

// ============================================================================
// suggestFieldValue (Story 6.2 / FR-25)
// ============================================================================

test("suggestFieldValue never calls the client when there are no recent messages to look at", async () => {
  const { calls, client } = fakeClient(textMessage("NONE"));
  const result = await suggestFieldValue(client, "t1", "Call dentist", "area", []);
  assert.equal(result, undefined);
  assert.equal(calls.length, 0);
});

test("suggestFieldValue returns a FieldValueSuggestion for a CONFIDENT response with a value that parses for the field", async () => {
  const { client } = fakeClient(textMessage("CONFIDENT: 30 | Spencer said it'll take about half an hour"));
  const result = await suggestFieldValue(
    client,
    "t1",
    "Call dentist",
    "estimatedDurationMinutes",
    ["that dentist call will take about half an hour"],
  );
  assert.deepEqual(result, {
    taskId: "t1",
    taskTitle: "Call dentist",
    field: "estimatedDurationMinutes",
    value: 30,
    reason: "Spencer said it'll take about half an hour",
  } satisfies FieldValueSuggestion);
});

test("suggestFieldValue returns undefined for a plain NONE response", async () => {
  const { client } = fakeClient(textMessage("NONE"));
  const result = await suggestFieldValue(client, "t1", "Call dentist", "area", ["unrelated chatter"]);
  assert.equal(result, undefined);
});

test("suggestFieldValue never trusts a CONFIDENT value that doesn't parse for the field's real type", async () => {
  const { client } = fakeClient(textMessage("CONFIDENT: sometime soon | vague timing mention"));
  const result = await suggestFieldValue(client, "t1", "Call dentist", "dueDate", ["I'll do it sometime soon"]);
  assert.equal(result, undefined);
});

test("suggestFieldValue sends the joined recent messages and mentions the Task/field in its system prompt", async () => {
  const { calls, client } = fakeClient(textMessage("NONE"));
  await suggestFieldValue(client, "t1", "Call dentist", "energy", ["msg one", "msg two"]);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.params.system as string, /Call dentist/);
  assert.equal(calls[0]!.params.messages[0]?.content, "msg one\nmsg two");
});

// ============================================================================
// draftNotionPageFields (Story 6.3 / FR-26)
// ============================================================================

test("draftNotionPageFields parses key=value lines into a field map", async () => {
  const { client } = fakeClient(textMessage("title=Buy hiking boots\narea=Errands\nestimatedDurationMinutes=30"));
  const result = await draftNotionPageFields(client, "Tasks", "add a task to buy hiking boots, errands, 30 min");
  assert.deepEqual(result, { title: "Buy hiking boots", area: "Errands", estimatedDurationMinutes: "30" });
});

test("draftNotionPageFields returns undefined when Claude extracts no title", async () => {
  const { client } = fakeClient(textMessage("area=Errands"));
  const result = await draftNotionPageFields(client, "Tasks", "something about errands");
  assert.equal(result, undefined);
});

test("draftNotionPageFields returns undefined for a response with no parseable key=value lines at all", async () => {
  const { client } = fakeClient(textMessage("I'm not sure what you mean."));
  const result = await draftNotionPageFields(client, "Tasks", "uhh");
  assert.equal(result, undefined);
});

test("draftNotionPageFields mentions the target database in its system prompt", async () => {
  const { calls, client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "ResearchVault", "research vault entry about hiking boots");
  assert.match(calls[0]!.params.system as string, /ResearchVault|Research Vault/);
});

// ============================================================================
// classifyChatIntent (Story 6.4 / FR-28)
// ============================================================================

test("classifyChatIntent returns a search-trigger intent with the extracted query for a SEARCH response", async () => {
  const { client } = fakeClient(textMessage("SEARCH: best noise canceling earbuds under $150"));
  const result = await classifyChatIntent(client, "search for the best noise canceling earbuds under $150");
  assert.deepEqual(result, { kind: "search-trigger", query: "best noise canceling earbuds under $150" });
});

test("classifyChatIntent returns a general-question intent for a GENERAL response", async () => {
  const { client } = fakeClient(textMessage("GENERAL"));
  const result = await classifyChatIntent(client, "how's it going");
  assert.deepEqual(result, { kind: "general-question" });
});

test("classifyChatIntent defaults to general-question for any unrecognized response shape, never throwing", async () => {
  const { client } = fakeClient(textMessage("I'm not sure."));
  const result = await classifyChatIntent(client, "hmm");
  assert.deepEqual(result, { kind: "general-question" });
});

// ============================================================================
// draftCalendarEditRequest (Story 6.6 / FR-27)
// ============================================================================

test("draftCalendarEditRequest parses a MOVE response into a structured move request", async () => {
  const { client } = fakeClient(textMessage("MOVE: Team sync | 2026-09-18T18:00:00.000Z"));
  const result = await draftCalendarEditRequest(client, "move team sync to 6pm", "2026-09-18", "America/New_York", []);
  assert.deepEqual(result, { kind: "move", eventTitle: "Team sync", newStart: "2026-09-18T18:00:00.000Z" });
});

test("draftCalendarEditRequest parses a RESIZE response", async () => {
  const { client } = fakeClient(textMessage("RESIZE: Team sync | 2026-09-18T17:30:00.000Z"));
  const result = await draftCalendarEditRequest(client, "extend team sync to 5:30", "2026-09-18", "America/New_York", []);
  assert.deepEqual(result, { kind: "resize", eventTitle: "Team sync", newEnd: "2026-09-18T17:30:00.000Z" });
});

test("draftCalendarEditRequest parses a CREATE response", async () => {
  const { client } = fakeClient(textMessage("CREATE: Focus block | 2026-09-18T14:00:00.000Z | 2026-09-18T15:00:00.000Z"));
  const result = await draftCalendarEditRequest(client, "block off 2-3pm for focus time", "2026-09-18", "America/New_York", []);
  assert.deepEqual(result, { kind: "create", title: "Focus block", start: "2026-09-18T14:00:00.000Z", end: "2026-09-18T15:00:00.000Z" });
});

test("draftCalendarEditRequest returns undefined for a NONE response", async () => {
  const { client } = fakeClient(textMessage("NONE"));
  const result = await draftCalendarEditRequest(client, "hmm", "2026-09-18", "America/New_York", []);
  assert.equal(result, undefined);
});

test("draftCalendarEditRequest rejects an unparseable/invalid ISO datetime rather than trusting it", async () => {
  const { client } = fakeClient(textMessage("MOVE: Team sync | not a real time"));
  const result = await draftCalendarEditRequest(client, "move team sync", "2026-09-18", "America/New_York", []);
  assert.equal(result, undefined);
});

test("draftCalendarEditRequest gives Claude today's date, timezone, and candidate events in its system prompt", async () => {
  const { calls, client } = fakeClient(textMessage("NONE"));
  await draftCalendarEditRequest(client, "move standup", "2026-09-18", "America/New_York", [
    { title: "Standup", start: "2026-09-18T13:00:00.000Z", end: "2026-09-18T13:15:00.000Z" },
  ]);
  const system = calls[0]!.params.system as string;
  assert.match(system, /2026-09-18/);
  assert.match(system, /America\/New_York/);
  assert.match(system, /Standup/);
});

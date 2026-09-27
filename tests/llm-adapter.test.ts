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
  classifyCapture,
  classifyChatIntent,
  draftCalendarEditRequest,
  draftNotionPageFields,
  loadLlmAdapterConfigFromEnv,
  normalizeQuickAddLine,
  streamGeneralQuestion,
  suggestFieldValue,
  CLAUDE_CHAT_MODEL_CAPABLE,
  CLAUDE_CHAT_MODEL_FAST,
  type AnthropicMessagesClient,
  type QuickAddLiveOptions,
} from "../src/adapters/llm-adapter.ts";
import { initLlmUsageStoreSchema, listLlmUsage } from "../src/adapters/llm-usage-store.ts";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { parsePlanningFieldValue } from "../src/core/planning-field-value.ts";
import type { ChatTurn, FieldValueSuggestion, PlanningFieldNames, Task } from "../src/types/domain.ts";

/**
 * Real-use fixes plan, Task 9: every function in `llm-adapter.ts` now
 * sends `system` as an ARRAY of `TextBlockParam`s (so a cache breakpoint
 * can be pinned on a specific block) rather than a bare string. This
 * extracts the equivalent plain text for the pre-existing assertions below
 * that only ever cared about the WORDS, not the cache-control wrapper —
 * joining every block's own `.text` reproduces exactly what the old plain
 * `system: string` used to read as.
 */
function systemText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  const system = params.system;
  if (typeof system === "string") return system;
  return (system ?? []).map((block) => block.text).join("\n");
}

/** A fresh in-memory `SqliteConnection` with `llm_usage` already created — the real usage-recording tests below pass this as the new trailing `connection` argument and read back through `listLlmUsage`. */
function fakeUsageConnection(): SqliteConnection {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initLlmUsageStoreSchema(connection.db);
  return connection;
}

/** A single-turn `ChatTurn[]` history — the shape most `answerGeneralQuestion` tests need, now that it takes real conversation history instead of a bare string. */
function oneTurn(content: string): ChatTurn[] {
  return [{ role: "user", content }];
}

/** A minimal real-shaped `Anthropic.Message` carrying a single text block. */
function textMessage(text: string): Anthropic.Message {
  return {
    id: "msg_test",
    container: null,
    content: [{ type: "text", text, citations: null }],
    model: CLAUDE_CHAT_MODEL_FAST,
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

  // Overloaded to match `AnthropicMessagesClient.messages.create`'s widened
  // (Story 8.3) shape exactly — this fake never actually streams, but must
  // still satisfy the streaming overload structurally.
  function create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  function create(params: Anthropic.MessageCreateParamsStreaming): Promise<AsyncIterable<Anthropic.RawMessageStreamEvent>>;
  async function create(
    params: Anthropic.MessageCreateParamsNonStreaming | Anthropic.MessageCreateParamsStreaming,
  ): Promise<Anthropic.Message | AsyncIterable<Anthropic.RawMessageStreamEvent>> {
    calls.push({ params: params as Anthropic.MessageCreateParamsNonStreaming });
    return typeof response === "function" ? response() : response;
  }

  const client: AnthropicMessagesClient = { messages: { create } };
  return { calls, client };
}

/**
 * The real production wrapper `shell/chat-cli.ts` injects into
 * `suggestFieldValue` (Epic 6 retro item 7) — using the REAL
 * `parsePlanningFieldValue` here, rather than a synthetic per-test fake,
 * proves the actual FR-25 <-> FR-4 integration contract, not just
 * `suggestFieldValue`'s own internal dispatch logic.
 */
function realParseValue(field: PlanningFieldNames, raw: string): NonNullable<Task[PlanningFieldNames]> | undefined {
  const parsed = parsePlanningFieldValue(field, raw);
  return parsed.ok ? (parsed.value as NonNullable<Task[PlanningFieldNames]>) : undefined;
}

// ============================================================================
// answerGeneralQuestion — the real Claude call (injectable client)
// ============================================================================

test("answerGeneralQuestion calls the injected client's messages.create and returns Claude's text, not a placeholder", async () => {
  const { calls, client } = fakeClient(textMessage("Paris is the capital of France."));

  const response = await answerGeneralQuestion(client, oneTurn("what's the capital of France"));

  assert.equal(calls.length, 1, "expected exactly one Claude call");
  assert.equal(response, "Paris is the capital of France.");
  assert.doesNotMatch(response, /free-text routing arrives in a later task/);
});

test("answerGeneralQuestion sends the given ChatTurn history verbatim as messages, plus a model/system prompt, defaulting to the fast (Haiku) model", async () => {
  const { calls, client } = fakeClient(textMessage("An answer."));

  await answerGeneralQuestion(client, oneTurn("what time is it in Tokyo"));

  const params = calls[0]!.params;
  assert.equal(params.model, CLAUDE_CHAT_MODEL_FAST);
  assert.ok(params.max_tokens > 0);
  assert.deepEqual(params.messages, [
    { role: "user", content: [{ type: "text", text: "what time is it in Tokyo", cache_control: { type: "ephemeral" } }] },
  ]);
  assert.ok(systemText(params).length > 0);
});

test("answerGeneralQuestion sends the given model override (2026-09-22 revision — situational escalation to Sonnet)", async () => {
  const { calls, client } = fakeClient(textMessage("An answer."));

  await answerGeneralQuestion(client, oneTurn("what time is it in Tokyo"), undefined, CLAUDE_CHAT_MODEL_CAPABLE);

  assert.equal(calls[0]!.params.model, CLAUDE_CHAT_MODEL_CAPABLE);
});

test("answerGeneralQuestion sends a multi-turn history as real prior conversation, not just the last line (2026-09-22 revision — the memory fix)", async () => {
  const { calls, client } = fakeClient(textMessage("Yes, I wrote it."));

  const history: ChatTurn[] = [
    { role: "user", content: "Quiz 1 — Energy: high" },
    { role: "assistant", content: "Got it — thanks. I'll factor that in next time I plan." },
    { role: "user", content: "have you written the data to notion" },
  ];
  await answerGeneralQuestion(client, history);

  assert.deepEqual(calls[0]!.params.messages, [
    { role: "user", content: "Quiz 1 — Energy: high" },
    { role: "assistant", content: "Got it — thanks. I'll factor that in next time I plan." },
    // Real-use fixes plan, Task 9: only the LAST turn carries the
    // conversation-history cache breakpoint (see `toCacheableMessages`) —
    // everything earlier is sent unchanged, as a plain string.
    { role: "user", content: [{ type: "text", text: "have you written the data to notion", cache_control: { type: "ephemeral" } }] },
  ]);
});

test("answerGeneralQuestion rejects an empty history — there is always at least the current turn by the time chat-cli.ts calls this", async () => {
  const { client } = fakeClient(textMessage("An answer."));

  await assert.rejects(() => answerGeneralQuestion(client, []));
});

test("answerGeneralQuestion accepts an overriding system prompt (Task 14's Tone integration seam)", async () => {
  const { calls, client } = fakeClient(textMessage("An answer."));

  await answerGeneralQuestion(client, oneTurn("hello"), "Custom tone instruction.");

  assert.equal(systemText(calls[0]!.params), "Custom tone instruction.");
});

test("answerGeneralQuestion throws (AD-8) rather than returning an empty string when Claude returns no text content", async () => {
  const { client } = fakeClient(() => ({ ...textMessage(""), content: [] }));

  await assert.rejects(() => answerGeneralQuestion(client, oneTurn("hello")));
});

test("answerGeneralQuestion propagates a rejected client call unchanged (AD-8)", async () => {
  const client: AnthropicMessagesClient = {
    messages: {
      create: async () => {
        throw new Error("simulated network failure");
      },
    },
  };

  await assert.rejects(() => answerGeneralQuestion(client, oneTurn("hello")), /simulated network failure/);
});

test("answerGeneralQuestion still returns a real response for a general/factual question with no matching specific intent (never errors/refuses)", async () => {
  const { client } = fakeClient(textMessage("Water boils at 100°C at sea level."));

  const response = await answerGeneralQuestion(client, oneTurn("at what temperature does water boil"));

  assert.ok(response.length > 0);
});

// ============================================================================
// answerGeneralQuestion — prompt caching + usage recording (real-use fixes
// plan, Task 9). The growing chat history is cached turn to turn: only the
// LAST message of `messages` carries the cache breakpoint, so a turn's
// shared prefix (every earlier message) is exactly what a PRIOR call
// already sent — byte-identical, so it can be read from cache — while only
// the newest message is new content.
// ============================================================================

test("answerGeneralQuestion's system prompt is sent as one cacheable block", async () => {
  const { calls, client } = fakeClient(textMessage("An answer."));
  await answerGeneralQuestion(client, oneTurn("hello"));
  const system = calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.ok(Array.isArray(system));
  assert.equal(system.length, 1);
  assert.deepEqual(system[0]!.cache_control, { type: "ephemeral" });
});

test("answerGeneralQuestion's cached history prefix is byte-identical across two consecutive turns", async () => {
  const first = fakeClient(textMessage("Got it."));
  const turn1: ChatTurn[] = [{ role: "user", content: "Quiz 1 — Energy: high" }];
  await answerGeneralQuestion(first.client, turn1);

  const second = fakeClient(textMessage("Yes, I wrote it."));
  const turn2: ChatTurn[] = [
    { role: "user", content: "Quiz 1 — Energy: high" },
    { role: "assistant", content: "Got it — thanks." },
    { role: "user", content: "have you written the data to notion" },
  ];
  await answerGeneralQuestion(second.client, turn2);

  // The system prompt (the OTHER half of the cacheable prefix, per
  // Anthropic's `tools -> system -> messages` render order) is byte-stable
  // across both calls — it never embeds a date (Task 9's own requirement).
  assert.deepEqual(first.calls[0]!.params.system, second.calls[0]!.params.system);

  // Turn 2's shared prefix (every message except the newest) reproduces
  // turn 1's own messages verbatim, text-for-text — the only difference is
  // WHICH message now carries the cache_control breakpoint (turn 1: the
  // first/only message; turn 2: the new last message), which is metadata,
  // not model input.
  const textOf = (m: Anthropic.MessageParam): string => (typeof m.content === "string" ? m.content : (m.content[0] as Anthropic.TextBlockParam).text);
  const turn1Texts = first.calls[0]!.params.messages.map(textOf);
  const turn2SharedPrefixTexts = second.calls[0]!.params.messages.slice(0, turn1Texts.length).map(textOf);
  assert.deepEqual(turn1Texts, turn2SharedPrefixTexts);

  // And turn 2's own last message is the one now marked cacheable — turn
  // 1's message is no longer marked (it's no longer last).
  const turn1Last = first.calls[0]!.params.messages.at(-1)!;
  const turn2Last = second.calls[0]!.params.messages.at(-1)!;
  assert.ok(Array.isArray(turn1Last.content) && (turn1Last.content[0] as Anthropic.TextBlockParam).cache_control);
  assert.ok(Array.isArray(turn2Last.content) && (turn2Last.content[0] as Anthropic.TextBlockParam).cache_control);
});

test("answerGeneralQuestion records usage under purpose 'answer' when given a connection", async () => {
  const connection = fakeUsageConnection();
  const { client } = fakeClient(textMessage("An answer."));
  await answerGeneralQuestion(client, oneTurn("hello"), undefined, undefined, connection);
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.purpose, "answer");
  assert.equal(rows[0]!.model, CLAUDE_CHAT_MODEL_FAST);
  assert.equal(rows[0]!.inputTokens, 10);
  assert.equal(rows[0]!.outputTokens, 5);
  assert.equal(rows[0]!.cacheCreationInputTokens, 0);
  assert.equal(rows[0]!.cacheReadInputTokens, 0);
  connection.close();
});

test("answerGeneralQuestion never calls the client at all when no connection is given — recording is purely additive", async () => {
  const { calls, client } = fakeClient(textMessage("An answer."));
  const before = calls.length;
  await answerGeneralQuestion(client, oneTurn("hello"));
  assert.equal(calls.length, before + 1, "the call itself must still happen — only recording is skipped");
});

test("answerGeneralQuestion swallows a usage-recording failure rather than letting it fail the call", async () => {
  const connection = fakeUsageConnection();
  connection.close(); // any write against a closed connection throws
  const { client } = fakeClient(textMessage("An answer."));
  const response = await answerGeneralQuestion(client, oneTurn("hello"), undefined, undefined, connection);
  assert.equal(response, "An answer.");
});

// ============================================================================
// streamGeneralQuestion — the streaming twin (Story 8.3)
// ============================================================================

/** A fake streaming-capable client: `stream: true` yields `chunks` as `content_block_delta` events; otherwise it behaves like `fakeClient` above. */
function fakeStreamingClient(chunks: readonly string[]): {
  readonly calls: Array<{ readonly stream?: boolean }>;
  readonly client: AnthropicMessagesClient;
} {
  const calls: Array<{ readonly stream?: boolean }> = [];
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming | Anthropic.MessageCreateParamsStreaming) => {
        calls.push(params);
        if ("stream" in params && params.stream) {
          async function* events(): AsyncGenerator<Anthropic.RawMessageStreamEvent> {
            for (const text of chunks) {
              yield {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text },
              } as Anthropic.RawMessageStreamEvent;
            }
          }
          return events();
        }
        return textMessage(chunks.join(""));
      },
    },
  } as unknown as AnthropicMessagesClient;
  return { calls, client };
}

test("streamGeneralQuestion yields each text_delta chunk in order and requests stream: true", async () => {
  const { calls, client } = fakeStreamingClient(["Hel", "lo the", "re."]);
  const received: string[] = [];

  for await (const chunk of streamGeneralQuestion(client, oneTurn("hi"))) {
    received.push(chunk);
  }

  assert.deepEqual(received, ["Hel", "lo the", "re."]);
  assert.equal(calls[0]?.stream, true);
});

test("streamGeneralQuestion throws if the stream produces no text at all", async () => {
  const { client } = fakeStreamingClient([]);

  await assert.rejects(async () => {
    for await (const _chunk of streamGeneralQuestion(client, oneTurn("hi"))) {
      // drain
    }
  }, /no text content/);
});

test("streamGeneralQuestion throws for an empty history, same as answerGeneralQuestion", async () => {
  const { client } = fakeStreamingClient(["x"]);

  await assert.rejects(async () => {
    for await (const _chunk of streamGeneralQuestion(client, [])) {
      // drain
    }
  }, /no conversation history/);
});

test("the non-streaming answerGeneralQuestion path is untouched by the streaming addition", async () => {
  const { calls, client } = fakeStreamingClient(["Two plus two is four."]);

  const reply = await answerGeneralQuestion(client, oneTurn("2+2?"));

  assert.equal(reply, "Two plus two is four.");
  assert.equal(calls[0]?.stream, undefined);
});

// ============================================================================
// streamGeneralQuestion — prompt caching + usage recording (real-use fixes
// plan, Task 9). This file's injected `AnthropicMessagesClient` interface
// mirrors the SDK's RAW `stream: true` shape (no `.finalMessage()` helper —
// see this file's own doc comment on `AnthropicMessagesClient`), so a real
// stream's usage only ever arrives via `message_start`'s initial `Usage`
// and each `message_delta`'s CUMULATIVE running total.
// ============================================================================

/** Like `fakeStreamingClient`, but also yields a `message_start` (with `startUsage`) before the text deltas and a `message_delta` (with the final cumulative `deltaUsage`) after them — the real shape `streamGeneralQuestion` reads usage from. */
function fakeStreamingClientWithUsage(
  chunks: readonly string[],
  startUsage: Anthropic.Usage,
  deltaUsage: Anthropic.MessageDeltaUsage,
): { readonly calls: Array<{ readonly stream?: boolean }>; readonly client: AnthropicMessagesClient } {
  const calls: Array<{ readonly stream?: boolean }> = [];
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming | Anthropic.MessageCreateParamsStreaming) => {
        calls.push(params);
        async function* events(): AsyncGenerator<Anthropic.RawMessageStreamEvent> {
          yield { type: "message_start", message: { ...textMessage(""), usage: startUsage } } as Anthropic.RawMessageStreamEvent;
          for (const text of chunks) {
            yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } as Anthropic.RawMessageStreamEvent;
          }
          yield {
            type: "message_delta",
            delta: { container: null, stop_details: null, stop_reason: "end_turn", stop_sequence: null },
            usage: deltaUsage,
          } as Anthropic.RawMessageStreamEvent;
        }
        return events();
      },
    },
  } as unknown as AnthropicMessagesClient;
  return { calls, client };
}

test("streamGeneralQuestion's system prompt and history breakpoint match the non-streaming path", async () => {
  const { calls, client } = fakeStreamingClient(["hi"]);
  for await (const _chunk of streamGeneralQuestion(client, oneTurn("hello"))) {
    // drain
  }
  const params = calls[0] as unknown as Anthropic.MessageCreateParamsStreaming;
  const system = params.system as Anthropic.TextBlockParam[];
  assert.ok(Array.isArray(system));
  assert.deepEqual(system[0]!.cache_control, { type: "ephemeral" });
  const lastMessage = params.messages.at(-1)!;
  assert.ok(Array.isArray(lastMessage.content) && (lastMessage.content[0] as Anthropic.TextBlockParam).cache_control);
});

test("streamGeneralQuestion records the FINAL cumulative usage (from message_delta, not message_start) under purpose 'answer'", async () => {
  const connection = fakeUsageConnection();
  const { client } = fakeStreamingClientWithUsage(
    ["Hel", "lo"],
    { input_tokens: 20, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null } as Anthropic.Usage,
    { input_tokens: 20, output_tokens: 7, cache_creation_input_tokens: 5, cache_read_input_tokens: 15, output_tokens_details: null, server_tool_use: null },
  );
  for await (const _chunk of streamGeneralQuestion(client, oneTurn("hi"), undefined, undefined, connection)) {
    // drain
  }
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.purpose, "answer");
  assert.equal(rows[0]!.inputTokens, 20);
  assert.equal(rows[0]!.outputTokens, 7, "must record the FINAL cumulative output_tokens (7), not message_start's initial placeholder (1)");
  assert.equal(rows[0]!.cacheCreationInputTokens, 5);
  assert.equal(rows[0]!.cacheReadInputTokens, 15);
  connection.close();
});

test("streamGeneralQuestion never records usage when no connection is given", async () => {
  const { client } = fakeStreamingClient(["hi"]);
  for await (const _chunk of streamGeneralQuestion(client, oneTurn("hello"))) {
    // drain — must not throw for lack of a connection
  }
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
  const result = await suggestFieldValue(client, "t1", "Call dentist", "area", [], realParseValue);
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
    realParseValue,
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
  const result = await suggestFieldValue(client, "t1", "Call dentist", "area", ["unrelated chatter"], realParseValue);
  assert.equal(result, undefined);
});

test("suggestFieldValue never trusts a CONFIDENT value that doesn't parse for the field's real type", async () => {
  const { client } = fakeClient(textMessage("CONFIDENT: sometime soon | vague timing mention"));
  const result = await suggestFieldValue(client, "t1", "Call dentist", "dueDate", ["I'll do it sometime soon"], realParseValue);
  assert.equal(result, undefined);
});

test("suggestFieldValue sends the joined recent messages and mentions the Task/field in its system prompt", async () => {
  const { calls, client } = fakeClient(textMessage("NONE"));
  await suggestFieldValue(client, "t1", "Call dentist", "energy", ["msg one", "msg two"], realParseValue);
  assert.equal(calls.length, 1);
  assert.match(systemText(calls[0]!.params), /Call dentist/);
  assert.equal(calls[0]!.params.messages[0]?.content, "msg one\nmsg two");
});

test("suggestFieldValue calls the injected parseValue with the trimmed claimed value, and trusts its result verbatim (Epic 6 retro item 7 — the injected-parser seam)", async () => {
  const { client } = fakeClient(textMessage("CONFIDENT:   42   | a fake parser gets the final say"));
  const parseValueCalls: Array<{ field: string; raw: string }> = [];
  const fakeParseValue = (field: PlanningFieldNames, raw: string): NonNullable<Task[PlanningFieldNames]> | undefined => {
    parseValueCalls.push({ field, raw });
    return "a completely different value" as unknown as NonNullable<Task[PlanningFieldNames]>;
  };
  const result = await suggestFieldValue(client, "t1", "Call dentist", "area", ["some message"], fakeParseValue);
  assert.deepEqual(parseValueCalls, [{ field: "area", raw: "42" }]);
  assert.equal(result?.value, "a completely different value", "suggestFieldValue must trust whatever parseValue returns, not re-derive it");
});

test("suggestFieldValue's system prompt is sent as one cacheable block, and records usage under purpose 'suggest-field'", async () => {
  const connection = fakeUsageConnection();
  const { calls, client } = fakeClient(textMessage("NONE"));
  await suggestFieldValue(client, "t1", "Call dentist", "area", ["msg"], realParseValue, connection);
  const system = calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.ok(Array.isArray(system));
  assert.deepEqual(system[0]!.cache_control, { type: "ephemeral" });
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.purpose, "suggest-field");
  connection.close();
});

// ============================================================================
// draftNotionPageFields (Story 6.3 / FR-26)
// ============================================================================

test("draftNotionPageFields parses key=value lines into a field map", async () => {
  const { client } = fakeClient(textMessage("title=Buy hiking boots\narea=Errands\nestimatedDurationMinutes=30"));
  const result = await draftNotionPageFields(client, "Tasks", "add a task to buy hiking boots, errands, 30 min", "2026-09-27", "America/Los_Angeles");
  assert.deepEqual(result, { title: "Buy hiking boots", area: "Errands", estimatedDurationMinutes: "30" });
});

test("draftNotionPageFields returns undefined when Claude extracts no title", async () => {
  const { client } = fakeClient(textMessage("area=Errands"));
  const result = await draftNotionPageFields(client, "Tasks", "something about errands", "2026-09-27", "America/Los_Angeles");
  assert.equal(result, undefined);
});

test("draftNotionPageFields returns undefined for a response with no parseable key=value lines at all", async () => {
  const { client } = fakeClient(textMessage("I'm not sure what you mean."));
  const result = await draftNotionPageFields(client, "Tasks", "uhh", "2026-09-27", "America/Los_Angeles");
  assert.equal(result, undefined);
});

test("draftNotionPageFields mentions the target database in its system prompt", async () => {
  const { calls, client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "ResearchVault", "research vault entry about hiking boots", "2026-09-27", "America/Los_Angeles");
  assert.match(systemText(calls[0]!.params), /ResearchVault|Research Vault/);
});

test("draftNotionPageFields's system prompt gives today's date + timezone and instructs resolving a Tasks database's dueDate into a real date, never the relative phrase itself", async () => {
  const { calls, client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "Tasks", "create a task due tomorrow", "2026-09-27", "America/Los_Angeles");
  const system = systemText(calls[0]!.params);
  assert.match(system, /2026-09-27/);
  assert.match(system, /America\/Los_Angeles/);
  assert.match(system, /dueDate/);
});

test("draftNotionPageFields's system prompt does NOT mention date resolution for a database with no date-typed field (Projects)", async () => {
  const { calls, client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "Projects", "create a project", "2026-09-27", "America/Los_Angeles");
  const system = systemText(calls[0]!.params);
  assert.doesNotMatch(system, /resolve any relative date/i);
});

// ============================================================================
// draftNotionPageFields — prompt caching (real-use fixes plan, Task 9): the
// date/timezone context is a SEPARATE, uncached `system` block from the
// stable instructions, so the cached prefix stays byte-stable day to day.
// ============================================================================

test("draftNotionPageFields sends system as two blocks for a database with a date field: a cached stable block, then an uncached dynamic date/timezone block", async () => {
  const { calls, client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "Tasks", "create a task due tomorrow", "2026-09-27", "America/Los_Angeles");
  const system = calls[0]!.params.system;
  assert.ok(Array.isArray(system));
  const blocks = system as Anthropic.TextBlockParam[];
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0]!.cache_control, { type: "ephemeral" });
  assert.doesNotMatch(blocks[0]!.text, /2026-09-27/);
  assert.equal(blocks[1]!.cache_control, undefined);
  assert.match(blocks[1]!.text, /2026-09-27/);
  assert.match(blocks[1]!.text, /America\/Los_Angeles/);
});

test("draftNotionPageFields's stable system block is IDENTICAL across two calls with different dates (Projects has no date field, so there's only ever one block)", async () => {
  const first = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(first.client, "Projects", "create a project", "2026-09-27", "America/Los_Angeles");
  const second = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(second.client, "Projects", "create a different project", "2026-09-28", "America/New_York");
  assert.deepEqual(first.calls[0]!.params.system, second.calls[0]!.params.system);
});

test("draftNotionPageFields's stable block text is byte-identical across two calls a day apart (Tasks); only the second, uncached block differs", async () => {
  const first = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(first.client, "Tasks", "create a task due tomorrow", "2026-09-27", "America/Los_Angeles");
  const second = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(second.client, "Tasks", "create a task due tomorrow", "2026-09-28", "America/Los_Angeles");
  const firstBlocks = first.calls[0]!.params.system as Anthropic.TextBlockParam[];
  const secondBlocks = second.calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.equal(firstBlocks[0]!.text, secondBlocks[0]!.text, "the cached stable block must be byte-identical regardless of the date");
  assert.notEqual(firstBlocks[1]!.text, secondBlocks[1]!.text, "the uncached dynamic block carries the date and so differs day to day");
});

test("draftNotionPageFields records usage under purpose 'draft-notion' when given a connection", async () => {
  const connection = fakeUsageConnection();
  const { client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "Tasks", "create a task", "2026-09-27", "America/Los_Angeles", connection);
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.purpose, "draft-notion");
  assert.equal(rows[0]!.model, CLAUDE_CHAT_MODEL_FAST);
  assert.equal(rows[0]!.inputTokens, 10);
  assert.equal(rows[0]!.outputTokens, 5);
  connection.close();
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

test("classifyChatIntent's system prompt is one cacheable block, and it records usage under purpose 'classify'", async () => {
  const connection = fakeUsageConnection();
  const { calls, client } = fakeClient(textMessage("GENERAL"));
  await classifyChatIntent(client, "how's it going", connection);
  const system = calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.ok(Array.isArray(system));
  assert.deepEqual(system[0]!.cache_control, { type: "ephemeral" });
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.purpose, "classify");
  connection.close();
});

test("classifyChatIntent's system prompt is byte-identical across two separate calls (a genuinely stable, cacheable prefix)", async () => {
  const first = fakeClient(textMessage("GENERAL"));
  await classifyChatIntent(first.client, "how's it going");
  const second = fakeClient(textMessage("SEARCH: weather tomorrow"));
  await classifyChatIntent(second.client, "what's the weather tomorrow");
  assert.deepEqual(first.calls[0]!.params.system, second.calls[0]!.params.system);
});

// ============================================================================
// classifyCapture (real-use fixes plan, Task 2 — replaces the old two-way
// detectTaskCapture) — a free-text description ("Lab report draft, due
// Thursday", or a calendar request that slipped past isCalendarEditCommand's
// broadened but still deterministic trigger) doesn't match
// parseCreateItemCommand's explicit "create/add/new a ___" phrasing, its
// Notion-mention heuristic, or isCalendarEditCommand's own trigger, so
// capture needs its own 3-way classifier: "event" (a time-bound thing to
// attend), "task" (something to do or produce), or "none".
// ============================================================================

test("classifyCapture returns 'task' when Claude confirms the line describes a new Task", async () => {
  const { calls, client } = fakeClient(textMessage("TASK"));
  const result = await classifyCapture(client, "Lab report draft, due Thursday");
  assert.equal(result, "task");
  assert.equal(calls[0]!.params.messages[0]!.content, "Lab report draft, due Thursday");
  assert.equal(calls[0]!.params.model, CLAUDE_CHAT_MODEL_FAST);
});

test("classifyCapture returns 'event' when Claude confirms the line describes a time-bound thing to attend", async () => {
  const { client } = fakeClient(textMessage("EVENT"));
  const result = await classifyCapture(client, "coffee with Sam tomorrow at 9");
  assert.equal(result, "event");
});

test("classifyCapture returns 'none' for a question", async () => {
  const { client } = fakeClient(textMessage("NONE"));
  const result = await classifyCapture(client, "What's my next meeting?");
  assert.equal(result, "none");
});

test("classifyCapture returns 'none' for an ordinary statement", async () => {
  const { client } = fakeClient(textMessage("NONE"));
  const result = await classifyCapture(client, "That lecture ran long today.");
  assert.equal(result, "none");
});

test("classifyCapture defaults to 'none' for any unrecognized response, never throwing", async () => {
  const { client } = fakeClient(textMessage("I'm not totally sure what you mean."));
  const result = await classifyCapture(client, "hmm");
  assert.equal(result, "none");
});

test("classifyCapture propagates a transport failure (AD-8) rather than swallowing it as 'none'", async () => {
  const client: AnthropicMessagesClient = {
    messages: {
      create: (async () => {
        throw new Error("network down");
      }) as AnthropicMessagesClient["messages"]["create"],
    },
  };
  await assert.rejects(() => classifyCapture(client, "anything"), /network down/);
});

test("classifyCapture's system prompt is one cacheable block, and it records usage under purpose 'capture'", async () => {
  const connection = fakeUsageConnection();
  const { calls, client } = fakeClient(textMessage("TASK"));
  await classifyCapture(client, "Lab report draft, due Thursday", connection);
  const system = calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.ok(Array.isArray(system));
  assert.deepEqual(system[0]!.cache_control, { type: "ephemeral" });
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.purpose, "capture");
  connection.close();
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

test("draftCalendarEditRequest parses a CREATE response with no duration marker — defaults durationAssumed to false", async () => {
  const { client } = fakeClient(textMessage("CREATE: Focus block | 2026-09-18T14:00:00.000Z | 2026-09-18T15:00:00.000Z"));
  const result = await draftCalendarEditRequest(client, "block off 2-3pm for focus time", "2026-09-18", "America/New_York", []);
  assert.deepEqual(result, { kind: "create", title: "Focus block", start: "2026-09-18T14:00:00.000Z", end: "2026-09-18T15:00:00.000Z", durationAssumed: false });
});

// Real-use fixes plan, Task 2: the trailing ASSUMED/EXPLICIT marker records
// whether draftCalendarEditRequest had to default the 60-minute duration
// itself (no explicit end time or duration phrase in Spencer's line) — the
// incident line ("make a event at 10:45 am tommorow to meet with alex...
// itll go for an hour and a half") gives an EXPLICIT 90-minute duration, so
// pin both shapes.
test("draftCalendarEditRequest parses a CREATE response with an EXPLICIT duration marker", async () => {
  const { client } = fakeClient(textMessage("CREATE: Meet with Alex | 2026-09-28T14:45:00.000Z | 2026-09-28T16:15:00.000Z | EXPLICIT"));
  const result = await draftCalendarEditRequest(client, "make a event at 10:45 am tommorow to meet with alex. itll go for an hour and a half", "2026-09-27", "America/New_York", []);
  assert.deepEqual(result, {
    kind: "create",
    title: "Meet with Alex",
    start: "2026-09-28T14:45:00.000Z",
    end: "2026-09-28T16:15:00.000Z",
    durationAssumed: false,
  });
});

test("draftCalendarEditRequest parses a CREATE response with an ASSUMED duration marker — no explicit end/duration was given", async () => {
  const { client } = fakeClient(textMessage("CREATE: Meeting with Alex | 2026-09-28T19:00:00.000Z | 2026-09-28T20:00:00.000Z | ASSUMED"));
  const result = await draftCalendarEditRequest(client, "schedule a meeting with Alex tomorrow at 3", "2026-09-27", "America/New_York", []);
  assert.deepEqual(result, {
    kind: "create",
    title: "Meeting with Alex",
    start: "2026-09-28T19:00:00.000Z",
    end: "2026-09-28T20:00:00.000Z",
    durationAssumed: true,
  });
});

test("draftCalendarEditRequest's system prompt instructs duration-phrase resolution and the ASSUMED/EXPLICIT marker", async () => {
  const { calls, client } = fakeClient(textMessage("NONE"));
  await draftCalendarEditRequest(client, "hmm", "2026-09-18", "America/New_York", []);
  const system = systemText(calls[0]!.params);
  assert.match(system, /an hour and a half.*90 minutes/i);
  assert.match(system, /default the duration to exactly 60 minutes/i);
  assert.match(system, /ASSUMED/);
  assert.match(system, /EXPLICIT/);
});

test("draftCalendarEditRequest returns undefined for a NONE response", async () => {
  const { client } = fakeClient(textMessage("NONE"));
  const result = await draftCalendarEditRequest(client, "hmm", "2026-09-18", "America/New_York", []);
  assert.equal(result, undefined);
});

test("draftCalendarEditRequest rejects an unparseable/invalid ISO datetime rather than trusting it", async () => {
  const { client } = fakeClient(textMessage("MOVE: Team sync | not a real time"));
  await assert.rejects(draftCalendarEditRequest(client, "move team sync", "2026-09-18", "America/New_York", []), /invalid or out-of-range/);
});

test("draftCalendarEditRequest gives Claude today's date, timezone, and candidate events in its system prompt", async () => {
  const { calls, client } = fakeClient(textMessage("NONE"));
  await draftCalendarEditRequest(client, "move standup", "2026-09-18", "America/New_York", [
    { title: "Standup", start: "2026-09-18T13:00:00.000Z", end: "2026-09-18T13:15:00.000Z" },
  ]);
  const system = systemText(calls[0]!.params);
  assert.match(system, /2026-09-18/);
  assert.match(system, /America\/New_York/);
  assert.match(system, /Standup/);
});

// ============================================================================
// draftCalendarEditRequest — prompt caching (real-use fixes plan, Task 9):
// today's date/timezone AND today's candidate events are both genuinely
// dynamic, so both live in the SECOND, uncached `system` block — the first
// (instructions-only) block stays byte-identical no matter what day it is
// or what's on the calendar.
// ============================================================================

test("draftCalendarEditRequest sends system as two blocks: a cached stable instructions block, then an uncached date/timezone/events block", async () => {
  const { calls, client } = fakeClient(textMessage("NONE"));
  // Deliberately a `today` that never coincidentally appears as an example
  // date inside the stable instructions block's own prose (e.g. "2026-09-18"
  // is used as a worked example there, so a real `today` of that same date
  // would produce a false negative below).
  await draftCalendarEditRequest(client, "move standup", "2026-12-01", "America/New_York", [
    { title: "Standup", start: "2026-12-01T13:00:00.000Z", end: "2026-12-01T13:15:00.000Z" },
  ]);
  const system = calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.ok(Array.isArray(system));
  assert.equal(system.length, 2);
  assert.deepEqual(system[0]!.cache_control, { type: "ephemeral" });
  assert.doesNotMatch(system[0]!.text, /2026-12-01|Standup/);
  assert.equal(system[1]!.cache_control, undefined);
  assert.match(system[1]!.text, /2026-12-01/);
  assert.match(system[1]!.text, /Standup/);
});

test("draftCalendarEditRequest's stable system block is byte-identical across two calls on different days with different candidate events", async () => {
  const first = fakeClient(textMessage("NONE"));
  await draftCalendarEditRequest(first.client, "move standup", "2026-09-18", "America/New_York", [
    { title: "Standup", start: "2026-09-18T13:00:00.000Z", end: "2026-09-18T13:15:00.000Z" },
  ]);
  const second = fakeClient(textMessage("NONE"));
  await draftCalendarEditRequest(second.client, "move sync", "2026-09-19", "America/Los_Angeles", []);
  const firstBlocks = first.calls[0]!.params.system as Anthropic.TextBlockParam[];
  const secondBlocks = second.calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.equal(firstBlocks[0]!.text, secondBlocks[0]!.text);
  assert.notEqual(firstBlocks[1]!.text, secondBlocks[1]!.text);
});

test("draftCalendarEditRequest records usage under purpose 'draft-calendar' when given a connection", async () => {
  const connection = fakeUsageConnection();
  const { client } = fakeClient(textMessage("NONE"));
  await draftCalendarEditRequest(client, "hmm", "2026-09-18", "America/New_York", [], connection);
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.purpose, "draft-calendar");
  connection.close();
});

test("draftCalendarEditRequest rejects date-only and offset-less datetimes", async () => {
  for (const bad of ["2026-09-18", "2026-09-18T16:00:00"]) {
    const { client } = fakeClient(textMessage(`MOVE: Team sync | ${bad}`));
    await assert.rejects(draftCalendarEditRequest(client, "move team sync", "2026-09-18", "America/New_York", []), /invalid or out-of-range/);
  }
});

test("draftCalendarEditRequest rejects an out-of-range calendar/clock value (e.g. Feb 30) instead of silently rolling it over", async () => {
  const { client } = fakeClient(textMessage("MOVE: Team sync | 2026-02-30T10:00:00Z"));
  await assert.rejects(draftCalendarEditRequest(client, "move team sync", "2026-09-18", "America/New_York", []), /invalid or out-of-range/);
});

test("draftCalendarEditRequest normalises datetimes to UTC and rejects an inverted CREATE range", async () => {
  const moved = fakeClient(textMessage("MOVE: Team sync | 2026-09-18T14:00:00-04:00"));
  assert.deepEqual(await draftCalendarEditRequest(moved.client, "m", "2026-09-18", "America/New_York", []), {
    kind: "move",
    eventTitle: "Team sync",
    newStart: "2026-09-18T18:00:00.000Z",
  });

  const inverted = fakeClient(textMessage("CREATE: Focus | 2026-09-18T15:00:00.000Z | 2026-09-18T14:00:00.000Z"));
  await assert.rejects(draftCalendarEditRequest(inverted.client, "c", "2026-09-18", "America/New_York", []), /end not after start/);
});

test("draftCalendarEditRequest tolerates a preamble and trailing commentary around the answer line", async () => {
  const { client } = fakeClient(textMessage("Sure, here you go:\nMOVE: Team sync | 2026-09-18T18:00:00.000Z\n(I assumed 6pm Eastern.)"));
  const result = await draftCalendarEditRequest(client, "move team sync to 6pm", "2026-09-18", "America/New_York", []);
  assert.deepEqual(result, { kind: "move", eventTitle: "Team sync", newStart: "2026-09-18T18:00:00.000Z" });
});

// ---------------------------------------------------------------------------
// normalizeQuickAddLine (Polish 4 Task 1) — Spencer's quick-add submit-time
// Haiku fallback. This function itself only calls Claude and does a loose
// JSON parse; it never validates against live options or Yoh's enums
// (`app/quick-add-normalize.ts` does that) — these tests only cover THIS
// file's own contract.
// ---------------------------------------------------------------------------

const QUICK_ADD_LIVE_OPTIONS: QuickAddLiveOptions = {
  area: ["School/ACT/College Apps", "Personal Goals"],
  energy: ["Deep", "medium", "low"],
  status: ["Nothing", "In Progress", "Completed"],
};

test("normalizeQuickAddLine parses a strict JSON reply into raw (unvalidated) fields", async () => {
  const { client } = fakeClient(
    textMessage(
      '{"title": "ACT Math section", "estimatedDurationMinutes": "60", "energy": "high", "area": "School/ACT/College Apps", "status": "not-started"}',
    ),
  );
  const result = await normalizeQuickAddLine(
    client,
    "add ACT Math section to act. 60 minutes. deep work. status not started",
    "2026-09-27",
    "UTC",
    QUICK_ADD_LIVE_OPTIONS,
  );
  assert.deepEqual(result, {
    title: "ACT Math section",
    estimatedDurationMinutes: "60",
    energy: "high",
    area: "School/ACT/College Apps",
    status: "not-started",
  });
});

test("normalizeQuickAddLine tolerates a preamble/trailing commentary around the JSON object", async () => {
  const { client } = fakeClient(textMessage('Sure, here you go:\n{"title": "history poster", "dueDate": "2026-09-30", "energy": "low"}\nHope that helps!'));
  const result = await normalizeQuickAddLine(client, "history poster due wednesday low energy", "2026-09-27", "UTC", QUICK_ADD_LIVE_OPTIONS);
  assert.deepEqual(result, { title: "history poster", dueDate: "2026-09-30", energy: "low" });
});

test("normalizeQuickAddLine returns undefined for malformed JSON or a response with no usable title", async () => {
  assert.equal(await normalizeQuickAddLine(fakeClient(textMessage("not json at all")).client, "x", "2026-09-27", "UTC", QUICK_ADD_LIVE_OPTIONS), undefined);
  assert.equal(await normalizeQuickAddLine(fakeClient(textMessage("{not valid json")).client, "x", "2026-09-27", "UTC", QUICK_ADD_LIVE_OPTIONS), undefined);
  assert.equal(
    await normalizeQuickAddLine(fakeClient(textMessage('{"energy": "high"}')).client, "x", "2026-09-27", "UTC", QUICK_ADD_LIVE_OPTIONS),
    undefined,
  );
});

test("normalizeQuickAddLine records usage under purpose 'quick-add-normalize' when given a connection", async () => {
  const connection = fakeUsageConnection();
  const { client } = fakeClient(textMessage('{"title": "x"}'));
  await normalizeQuickAddLine(client, "x", "2026-09-27", "UTC", QUICK_ADD_LIVE_OPTIONS, connection);
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.purpose, "quick-add-normalize");
  connection.close();
});

test("normalizeQuickAddLine's stable system block is byte-identical across two calls on different days with different live options", async () => {
  const first = fakeClient(textMessage('{"title": "a"}'));
  await normalizeQuickAddLine(first.client, "a", "2026-09-18", "America/New_York", { energy: ["Deep", "medium", "low"], status: ["Nothing", "Completed"] });
  const second = fakeClient(textMessage('{"title": "b"}'));
  await normalizeQuickAddLine(second.client, "b", "2026-09-19", "America/Los_Angeles", QUICK_ADD_LIVE_OPTIONS);
  const firstBlocks = first.calls[0]!.params.system as Anthropic.TextBlockParam[];
  const secondBlocks = second.calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.equal(firstBlocks[0]!.cache_control?.type, "ephemeral");
  assert.equal(firstBlocks[0]!.text, secondBlocks[0]!.text);
  assert.equal(firstBlocks[1]!.cache_control, undefined);
  assert.notEqual(firstBlocks[1]!.text, secondBlocks[1]!.text);
});

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
  streamGeneralQuestion,
  suggestFieldValue,
  CLAUDE_CHAT_MODEL_CAPABLE,
  CLAUDE_CHAT_MODEL_FAST,
  type AnthropicMessagesClient,
} from "../src/adapters/llm-adapter.ts";
import { parsePlanningFieldValue } from "../src/core/planning-field-value.ts";
import type { ChatTurn, FieldValueSuggestion, PlanningFieldNames, Task } from "../src/types/domain.ts";

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
  assert.deepEqual(params.messages, [{ role: "user", content: "what time is it in Tokyo" }]);
  assert.ok(typeof params.system === "string" && params.system.length > 0);
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
    { role: "user", content: "have you written the data to notion" },
  ]);
});

test("answerGeneralQuestion rejects an empty history — there is always at least the current turn by the time chat-cli.ts calls this", async () => {
  const { client } = fakeClient(textMessage("An answer."));

  await assert.rejects(() => answerGeneralQuestion(client, []));
});

test("answerGeneralQuestion accepts an overriding system prompt (Task 14's Tone integration seam)", async () => {
  const { calls, client } = fakeClient(textMessage("An answer."));

  await answerGeneralQuestion(client, oneTurn("hello"), "Custom tone instruction.");

  assert.equal(calls[0]!.params.system, "Custom tone instruction.");
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
  assert.match(calls[0]!.params.system as string, /Call dentist/);
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
  assert.match(calls[0]!.params.system as string, /ResearchVault|Research Vault/);
});

test("draftNotionPageFields's system prompt gives today's date + timezone and instructs resolving a Tasks database's dueDate into a real date, never the relative phrase itself", async () => {
  const { calls, client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "Tasks", "create a task due tomorrow", "2026-09-27", "America/Los_Angeles");
  const system = calls[0]!.params.system as string;
  assert.match(system, /2026-09-27/);
  assert.match(system, /America\/Los_Angeles/);
  assert.match(system, /dueDate/);
});

test("draftNotionPageFields's system prompt does NOT mention date resolution for a database with no date-typed field (Projects)", async () => {
  const { calls, client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "Projects", "create a project", "2026-09-27", "America/Los_Angeles");
  const system = calls[0]!.params.system as string;
  assert.doesNotMatch(system, /resolve any relative date/i);
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
  const system = calls[0]!.params.system as string;
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
  const system = calls[0]!.params.system as string;
  assert.match(system, /2026-09-18/);
  assert.match(system, /America\/New_York/);
  assert.match(system, /Standup/);
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

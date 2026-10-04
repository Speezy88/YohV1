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
  draftCalendarEditRequest,
  draftNotionPageFields,
  extractMemories,
  loadLlmAdapterConfigFromEnv,
  normalizeQuickAddLine,
  suggestFieldValue,
  CLAUDE_CHAT_MODEL_FAST,
  type AnthropicMessagesClient,
  type QuickAddLiveOptions,
} from "../src/adapters/llm-adapter.ts";
import { initLlmUsageStoreSchema, listLlmUsage } from "../src/adapters/llm-usage-store.ts";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { parsePlanningFieldValue } from "../src/core/planning-field-value.ts";
import type { FieldValueSuggestion, PlanningFieldNames, Task } from "../src/types/domain.ts";

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

// ============================================================================
// extractMemories (Story 13.4)
// ============================================================================

test("extractMemories parses candidates, sees only typed text and always-loaded items, records usage", async () => {
  const connection = fakeUsageConnection();
  const json = JSON.stringify([
    { folder: "feedback", text: "Keep plans short", origin: "stated", scope: "plans", restatesId: "m1" },
    { folder: "about-you", text: "Runs at 6", origin: "stated", expiresOn: "2026-12-01", sensitive: "health", ruleChange: { key: "schoolDayWorkStart", value: "16:00" } },
    { folder: "nope", text: "bad folder", origin: "stated" },
    { folder: "about-you", text: "", origin: "stated" },
    { folder: "about-you", text: "third", origin: "stated" },
  ]);
  const { calls, client } = fakeClient(textMessage("```json\n" + json + "\n```"));
  const alwaysLoaded = [{ id: "m1", folder: "feedback", text: "Keep plans brief", origin: "stated", ruleChange: "none", status: "current", createdAt: "x", confirmedAt: "x" }] as const;
  const out = await extractMemories(client, "remember that I run at 6", alwaysLoaded as never, { forceStated: true }, connection);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { folder: "feedback", text: "Keep plans short", origin: "stated", scope: "plans", restatesId: "m1" });
  assert.equal(out[1]!.sensitive, "health");
  assert.equal(out[1]!.expiresOn, "2026-12-01");
  assert.deepEqual(out[1]!.ruleChange, { key: "schoolDayWorkStart", value: "16:00" });
  const sent = JSON.stringify(calls[0]!.params.messages);
  assert.match(sent, /remember that I run at 6/);
  assert.match(sent, /m1/);
  assert.match(sent, /Keep plans brief/);
  assert.match(systemText(calls[0]!.params), /narrowest/i);
  assert.equal(calls[0]!.params.model, CLAUDE_CHAT_MODEL_FAST);
  assert.equal(listLlmUsage(connection)[0]!.purpose, "extract-memories");
});

test("extractMemories returns [] for malformed output and throws on transport error", async () => {
  const { client } = fakeClient(textMessage("no idea"));
  assert.deepEqual(await extractMemories(client, "remember that x", [], { forceStated: true }), []);
  const boom: AnthropicMessagesClient = { messages: { create: (() => Promise.reject(new Error("net"))) as never } };
  await assert.rejects(() => extractMemories(boom, "remember that x", [], { forceStated: true }), /net/);
});

test("extractMemories forceFolder is named in the prompt", async () => {
  const { calls, client } = fakeClient(textMessage("[]"));
  await extractMemories(client, "x", [], { forceStated: false, forceFolder: "ideas-notes" });
  assert.match(JSON.stringify(calls[0]!.params), /ideas-notes/);
});

// ============================================================================
// Story 13.6: memory blocks on general answers and drafts
// ============================================================================

const MEMORY_FIXTURE = {
  always: [{ id: "m1", folder: "feedback", text: "Keep it short", origin: "stated", ruleChange: "none", status: "current", createdAt: "2026-09-01T00:00:00.000Z", confirmedAt: "2026-09-01T00:00:00.000Z" }],
  relevant: [{ id: "m2", folder: "goals-projects", text: "Ship Obliterade v2", origin: "stated", ruleChange: "none", status: "current", createdAt: "2026-09-01T00:00:00.000Z", confirmedAt: "2026-09-01T00:00:00.000Z" }],
} as const;

test("draftNotionPageFields orders blocks stable, always, date, relevant", async () => {
  const { calls, client } = fakeClient(textMessage("title=X"));
  await draftNotionPageFields(client, "Tasks", "create a task due tomorrow", "2026-09-27", "America/Los_Angeles", undefined, MEMORY_FIXTURE as never);
  const blocks = calls[0]!.params.system as Anthropic.TextBlockParam[];
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0]!.cache_control, { type: "ephemeral" });
  assert.match(blocks[1]!.text, /Keep it short/);
  assert.deepEqual(blocks[1]!.cache_control, { type: "ephemeral" });
  assert.match(blocks[2]!.text, /2026-09-27/);
  assert.equal(blocks[2]!.cache_control, undefined);
  assert.match(blocks[3]!.text, /Ship Obliterade v2/);
});

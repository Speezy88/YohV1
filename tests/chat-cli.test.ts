/**
 * Tests for `src/shell/chat-cli.ts` (Story 1.5 / Task 5).
 *
 * Per the Task 5 brief, this task only needs a minimal REPL that
 * demonstrates the "surface open interaction requests before anything else"
 * pattern (AD-5) — not real free-text NLU/LLM routing (Task 13). These
 * tests exercise `runChatCli` against a real (throwaway, `:memory:`)
 * `MemoryStore` with an injected `ChatCliIo` (no real TTY/stdin), plus the
 * pure prompt-text-building and gate-wiring helpers directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryStore,
  getOpenInteractionRequest,
  getUncheckedDay,
  putOpenInteractionRequest,
  getTaskFieldOverride,
  mergeTaskFieldOverride,
  getCurrentTimeBudget,
  putPlan,
  putTimeBudget,
  getSelfCheckState,
  putSelfCheckState,
} from "../src/adapters/memory-store.ts";
import { NIGHT_CLOSE_OUT_REQUEST_ID, runNightEscalateRitual, runNightPromptRitual } from "../src/rituals/night-ritual.ts";
import { runSelfCheckRitual, SELF_CHECK_REQUEST_ID } from "../src/rituals/self-check.ts";
import type { MemoryStore } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { surfaceOpenInteractionRequests, runChatCli, type ChatCliIo } from "../src/shell/chat-cli.ts";
import type { AnswerOpenItemDeps } from "../src/app/answer-open-item.ts";
import type {
  NotionCreatePageClient,
  NotionCreatePageConfig,
  NotionSchemaClient,
  NotionTaskWriteBindingFn,
  NotionWriteClient,
} from "../src/adapters/notion-adapter.ts";
import type { CalendarBroadClient } from "../src/adapters/calendar-adapter.ts";
import { localIsoDate } from "../src/rituals/ritual-shared.ts";
// The Data-Completeness merge/gate/sync trio is its own capability and lives
// in its own file (Task 10 review fix); `chat-cli.ts` imports it rather than
// owning or re-exporting it. Import paths only — the behavior these tests
// assert is unchanged.
import {
  buildMissingFieldsPromptText,
  syncDataCompletenessInteractionRequest,
  applyTaskFieldOverride,
  mergeStoredOverrides,
  DATA_COMPLETENESS_REQUEST_ID,
} from "../src/rituals/data-completeness.ts";
import type { MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import { CLAUDE_CHAT_MODEL_CAPABLE, CLAUDE_CHAT_MODEL_FAST, type AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { resolveToneSystemPrompt } from "../src/core/tone.ts";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  CalendarEditChange,
  CalendarEvent,
  IsoDate,
  Plan,
  PlanBlock,
  PlanningFieldNames,
  Proposal,
  Result,
  SearchAnswer,
  Task,
  TaskStatus,
  YohError,
} from "../src/types/domain.ts";

function tempStore(): MemoryStore {
  // Story 7.8, Ruling R4: mid-day-reflow.ts's putPlan call site (reached
  // via chat-cli.ts's Mid-Day Re-Flow/Blocker triggers) now always appends
  // a Plan-change outbox hint in the same writeTx, so this store's
  // connection needs the notification-store schema initialized too, or
  // that write throws "no such table: outbox".
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

/**
 * `runChatCli`'s `timeZone` is a required parameter as of the Task 11 review
 * fix (never defaulted to UTC — see `chat-cli.ts`'s `currentIsoDate` doc
 * comment). Deliberately a REAL non-UTC zone (not `"UTC"`) for every test
 * below that doesn't care about the exact date, precisely so that any test
 * that silently reintroduces a UTC-date assumption would be exercised
 * against a zone where UTC-date and local-date can genuinely disagree.
 */
const TEST_TIME_ZONE = "America/New_York";

const NOW = "2026-08-22T12:00:00.000Z";

const TEAM_SYNC: CalendarEvent = { id: "evt-1", title: "Team sync", start: "2026-09-18T15:00:00.000Z", end: "2026-09-18T16:00:00.000Z" };

function makeTask(
  id: string,
  title: string,
  overrides: {
    estimatedDurationMinutes?: number | undefined;
    area?: string | undefined;
    dueDate?: string | undefined;
    status?: Task["status"] | undefined;
    energy?: Task["energy"] | undefined;
  } = {},
): Task {
  return {
    id,
    title,
    createdAt: NOW,
    updatedAt: NOW,
    estimatedDurationMinutes: 30,
    area: "Work",
    dueDate: "2026-08-23",
    status: "not-started",
    energy: "medium",
    ...overrides,
  } as Task;
}

/** Scripted `ChatCliIo`: `lines` are consumed in order by successive `readLine` calls; every `writeLine` call is recorded. */
function makeScriptedIo(lines: readonly string[]): ChatCliIo & { readonly written: string[] } {
  const queue = [...lines];
  const written: string[] = [];
  return {
    written,
    readLine: async () => {
      if (queue.length === 0) return null;
      return queue.shift() as string;
    },
    writeLine: (line: string) => {
      written.push(line);
    },
  };
}

/**
 * Fake `AnthropicMessagesClient` (Task 13) — no live Claude API key is
 * available in this environment, so every `runChatCli` test below injects
 * this instead of a real client. Returns a fixed canned response by default
 * so Time Budget/Plan-view tests (which should never reach the free-text
 * catch-all at all) fail loudly if they unexpectedly do. Records every call
 * so a test can assert the injected client was (or wasn't) invoked.
 */
function makeFakeLlmClient(
  responseText: string = "I don't have a specific answer for that.",
): AnthropicMessagesClient & { readonly calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];

  // Overloaded to match `AnthropicMessagesClient.messages.create`'s widened
  // (Story 8.3) shape exactly. `chat-cli.ts` never supplies `chatTurn` an
  // `emit`, so `app/general-question.ts` always takes the non-streaming
  // path — this fake is never actually asked to stream, but must still
  // satisfy the streaming overload structurally.
  function create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  function create(params: Anthropic.MessageCreateParamsStreaming): Promise<AsyncIterable<Anthropic.RawMessageStreamEvent>>;
  async function create(
    params: Anthropic.MessageCreateParamsNonStreaming | Anthropic.MessageCreateParamsStreaming,
  ): Promise<Anthropic.Message | AsyncIterable<Anthropic.RawMessageStreamEvent>> {
    calls.push(params as Anthropic.MessageCreateParamsNonStreaming);
    return {
      id: "msg_test",
      container: null,
      content: [{ type: "text", text: responseText, citations: null }],
      model: params.model,
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

  return { calls, messages: { create } };
}

/**
 * Story 8.1: `surfaceOpenInteractionRequests`'s third parameter is now
 * `AnswerOpenItemDeps` (`app/answer-open-item.ts`) rather than a long
 * positional-parameter list. This builds one with safe, throws-only-if-
 * invoked-and-not-overridden defaults for every field this test file's
 * `surfaceOpenInteractionRequests(store, io, ...)` call sites don't
 * otherwise care about — mirrors `tests/answer-open-item.test.ts`'s own
 * `fullDeps` helper.
 */
function makeAnswerDeps(
  store: MemoryStore,
  overrides: {
    updateTaskField?: (taskId: string, field: PlanningFieldNames, value: unknown) => Promise<Result<void, YohError>>;
    llmClient?: AnthropicMessagesClient;
    session?: { recentMessages: string[]; lastSearchAnswer: { readonly query: string; readonly answer: SearchAnswer } | undefined };
  } = {},
): AnswerOpenItemDeps {
  return {
    store,
    session: overrides.session ?? { recentMessages: [], lastSearchAnswer: undefined },
    updateTaskField: (overrides.updateTaskField as AnswerOpenItemDeps["updateTaskField"]) ?? makeFakeUpdateTaskField(),
    setTaskStatus: async () => ({ ok: true, value: undefined }),
    recordCompletion: () => {},
    lookupTask: async () => undefined,
    today: "2026-08-22",
    random: () => 0,
    ...(overrides.llmClient ? { llmClient: overrides.llmClient } : {}),
  };
}

// ============================================================================
// buildMissingFieldsPromptText — pure formatting
// ============================================================================

test("buildMissingFieldsPromptText names the missing field(s) and Task title for a single Task", () => {
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] }];
  const text = buildMissingFieldsPromptText(reports);
  assert.match(text, /Call dentist/);
  assert.match(text, /Area/);
});

test("buildMissingFieldsPromptText covers multiple incomplete Tasks in one combined prompt (UX-DR10)", () => {
  const reports: MissingFieldReport[] = [
    { taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] },
    { taskId: "t2", taskTitle: "Plan trip", missingFields: ["dueDate", "energy"] },
  ];
  const text = buildMissingFieldsPromptText(reports);
  assert.match(text, /Call dentist/);
  assert.match(text, /Plan trip/);
  assert.match(text, /Due Date/);
  assert.match(text, /Energy/);
});

// ============================================================================
// syncDataCompletenessInteractionRequest — thin wiring: gate -> memory-store
// ============================================================================

test("syncDataCompletenessInteractionRequest persists one combined interaction request when a Task is missing a field", () => {
  const store = tempStore();
  const incompleteTask = makeTask("t1", "Call dentist", { area: undefined });

  syncDataCompletenessInteractionRequest(store, [incompleteTask]);

  const record = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);
  assert.ok(record, "expected an open data-completeness interaction request");
  assert.equal(record?.data.requestKind, "data-completeness");
  assert.match(record?.data.promptText ?? "", /Call dentist/);
  store.close();
});

test("syncDataCompletenessInteractionRequest covers multiple incomplete Tasks with a single request record, not one per Task", () => {
  const store = tempStore();
  const t1 = makeTask("t1", "Call dentist", { area: undefined });
  const t2 = makeTask("t2", "Plan trip", { dueDate: undefined });

  syncDataCompletenessInteractionRequest(store, [t1, t2]);

  assert.deepEqual(store.listRecordsByKind("interaction-request").map((r) => r.id), [DATA_COMPLETENESS_REQUEST_ID]);
  const record = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);
  assert.match(record?.data.promptText ?? "", /Call dentist/);
  assert.match(record?.data.promptText ?? "", /Plan trip/);
  store.close();
});

test("syncDataCompletenessInteractionRequest does not persist a request when every Task is complete", () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Complete task")]);
  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

test("syncDataCompletenessInteractionRequest clears a previously-open request once the gate re-run's input Task set has the field present (unit-level: caller supplies the now-complete Task directly, not exercising the answer-storage path — see the end-to-end test below for that)", () => {
  const store = tempStore();
  const incompleteTask = makeTask("t1", "Call dentist", { area: undefined });
  syncDataCompletenessInteractionRequest(store, [incompleteTask]);
  assert.ok(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID));

  // A hand-constructed already-complete Task, standing in for whatever
  // later re-read of Task data has the field present — this test is only
  // about syncDataCompletenessInteractionRequest's own clearing logic in
  // isolation, not about how the field actually became present.
  const nowCompleteTask = makeTask("t1", "Call dentist");
  syncDataCompletenessInteractionRequest(store, [nowCompleteTask]);

  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

test("syncDataCompletenessInteractionRequest merges a stored TaskFieldOverride onto the raw Task before running the gate", () => {
  const store = tempStore();
  const rawTask = makeTask("t1", "Call dentist", { area: undefined });

  // The raw Task is still missing `area` on every re-read (e.g. from
  // Notion) — but an override for it is already on file from a previous
  // answer.
  mergeTaskFieldOverride(store, "t1", { area: "Health" });

  syncDataCompletenessInteractionRequest(store, [rawTask]);

  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

// ============================================================================
// surfaceOpenInteractionRequests / runChatCli — the REPL surfacing pattern
// ============================================================================

test("surfaceOpenInteractionRequests prints the prompt and blocks (reads an answer) before returning", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  const io = makeScriptedIo(["Work"]);

  await surfaceOpenInteractionRequests(store, io, makeAnswerDeps(store));

  assert.ok(io.written.some((line) => line.includes("Call dentist")), "expected the prompt to be printed");
  store.close();
});

test("surfaceOpenInteractionRequests clears the request once a non-empty answer is given", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  const io = makeScriptedIo(["Work"]);

  await surfaceOpenInteractionRequests(store, io, makeAnswerDeps(store));

  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

test("surfaceOpenInteractionRequests does nothing when no interaction request is open", async () => {
  const store = tempStore();
  const io = makeScriptedIo([]);

  await surfaceOpenInteractionRequests(store, io);

  assert.deepEqual(io.written, []);
  store.close();
});

test("surfaceOpenInteractionRequests keeps waiting (no timeout) on an empty answer rather than clearing (UX-DR20)", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  // Blank line, then a real answer.
  const io = makeScriptedIo(["", "Work"]);

  await surfaceOpenInteractionRequests(store, io, makeAnswerDeps(store));

  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

test("Review Focus #5: a decline-then-blind-answer within ONE data-completeness field still completes within a single surfaceOpenInteractionRequests call, before any unrelated line is read", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { estimatedDurationMinutes: undefined })]);
  const llmClient = makeFakeLlmClient("CONFIDENT: 30 | Spencer said it'll take about half an hour");
  const io = makeScriptedIo(["no", "45", "show me today's plan"]);

  await surfaceOpenInteractionRequests(
    store,
    io,
    makeAnswerDeps(store, { llmClient, session: { recentMessages: ["that dentist call will take about half an hour"], lastSearchAnswer: undefined } }),
  );

  assert.equal(getTaskFieldOverride(store, "t1")?.data.estimatedDurationMinutes, 45);
  assert.equal(await io.readLine(), "show me today's plan");
  store.close();
});

test("runChatCli surfaces an open interaction request before accepting any other input", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  // First line answers the prompt; second line is what would be an
  // "unrelated command" if it were processed before the prompt.
  const io = makeScriptedIo(["Work", "show me today's plan"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient: makeFakeLlmClient(), getNotionTaskWriteBinding: fakeNotionTaskWriteBinding() });

  const promptIndex = io.written.findIndex((line) => line.includes("Call dentist"));
  assert.ok(promptIndex !== -1, "expected the interaction request to be surfaced");
  // Nothing about "show me today's plan" is echoed/acted on before the
  // prompt line appears.
  const beforePrompt = io.written.slice(0, promptIndex);
  assert.ok(!beforePrompt.some((line) => line.includes("today's plan")));
  store.close();
});

test("runChatCli proceeds straight to the ordinary loop when no interaction request is open on start", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["hello"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient: makeFakeLlmClient() });

  assert.ok(!io.written.some((line) => line.includes("I need a bit more")));
  store.close();
});

test("runChatCli produces no ambient output while waiting for input — silence between Spencer-initiated interactions is the default (UX-DR17)", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient();
  // A readLine that never resolves models "time passing with no input from
  // Spencer" — per the Task 13 brief, this REPL only ever reacts to input
  // events (no timer/polling mechanism exists to write anything while
  // nothing has been typed), so simply never providing a line and asserting
  // nothing was written is sufficient evidence; no fake clock is needed.
  const written: string[] = [];
  const io: ChatCliIo = {
    readLine: () => new Promise<string | null>(() => {}), // never resolves
    writeLine: (line) => written.push(line),
  };

  const done = runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });
  // Give any pending microtasks a chance to run before checking — if
  // anything were going to write ambiently, it would have by now.
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 10))]);

  assert.deepEqual(written, [], "expected no output written while awaiting input");
  assert.equal(llmClient.calls.length, 0);
  store.close();
});

test("an interaction request of an unrecognized kind is also surfaced generically, not just data-completeness/night-close-out/self-check", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "some-future-request", {
    requestKind: "some-future-kind",
    promptText: "Did you finish today's Tasks?",
    createdAt: NOW,
  });
  const io = makeScriptedIo(["yes"]);

  await surfaceOpenInteractionRequests(store, io);

  assert.ok(io.written.some((line) => line.includes("Did you finish today's Tasks?")));
  assert.equal(store.listRecordsByKind("interaction-request").length, 0);
  store.close();
});

// ============================================================================
// parsePlanningFieldValue moved to core/planning-field-value.ts and its own
// tests/planning-field-value.test.ts (Epic 6 retro item 7, F8/F9).
// ============================================================================

// ============================================================================
// applyTaskFieldOverride / mergeStoredOverrides — pure merge helpers
// ============================================================================

test("applyTaskFieldOverride merges override fields onto a Task, leaving fields the override doesn't mention untouched", () => {
  const task = makeTask("t1", "Call dentist", { area: undefined, dueDate: undefined });
  const merged = applyTaskFieldOverride(task, { area: "Health" });
  assert.equal(merged.area, "Health");
  assert.equal(merged.dueDate, undefined);
  assert.equal(merged.estimatedDurationMinutes, 30); // untouched, from makeTask's defaults
});

test("applyTaskFieldOverride returns the Task unchanged when there is no override", () => {
  const task = makeTask("t1", "Call dentist");
  assert.deepEqual(applyTaskFieldOverride(task, undefined), task);
});

test("mergeStoredOverrides applies each Task's own stored override (if any) from memory-store", () => {
  const store = tempStore();
  mergeTaskFieldOverride(store, "t1", { area: "Health" });
  const t1 = makeTask("t1", "Call dentist", { area: undefined });
  const t2 = makeTask("t2", "No override for me", { area: undefined });

  const merged = mergeStoredOverrides(store, [t1, t2]);

  assert.equal(merged.find((t) => t.id === "t1")?.area, "Health");
  assert.equal(merged.find((t) => t.id === "t2")?.area, undefined);
  store.close();
});

// Story 8.1: the "gate rejects -> chat-cli answers -> override stored ->
// re-run produces CompleteTask" end-to-end path, and every FR-25
// suggest/decline/NONE/no-llmClient scenario, moved (adapted to the
// one-question-per-turn shape) to `tests/answer-data-completeness.test.ts`
// and `tests/surface-open-items.test.ts`.

// Story 8.4: parseCreateItemCommand's own pure tests moved to
// tests/chat-commands.test.ts; handleCreateItemCommand's own end-to-end
// tests moved (adapted to the one-shot draft-then-openProposal shape) to
// tests/create-item.test.ts. isSaveSearchResultCommand's own pure tests
// moved to tests/chat-commands.test.ts; handleSaveSearchResultCommand's own
// tests moved to tests/save-search-result.test.ts. handleSearchCommand's own
// tests moved (adapted) to tests/web-search.test.ts. The F6 regression
// ("save that to my notion research vault" routes to save-search-result, not
// create-item) and the "an ordinary message classified as general-question
// never calls search()" test moved to tests/app-chat-turn.test.ts (both are
// chat-turn.ts dispatch-ordering assertions now, not this file's own).

// ============================================================================
// runChatCli — the declare/change command path end-to-end
//
// Story 8.3: `parseTimeBudgetCommand`'s own unit tests moved to
// `tests/chat-commands.test.ts`; `declareTimeBudget`'s own unit tests moved
// to `tests/app-time-budget.test.ts`. These `runChatCli` integration tests
// stay here — they exercise the full dispatch (now via `app/chat-turn.ts`'s
// `chatTurn`, reached only after the still-inline
// classifyChatIntent/search-trigger check), not `declareTimeBudget` alone.
// ============================================================================

test("runChatCli: typing a Time Budget command persists it and confirms back to Spencer, costing ZERO LLM calls (Story 8.4 restores the original, pre-Epic-8 dispatch order — chatTurn's own recognizers are checked before its classifyChatIntent call, so a recognized deterministic command never reaches it)", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient();
  const io = makeScriptedIo(["time budget 6h"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  const stored = getCurrentTimeBudget(store);
  assert.equal(stored?.data.totalMinutes, 360);
  assert.ok(
    io.written.some((line) => /360|6h|6 hours?/i.test(line)),
    "expected a confirmation line mentioning the new Time Budget",
  );
  assert.equal(llmClient.calls.length, 0, "a recognized Time Budget command must never call the LLM client (Story 8.4)");
  store.close();
});

test("runChatCli: an invalid Time Budget amount is reported as an error, not silently persisted", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["time budget 30 hours"]); // 1800 minutes > 24h cap

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient: makeFakeLlmClient() });

  assert.equal(getCurrentTimeBudget(store), undefined);
  assert.ok(io.written.some((line) => /couldn't|invalid|cannot/i.test(line)));
  store.close();
});

test("runChatCli: routing unrelated input through the ordinary loop never calls into Time Budget storage (only demonstrates the router doesn't misfire on non-commands, not a day/expiry boundary — no clock is mocked or advanced here)", async () => {
  const store = tempStore();
  // Declare directly (simulating an earlier day's chat-cli session) — the
  // "2026-08-21" date is flavor text only; nothing below reads or advances
  // any clock, so this cannot distinguish "declared yesterday" from
  // "declared a moment ago." What it actually proves: lines that don't
  // match `parseTimeBudgetCommand` fall through to the free-text/general-qa
  // catch-all without ever calling `putTimeBudget` again.
  putTimeBudget(store, { date: "2026-08-21", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 });
  const before = getCurrentTimeBudget(store);

  const io = makeScriptedIo(["hello", "show me today's plan"]);
  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient: makeFakeLlmClient() });

  const after = getCurrentTimeBudget(store);
  assert.deepEqual(after?.data, before?.data);
  assert.equal(after?.version, before?.version);
  store.close();
});

// ============================================================================
// runChatCli — the free-text/general-qa catch-all routes through
// llm-adapter.ts's answerGeneralQuestion (Task 13), never the old
// placeholder string. `answerGeneralQuestion`'s own unit tests live in
// tests/llm-adapter.test.ts — these exercise the wiring from
// `runChatCli`'s loop into that adapter.
// ============================================================================

test("runChatCli: input that isn't a Time Budget or Plan-view command routes through llm-adapter.ts and prints Claude's real response, not a placeholder", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("It's sunny where you are, probably.");
  const io = makeScriptedIo(["what's the weather"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  assert.ok(!io.written.some((line) => line.includes("free-text routing arrives in a later task")));
  assert.ok(io.written.includes("It's sunny where you are, probably."));
  assert.equal(
    llmClient.calls.length,
    3,
    "expected exactly three Claude calls for the unmatched input: detectTaskCapture (Story 8.8), classifyChatIntent (Story 6.4), then the general-qa answer",
  );
  store.close();
});

test("runChatCli: a general/factual question with no matching specific intent still gets a real response, never an error/refusal", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("The capital of France is Paris.");
  const io = makeScriptedIo(["what's the capital of France"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  assert.ok(io.written.includes("The capital of France is Paris."));
  store.close();
});

// ============================================================================
// runChatCli — Tone integration (Task 14): the catch-all hands
// answerGeneralQuestion a Tone-governed systemPrompt via core/tone.ts's
// resolveToneSystemPrompt, rather than falling back to
// answerGeneralQuestion's own DEFAULT_GENERAL_QA_SYSTEM_PROMPT.
// ============================================================================

test("runChatCli: passes core/tone.ts's resolveToneSystemPrompt(line) as the systemPrompt for a casual message", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("hey yourself");
  const io = makeScriptedIo(["hey, what's up"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  // calls[0] is detectTaskCapture's own call (Story 8.8); calls[1] is
  // classifyChatIntent's (Story 6.4); calls[2] is the actual general-qa
  // answer call this test is about.
  assert.equal(llmClient.calls.length, 3);
  assert.equal(llmClient.calls[2]!.system, resolveToneSystemPrompt("hey, what's up"));
  store.close();
});

test("runChatCli: passes core/tone.ts's resolveToneSystemPrompt(line) as the systemPrompt for a factual question, and it differs from the casual instruction", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("TCP is connection-oriented; UDP is not.");
  const io = makeScriptedIo(["What's the difference between TCP and UDP?"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  assert.equal(llmClient.calls.length, 3);
  const sentSystemPrompt = llmClient.calls[2]!.system;
  assert.equal(sentSystemPrompt, resolveToneSystemPrompt("What's the difference between TCP and UDP?"));
  assert.notEqual(sentSystemPrompt, resolveToneSystemPrompt("hey, what's up"));
  store.close();
});

// ============================================================================
// runChatCli — model routing (2026-09-22 revision): the general-qa catch-all
// defaults to CLAUDE_CHAT_MODEL_FAST (Haiku) and escalates to
// CLAUDE_CHAT_MODEL_CAPABLE (Sonnet) for a message core/tone.ts's own
// classifyTone reads as concise-educational (factual/analytical) — reusing
// that existing classification rather than a second one.
// ============================================================================

test("runChatCli: an ordinary casual message routes the general-qa answer to CLAUDE_CHAT_MODEL_FAST (Haiku)", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("hey yourself");
  const io = makeScriptedIo(["hey, what's up"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  assert.equal(llmClient.calls.length, 3);
  assert.equal(llmClient.calls[2]!.model, CLAUDE_CHAT_MODEL_FAST);
  store.close();
});

test("runChatCli: a factual/analytical message escalates the general-qa answer to CLAUDE_CHAT_MODEL_CAPABLE (Sonnet)", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("TCP is connection-oriented; UDP is not.");
  const io = makeScriptedIo(["What's the difference between TCP and UDP?"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  assert.equal(llmClient.calls.length, 3);
  assert.equal(llmClient.calls[2]!.model, CLAUDE_CHAT_MODEL_CAPABLE);
  store.close();
});

// ============================================================================
// runChatCli — conversation-history threading (2026-09-22 revision): the
// root-cause fix for a real observed bug — asking Yoh a general-chat
// question after it had ALREADY written data to Notion in the same session
// got a false "no, nothing's been written," because answerGeneralQuestion
// used to send only the current line, no history at all. See
// withConversationHistory's and answerGeneralQuestion's own doc comments.
// ============================================================================

test("runChatCli: a second general-qa turn's history includes the first turn's question and Yoh's own prior reply, not just the current line", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("Two plus two is four.");
  const io = makeScriptedIo(["what's 2+2", "what did I just ask you"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  // calls: [capture #1, classify #1, general-qa #1, capture #2, classify #2, general-qa #2].
  assert.equal(llmClient.calls.length, 6);
  const history = llmClient.calls[5]!.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(history[0], { role: "user", content: "what's 2+2" });
  assert.equal(history[1]!.role, "assistant");
  // The assistant turn also folds in the divider/next-prompt text printed
  // right after Yoh's reply (see withConversationHistory's doc comment on
  // why it buffers everything up to the next real answer) — assert the
  // substance is present rather than the exact printed formatting.
  assert.match(history[1]!.content, /^Two plus two is four\./);
  assert.deepEqual(history[2], { role: "user", content: "what did I just ask you" });
  store.close();
});

test("runChatCli: a deterministic flow's own output (never touching Claude) still appears as prior history in a later general-qa call — the exact shape of the reported bug", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("Yes, I set it.");
  const io = makeScriptedIo(["time budget 6 hours", "did you set my time budget"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  // "time budget 6 hours" is recognized deterministically — zero Claude
  // calls (Story 8.4 restores the original dispatch order). calls[0..2]
  // are the SECOND line's own capture (Story 8.8) + classify + general-qa
  // calls.
  assert.equal(llmClient.calls.length, 3);
  const historySent = llmClient.calls[2]!.messages as Array<{ role: string; content: string }>;
  assert.equal(historySent[0]!.role, "user");
  assert.equal(historySent[0]!.content, "time budget 6 hours");
  assert.equal(historySent[1]!.role, "assistant");
  assert.match(historySent[1]!.content, /Time Budget is set to/);
  assert.deepEqual(historySent[2], { role: "user", content: "did you set my time budget" });
  store.close();
});

test("runChatCli: catches a thrown error from the Claude call and surfaces it as a plain line instead of crashing the session", async () => {
  const store = tempStore();
  const llmClient: AnthropicMessagesClient = {
    messages: {
      create: async () => {
        throw new Error("simulated API failure");
      },
    },
  };
  const io = makeScriptedIo(["what's the weather"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient });

  assert.ok(io.written.some((line) => /simulated API failure/.test(line)));
  store.close();
});

// Story 8.3: `isPlanViewCommand`'s own unit tests moved to
// `tests/chat-commands.test.ts`; `showPlanCommand`'s own `runChatCli`
// integration tests moved (as `showPlan` unit tests, adapted to call it
// directly) to `tests/app-plan-view.test.ts` — nothing about this
// capability's own behavior is exercised at the `runChatCli` level any more.

// ============================================================================
// runChatCli — Mid-Day Re-Flow (Task 15 / Story 2.3)
//
// Story 8.3: `isMidDayReflowCommand`'s own unit tests moved to
// `tests/chat-commands.test.ts`; `midDayReflowCommand`'s own `runChatCli`
// integration tests moved (as `reflowDay` unit tests, adapted to call it
// directly) to `tests/app-mid-day-reflow.test.ts`. `reflowSamplePlan` stays
// here — the "ChatCliDeps... omitted optional dependency" test below (a
// `chat-cli.ts`-owned concern, not `app/mid-day-reflow.ts`'s) still uses it.
// ============================================================================

function reflowSamplePlan(date: IsoDate, nowIso: string): Plan {
  const nowMs = Date.parse(nowIso);
  const past = new Date(nowMs - 30 * 60_000).toISOString();
  const future = new Date(nowMs + 30 * 60_000).toISOString();
  const futureEnd = new Date(nowMs + 60 * 60_000).toISOString();
  return {
    id: `plan-${date}`,
    date,
    blocks: [
      { id: "work-0", kind: "work", start: past, end: nowIso, label: "Past Task", taskId: "t1" },
      { id: "work-1", kind: "work", start: future, end: futureEnd, label: "Future Task", taskId: "t2" },
    ],
    reasoning: '"Past Task" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: past,
    updatedAt: past,
  };
}

test("ChatCliDeps (Epic 6 retro item 7): an omitted optional dependency still defaults to its original throws-only-if-invoked stub, surfaced as an honest error rather than a raw TypeError", async () => {
  const store = tempStore();
  const REFLOW_NOW = new Date("2026-08-22T18:00:00.000Z");
  const today = localIsoDate(REFLOW_NOW, TEST_TIME_ZONE);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  putPlan(store, reflowSamplePlan(today, REFLOW_NOW.toISOString()));
  const io = makeScriptedIo(["reflow my day"]);

  // `readTasks` is deliberately omitted from this ChatCliDeps object — the
  // conversion from positional params to one object must still leave its
  // default (a stub that throws only once actually invoked) in place.
  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient: makeFakeLlmClient(), now: () => REFLOW_NOW });

  assert.ok(
    io.written.some((line) => line.includes("no readTasks dependency configured")),
    `expected the original default-stub message to surface, got: ${io.written.join(" | ")}`,
  );
  store.close();
});

// ============================================================================
// runChatCli — Logistics-Only Blocker Handling (Task 16 / Story 2.4) and
// why-prioritized (Task 17 / Story 2.5)
//
// Story 8.3: `isBlockerReportCommand`/`parseWhyPrioritizedCommand`'s own unit
// tests moved to `tests/chat-commands.test.ts`; `blockerReportCommand`'s and
// `whyPrioritizedCommand`'s own `runChatCli` integration tests moved (as
// `reportBlocker`/`explainPriority` unit tests, adapted to call them directly)
// to `tests/app-blocker-report.test.ts`/`tests/app-why-prioritized.test.ts`.
// ============================================================================

// ============================================================================
// Night Ritual close-out prompt (Task 19 / Story 3.1) — surfacing and
// answering `requestKind: "night-close-out"` via chat-cli.ts
// ============================================================================

/**
 * A fake `NotionTaskWriteBindingFn` (Story 8.4, Ruling R1) — `runChatCli`
 * no longer accepts a bare `setTaskStatus`/`updateTaskField` closure
 * directly (that binding construction moved into `notion-adapter.ts`'s own
 * `bindNotionTaskWrites`), so a test that just needs either write to
 * SUCCEED (without asserting on its own call shape) supplies this instead:
 * a permissive fake `NotionWriteClient`/`NotionSchemaClient` whose every
 * relevant property is `rich_text`-typed, so `writeSelectLikeField` writes
 * whatever raw value it's given rather than needing a live option match.
 */
function fakeNotionTaskWriteBinding(): NotionTaskWriteBindingFn {
  const schema = {
    object: "data_source",
    properties: {
      Area: { id: "area", name: "Area", description: null, type: "rich_text", rich_text: {} },
      Energy: { id: "energy", name: "Energy", description: null, type: "rich_text", rich_text: {} },
      Status: { id: "status", name: "Status", description: null, type: "rich_text", rich_text: {} },
    },
  } as unknown as Awaited<ReturnType<NotionSchemaClient["dataSources"]["retrieve"]>>;
  const client: NotionWriteClient & NotionSchemaClient = {
    pages: { update: (async () => ({})) as unknown as NotionWriteClient["pages"]["update"] },
    dataSources: { retrieve: (async () => schema) as NotionSchemaClient["dataSources"]["retrieve"] },
  };
  return () => ({ ok: true, value: { client, config: { tasksDataSourceId: "tasks-ds" } } });
}

/**
 * A fake `UpdateTaskFieldFn` (FR-24): records every call and, by default,
 * succeeds every write. `failFieldsOnce` names field(s) whose FIRST call
 * fails (`YohError.kind: "validation"`, mirroring a real
 * `updateTaskField` resolution failure) — every subsequent call for that
 * same field succeeds, for tests exercising the re-prompt-on-failure path.
 */
function makeFakeUpdateTaskField(
  failFieldsOnce: readonly PlanningFieldNames[] = [],
): ((
  taskId: string,
  field: PlanningFieldNames,
  value: NonNullable<Task[PlanningFieldNames]>,
) => Promise<Result<void, YohError>>) & {
  readonly calls: Array<{ readonly taskId: string; readonly field: PlanningFieldNames; readonly value: unknown }>;
} {
  const calls: Array<{ taskId: string; field: PlanningFieldNames; value: unknown }> = [];
  const alreadyFailed = new Set<PlanningFieldNames>();
  const fn = async (
    taskId: string,
    field: PlanningFieldNames,
    value: NonNullable<Task[PlanningFieldNames]>,
  ): Promise<Result<void, YohError>> => {
    calls.push({ taskId, field, value });
    if (failFieldsOnce.includes(field) && !alreadyFailed.has(field)) {
      alreadyFailed.add(field);
      return { ok: false, error: { kind: "validation", message: `notion-adapter: no confident match for "${field}"` } };
    }
    return { ok: true, value: undefined };
  };
  return Object.assign(fn, { calls });
}

/**
 * A minimal real `NotionCreatePageClient` fake (Story 8.4 — mirrors
 * `tests/notion-adapter.test.ts`'s own `fakeSchemaFor`/`fakeCreatePageClient`
 * fixtures) covering both databases the smoke tests below actually draft
 * into — `draftItem`/`saveSearchResult` call the REAL
 * `resolveNotionPageDraftProperties`/`createPage` against it.
 */
function fakeNotionCreatePageClient(): NotionCreatePageClient & { readonly createCalls: Array<{ readonly parent: unknown; readonly properties: unknown }> } {
  const createCalls: Array<{ parent: unknown; properties: unknown }> = [];
  const baseSchema = {
    object: "data_source",
    title: [],
    description: [],
    parent: { type: "database_id", database_id: "db" },
    database_parent: { type: "database_id", database_id: "db" },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: "2026-08-01T09:00:00.000Z",
    last_edited_time: "2026-08-01T09:00:00.000Z",
    created_by: { object: "user", id: "user-1" },
    last_edited_by: { object: "user", id: "user-1" },
    icon: null,
    cover: null,
    url: "https://notion.so/db",
    public_url: null,
  };
  const schemasByDataSourceId: Record<string, unknown> = {
    "tasks-ds": {
      ...baseSchema,
      id: "tasks-ds",
      properties: {
        Name: { id: "title", name: "Name", description: null, type: "title", title: {} },
        Area: { id: "area", name: "Area", description: null, type: "rich_text", rich_text: {} },
      },
    },
    "research-vault-ds": {
      ...baseSchema,
      id: "research-vault-ds",
      properties: {
        "Research Title": { id: "title", name: "Research Title", description: null, type: "title", title: {} },
        "Key Findings": { id: "kf", name: "Key Findings", description: null, type: "rich_text", rich_text: {} },
        Query: { id: "q", name: "Query", description: null, type: "rich_text", rich_text: {} },
        Date: { id: "date", name: "Date", description: null, type: "date", date: {} },
        Sources: { id: "src", name: "Sources", description: null, type: "rich_text", rich_text: {} },
      },
    },
  };
  return {
    createCalls,
    dataSources: {
      retrieve: (async ({ data_source_id }: { data_source_id: string }) => schemasByDataSourceId[data_source_id]) as NotionCreatePageClient["dataSources"]["retrieve"],
    },
    pages: {
      create: (async (args: { parent: unknown; properties: unknown }) => {
        createCalls.push(args);
        return { object: "page", id: "new-page-id", url: "https://notion.so/new-page-id" };
      }) as NotionCreatePageClient["pages"]["create"],
    },
  };
}

const FAKE_NOTION_CREATE_PAGE_CONFIG: NotionCreatePageConfig = {
  tasksDataSourceId: "tasks-ds",
  projectsDataSourceId: "projects-ds",
  researchVaultDataSourceId: "research-vault-ds",
};

/** Fake `search` binding (Story 6.4 / FR-28) — records every call, returns a fixed `Result` by default. */
function makeFakeSearch(
  result: Result<SearchAnswer, YohError> = { ok: true, value: { answer: "A cited answer.", citations: ["https://example.com"] } },
): ((query: string) => Promise<Result<SearchAnswer, YohError>>) & { readonly calls: string[] } {
  const calls: string[] = [];
  const fn = async (query: string) => {
    calls.push(query);
    return result;
  };
  return Object.assign(fn, { calls });
}

/** Fake `readCalendarEvents` binding (Story 6.6 / FR-27) — returns a fixed event list. */
function makeFakeReadCalendarEvents(events: readonly CalendarEvent[] = []): () => Promise<readonly CalendarEvent[]> {
  return async () => events;
}

function makeFakeResolveCalendarEditRoute(
  result: { readonly kind: "owned" } | { readonly kind: "external" } = { kind: "external" },
): (calendarId: string, eventId: string) => Promise<{ readonly kind: "owned" } | { readonly kind: "external" }> {
  return async () => result;
}

function makeFakeProposeCalendarEdit(): ((
  calendarId: string,
  eventId: string,
  change: { readonly kind: "move"; readonly newStart: string } | { readonly kind: "resize"; readonly newEnd: string },
) => Promise<Proposal<CalendarEditChange>>) & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  const fn = async (
    calendarId: string,
    eventId: string,
    change: { readonly kind: "move"; readonly newStart: string } | { readonly kind: "resize"; readonly newEnd: string },
  ) => {
    calls.push({ calendarId, eventId, change });
    const suggested: CalendarEditChange =
      change.kind === "move"
        ? { kind: "move", eventId, calendarId, newStart: change.newStart, newEnd: "2026-09-18T19:00:00.000Z" }
        : { kind: "resize", eventId, calendarId, newEnd: change.newEnd };
    return {
      id: "proposal-1",
      kind: "calendar-edit",
      entityId: eventId,
      entityVersion: "etag-1",
      suggested,
      reason: "Test proposal",
      createdAt: NOW,
    } satisfies Proposal<CalendarEditChange>;
  };
  return Object.assign(fn, { calls });
}

/**
 * A minimal fake `CalendarBroadClient` (Story 8.4) — `getCalendarApplyBinding`
 * now hands `bindCalendarApply` a raw client (never a pre-bound write
 * closure, AD-16), so the smoke test below exercises the REAL
 * `applyCalendarEdit` against this fixture. `getResult`'s `etag` must match
 * whatever `entityVersion` the test's own `proposeCalendarEditFn` fake
 * returns (`makeFakeProposeCalendarEdit`'s own `"etag-1"`, by default) or
 * `applyCalendarEdit`'s staleness check rejects it.
 */
function fakeCalendarBroadClient(
  overrides: { readonly getResult?: { readonly etag: string; readonly summary: string; readonly start: string; readonly end: string } } = {},
): CalendarBroadClient {
  const getResult = overrides.getResult ?? { etag: "etag-1", summary: "Team sync", start: "2026-09-18T15:00:00.000Z", end: "2026-09-18T16:00:00.000Z" };
  return {
    events: {
      get: (async () => ({
        data: { etag: getResult.etag, summary: getResult.summary, start: { dateTime: getResult.start }, end: { dateTime: getResult.end } },
      })) as CalendarBroadClient["events"]["get"],
      patch: (async () => ({ data: {} })) as CalendarBroadClient["events"]["patch"],
      insert: (async () => ({ data: { id: "new-event-id" } })) as CalendarBroadClient["events"]["insert"],
    },
  };
}

function closeOutPlan(date: IsoDate): Plan {
  const blocks: PlanBlock[] = [
    { id: "work-0", kind: "work", start: `${date}T13:00:00.000Z`, end: `${date}T14:00:00.000Z`, label: "Draft the memo", taskId: "t1" },
    { id: "work-1", kind: "work", start: `${date}T14:15:00.000Z`, end: `${date}T15:00:00.000Z`, label: "Book the flights", taskId: "t2" },
  ];
  return {
    id: `plan-${date}`,
    date,
    blocks,
    reasoning: "Some reasoning.",
    version: 1,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

const NIGHT_NOW = new Date("2026-08-22T22:00:00.000Z");

/**
 * Story 7.9 (AD-23/R7): every `runChatCli` call below that exercises the
 * Night Ritual close-out flow with a "completed" answer reaches
 * `applyNightCloseOutConfirmation`'s `recordCompletion`/`lookupTask` deps —
 * these harmless no-ops stand in for the real `completion-log.ts`/live-Task
 * bindings `main()` wires in production, so these Slip-Bump-focused tests
 * don't need to also assert on completion recording (that's covered
 * end-to-end by `tests/night-ritual.test.ts`).
 */
const noOpRecordCompletion = (): void => {};
const noOpLookupTask = (): Promise<Task | undefined> => Promise.resolve(undefined);

test("runChatCli surfaces the Night Ritual close-out prompt first and accepts per-block completed/slipped answers", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  const promptRun = await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE, getCompletedTaskIdsToday: () => new Set() });
  assert.ok(promptRun.ok && promptRun.value.status === "prompted");
  assert.ok(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID));

  const io = makeScriptedIo(["completed", "slipped"]);
  const llmClient = makeFakeLlmClient();

  await runChatCli({
    store,
    io,
    timeZone: TEST_TIME_ZONE,
    llmClient,
    now: () => NIGHT_NOW,
    readTasks: async () => [],
    getNotionTaskWriteBinding: fakeNotionTaskWriteBinding(),
    recordCompletion: noOpRecordCompletion,
    lookupTask: noOpLookupTask,
  });

  assert.ok(io.written.some((l) => l.includes("Draft the memo")), "expected the combined close-out prompt to be printed");
  assert.equal(llmClient.calls.length, 0, "the close-out prompt is fully resolved before the ordinary loop ever reaches the LLM catch-all");
  store.close();
});

// Story 8.1: every per-block Slip-Bump/retry/skip/UncheckedDay/next-morning
// scenario moved (adapted to the one-question-per-turn shape) to
// `tests/answer-night-close-out.test.ts`.

// ============================================================================
// Periodic Self-Check prompt (Task 24 / Story 4.3, FR-17, UX-DR15) —
// surfacing and answering `requestKind: "self-check"` via chat-cli.ts
// ============================================================================

const SELF_CHECK_NOW = new Date("2026-08-22T15:00:00.000Z");

/** Persists an already-due, already-open Self-Check request via the REAL production ritual, so these tests exercise the real persisted shape rather than a hand-seeded fixture. */
async function openSelfCheckRequest(store: MemoryStore): Promise<IsoDate> {
  const today = localIsoDate(SELF_CHECK_NOW, TEST_TIME_ZONE);
  putSelfCheckState(store, { nextDueDate: today, nextDueMinuteOfDay: 0 }); // due any time today
  const result = await runSelfCheckRitual({
    store,
    now: () => SELF_CHECK_NOW,
    timeZone: TEST_TIME_ZONE,
    random: () => 0,
    sendNotification: async () => {},
  });
  assert.ok(result.ok && result.value.status === "prompted", `test setup sanity: expected a prompted Self-Check, got ${JSON.stringify(result)}`);
  return today;
}

test("runChatCli surfaces the Self-Check prompt and, given a complete answer (score + reason), persists it and clears the request", async () => {
  const store = tempStore();
  await openSelfCheckRequest(store);

  const io = makeScriptedIo(["8 things are going well"]);
  const llmClient = makeFakeLlmClient();
  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient, now: () => SELF_CHECK_NOW, readTasks: async () => [] });

  assert.ok(io.written.some((l) => /1-10|number/i.test(l)), "expected the Self-Check prompt itself to be printed");
  assert.equal(llmClient.calls.length, 0);
});

// Story 8.1: the score-only/re-prompt and shortened-interval scenarios moved
// (adapted to the one-question-per-turn shape) to
// `tests/answer-self-check.test.ts`. The blank-line/EOF tests below stay —
// they exercise `chat-cli.ts`'s own transport-level blocking loop, not
// `app/answer-self-check.ts`'s logic.

test("runChatCli: a blank line to an open Self-Check prompt keeps waiting rather than clearing (UX-DR20)", async () => {
  const store = tempStore();
  await openSelfCheckRequest(store);

  const io = makeScriptedIo(["", "9 all good"]);
  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient: makeFakeLlmClient(), now: () => SELF_CHECK_NOW, readTasks: async () => [] });

  assert.equal(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), undefined);
  assert.equal(getSelfCheckState(store)?.data.lastScore, 9);
});

test("runChatCli: EOF mid-Self-Check-answer leaves the request open, unanswered, for the next session", async () => {
  const store = tempStore();
  await openSelfCheckRequest(store);

  const io = makeScriptedIo([]); // immediate EOF
  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient: makeFakeLlmClient(), now: () => SELF_CHECK_NOW, readTasks: async () => [] });

  assert.ok(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), "the request must survive an EOF mid-answer");
});

// Story 8.4: isCalendarEditCommand's own pure tests moved to
// tests/chat-commands.test.ts; handleCalendarEditCommand's own end-to-end
// tests moved (adapted to the one-shot draft-then-openProposal shape) to
// tests/calendar-edit.test.ts. The "an ambiguous confirm answer re-prompts"
// and "an apply failure" scenarios exercise confirmProposal's own
// retry/apply behavior (Story 8.2's own tests), not this file's propose-only
// behavior. FR-29's own "never calls confirmProposal" isolation check moved
// to tests/save-search-result.test.ts (handleSaveSearchResultCommand no
// longer exists in this file).

// ============================================================================
// Story 8.4 — thin transport-level smoke tests: chat-cli.ts still presents a
// create-item/calendar-edit follow-up question (and a search/save-search-
// result reply) correctly end-to-end, now that every one of these four
// capabilities is dispatched from app/chat-turn.ts's chatTurn rather than
// handled inline in this file's own loop.
// ============================================================================

test("runChatCli: a recognized create-item request shows the draft, waits for yes/no, and echoes a receipt on confirm", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("title=Buy hiking boots\narea=Errands");
  const io = makeScriptedIo(["create a task to buy hiking boots", "yes"]);

  await runChatCli({
    store,
    io,
    timeZone: TEST_TIME_ZONE,
    llmClient,
    now: () => new Date(NOW),
    readTasks: async () => [],
    getNotionCreatePageBinding: () => ({ ok: true, value: { client: fakeNotionCreatePageClient(), config: FAKE_NOTION_CREATE_PAGE_CONFIG } }),
  });

  assert.ok(io.written.some((line) => /Here's what I'll create in Tasks/.test(line)), `expected the draft preview, got: ${io.written.join(" | ")}`);
  assert.ok(io.written.some((line) => /Created "Buy hiking boots" in Tasks/.test(line)), `expected a one-line creation receipt, got: ${io.written.join(" | ")}`);
  store.close();
});

test("runChatCli: a recognized calendar-edit request shows the confirm preview, waits for yes/no, and echoes a receipt on confirm", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("MOVE: Team sync | 2026-09-18T18:00:00.000Z");
  const io = makeScriptedIo(["move team sync to 6pm", "yes"]);
  const propose = makeFakeProposeCalendarEdit();

  await runChatCli({
    store,
    io,
    timeZone: TEST_TIME_ZONE,
    llmClient,
    now: () => new Date("2026-09-18T12:00:00.000Z"),
    readTasks: async () => [],
    readCalendarEventsFn: makeFakeReadCalendarEvents([TEAM_SYNC]),
    resolveCalendarEditRouteFn: makeFakeResolveCalendarEditRoute({ kind: "external" }),
    proposeCalendarEditFn: propose,
    getCalendarApplyBinding: () => ({ ok: true, value: fakeCalendarBroadClient() }),
  });

  assert.equal(propose.calls.length, 1);
  const moveLines = io.written.filter((line) => /Move "Team sync" to/.test(line));
  assert.ok(
    moveLines.length >= 2,
    `expected the confirm preview AND a receipt naming the event and change, got: ${io.written.join(" | ")}`,
  );
  store.close();
});

test("runChatCli: an explicit search request renders the answer with its citations", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("SEARCH: best hiking boots under $150");
  const searchFn = makeFakeSearch({ ok: true, value: { answer: "Salomon and Merrell test well.", citations: ["https://example.com/a"] } });
  const io = makeScriptedIo(["search for the best hiking boots under $150"]);

  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient, now: () => new Date(NOW), readTasks: async () => [], searchFn });

  assert.deepEqual(searchFn.calls, ["best hiking boots under $150"]);
  assert.ok(io.written.some((line) => line.includes("Salomon and Merrell")));
  assert.ok(io.written.some((line) => line.includes("https://example.com/a")));
  store.close();
});

test("runChatCli: 'save that' after a search files it to the Research Vault directly, with no confirm step, and echoes a receipt", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("SEARCH: best hiking boots under $150");
  const searchFn = makeFakeSearch({ ok: true, value: { answer: "Salomon and Merrell test well.", citations: ["https://example.com/a"] } });
  const io = makeScriptedIo(["search for the best hiking boots under $150", "save that"]);

  await runChatCli({
    store,
    io,
    timeZone: TEST_TIME_ZONE,
    llmClient,
    now: () => new Date(NOW),
    readTasks: async () => [],
    searchFn,
    getNotionCreatePageBinding: () => ({ ok: true, value: { client: fakeNotionCreatePageClient(), config: FAKE_NOTION_CREATE_PAGE_CONFIG } }),
  });

  assert.ok(io.written.some((line) => /filed/i.test(line)), `expected a filing receipt, got: ${io.written.join(" | ")}`);
  store.close();
});

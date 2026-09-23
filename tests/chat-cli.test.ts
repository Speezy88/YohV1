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
  ConflictError,
  getOpenInteractionRequest,
  getSlipHistory,
  getTimeBudgetDeferralStreak,
  getUncheckedDay,
  putOpenInteractionRequest,
  putTimeBudgetDeferralStreak,
  getTaskFieldOverride,
  mergeTaskFieldOverride,
  getCurrentTimeBudget,
  getPlan,
  putPlan,
  putTimeBudget,
  recordSlip,
  getSelfCheckState,
  putSelfCheckState,
} from "../src/adapters/memory-store.ts";
import { NIGHT_CLOSE_OUT_REQUEST_ID, runNightEscalateRitual, runNightPromptRitual } from "../src/rituals/night-ritual.ts";
import { runSelfCheckRitual, SELF_CHECK_REQUEST_ID } from "../src/rituals/self-check.ts";
import type { MemoryStore } from "../src/adapters/memory-store.ts";
import {
  surfaceOpenInteractionRequests,
  runChatCli,
  parseFieldAnswer,
  parseTimeBudgetCommand,
  declareTimeBudget,
  isMidDayReflowCommand,
  isPlanViewCommand,
  isBlockerReportCommand,
  parseWhyPrioritizedCommand,
  parseCreateItemCommand,
  isSaveSearchResultCommand,
  isCalendarEditCommand,
  parseSelfCheckAnswer,
  apply,
  parseProposalAnswer,
  type ChatCliIo,
  type ProposalEntityAccessor,
} from "../src/shell/chat-cli.ts";
import { runMorningRitual, TIME_BUDGET_PROPOSAL_REQUEST_ID, type MorningRitualDeps } from "../src/rituals/morning-ritual.ts";
import { localIsoDate, renderPlan } from "../src/rituals/ritual-shared.ts";
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
import { checkDataCompleteness, type MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { resolveToneSystemPrompt } from "../src/core/tone.ts";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  CalendarEditChange,
  CalendarEvent,
  IsoDate,
  NotionDatabaseTarget,
  Plan,
  PlanBlock,
  PlanningFieldNames,
  Proposal,
  Result,
  SearchAnswer,
  Task,
  TaskStatus,
  TimeBudget,
  YohError,
} from "../src/types/domain.ts";

function tempStore(): MemoryStore {
  return createMemoryStore({ databasePath: ":memory:" });
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
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
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
      },
    },
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

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, makeFakeUpdateTaskField());

  assert.ok(io.written.some((line) => line.includes("Call dentist")), "expected the prompt to be printed");
  store.close();
});

test("surfaceOpenInteractionRequests clears the request once a non-empty answer is given", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  const io = makeScriptedIo(["Work"]);

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, makeFakeUpdateTaskField());

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

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, makeFakeUpdateTaskField());

  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

test("runChatCli surfaces an open interaction request before accepting any other input", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  // First line answers the prompt; second line is what would be an
  // "unrelated command" if it were processed before the prompt.
  const io = makeScriptedIo(["Work", "show me today's plan"]);

  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), undefined, undefined, undefined, makeFakeUpdateTaskField());

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

  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient());

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

  const done = runChatCli(store, io, TEST_TIME_ZONE, llmClient);
  // Give any pending microtasks a chance to run before checking — if
  // anything were going to write ambiently, it would have by now.
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 10))]);

  assert.deepEqual(written, [], "expected no output written while awaiting input");
  assert.equal(llmClient.calls.length, 0);
  store.close();
});

test("an interaction request opened by another kind (e.g. a Proposal) is also surfaced generically, not just data-completeness", async () => {
  const store = tempStore();
  putOpenInteractionRequest(store, "night-close-out", {
    requestKind: "night-close-out",
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
// parseFieldAnswer — per-field parsing/validation of a raw answer (Task 5 fix)
// ============================================================================

test("parseFieldAnswer(estimatedDurationMinutes) accepts a positive whole number of minutes", () => {
  const result = parseFieldAnswer("estimatedDurationMinutes", "30");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 30);
});

test("parseFieldAnswer(estimatedDurationMinutes) rejects non-numeric, zero, negative, and fractional input", () => {
  for (const raw of ["not a number", "0", "-5", "12.5", ""]) {
    const result = parseFieldAnswer("estimatedDurationMinutes", raw);
    assert.equal(result.ok, false, `expected "${raw}" to be rejected`);
  }
});

test("parseFieldAnswer(area) accepts any non-blank free-form text", () => {
  const result = parseFieldAnswer("area", "  Health  ");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "Health");
});

test("parseFieldAnswer(area) rejects blank input", () => {
  const result = parseFieldAnswer("area", "   ");
  assert.equal(result.ok, false);
});

test("parseFieldAnswer(dueDate) accepts a YYYY-MM-DD date", () => {
  const result = parseFieldAnswer("dueDate", "2026-08-25");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "2026-08-25");
});

test("parseFieldAnswer(dueDate) rejects an unparseable or malformed date", () => {
  for (const raw of ["not a date", "08/25/2026", "2026-13-40", "2026-02-30"]) {
    const result = parseFieldAnswer("dueDate", raw);
    assert.equal(result.ok, false, `expected "${raw}" to be rejected`);
  }
});

test("parseFieldAnswer(status) accepts one of the fixed TaskStatus values, case/space-insensitively", () => {
  const result = parseFieldAnswer("status", "In Progress");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "in-progress");
});

test("parseFieldAnswer(status) rejects a value outside the fixed enum", () => {
  const result = parseFieldAnswer("status", "done-ish");
  assert.equal(result.ok, false);
});

test("parseFieldAnswer(energy) accepts one of the fixed Energy values, case-insensitively", () => {
  const result = parseFieldAnswer("energy", "HIGH");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "high");
});

test("parseFieldAnswer(energy) rejects a value outside the fixed enum", () => {
  const result = parseFieldAnswer("energy", "extreme");
  assert.equal(result.ok, false);
});

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

// ============================================================================
// Required end-to-end test: gate rejects -> request opened -> chat-cli
// answers it with real input -> override stored -> merging the override onto
// the ORIGINAL raw Task and re-running the gate produces a CompleteTask.
// ============================================================================

test("end-to-end: a missing field answered through chat-cli is stored as an override that makes the original raw Task complete on the next gate run", async () => {
  const store = tempStore();
  const rawTask = makeTask("t1", "Call dentist", { area: undefined });

  // 1. Gate rejects it; an interaction request is opened.
  syncDataCompletenessInteractionRequest(store, [rawTask]);
  const opened = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);
  assert.ok(opened, "expected an open data-completeness interaction request");
  assert.equal(getTaskFieldOverride(store, "t1"), undefined, "no override should exist yet");

  // Sanity: the gate itself, run directly over the still-raw Task, still
  // rejects it (nothing has been answered yet).
  const beforeAnswer = checkDataCompleteness([rawTask]);
  assert.equal(beforeAnswer.ok, true);
  if (beforeAnswer.ok) assert.equal(beforeAnswer.value.completeTasks.length, 0);

  // 2. chat-cli answers it with real (scripted) input.
  const io = makeScriptedIo(["Health"]);
  const updateTaskField = makeFakeUpdateTaskField();
  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, updateTaskField);

  // 2.5. The answer was ALSO written to Notion (FR-24) — not just stored
  // locally, and with the same taskId/field/value the local override gets.
  assert.deepEqual(updateTaskField.calls, [{ taskId: "t1", field: "area", value: "Health" }]);

  // 3. The override is now stored...
  const override = getTaskFieldOverride(store, "t1");
  assert.equal(override?.data.area, "Health");
  // ...and the interaction request is cleared.
  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);

  // 4. Merging the stored override onto the ORIGINAL raw Task (not a
  // hand-constructed stand-in — the exact same `rawTask` object from step
  // 1, still missing `area` itself) and re-running the gate now produces a
  // CompleteTask.
  const merged = mergeStoredOverrides(store, [rawTask]);
  const afterAnswer = checkDataCompleteness(merged);
  assert.equal(afterAnswer.ok, true);
  if (!afterAnswer.ok) return;
  assert.equal(afterAnswer.value.incomplete.length, 0);
  assert.equal(afterAnswer.value.completeTasks.length, 1);
  assert.equal(afterAnswer.value.completeTasks[0]?.area, "Health");

  // 5. And the full wiring function, called again with the same raw Task,
  // agrees: no interaction request re-opens.
  syncDataCompletenessInteractionRequest(store, [rawTask]);
  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);

  store.close();
});

// ============================================================================
// FR-25 — inferred-value proposal ahead of the Data-Completeness blind ask
// ============================================================================

test("a confident inference is shown as a proposal and, on 'yes', applied through the same updateTaskField path a manual answer uses", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { estimatedDurationMinutes: undefined })]);

  const llmClient = makeFakeLlmClient("CONFIDENT: 30 | Spencer said it'll take about half an hour");
  const updateTaskField = makeFakeUpdateTaskField();
  const io = makeScriptedIo(["yes"]);

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, updateTaskField, llmClient, [
    "that dentist call will take about half an hour",
  ]);

  assert.deepEqual(updateTaskField.calls, [{ taskId: "t1", field: "estimatedDurationMinutes", value: 30 }]);
  assert.equal(getTaskFieldOverride(store, "t1")?.data.estimatedDurationMinutes, 30);
  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  assert.ok(io.written.some((line) => line.includes("I think it's")), "expected the proposal line to be shown");
  store.close();
});

test("declining a confident inference falls back to the plain blind ask (FR-25 never blocks or replaces FR-4's baseline)", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { estimatedDurationMinutes: undefined })]);

  const llmClient = makeFakeLlmClient("CONFIDENT: 30 | Spencer said it'll take about half an hour");
  const updateTaskField = makeFakeUpdateTaskField();
  const io = makeScriptedIo(["no", "45"]);

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, updateTaskField, llmClient, [
    "that dentist call will take about half an hour",
  ]);

  assert.deepEqual(updateTaskField.calls, [{ taskId: "t1", field: "estimatedDurationMinutes", value: 45 }]);
  store.close();
});

test("no confident inference (NONE) falls straight through to the plain blind ask, unchanged", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { estimatedDurationMinutes: undefined })]);

  const llmClient = makeFakeLlmClient("NONE");
  const updateTaskField = makeFakeUpdateTaskField();
  const io = makeScriptedIo(["30"]);

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, updateTaskField, llmClient, [
    "unrelated chatter",
  ]);

  assert.deepEqual(updateTaskField.calls, [{ taskId: "t1", field: "estimatedDurationMinutes", value: 30 }]);
  assert.equal(io.written.some((line) => line.includes("I think it's")), false);
  store.close();
});

test("no llmClient supplied (the default) never attempts an inference — pre-existing blind-ask behavior is fully preserved", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  const io = makeScriptedIo(["Health"]);

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, makeFakeUpdateTaskField());

  assert.equal(getTaskFieldOverride(store, "t1")?.data.area, "Health");
  store.close();
});

// ============================================================================
// parseCreateItemCommand — pure trigger recognition (Story 6.3 / FR-26)
// ============================================================================

test("parseCreateItemCommand recognizes 'create a task ...' and targets Tasks", () => {
  const result = parseCreateItemCommand("create a task to buy hiking boots");
  assert.deepEqual(result, { database: "Tasks", request: "to buy hiking boots" });
});

test("parseCreateItemCommand recognizes 'add a project ...' and targets Projects", () => {
  const result = parseCreateItemCommand("add a project called Kitchen Remodel");
  assert.equal(result?.database, "Projects");
});

test("parseCreateItemCommand recognizes a research vault request and targets ResearchVault", () => {
  const result = parseCreateItemCommand("create a research vault entry about hiking boots");
  assert.equal(result?.database, "ResearchVault");
});

test("parseCreateItemCommand returns undefined for an unrelated database name — no fourth target is ever produced", () => {
  assert.equal(parseCreateItemCommand("create a shopping list"), undefined);
});

test("parseCreateItemCommand returns undefined for ordinary conversational input", () => {
  assert.equal(parseCreateItemCommand("what's my plan today"), undefined);
});

test("parseCreateItemCommand recognizes a Notion-mention request that isn't phrased as 'create a ...'", () => {
  const result = parseCreateItemCommand("can we input the high priority data to the notion tasks db");
  assert.deepEqual(result, {
    database: "Tasks",
    request: "can we input the high priority data to the notion tasks db",
  });
});

test("parseCreateItemCommand recognizes 'put this in the notion research vault'", () => {
  const result = parseCreateItemCommand("put this in the notion research vault");
  assert.equal(result?.database, "ResearchVault");
});

test("parseCreateItemCommand's Notion-mention branch requires a write verb, not just a question about Notion", () => {
  assert.equal(parseCreateItemCommand("what's in the notion tasks db"), undefined);
});

test("parseCreateItemCommand's Notion-mention branch requires 'notion' and the database word in the same clause", () => {
  assert.equal(parseCreateItemCommand("add milk to the list. also check notion tasks later"), undefined);
});

// ============================================================================
// Create-item flow, end-to-end via runChatCli (Story 6.3 / FR-26)
// ============================================================================

test("a create-item request is drafted, validated, shown, and — on 'yes' — created via createPage, with a one-line receipt", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("title=Buy hiking boots\narea=Errands");
  const createPageFn = makeFakeCreatePage();
  const validateDraft = makeFakeValidateDraft();
  const io = makeScriptedIo(["create a task to buy hiking boots", "yes"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    createPageFn,
    validateDraft,
  );

  assert.equal(createPageFn.calls.length, 1);
  assert.equal(createPageFn.calls[0]!.database, "Tasks");
  assert.equal(createPageFn.calls[0]!.properties["title"], "Buy hiking boots");
  assert.ok(io.written.some((line) => /created/i.test(line)), "expected a one-line creation receipt");
  store.close();
});

test("declining the draft does not create anything", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("title=Buy hiking boots");
  const createPageFn = makeFakeCreatePage();
  const validateDraft = makeFakeValidateDraft();
  const io = makeScriptedIo(["create a task to buy hiking boots", "no"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    createPageFn,
    validateDraft,
  );

  assert.equal(createPageFn.calls.length, 0);
  store.close();
});

test("a draft that fails validation is never shown for confirmation, and nothing is created", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("title=Buy hiking boots\narea=Astronomy");
  const createPageFn = makeFakeCreatePage();
  const validateDraft = makeFakeValidateDraft({ ok: false, error: { kind: "validation", message: "no close match for Area" } });
  const io = makeScriptedIo(["create a task to buy hiking boots"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    createPageFn,
    validateDraft,
  );

  assert.equal(createPageFn.calls.length, 0);
  store.close();
});

test("when the LLM can't extract a title, Yoh says so and does not attempt validation or creation", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("NONE");
  const createPageFn = makeFakeCreatePage();
  const io = makeScriptedIo(["create a task, uh, something"]);

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient, () => new Date(NOW), async () => [], undefined, undefined, createPageFn);

  assert.equal(createPageFn.calls.length, 0);
  assert.equal(llmClient.calls.length, 1, "the create-item path must never fall through to the general-qa catch-all too");
  store.close();
});

// ============================================================================
// Web search via chat (Story 6.4 / FR-28)
// ============================================================================

test("an explicit search request routes to search() and renders the answer with its citations", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("SEARCH: best hiking boots under $150");
  const searchFn = makeFakeSearch({ ok: true, value: { answer: "Salomon and Merrell test well.", citations: ["https://example.com/a"] } });
  const io = makeScriptedIo(["search for the best hiking boots under $150"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    searchFn,
  );

  assert.deepEqual(searchFn.calls, ["best hiking boots under $150"]);
  assert.ok(io.written.some((line) => line.includes("Salomon and Merrell")));
  assert.ok(io.written.some((line) => line.includes("https://example.com/a")));
  store.close();
});

test("an ordinary message classified as general-question never calls search(), and still answers via the general-qa path", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("GENERAL");
  const searchFn = makeFakeSearch();
  const io = makeScriptedIo(["how's the weather looking"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    searchFn,
  );

  assert.equal(searchFn.calls.length, 0);
  store.close();
});

test("a search returning zero usable results is relayed honestly, not as an error", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("SEARCH: an obscure query");
  const searchFn = makeFakeSearch({ ok: true, value: { answer: "", citations: [] } });
  const io = makeScriptedIo(["search for an obscure query"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    searchFn,
  );

  assert.ok(io.written.some((line) => /didn't find|couldn't find|no results/i.test(line)));
  store.close();
});

test("a search failure (YohError) is reported plainly, not thrown", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("SEARCH: query");
  const searchFn = makeFakeSearch({ ok: false, error: { kind: "unreachable", message: "search-adapter: Perplexity returned HTTP 500" } });
  const io = makeScriptedIo(["search for query"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    searchFn,
  );

  assert.ok(io.written.some((line) => line.includes("Perplexity returned HTTP 500")));
  store.close();
});

// ============================================================================
// isSaveSearchResultCommand — pure trigger recognition (Story 6.5 / FR-29)
// ============================================================================

test("isSaveSearchResultCommand recognizes 'save that'/'save this'/'file that' phrasings, case-insensitively", () => {
  for (const line of ["save that", "Save This", "file that", "save that to the vault", "file this to the research vault"]) {
    assert.equal(isSaveSearchResultCommand(line), true, `expected "${line}" to be recognized`);
  }
});

test("isSaveSearchResultCommand returns false for unrelated input", () => {
  for (const line of ["what's my plan", "create a task to buy boots", "save my progress"]) {
    assert.equal(isSaveSearchResultCommand(line), false, `expected "${line}" NOT to be recognized`);
  }
});

// ============================================================================
// "save that" -> file the last search result to Research Vault (Story 6.5 / FR-29)
// ============================================================================

test("'save that' after a search files it to Research Vault directly, with no confirm step, and echoes a receipt", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("SEARCH: best hiking boots under $150");
  const createPageFn = makeFakeCreatePage();
  const searchFn = makeFakeSearch({ ok: true, value: { answer: "Salomon and Merrell test well.", citations: ["https://example.com/a"] } });
  const io = makeScriptedIo(["search for the best hiking boots under $150", "save that"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    createPageFn,
    undefined,
    searchFn,
  );

  assert.equal(createPageFn.calls.length, 1);
  assert.equal(createPageFn.calls[0]!.database, "ResearchVault");
  assert.equal(createPageFn.calls[0]!.properties["keyFindings"], "Salomon and Merrell test well.");
  assert.equal(createPageFn.calls[0]!.properties["sources"], "https://example.com/a");
  assert.ok(createPageFn.calls[0]!.properties["searchDate"]);
  assert.ok(io.written.some((line) => /filed/i.test(line)));
  store.close();
});

test("'save that' with no recent search result in the session does not fabricate a page — nothing is created", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("GENERAL");
  const createPageFn = makeFakeCreatePage();
  const io = makeScriptedIo(["save that"]);

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    createPageFn,
  );

  assert.equal(createPageFn.calls.length, 0);
  assert.ok(io.written.some((line) => /don't have|no recent|nothing to save/i.test(line)));
  store.close();
});

test("end-to-end: a Task missing multiple fields is answered field-by-field in one surfacing pass, each stored as its own override", async () => {
  const store = tempStore();
  const rawTask = makeTask("t1", "Plan trip", { area: undefined, dueDate: undefined });

  syncDataCompletenessInteractionRequest(store, [rawTask]);
  const io = makeScriptedIo(["Health", "2026-09-01"]);
  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, makeFakeUpdateTaskField());

  const override = getTaskFieldOverride(store, "t1");
  assert.equal(override?.data.area, "Health");
  assert.equal(override?.data.dueDate, "2026-09-01");
  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);

  const merged = mergeStoredOverrides(store, [rawTask]);
  const result = checkDataCompleteness(merged);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.completeTasks.length, 1);

  store.close();
});

test("an unparseable answer for a numeric field is rejected and re-prompted, not silently stored as garbage", async () => {
  const store = tempStore();
  const rawTask = makeTask("t1", "Write report", { estimatedDurationMinutes: undefined });
  syncDataCompletenessInteractionRequest(store, [rawTask]);
  const io = makeScriptedIo(["not-a-number", "45"]);

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, makeFakeUpdateTaskField());

  const override = getTaskFieldOverride(store, "t1");
  assert.equal(override?.data.estimatedDurationMinutes, 45);
  assert.ok(
    io.written.some((line) => /didn't understand|invalid|couldn't/i.test(line)),
    "expected a re-prompt/error message for the unparseable first answer",
  );
  store.close();
});

test("FR-24: a Notion write failure re-prompts the SAME question rather than storing the override — Notion must actually succeed before moving on", async () => {
  const store = tempStore();
  const rawTask = makeTask("t1", "Call dentist", { area: undefined });
  syncDataCompletenessInteractionRequest(store, [rawTask]);
  // First answer's Notion write fails (e.g. no live Area option is a close
  // enough match); Spencer is re-prompted and answers again, which succeeds.
  const io = makeScriptedIo(["Astronomy", "Health"]);
  const updateTaskField = makeFakeUpdateTaskField(["area"]);

  await surfaceOpenInteractionRequests(store, io, undefined, undefined, undefined, updateTaskField);

  assert.equal(updateTaskField.calls.length, 2, "expected a retry call after the first write failed");
  assert.equal(updateTaskField.calls[0]?.value, "Astronomy");
  assert.equal(updateTaskField.calls[1]?.value, "Health");
  // The FAILED first answer is never stored as an override...
  const override = getTaskFieldOverride(store, "t1");
  assert.equal(override?.data.area, "Health", "only the eventually-successful answer is stored");
  // ...and Spencer sees why the first answer didn't stick.
  assert.ok(io.written.some((line) => /couldn't record|notion/i.test(line)));
  store.close();
});

// ============================================================================
// parseTimeBudgetCommand — simple pattern matching for Spencer's declare/
// change command (Task 6 / Story 1.6). Scaffolding — Task 13 replaces this
// with real LLM routing without changing observable behavior.
// ============================================================================

test("parseTimeBudgetCommand recognizes '<N>h' shorthand", () => {
  const result = parseTimeBudgetCommand("time budget 6h");
  assert.deepEqual(result, { totalMinutes: 360 });
});

test("parseTimeBudgetCommand recognizes 'set time budget to <N> hours'", () => {
  const result = parseTimeBudgetCommand("set time budget to 6 hours");
  assert.deepEqual(result, { totalMinutes: 360 });
});

test("parseTimeBudgetCommand recognizes minutes ('<N>m', '<N> minutes')", () => {
  assert.deepEqual(parseTimeBudgetCommand("time budget 90m"), { totalMinutes: 90 });
  assert.deepEqual(parseTimeBudgetCommand("change time budget to 90 minutes"), { totalMinutes: 90 });
});

test("parseTimeBudgetCommand treats a bare number with no unit as hours (documented default)", () => {
  const result = parseTimeBudgetCommand("time budget 5");
  assert.deepEqual(result, { totalMinutes: 300 });
});

test("parseTimeBudgetCommand is case-insensitive and tolerates extra whitespace", () => {
  const result = parseTimeBudgetCommand("  SET Time   Budget TO 2 HOURS  ");
  assert.deepEqual(result, { totalMinutes: 120 });
});

test("parseTimeBudgetCommand accepts a fractional hour amount", () => {
  const result = parseTimeBudgetCommand("time budget 1.5h");
  assert.deepEqual(result, { totalMinutes: 90 });
});

test("parseTimeBudgetCommand rejects a fractional amount that doesn't land on a whole minute", () => {
  assert.equal(parseTimeBudgetCommand("time budget 0.5m"), undefined);
});

test("parseTimeBudgetCommand returns undefined for unrelated free text (falls through to the placeholder)", () => {
  assert.equal(parseTimeBudgetCommand("show me today's plan"), undefined);
  assert.equal(parseTimeBudgetCommand("hello"), undefined);
  assert.equal(parseTimeBudgetCommand(""), undefined);
});

test("parseTimeBudgetCommand returns undefined for a zero or negative amount", () => {
  assert.equal(parseTimeBudgetCommand("time budget 0h"), undefined);
  assert.equal(parseTimeBudgetCommand("time budget -3h"), undefined);
});

// ============================================================================
// declareTimeBudget — the thin wiring function (core shape/validate -> persist)
// ============================================================================

test("declareTimeBudget persists a valid declaration as today's Time Budget", () => {
  const store = tempStore();
  const result = declareTimeBudget(store, 360, "2026-08-22");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.data.totalMinutes, 360);
  assert.equal(result.value.data.date, "2026-08-22");

  const stored = getCurrentTimeBudget(store);
  assert.equal(stored?.data.totalMinutes, 360);
  store.close();
});

test("declareTimeBudget returns a validation error and persists nothing for an out-of-range amount", () => {
  const store = tempStore();
  const result = declareTimeBudget(store, 1500, "2026-08-22"); // > 24h

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(getCurrentTimeBudget(store), undefined);
  store.close();
});

test("declareTimeBudget called again for a later date replaces the prior value (still the one singleton row)", () => {
  const store = tempStore();
  declareTimeBudget(store, 360, "2026-08-21");
  declareTimeBudget(store, 240, "2026-08-25");

  const stored = getCurrentTimeBudget(store);
  assert.equal(stored?.data.totalMinutes, 240);
  assert.equal(stored?.data.date, "2026-08-25");
  store.close();
});

// ============================================================================
// runChatCli — the declare/change command path end-to-end
// ============================================================================

test("runChatCli: typing a Time Budget command persists it and confirms back to Spencer, never calling the LLM client (Task 13: observable behavior unchanged, no API call spent on a command already recognized for free)", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient();
  const io = makeScriptedIo(["time budget 6h"]);

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient);

  const stored = getCurrentTimeBudget(store);
  assert.equal(stored?.data.totalMinutes, 360);
  assert.ok(
    io.written.some((line) => /360|6h|6 hours?/i.test(line)),
    "expected a confirmation line mentioning the new Time Budget",
  );
  assert.equal(llmClient.calls.length, 0, "a recognized Time Budget command must never call the LLM client");
  store.close();
});

test("runChatCli: an invalid Time Budget amount is reported as an error, not silently persisted", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["time budget 30 hours"]); // 1800 minutes > 24h cap

  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient());

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
  // catch-all (Task 13) without ever calling `putTimeBudget` again.
  declareTimeBudget(store, 360, "2026-08-21");
  const before = getCurrentTimeBudget(store);

  const io = makeScriptedIo(["hello", "show me today's plan"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient());

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

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient);

  assert.ok(!io.written.some((line) => line.includes("free-text routing arrives in a later task")));
  assert.ok(io.written.includes("It's sunny where you are, probably."));
  assert.equal(
    llmClient.calls.length,
    2,
    "expected exactly two Claude calls for the unmatched input: classifyChatIntent (Story 6.4), then the general-qa answer",
  );
  store.close();
});

test("runChatCli: a general/factual question with no matching specific intent still gets a real response, never an error/refusal", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("The capital of France is Paris.");
  const io = makeScriptedIo(["what's the capital of France"]);

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient);

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

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient);

  // calls[0] is classifyChatIntent's own system prompt (Story 6.4);
  // calls[1] is the actual general-qa answer call this test is about.
  assert.equal(llmClient.calls.length, 2);
  assert.equal(llmClient.calls[1]!.system, resolveToneSystemPrompt("hey, what's up"));
  store.close();
});

test("runChatCli: passes core/tone.ts's resolveToneSystemPrompt(line) as the systemPrompt for a factual question, and it differs from the casual instruction", async () => {
  const store = tempStore();
  const llmClient = makeFakeLlmClient("TCP is connection-oriented; UDP is not.");
  const io = makeScriptedIo(["What's the difference between TCP and UDP?"]);

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient);

  assert.equal(llmClient.calls.length, 2);
  const sentSystemPrompt = llmClient.calls[1]!.system;
  assert.equal(sentSystemPrompt, resolveToneSystemPrompt("What's the difference between TCP and UDP?"));
  assert.notEqual(sentSystemPrompt, resolveToneSystemPrompt("hey, what's up"));
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

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient);

  assert.ok(io.written.some((line) => /simulated API failure/.test(line)));
  store.close();
});

// ============================================================================
// isPlanViewCommand / runChatCli — on-demand Plan view (Task 11 / Story 1.11)
// ============================================================================

test("isPlanViewCommand recognizes a few plan-view phrasings, case-insensitively", () => {
  for (const line of [
    "plan",
    "Plan",
    "what's my plan",
    "what is my plan",
    "show plan",
    "show my plan",
    "show me today's plan",
    "SHOW MY PLAN",
  ]) {
    assert.equal(isPlanViewCommand(line), true, `expected "${line}" to be recognized as a Plan-view request`);
  }
});

test("isPlanViewCommand returns false for unrelated input, including other recognized commands", () => {
  for (const line of ["hello", "time budget 6h", "what's the weather", ""]) {
    assert.equal(isPlanViewCommand(line), false, `expected "${line}" NOT to be recognized as a Plan-view request`);
  }
});

/**
 * A fixed instant (Task 11 review fix) picked so that the UTC calendar date
 * and Spencer's LOCAL calendar date in `TEST_TIME_ZONE`
 * (`America/New_York`, UTC-4 in August under DST) genuinely disagree: as UTC
 * time this is 2026-08-23 (02:00), but it is still 2026-08-22 (22:00 EDT) in
 * New York. Using a fixed `now` — rather than the real wall clock — means
 * the tests below exercise the local-vs-UTC mismatch deterministically,
 * regardless of what day the suite happens to run on. They would have
 * FAILED against the pre-fix `currentIsoDate()`, which computed
 * `new Date().toISOString().slice(0, 10)` (the UTC date) unconditionally,
 * ignoring both `timeZone` and any injected clock.
 */
const LATE_EVENING_UTC = new Date("2026-08-23T02:00:00.000Z");
/** The LOCAL date `LATE_EVENING_UTC` falls on in `TEST_TIME_ZONE` — "2026-08-22", one day BEHIND its UTC date ("2026-08-23"). */
const LOCAL_TODAY_FOR_LATE_EVENING = localIsoDate(LATE_EVENING_UTC, TEST_TIME_ZONE);

function samplePlanForDate(date: IsoDate): Plan {
  return {
    id: `plan-${date}`,
    date,
    blocks: [
      {
        id: "work-1",
        kind: "work",
        start: `${date}T13:00:00.000Z`,
        end: `${date}T14:00:00.000Z`,
        label: "Draft the memo",
        taskId: "t1",
      },
      {
        id: "break-1",
        kind: "break",
        start: `${date}T14:00:00.000Z`,
        end: `${date}T14:15:00.000Z`,
        label: "Break",
      },
    ],
    reasoning: '"Draft the memo" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

test("runChatCli: Given a Plan already exists for today, When Spencer asks \"what's my plan\", Then it displays the same ordered Plan and reasoning line via renderPlan (UX-DR18) — keyed by Spencer's LOCAL day, not the UTC one", async () => {
  const store = tempStore();
  // Stored under the LOCAL date — what `runMorningRitual` actually keys a
  // Plan by — which is one day BEHIND the UTC date at `LATE_EVENING_UTC`.
  // This is exactly the "false negative" regime the Task 11 review flagged:
  // a UTC-based lookup would compute "2026-08-23" here and find nothing.
  const plan = samplePlanForDate(LOCAL_TODAY_FOR_LATE_EVENING);
  putPlan(store, plan);

  const llmClient = makeFakeLlmClient();
  const io = makeScriptedIo(["what's my plan"]);
  await runChatCli(store, io, TEST_TIME_ZONE, llmClient, () => LATE_EVENING_UTC);

  const expected = renderPlan(plan);
  assert.ok(
    io.written.includes(expected),
    `expected chat-cli to find and print today's LOCAL-dated Plan even though the UTC date has already rolled over; got: ${JSON.stringify(io.written)}`,
  );
  assert.equal(llmClient.calls.length, 0, "a recognized Plan-view command must never call the LLM client (Task 13)");
  store.close();
});

test("runChatCli: on-demand Plan view also responds to other recognized phrasings ('show plan')", async () => {
  const store = tempStore();
  const plan = samplePlanForDate(LOCAL_TODAY_FOR_LATE_EVENING);
  putPlan(store, plan);

  const io = makeScriptedIo(["show plan"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => LATE_EVENING_UTC);

  assert.ok(io.written.includes(renderPlan(plan)));
  store.close();
});

test("runChatCli: Given no Plan has been generated yet for today, When Spencer asks for the Plan, Then Yoh says so plainly rather than fabricating one or erroring silently", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["show plan"]);

  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => LATE_EVENING_UTC);

  assert.ok(
    io.written.some((line) => /no plan/i.test(line)),
    "expected a plain statement that no Plan exists yet",
  );
  // Not fabricating a rendered block list (which would look like "HH:MM-HH:MM  ...").
  assert.ok(!io.written.some((line) => /\d{2}:\d{2}-\d{2}:\d{2}/.test(line)));
  store.close();
});

test("runChatCli: does NOT silently display a stale prior-day Plan when today's LOCAL Plan doesn't exist yet, even though a row happens to exist under the UTC date (Task 11 review fix — stale-plan false positive)", async () => {
  const store = tempStore();
  // A zone AHEAD of UTC, in the early local morning: UTC is still
  // "yesterday" while the local calendar day has already rolled over — the
  // exact regime the Task 11 review flagged as a false positive, where an
  // old UTC-based lookup would find and silently display YESTERDAY's Plan.
  const timeZone = "Asia/Tokyo";
  const earlyMorningUtc = new Date("2026-08-22T16:00:00.000Z"); // 2026-08-23 01:00 JST
  const utcDateOnly = "2026-08-22"; // what the OLD UTC-based lookup would have used
  const localToday = localIsoDate(earlyMorningUtc, timeZone); // "2026-08-23" — the correct key

  assert.notEqual(utcDateOnly, localToday, "test setup sanity: the two dates must genuinely differ");
  // Only yesterday's (UTC-dated) row exists — nothing has been generated yet
  // for the real local "today".
  putPlan(store, samplePlanForDate(utcDateOnly));

  const io = makeScriptedIo(["show plan"]);
  await runChatCli(store, io, timeZone, makeFakeLlmClient(), () => earlyMorningUtc);

  assert.ok(
    io.written.some((line) => /no plan/i.test(line)),
    "expected chat-cli to say no Plan exists for today rather than silently showing yesterday's stale stored Plan",
  );
  assert.ok(
    !io.written.some((line) => /\d{2}:\d{2}-\d{2}:\d{2}/.test(line)),
    "must not have printed the stale prior-day Plan's rendered block list",
  );
  store.close();
});

// ============================================================================
// isMidDayReflowCommand / runChatCli — Mid-Day Re-Flow trigger (Task 15 / Story 2.3)
// ============================================================================

test("isMidDayReflowCommand recognizes the documented trigger phrasings, case-insensitively", () => {
  for (const line of [
    "reflow",
    "re-flow",
    "REFLOW",
    "refit",
    "reflow my day",
    "re-flow my plan",
    "refit my day",
    "refit plan",
    "redo my plan",
    "redo my day",
    "redo plan",
    "please reflow my day",
    "reflow?",
  ]) {
    assert.equal(isMidDayReflowCommand(line), true, `expected "${line}" to be recognized as a Mid-Day Re-Flow trigger`);
  }
});

test("isMidDayReflowCommand returns false for unrelated input, including other recognized commands and a bare 'redo'", () => {
  for (const line of ["hello", "time budget 6h", "show plan", "what's my plan", "redo", ""]) {
    assert.equal(isMidDayReflowCommand(line), false, `expected "${line}" NOT to be recognized as a Mid-Day Re-Flow trigger`);
  }
});

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

test("runChatCli: typing a recognized Mid-Day Re-Flow trigger calls into mid-day-reflow.ts and prints only the short remainder, not the whole day", async () => {
  const store = tempStore();
  const REFLOW_NOW = new Date("2026-08-22T18:00:00.000Z");
  const today = localIsoDate(REFLOW_NOW, TEST_TIME_ZONE);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  const plan = reflowSamplePlan(today, REFLOW_NOW.toISOString());
  putPlan(store, plan);

  const tasks: Task[] = [
    makeTask("t1", "Past Task", { dueDate: today }),
    makeTask("t2", "Future Task", { dueDate: today }),
  ];
  const io = makeScriptedIo(["reflow my day"]);
  const llmClient = makeFakeLlmClient();

  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    llmClient,
    () => REFLOW_NOW,
    async () => tasks,
  );

  assert.equal(llmClient.calls.length, 0, "a recognized Mid-Day Re-Flow trigger must never fall through to the LLM catch-all");
  assert.ok(io.written.some((line) => /Re-flowed the rest of today/.test(line)), "expected the short reflow reasoning to be printed");
  assert.ok(!io.written.some((line) => /Today's Plan for/.test(line)), "must not re-print the whole-day header");
  assert.ok(!io.written.some((line) => /Past Task/.test(line)), "must not re-list the already-elapsed block");

  const updated = getPlan(store, today);
  assert.ok(updated);
  assert.equal(updated!.data.version, 2, "the stored Plan's version must be bumped by the re-flow");
  const pastBlock = updated!.data.blocks.find((b) => b.id === "work-0");
  assert.deepEqual(pastBlock, plan.blocks[0], "the past block must survive the round-trip through chat-cli.ts byte-identical");
  store.close();
});

test("runChatCli: Mid-Day Re-Flow trigger says so plainly when no Plan exists yet for today", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["reflow"]);

  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => LATE_EVENING_UTC, async () => []);

  assert.ok(io.written.some((line) => /no plan/i.test(line)));
  store.close();
});

// ============================================================================
// isBlockerReportCommand / runChatCli — Logistics-Only Blocker Handling
// (Task 16 / Story 2.4, FR-10, UX-DR12)
// ============================================================================

test("isBlockerReportCommand recognizes documented starting keyword/phrase heuristics, case-insensitively", () => {
  for (const line of [
    "meeting ran over",
    "the meeting ran over",
    "the call ran over",
    "running late",
    "I'm running late",
    "I ran late",
    "something came up",
    "stuck in traffic",
    "I'm stuck in traffic",
    "call went long",
    "the call went long",
    "the meeting ran long",
    "got held up",
    "held up",
    "got stuck",
    "got interrupted",
    "MEETING RAN OVER",
  ]) {
    assert.equal(isBlockerReportCommand(line), true, `expected "${line}" to be recognized as a Blocker report`);
  }
});

test(
  "isBlockerReportCommand returns false for unrelated input, including other recognized commands and (post-review fix) plausible unrelated " +
    "sentences that merely CONTAIN a formerly-bare-word trigger",
  () => {
    for (const line of [
      "hello",
      "time budget 6h",
      "show plan",
      "reflow my day",
      "what's the weather",
      "",
      // Post-review Important fix: `\btraffic\b` and `\bdelayed\b` used to be
      // bare single-word triggers, matching ANYWHERE inside free text with
      // no co-occurring signal. Both plausibly appear in an ordinary
      // question or an unrelated statement, and — because AD-3 makes the
      // Blocker path unconditional with no confirmation gate — a false
      // match here would silently mutate and persist a change to Spencer's
      // Plan instead of answering what he actually asked/said.
      "what's traffic like on I-95 right now",
      "how's traffic looking this morning",
      "my package got delayed",
      "the flight was delayed by two hours",
      // Post-review fix: the old `\b(meeting|call)\s+(ran|went)\b` catch-all
      // required no continuation after "ran"/"went", so it falsely matched
      // ordinary good-news statements too.
      "the meeting went great",
      "the call went really well",
    ]) {
      assert.equal(isBlockerReportCommand(line), false, `expected "${line}" NOT to be recognized as a Blocker report`);
    }
  },
);

function blockerSamplePlan(date: IsoDate, nowIso: string): Plan {
  const nowMs = Date.parse(nowIso);
  const start = new Date(nowMs - 30 * 60_000).toISOString();
  const end = new Date(nowMs - 5 * 60_000).toISOString(); // scheduled end already passed by the time of the report
  return {
    id: `plan-${date}`,
    date,
    blocks: [{ id: "work-0", kind: "work", start, end, label: "Blocked Task", taskId: "t1" }],
    reasoning: '"Blocked Task" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: start,
    updatedAt: start,
  };
}

test("runChatCli: a recognized Blocker report reschedules immediately and responds with a single confirmation line, no discussion (UX-DR12, AD-3)", async () => {
  const store = tempStore();
  const BLOCKER_NOW = new Date("2026-08-22T18:30:00.000Z");
  const today = localIsoDate(BLOCKER_NOW, TEST_TIME_ZONE);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  putPlan(store, blockerSamplePlan(today, BLOCKER_NOW.toISOString()));

  const tasks: Task[] = [makeTask("t1", "Blocked Task", { dueDate: today })];
  const io = makeScriptedIo(["meeting ran over"]);
  const llmClient = makeFakeLlmClient();

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient, () => BLOCKER_NOW, async () => tasks);

  assert.equal(llmClient.calls.length, 0, "a recognized Blocker report must never fall through to the LLM catch-all");
  assert.equal(io.written.length, 1, "a Blocker report response must be exactly one printed line");
  const response = io.written[0]!;
  assert.equal(response.includes("\n"), false, "the confirmation must be a single line, not multi-line");
  assert.doesNotMatch(response, /Today's Plan for/, "must not print a full plan view");
  assert.doesNotMatch(
    response,
    /should|recommend|suggest|next time|try to|advice/i,
    "must contain no suggestions/commentary about resolving the underlying obstacle",
  );

  const updated = getPlan(store, today);
  assert.ok(updated);
  assert.equal(updated!.data.version, 2, "the Plan must be rescheduled immediately — no confirmation gate (AD-3)");
  assert.equal(
    store.listRecordsByKind("interaction-request").length,
    0,
    "no Proposal/interaction request may be opened for a Blocker report (AD-3 carve-out)",
  );
  store.close();
});

test("runChatCli: Blocker report trigger says so plainly when no Plan exists yet for today", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["meeting ran over"]);

  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => LATE_EVENING_UTC, async () => []);

  assert.ok(io.written.some((line) => /no plan/i.test(line)));
  store.close();
});

// ============================================================================
// parseWhyPrioritizedCommand / runChatCli — Slip-Bump lineage view
// (Task 17 / Story 2.5, UX-DR19)
// ============================================================================

test("parseWhyPrioritizedCommand recognizes 'why is X prioritized [today]' phrasings, case-insensitively, and extracts the Task name", () => {
  assert.equal(parseWhyPrioritizedCommand("why is Draft the memo prioritized"), "Draft the memo");
  assert.equal(parseWhyPrioritizedCommand("why is Draft the memo prioritized today"), "Draft the memo");
  assert.equal(parseWhyPrioritizedCommand("Why Is Draft The Memo Prioritized Today?"), "Draft The Memo");
  assert.equal(parseWhyPrioritizedCommand("  why is Draft the memo prioritized today  "), "Draft the memo");
});

test("parseWhyPrioritizedCommand returns undefined for unrelated input, including other recognized commands", () => {
  for (const line of ["hello", "time budget 6h", "show plan", "reflow", "meeting ran over", "why is the sky blue", ""]) {
    assert.equal(
      parseWhyPrioritizedCommand(line),
      undefined,
      `expected "${line}" NOT to be recognized as a why-prioritized request`,
    );
  }
});

test("runChatCli: 'why is X prioritized' shows a Task's Slip-Bump lineage — consecutive-slip count and current bump level (UX-DR19)", async () => {
  const store = tempStore();
  // Two consecutive slips recorded for this Task before the question is asked.
  recordSlip(store, "t1", "2026-08-20");
  recordSlip(store, "t1", "2026-08-21");

  const tasks: Task[] = [makeTask("t1", "Draft the memo")];
  const io = makeScriptedIo(["why is Draft the memo prioritized today"]);
  const llmClient = makeFakeLlmClient();

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient, () => new Date(NOW), async () => tasks);

  assert.equal(llmClient.calls.length, 0, "a recognized lineage-view request must never fall through to the LLM catch-all");
  const response = io.written.join("\n");
  assert.match(response, /Draft the memo/);
  assert.match(response, /2/, "expected the consecutive-slip count (2) to be shown");
  assert.match(response, /2026-08-21/, "expected the last-slip date to be shown");
  // Slip-Bump curve { cap: 3, step: 1 }: 2 consecutive slips -> bump level 2, not yet at the cap.
  assert.doesNotMatch(response, /\bcap\b/i);
  store.close();
});

test("runChatCli: 'why is X prioritized' reports a Task at the Slip-Bump cap distinctly", async () => {
  const store = tempStore();
  recordSlip(store, "t1", "2026-08-19");
  recordSlip(store, "t1", "2026-08-20");
  recordSlip(store, "t1", "2026-08-21");
  recordSlip(store, "t1", "2026-08-22"); // 4th consecutive slip -- still pinned at the cap of 3.

  const tasks: Task[] = [makeTask("t1", "Draft the memo")];
  const io = makeScriptedIo(["why is Draft the memo prioritized"]);

  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => new Date(NOW), async () => tasks);

  const response = io.written.join("\n");
  assert.match(response, /\bcap\b/i, "expected the response to note the Task is at its Slip-Bump cap");
  store.close();
});

test("runChatCli: 'why is X prioritized' for a Task with no slip history says plainly that no Slip-Bump applies", async () => {
  const store = tempStore();
  const tasks: Task[] = [makeTask("t1", "Draft the memo")];
  const io = makeScriptedIo(["why is Draft the memo prioritized"]);
  const llmClient = makeFakeLlmClient();

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient, () => new Date(NOW), async () => tasks);

  assert.equal(llmClient.calls.length, 0);
  const response = io.written.join("\n");
  assert.match(response, /Draft the memo/);
  assert.match(response, /hasn'?t slipped|no slip-bump|never slipped/i);
  store.close();
});

test("runChatCli: 'why is X prioritized' for an unknown Task name says it couldn't find that Task", async () => {
  const store = tempStore();
  const tasks: Task[] = [makeTask("t1", "Draft the memo")];
  const io = makeScriptedIo(["why is Some Other Task prioritized"]);

  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => new Date(NOW), async () => tasks);

  assert.ok(io.written.some((line) => /couldn'?t find/i.test(line)));
  store.close();
});

// ============================================================================
// Night Ritual close-out prompt (Task 19 / Story 3.1) — surfacing and
// answering `requestKind: "night-close-out"` via chat-cli.ts
// ============================================================================

/** Scripted fake `setTaskStatus` (mirrors `makeFakeLlmClient`'s recording convention) — no live Notion account is available in this environment. */
function makeFakeSetTaskStatus(): ((taskId: string, status: TaskStatus) => Promise<Result<void, YohError>>) & {
  readonly calls: Array<{ readonly taskId: string; readonly status: TaskStatus }>;
} {
  const calls: Array<{ taskId: string; status: TaskStatus }> = [];
  const fn = async (taskId: string, status: TaskStatus): Promise<Result<void, YohError>> => {
    calls.push({ taskId, status });
    return { ok: true, value: undefined };
  };
  return Object.assign(fn, { calls });
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

/** Fake `createNotionPage` binding (Story 6.3 / FR-26) — records every call, returns a fixed `Result` by default. */
function makeFakeCreatePage(
  result: Result<{ pageId: string; url?: string }, YohError> = { ok: true, value: { pageId: "page-1", url: "https://notion.so/page-1" } },
): ((
  database: NotionDatabaseTarget,
  properties: Readonly<Record<string, string>>,
) => Promise<Result<{ pageId: string; url?: string }, YohError>>) & {
  readonly calls: Array<{ readonly database: NotionDatabaseTarget; readonly properties: Readonly<Record<string, string>> }>;
} {
  const calls: Array<{ database: NotionDatabaseTarget; properties: Readonly<Record<string, string>> }> = [];
  const fn = async (database: NotionDatabaseTarget, properties: Readonly<Record<string, string>>) => {
    calls.push({ database, properties });
    return result;
  };
  return Object.assign(fn, { calls });
}

/** Fake `validateNotionPageDraft` binding — returns a fixed `Result<void, YohError>` (draft-time check, Story 6.3). */
function makeFakeValidateDraft(
  result: Result<void, YohError> = { ok: true, value: undefined },
): (database: NotionDatabaseTarget, properties: Readonly<Record<string, string>>) => Promise<Result<void, YohError>> {
  return async () => result;
}

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

function makeFakeApplyCalendarEdit(
  result: Result<{ eventId: string; calendarId: string }, YohError> = { ok: true, value: { eventId: "evt-1", calendarId: "primary" } },
): ((proposal: Proposal<CalendarEditChange>) => Promise<Result<{ eventId: string; calendarId: string }, YohError>>) & {
  readonly calls: Array<Proposal<CalendarEditChange>>;
} {
  const calls: Array<Proposal<CalendarEditChange>> = [];
  const fn = async (proposal: Proposal<CalendarEditChange>) => {
    calls.push(proposal);
    return result;
  };
  return Object.assign(fn, { calls });
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

test("runChatCli surfaces the Night Ritual close-out prompt first and accepts per-block completed/slipped answers", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  const promptRun = await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });
  assert.ok(promptRun.ok && promptRun.value.status === "prompted");
  assert.ok(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID));

  const setTaskStatus = makeFakeSetTaskStatus();
  const io = makeScriptedIo(["completed", "slipped"]);
  const llmClient = makeFakeLlmClient();

  await runChatCli(store, io, TEST_TIME_ZONE, llmClient, () => NIGHT_NOW, async () => [], setTaskStatus);

  assert.ok(io.written.some((l) => l.includes("Draft the memo")), "expected the combined close-out prompt to be printed");
  assert.deepEqual(setTaskStatus.calls, [
    { taskId: "t1", status: "completed" },
    { taskId: "t2", status: "slipped" },
  ]);
  assert.equal(
    getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID),
    undefined,
    "the request is cleared once every named Task is answered",
  );
  assert.equal(llmClient.calls.length, 0, "the close-out prompt is fully resolved before the ordinary loop ever reaches the LLM catch-all");
  store.close();
});

test("runChatCli: a confirmed 'slipped' Task records a real Slip-Bump via the night-ritual answer-processing path (recordSlip, not faked)", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });

  const io = makeScriptedIo(["slipped", "completed"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NIGHT_NOW, async () => [], makeFakeSetTaskStatus());

  const history = getSlipHistory(store, "t1");
  assert.ok(history, "expected a real SlipHistory row for the Task confirmed slipped");
  assert.equal(history!.data.consecutiveSlipCount, 1);
  assert.equal(getSlipHistory(store, "t2"), undefined, "a Task confirmed completed with no prior slip history stays clear");
  store.close();
});

test("runChatCli: a confirmed 'completed' Task with prior slip history gets it cleared via the night-ritual answer-processing path", async () => {
  const store = tempStore();
  recordSlip(store, "t1", "2026-08-20");
  recordSlip(store, "t1", "2026-08-21");
  assert.ok(getSlipHistory(store, "t1"));

  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });

  const io = makeScriptedIo(["completed", "completed"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NIGHT_NOW, async () => [], makeFakeSetTaskStatus());

  assert.equal(getSlipHistory(store, "t1"), undefined, "the Slip-Bump must be cleared, not carried indefinitely");
  store.close();
});

test("runChatCli: an unrecognized close-out answer re-prompts the SAME Task rather than guessing (UX-DR20)", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });

  const setTaskStatus = makeFakeSetTaskStatus();
  const io = makeScriptedIo(["huh?", "completed", "slipped"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NIGHT_NOW, async () => [], setTaskStatus);

  assert.deepEqual(setTaskStatus.calls, [
    { taskId: "t1", status: "completed" },
    { taskId: "t2", status: "slipped" },
  ]);
  assert.ok(io.written.some((l) => /didn'?t understand|try/i.test(l)));
  store.close();
});

test("runChatCli: a Notion write failure re-prompts the same Task rather than silently moving on", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });

  let attempt = 0;
  const flakySetTaskStatus = async (taskId: string, status: TaskStatus): Promise<Result<void, YohError>> => {
    attempt += 1;
    if (attempt === 1) return { ok: false, error: { kind: "unreachable", message: "notion: 500" } };
    return { ok: true, value: undefined };
  };

  const io = makeScriptedIo(["completed", "completed", "slipped"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NIGHT_NOW, async () => [], flakySetTaskStatus);

  assert.ok(io.written.some((l) => /notion|couldn'?t/i.test(l)), "expected the failure to be surfaced, not swallowed");
  assert.equal(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID), undefined, "eventually resolved once the retry succeeds");
  store.close();
});

test("runChatCli: a PERMANENTLY-failing Notion write can be skipped, unblocking the rest of the close-out and the chat session (Task 19 review fix)", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });

  // t1 fails on EVERY attempt (simulates a Task archived/deleted in Notion
  // between Plan generation and close-out — a permanent 404, not a
  // transient blip retrying would fix). t2 succeeds normally, proving the
  // rest of the close-out still completes after t1 is skipped.
  const perTaskFailingSetTaskStatus = async (taskId: string): Promise<Result<void, YohError>> => {
    if (taskId === "t1") {
      return { ok: false, error: { kind: "unreachable", message: "notion: 404 — page not found" } };
    }
    return { ok: true, value: undefined };
  };

  const io = makeScriptedIo(["completed", "skip", "slipped"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NIGHT_NOW, async () => [], perTaskFailingSetTaskStatus);

  assert.ok(io.written.some((l) => /skip/i.test(l)), "expected the skip to be acknowledged");
  assert.equal(
    getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID),
    undefined,
    "the request must clear once every Task is either answered or skipped — chat must not be permanently blocked",
  );
  assert.equal(getSlipHistory(store, "t1"), undefined, "nothing is recorded for a skipped Task — its real outcome is unknown");
  assert.equal(
    getSlipHistory(store, "t2")?.data.consecutiveSlipCount,
    1,
    "the rest of the close-out (t2) still completes normally after t1 is skipped",
  );
  store.close();
});

// ============================================================================
// Task 21, third post-review fix: a skip during close-out must NOT resolve
// (clear) a matching UncheckedDay record — Spencer hasn't genuinely
// confirmed what happened to a skipped Task, so the flag must survive to
// surface on a future Morning Plan rather than silently vanishing.
// ============================================================================

test("runChatCli: a night that was escalated and then answered with AT LEAST ONE SKIP does NOT clear its UncheckedDay record — the flag survives", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  const promptRun = await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });
  assert.ok(promptRun.ok && promptRun.value.status === "prompted");

  // Both close-out attempts spent, still unanswered — recorded as unchecked
  // (rituals/night-ritual.ts's runNightEscalateRitual, the real production
  // code path, not a hand-seeded fixture).
  const escalated = await runNightEscalateRitual({
    store,
    sendEscalationEmail: async () => {},
    now: () => NIGHT_NOW,
    timeZone: TEST_TIME_ZONE,
  });
  assert.ok(escalated.ok && escalated.value.status === "escalated", `expected escalation, got ${JSON.stringify(escalated)}`);
  assert.ok(getUncheckedDay(store, today), "sanity: recorded as unchecked before Spencer answers");

  // Spencer finally opens chat — but SKIPS one of the two named Tasks
  // (t1 is answered genuinely; t2 is skipped).
  const io = makeScriptedIo(["completed", "skip"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NIGHT_NOW, async () => [], makeFakeSetTaskStatus());

  assert.equal(
    getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID),
    undefined,
    "the request itself still clears once every Task is answered-or-skipped",
  );
  assert.ok(
    getUncheckedDay(store, today),
    "the UncheckedDay record must SURVIVE a skip — Spencer never genuinely confirmed what happened to t2, so the flag must still surface on a future Morning Plan",
  );
});

test("runChatCli: a night that was escalated and then answered with EVERY Task skipped (a full skip-all, not just partial) also does NOT clear its UncheckedDay record", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });

  const escalated = await runNightEscalateRitual({
    store,
    sendEscalationEmail: async () => {},
    now: () => NIGHT_NOW,
    timeZone: TEST_TIME_ZONE,
  });
  assert.ok(escalated.ok && escalated.value.status === "escalated");
  assert.ok(getUncheckedDay(store, today), "sanity: recorded as unchecked before Spencer answers");

  // Both named Tasks are skipped — nothing genuinely confirmed at all.
  const io = makeScriptedIo(["skip", "skip"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NIGHT_NOW, async () => [], makeFakeSetTaskStatus());

  assert.equal(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID), undefined, "the request still clears — skip unblocks the session");
  assert.ok(
    getUncheckedDay(store, today),
    "a full skip-all must ALSO leave the UncheckedDay record intact — this is the exact reviewer-reproduced regression scenario",
  );
});

test("runChatCli: a night that was escalated and then answered with EVERY Task genuinely confirmed (no skips) DOES clear its UncheckedDay record", async () => {
  const store = tempStore();
  const today = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(today));
  await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });

  const escalated = await runNightEscalateRitual({
    store,
    sendEscalationEmail: async () => {},
    now: () => NIGHT_NOW,
    timeZone: TEST_TIME_ZONE,
  });
  assert.ok(escalated.ok && escalated.value.status === "escalated");
  assert.ok(getUncheckedDay(store, today), "sanity: recorded as unchecked before Spencer answers");

  // Spencer answers EVERY named Task genuinely — no skip at all.
  const io = makeScriptedIo(["completed", "slipped"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NIGHT_NOW, async () => [], makeFakeSetTaskStatus());

  assert.equal(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID), undefined);
  assert.equal(
    getUncheckedDay(store, today),
    undefined,
    "a fully, genuinely answered night (no skips) must resolve the UncheckedDay record — confirms Task 21's second post-review fix still works after the third",
  );
});

test("runChatCli: a close-out answered the NEXT MORNING records the Slip-Bump against the Plan's own date, not the day it was answered", async () => {
  const store = tempStore();
  const planDate = localIsoDate(NIGHT_NOW, TEST_TIME_ZONE);
  putPlan(store, closeOutPlan(planDate));
  await runNightPromptRitual({ store, sendNotification: async () => {}, now: () => NIGHT_NOW, timeZone: TEST_TIME_ZONE });

  // Spencer doesn't open chat until the NEXT day.
  const NEXT_MORNING = new Date(NIGHT_NOW.getTime() + 12 * 60 * 60_000);
  const nextMorningLocalDate = localIsoDate(NEXT_MORNING, TEST_TIME_ZONE);
  assert.notEqual(nextMorningLocalDate, planDate, "test setup sanity: the answer genuinely lands on a different local day");

  const io = makeScriptedIo(["slipped", "completed"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => NEXT_MORNING, async () => [], makeFakeSetTaskStatus());

  const history = getSlipHistory(store, "t1");
  assert.ok(history);
  assert.equal(history!.data.lastSlipDate, planDate, "the slip must be recorded against the Plan's own date, not the answer date");
  store.close();
});

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
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => SELF_CHECK_NOW, async () => []);

  assert.ok(io.written.some((l) => /1-10|number/i.test(l)), "expected the Self-Check prompt itself to be printed");
  assert.equal(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), undefined, "the request is cleared once a complete answer is given");

  const state = getSelfCheckState(store);
  assert.equal(state?.data.lastScore, 8);
  assert.equal(state?.data.lastReason, "things are going well");
});

test("UX-DR15: a score-only answer (no written reason) is NOT accepted as complete — the request stays open and re-prompts", async () => {
  const store = tempStore();
  await openSelfCheckRequest(store);

  // "7" alone (a bare number, no reason) must not resolve the prompt.
  const io = makeScriptedIo(["7"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => SELF_CHECK_NOW, async () => []);

  assert.ok(
    getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID),
    "a bare number alone must not clear the request — both a score AND a reason are required",
  );
  assert.equal(getSelfCheckState(store)?.data.lastScore, undefined, "nothing should have been recorded from an incomplete answer");
  assert.ok(io.written.some((l) => /reason|both/i.test(l)), "expected Yoh to explain that both a number and a reason are needed");
});

test("a score-only answer re-prompts the SAME question rather than moving on, and a subsequent complete answer resolves it", async () => {
  const store = tempStore();
  await openSelfCheckRequest(store);

  const io = makeScriptedIo(["7", "4 felt a bit off this week"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => SELF_CHECK_NOW, async () => []);

  assert.equal(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), undefined, "resolved once a genuinely complete answer follows");
  const state = getSelfCheckState(store);
  assert.equal(state?.data.lastScore, 4);
  assert.equal(state?.data.lastReason, "felt a bit off this week");
});

test("runChatCli: a blank line to an open Self-Check prompt keeps waiting rather than clearing (UX-DR20)", async () => {
  const store = tempStore();
  await openSelfCheckRequest(store);

  const io = makeScriptedIo(["", "9 all good"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => SELF_CHECK_NOW, async () => []);

  assert.equal(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), undefined);
  assert.equal(getSelfCheckState(store)?.data.lastScore, 9);
});

test("runChatCli: EOF mid-Self-Check-answer leaves the request open, unanswered, for the next session", async () => {
  const store = tempStore();
  await openSelfCheckRequest(store);

  const io = makeScriptedIo([]); // immediate EOF
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => SELF_CHECK_NOW, async () => []);

  assert.ok(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), "the request must survive an EOF mid-answer");
});

test("a low Self-Check score genuinely shortens the next scheduled interval via the real shared curve, end-to-end through chat-cli.ts", async () => {
  const store = tempStore();
  const today = await openSelfCheckRequest(store);

  const io = makeScriptedIo(["2 really struggling this week"]);
  await runChatCli(store, io, TEST_TIME_ZONE, makeFakeLlmClient(), () => SELF_CHECK_NOW, async () => []);

  const state = getSelfCheckState(store);
  assert.ok(state);
  const daysUntilNextDue = (Date.parse(`${state!.data.nextDueDate}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000;
  assert.ok(daysUntilNextDue < 4, `expected a shortened interval for a low score, got ${daysUntilNextDue} days`);
  assert.equal(daysUntilNextDue, 2, "worked number: default 4 days minus this file's curve value (2) = 2");
});

test("parseSelfCheckAnswer: accepts a valid score + reason on one line, rejects a bare number", () => {
  assert.deepEqual(parseSelfCheckAnswer("7 feeling good"), { score: 7, reason: "feeling good" });
  assert.deepEqual(parseSelfCheckAnswer("10 everything is on track"), { score: 10, reason: "everything is on track" });
  assert.equal(parseSelfCheckAnswer("7"), undefined, "a bare number with no reason must not parse as complete (UX-DR15)");
  assert.equal(parseSelfCheckAnswer("7 "), undefined, "trailing whitespace with no actual reason text must not parse as complete");
  assert.equal(parseSelfCheckAnswer("not a number at all"), undefined);
  assert.equal(parseSelfCheckAnswer("11 out of range"), undefined, "score must be 1-10");
  assert.equal(parseSelfCheckAnswer("0 out of range"), undefined, "score must be 1-10");
});

// ============================================================================
// Propose-Don't-Impose confirm/apply pathway (Task 23 / Story 4.2, AD-3)
// ============================================================================

const PROPOSAL_NOW = "2026-08-24T09:00:00.000Z";
const PROPOSAL_REQUEST_ID = "time-budget-proposal";

function makeTimeBudgetProposal(overrides: Partial<Proposal<Partial<TimeBudget>>> = {}): Proposal<Partial<TimeBudget>> {
  return {
    id: "time-budget-change-2026-08-24",
    kind: "time-budget-change",
    entityId: "current",
    entityVersion: "1",
    suggested: { totalMinutes: 480 },
    reason:
      "Tasks have been deferred for 3 consecutive days because they don't fit your declared Time Budget of 360 minutes (6h) — raising it to 480 minutes (8h) might let more of your day actually fit.",
    createdAt: PROPOSAL_NOW,
    ...overrides,
  };
}

function openTimeBudgetProposalRequest(store: MemoryStore, proposal: Proposal<Partial<TimeBudget>>): void {
  putOpenInteractionRequest(store, PROPOSAL_REQUEST_ID, {
    requestKind: "proposal",
    promptText: `${proposal.reason} Reply "yes" to apply this change, or "no" to dismiss it.`,
    detail: { proposal },
    createdAt: PROPOSAL_NOW,
  });
}

// ---- apply() — the generic confirm/apply pathway, unit-tested directly ----

test("apply: answer false ('no') applies nothing and reports 'declined' — the accessor is never even consulted", async () => {
  const proposal = makeTimeBudgetProposal();
  let applyChangeCalls = 0;
  const accessor: ProposalEntityAccessor<Partial<TimeBudget>> = {
    currentVersion: () => "1",
    applyChange: () => {
      applyChangeCalls++;
    },
  };

  const result = await apply(proposal, false, accessor);
  assert.deepEqual(result, { ok: true, value: "declined" });
  assert.equal(applyChangeCalls, 0);
});

test("apply: answer true with a matching live version re-reads, applies the change, and reports 'applied'", async () => {
  const proposal = makeTimeBudgetProposal({ entityVersion: "1" });
  let applied: Partial<TimeBudget> | undefined;
  let versionReads = 0;
  const accessor: ProposalEntityAccessor<Partial<TimeBudget>> = {
    currentVersion: () => {
      versionReads++;
      return "1";
    },
    applyChange: (suggested) => {
      applied = suggested;
    },
  };

  const result = await apply(proposal, true, accessor);
  assert.deepEqual(result, { ok: true, value: "applied" });
  assert.deepEqual(applied, { totalMinutes: 480 });
  assert.ok(versionReads >= 1, "the live entity's version must actually be re-read, not assumed");
});

test("apply: answer true with a MISMATCHED live version (stale) rejects with YohError.kind: 'stale-proposal' — never applies", async () => {
  const proposal = makeTimeBudgetProposal({ entityVersion: "1" });
  let applyChangeCalls = 0;
  const accessor: ProposalEntityAccessor<Partial<TimeBudget>> = {
    currentVersion: () => "2", // the live entity has moved on since the proposal was generated
    applyChange: () => {
      applyChangeCalls++;
    },
  };

  const result = await apply(proposal, true, accessor);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "stale-proposal");
  assert.equal(applyChangeCalls, 0, "the change must never be applied against outdated state");
});

test("apply: answer true when the live entity no longer exists at all (currentVersion undefined) also rejects as stale", async () => {
  const proposal = makeTimeBudgetProposal({ entityVersion: "1" });
  const accessor: ProposalEntityAccessor<Partial<TimeBudget>> = {
    currentVersion: () => undefined,
    applyChange: () => {
      throw new Error("must not be called");
    },
  };

  const result = await apply(proposal, true, accessor);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "stale-proposal");
});

// ---- parseProposalAnswer ----------------------------------------------------

test("parseProposalAnswer recognizes common yes/no variants and rejects anything else", () => {
  for (const yes of ["yes", "y", "Yes", "  yes  ", "yeah", "yep", "confirm", "apply"]) {
    assert.equal(parseProposalAnswer(yes), true, `expected "${yes}" to parse as yes`);
  }
  for (const no of ["no", "n", "No", "nope", "dismiss", "decline"]) {
    assert.equal(parseProposalAnswer(no), false, `expected "${no}" to parse as no`);
  }
  for (const unclear of ["maybe", "sure I guess", "", "later"]) {
    assert.equal(parseProposalAnswer(unclear), undefined, `expected "${unclear}" to be unrecognized`);
  }
});

// ---- End-to-end via surfaceOpenInteractionRequests / runChatCli -----------

test("surfaceOpenInteractionRequests: an open Proposal is surfaced, stating what Yoh wants to do and why", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 });
  const proposal = makeTimeBudgetProposal({ entityVersion: "1" });
  openTimeBudgetProposalRequest(store, proposal);

  const io = makeScriptedIo(["yes"]);
  await surfaceOpenInteractionRequests(store, io);

  assert.ok(io.written.some((l) => l.includes(proposal.reason)), "expected the Proposal's reason to be surfaced");
  store.close();
});

test("surfaceOpenInteractionRequests: a blank answer to an open Proposal is never treated as consent — it keeps waiting rather than clearing (UX-DR16)", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 });
  const proposal = makeTimeBudgetProposal({ entityVersion: "1" });
  openTimeBudgetProposalRequest(store, proposal);

  const io = makeScriptedIo(["", ""]); // blank lines only, then EOF (queue exhausted)
  await surfaceOpenInteractionRequests(store, io);

  assert.ok(getOpenInteractionRequest(store, PROPOSAL_REQUEST_ID), "still open — blank lines are never consent");
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 360, "nothing was applied");
  store.close();
});

test("surfaceOpenInteractionRequests: 'yes' re-reads the live TimeBudget, confirms its version matches, applies the change, and clears the request", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 }); // version 1
  const proposal = makeTimeBudgetProposal({ entityVersion: "1", suggested: { totalMinutes: 480 } });
  openTimeBudgetProposalRequest(store, proposal);

  const io = makeScriptedIo(["yes"]);
  await surfaceOpenInteractionRequests(store, io);

  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 480, "the suggested change was applied");
  assert.equal(getOpenInteractionRequest(store, PROPOSAL_REQUEST_ID), undefined);
  assert.ok(io.written.some((l) => /updated your Time Budget/i.test(l)));
  store.close();
});

test("surfaceOpenInteractionRequests: the live TimeBudget's version has since changed (stale) — apply rejects, no change is applied, and the request clears", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 }); // version 1
  const proposal = makeTimeBudgetProposal({ entityVersion: "1", suggested: { totalMinutes: 480 } });
  openTimeBudgetProposalRequest(store, proposal);

  // The live Time Budget changes AFTER the Proposal was generated (e.g.
  // Spencer declared a new one himself in the meantime) — version bumps to 2.
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 200, workMinutes: 70, breakMinutes: 15 });

  const io = makeScriptedIo(["yes"]);
  await surfaceOpenInteractionRequests(store, io);

  assert.equal(
    getCurrentTimeBudget(store)?.data.totalMinutes,
    200,
    "the stale suggestion must never be applied over Spencer's own newer value",
  );
  assert.equal(getOpenInteractionRequest(store, PROPOSAL_REQUEST_ID), undefined, "the stale request is cleared, not left open forever");
  assert.ok(io.written.some((l) => /can't apply that any more/i.test(l)));
  store.close();
});

test("surfaceOpenInteractionRequests: 'no' applies nothing, and the request is cleared", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 });
  const proposal = makeTimeBudgetProposal({ entityVersion: "1", suggested: { totalMinutes: 480 } });
  openTimeBudgetProposalRequest(store, proposal);

  const io = makeScriptedIo(["no"]);
  await surfaceOpenInteractionRequests(store, io);

  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 360, "nothing was applied");
  assert.equal(getOpenInteractionRequest(store, PROPOSAL_REQUEST_ID), undefined);
  assert.ok(io.written.some((l) => /won't make that change/i.test(l)));
  store.close();
});

test("surfaceOpenInteractionRequests: an unrecognized answer re-prompts rather than guessing", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 });
  const proposal = makeTimeBudgetProposal({ entityVersion: "1", suggested: { totalMinutes: 480 } });
  openTimeBudgetProposalRequest(store, proposal);

  const io = makeScriptedIo(["maybe later", "yes"]);
  await surfaceOpenInteractionRequests(store, io);

  assert.ok(io.written.some((l) => /"yes" or "no"/i.test(l)));
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 480, "eventually resolved once a real answer was given");
  store.close();
});

test("runChatCli surfaces an open Proposal before accepting any other input, and never reaches the LLM catch-all for it", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 });
  const proposal = makeTimeBudgetProposal({ entityVersion: "1" });
  openTimeBudgetProposalRequest(store, proposal);

  const llmClient = makeFakeLlmClient();
  const io = makeScriptedIo(["yes"]);
  await runChatCli(store, io, TEST_TIME_ZONE, llmClient, () => new Date(NOW));

  assert.ok(io.written.some((l) => l.includes(proposal.reason)));
  assert.equal(getOpenInteractionRequest(store, PROPOSAL_REQUEST_ID), undefined);
  assert.equal(llmClient.calls.length, 0, "the Proposal is fully resolved before the ordinary loop ever reaches the LLM catch-all");
  store.close();
});

// ============================================================================
// Review fixes (post-review, Important #1-#3)
// ============================================================================

test("Review fix (Important #1): a 'no' answer resets the deferral streak — the NEXT deferral day starts a FRESH streak (1), not a continuation (4), and does not immediately re-propose", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-20", totalMinutes: 60, workMinutes: 70, breakMinutes: 15 }); // version 1
  putTimeBudgetDeferralStreak(store, { consecutiveDeferralDays: 3, lastDeferralDate: "2026-08-22" });
  const proposal = makeTimeBudgetProposal({ entityVersion: "1", suggested: { totalMinutes: 75 } });
  openTimeBudgetProposalRequest(store, proposal);

  const io = makeScriptedIo(["no"]);
  await surfaceOpenInteractionRequests(store, io);

  assert.equal(getTimeBudgetDeferralStreak(store), undefined, "the streak must be reset once Spencer has genuinely answered");
  assert.equal(getOpenInteractionRequest(store, PROPOSAL_REQUEST_ID), undefined);
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 60, "nothing was applied on 'no'");

  // The very next deferral day, through the real production wiring
  // (rituals/morning-ritual.ts's step 8.5) — not a hand-simulated streak.
  const deps: MorningRitualDeps = {
    store,
    readTasks: async () => [makeTask("t1", "Rebuild the deck", { estimatedDurationMinutes: 600 })],
    readCalendarEvents: async () => [],
    sendNotification: async () => {},
    now: () => new Date("2026-08-23T13:00:00.000Z"),
    timeZone: "UTC",
    color: false,
  };
  const result = await runMorningRitual(deps);
  assert.ok(result.ok && result.value.status === "nothing-fits");

  const freshStreak = getTimeBudgetDeferralStreak(store);
  assert.equal(freshStreak?.data.consecutiveDeferralDays, 1, "a FRESH streak, not a continuation of the pre-answer count of 3 (would be 4)");
  assert.equal(
    getOpenInteractionRequest(store, TIME_BUDGET_PROPOSAL_REQUEST_ID),
    undefined,
    "no immediate re-prompt — a streak of 1 is well below the 3-day threshold",
  );
  store.close();
});

test("Review fix (Important #1): a 'yes' answer ALSO resets the deferral streak — the day-4 deferral does not stack a second increase on top of the one just accepted", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-20", totalMinutes: 60, workMinutes: 70, breakMinutes: 15 }); // version 1
  putTimeBudgetDeferralStreak(store, { consecutiveDeferralDays: 3, lastDeferralDate: "2026-08-22" });
  const proposal = makeTimeBudgetProposal({ entityVersion: "1", suggested: { totalMinutes: 75 } });
  openTimeBudgetProposalRequest(store, proposal);

  const io = makeScriptedIo(["yes"]);
  await surfaceOpenInteractionRequests(store, io);

  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 75, "the accepted change was applied");
  assert.equal(getTimeBudgetDeferralStreak(store), undefined, "the streak resets even on 'yes' — an accepted change must not compound");
  store.close();
});

test("Review fix (Important #2): apply's accessor throwing a genuine ConflictError (memory-store.ts's own optimistic-concurrency check) is caught and returned as a Result failure, not an unhandled throw", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 }); // version 1
  const staleVersion = getCurrentTimeBudget(store)!.version;
  // A concurrent writer races ahead (e.g. ritual-cli.ts, AD-10) between
  // apply()'s version check and its own write attempt.
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 400, workMinutes: 70, breakMinutes: 15 }); // version 2

  const proposal = makeTimeBudgetProposal({ entityVersion: String(staleVersion) });
  const accessor: ProposalEntityAccessor<Partial<TimeBudget>> = {
    currentVersion: () => String(staleVersion), // the narrow window apply() itself can't fully close
    applyChange: () => {
      // Forces memory-store.ts's REAL optimistic-concurrency check to fire
      // — a genuine ConflictError, not a hand-rolled fake (mirrors
      // tests/memory-store.test.ts's own precedent for forcing one).
      store.readModifyWrite<TimeBudget>("time-budget", "current", staleVersion, () => ({
        date: "2026-08-24",
        totalMinutes: 480,
        workMinutes: 70,
        breakMinutes: 15,
      }));
    },
  };

  const result = await apply(proposal, true, accessor);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "conflict");
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 400, "the conflicting write must not have applied");
  store.close();
});

test("Review fix (Important #2): apply's accessor throwing a plain Error is caught and returned as a Result failure (kind: 'unreachable'), not an unhandled throw", async () => {
  const proposal = makeTimeBudgetProposal({ entityVersion: "1" });
  const accessor: ProposalEntityAccessor<Partial<TimeBudget>> = {
    currentVersion: () => "1",
    applyChange: () => {
      throw new Error("disk full");
    },
  };

  const result = await apply(proposal, true, accessor);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.match(result.error.message, /disk full/);
});

test("Review fix (Important #2): a ConflictError's own .yohError is passed through verbatim, not re-wrapped", async () => {
  const proposal = makeTimeBudgetProposal({ entityVersion: "1" });
  const conflict = new ConflictError("memory-store: conflicting write to time-budget/current — expected version 1, found 2", {
    kind: "time-budget",
    id: "current",
  });
  const accessor: ProposalEntityAccessor<Partial<TimeBudget>> = {
    currentVersion: () => "1",
    applyChange: () => {
      throw conflict;
    },
  };

  const result = await apply(proposal, true, accessor);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, conflict.yohError);
});

// ============================================================================
// isCalendarEditCommand — pure trigger recognition (Story 6.6 / FR-27)
// ============================================================================

test("isCalendarEditCommand recognizes move/reschedule/resize/extend/schedule/block-off phrasings", () => {
  for (const line of [
    "move team sync to 6pm",
    "reschedule my meeting to 5",
    "resize team sync to end at 6",
    "extend team sync to 6pm",
    "schedule a focus block from 2 to 3",
    "block off 2-3pm for deep work",
  ]) {
    assert.equal(isCalendarEditCommand(line), true, `expected "${line}" to be recognized`);
  }
});

test("isCalendarEditCommand returns false for unrelated input — including a delete request, which has no trigger at all", () => {
  for (const line of ["what's my plan", "create a task to buy boots", "search for the weather", "delete my team sync", "remove the 3pm meeting"]) {
    assert.equal(isCalendarEditCommand(line), false, `expected "${line}" NOT to be recognized`);
  }
});

// ============================================================================
// Calendar editing flow, end-to-end via runChatCli (Story 6.6 / FR-27)
// ============================================================================

const TEAM_SYNC: CalendarEvent = { id: "evt-1", title: "Team sync", start: "2026-09-18T15:00:00.000Z", end: "2026-09-18T16:00:00.000Z" };

async function runCalendarEditSession(
  lines: readonly string[],
  llmResponse: string,
  deps: {
    readonly events?: readonly CalendarEvent[];
    readonly route?: { readonly kind: "owned" } | { readonly kind: "external" };
    readonly propose?: ReturnType<typeof makeFakeProposeCalendarEdit>;
    readonly apply?: ReturnType<typeof makeFakeApplyCalendarEdit>;
    readonly readEvents?: () => Promise<readonly CalendarEvent[]>;
  } = {},
): Promise<{
  readonly io: ReturnType<typeof makeScriptedIo>;
  readonly propose: ReturnType<typeof makeFakeProposeCalendarEdit>;
  readonly apply: ReturnType<typeof makeFakeApplyCalendarEdit>;
}> {
  const store = tempStore();
  const io = makeScriptedIo(lines);
  const propose = deps.propose ?? makeFakeProposeCalendarEdit();
  const apply = deps.apply ?? makeFakeApplyCalendarEdit();
  await runChatCli(
    store,
    io,
    TEST_TIME_ZONE,
    makeFakeLlmClient(llmResponse),
    () => new Date(NOW),
    async () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    deps.readEvents ?? makeFakeReadCalendarEvents(deps.events ?? []),
    makeFakeResolveCalendarEditRoute(deps.route ?? { kind: "external" }),
    propose,
    apply,
  );
  store.close();
  return { io, propose, apply };
}

test("moving a named event: draft -> route (external) -> propose -> confirm -> apply, with a receipt naming the event and change", async () => {
  const { io, propose, apply } = await runCalendarEditSession(
    ["move team sync to 6pm", "yes"],
    "MOVE: Team sync | 2026-09-18T18:00:00.000Z",
    { events: [TEAM_SYNC] },
  );

  assert.equal(propose.calls.length, 1);
  assert.equal(apply.calls.length, 1);
  assert.ok(io.written.some((line) => /Moved "Team sync" to/.test(line)), `expected a receipt naming the event, got: ${io.written.join(" | ")}`);
});

test("resizing a named event proposes a resize and applies it on confirm", async () => {
  const { io, apply } = await runCalendarEditSession(
    ["extend team sync to 5:30", "yes"],
    "RESIZE: Team sync | 2026-09-18T21:30:00.000Z",
    { events: [TEAM_SYNC] },
  );

  assert.equal(apply.calls.length, 1);
  assert.equal(apply.calls[0]!.suggested.kind, "resize");
  assert.ok(io.written.some((line) => /Resized "Team sync" to end at/.test(line)));
});

test("the confirm preview names the specific event before anything is applied", async () => {
  const { io } = await runCalendarEditSession(["move team sync to 6pm", "no"], "MOVE: Team sync | 2026-09-18T18:00:00.000Z", {
    events: [TEAM_SYNC],
  });

  assert.ok(io.written.some((line) => /Move "Team sync" to/.test(line)));
});

test("declining the proposed edit applies nothing", async () => {
  const { io, apply } = await runCalendarEditSession(["move team sync to 6pm", "no"], "MOVE: Team sync | 2026-09-18T18:00:00.000Z", {
    events: [TEAM_SYNC],
  });

  assert.equal(apply.calls.length, 0);
  assert.ok(io.written.some((line) => /won't make that change/i.test(line)));
});

test("an event resolveCalendarEditRoute reports as 'owned' is declined — this path never touches it, deferring to the automatic re-flow path", async () => {
  const { propose, apply } = await runCalendarEditSession(["move yoh block to 6pm"], "MOVE: Yoh block | 2026-09-18T18:00:00.000Z", {
    events: [{ ...TEAM_SYNC, title: "Yoh block" }],
    route: { kind: "owned" },
  });

  assert.equal(propose.calls.length, 0);
  assert.equal(apply.calls.length, 0);
});

test("creating a new time block skips route resolution entirely and proposes/applies directly on the primary calendar", async () => {
  const { io, apply } = await runCalendarEditSession(
    ["block off 2-3pm for focus time", "yes"],
    "CREATE: Focus block | 2026-09-18T18:00:00.000Z | 2026-09-18T19:00:00.000Z",
  );

  assert.equal(apply.calls.length, 1);
  assert.equal(apply.calls[0]!.suggested.kind, "create");
  if (apply.calls[0]!.suggested.kind === "create") assert.equal(apply.calls[0]!.suggested.calendarId, "primary");
  assert.ok(io.written.some((line) => /Created "Focus block" from/.test(line)));
});

test("an event named in the request that isn't found among today's events reports plainly, nothing is proposed", async () => {
  const { io, propose, apply } = await runCalendarEditSession(
    ["move nonexistent meeting to 6pm"],
    "MOVE: Nonexistent meeting | 2026-09-18T18:00:00.000Z",
  );

  assert.equal(propose.calls.length, 0);
  assert.equal(apply.calls.length, 0);
  assert.ok(io.written.some((line) => /couldn't find/i.test(line)));
});

test("a request the LLM can't turn into a structured edit is reported plainly, nothing is proposed or applied", async () => {
  const { io, propose, apply } = await runCalendarEditSession(["move it somewhere"], "NONE", { events: [TEAM_SYNC] });

  assert.equal(propose.calls.length, 0);
  assert.equal(apply.calls.length, 0);
  assert.ok(io.written.some((line) => /couldn't tell what calendar change/i.test(line)));
});

test("an apply failure (e.g. a stale proposal) is reported instead of a success receipt", async () => {
  const apply = makeFakeApplyCalendarEdit({ ok: false, error: { kind: "stale-proposal", message: "the event has changed" } });
  const { io } = await runCalendarEditSession(["move team sync to 6pm", "yes"], "MOVE: Team sync | 2026-09-18T18:00:00.000Z", {
    events: [TEAM_SYNC],
    apply,
  });

  assert.ok(io.written.some((line) => /couldn't apply that: the event has changed/i.test(line)));
  assert.ok(!io.written.some((line) => /^Moved /.test(line)));
});

test("a thrown error while reading today's events (e.g. Google auth not configured) is surfaced as a line, not a crash", async () => {
  const { io, apply } = await runCalendarEditSession(["move team sync to 6pm"], "MOVE: Team sync | 2026-09-18T18:00:00.000Z", {
    readEvents: async () => {
      throw new Error("no Google credentials");
    },
  });

  assert.equal(apply.calls.length, 0);
  assert.ok(io.written.some((line) => /no Google credentials/.test(line)));
});

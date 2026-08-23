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
  putOpenInteractionRequest,
  getTaskFieldOverride,
  mergeTaskFieldOverride,
  getCurrentTimeBudget,
} from "../src/adapters/memory-store.ts";
import type { MemoryStore } from "../src/adapters/memory-store.ts";
import {
  buildMissingFieldsPromptText,
  syncDataCompletenessInteractionRequest,
  surfaceOpenInteractionRequests,
  runChatCli,
  parseFieldAnswer,
  applyTaskFieldOverride,
  mergeStoredOverrides,
  DATA_COMPLETENESS_REQUEST_ID,
  parseTimeBudgetCommand,
  declareTimeBudget,
  type ChatCliIo,
} from "../src/shell/chat-cli.ts";
import { checkDataCompleteness, type MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import type { Task } from "../src/types/domain.ts";

function tempStore(): MemoryStore {
  return createMemoryStore({ databasePath: ":memory:" });
}

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

  await surfaceOpenInteractionRequests(store, io);

  assert.ok(io.written.some((line) => line.includes("Call dentist")), "expected the prompt to be printed");
  store.close();
});

test("surfaceOpenInteractionRequests clears the request once a non-empty answer is given", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  const io = makeScriptedIo(["Work"]);

  await surfaceOpenInteractionRequests(store, io);

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

  await surfaceOpenInteractionRequests(store, io);

  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

test("runChatCli surfaces an open interaction request before accepting any other input", async () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Call dentist", { area: undefined })]);
  // First line answers the prompt; second line is what would be an
  // "unrelated command" if it were processed before the prompt.
  const io = makeScriptedIo(["Work", "show me today's plan"]);

  await runChatCli(store, io);

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

  await runChatCli(store, io);

  assert.ok(!io.written.some((line) => line.includes("I need a bit more")));
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
  await surfaceOpenInteractionRequests(store, io);

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

test("end-to-end: a Task missing multiple fields is answered field-by-field in one surfacing pass, each stored as its own override", async () => {
  const store = tempStore();
  const rawTask = makeTask("t1", "Plan trip", { area: undefined, dueDate: undefined });

  syncDataCompletenessInteractionRequest(store, [rawTask]);
  const io = makeScriptedIo(["Health", "2026-09-01"]);
  await surfaceOpenInteractionRequests(store, io);

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

  await surfaceOpenInteractionRequests(store, io);

  const override = getTaskFieldOverride(store, "t1");
  assert.equal(override?.data.estimatedDurationMinutes, 45);
  assert.ok(
    io.written.some((line) => /didn't understand|invalid|couldn't/i.test(line)),
    "expected a re-prompt/error message for the unparseable first answer",
  );
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

test("runChatCli: typing a Time Budget command persists it and confirms back to Spencer", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["time budget 6h"]);

  await runChatCli(store, io);

  const stored = getCurrentTimeBudget(store);
  assert.equal(stored?.data.totalMinutes, 360);
  assert.ok(
    io.written.some((line) => /360|6h|6 hours?/i.test(line)),
    "expected a confirmation line mentioning the new Time Budget",
  );
  store.close();
});

test("runChatCli: an invalid Time Budget amount is reported as an error, not silently persisted", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["time budget 30 hours"]); // 1800 minutes > 24h cap

  await runChatCli(store, io);

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
  // match `parseTimeBudgetCommand` fall through to the free-text placeholder
  // without ever calling `putTimeBudget` again.
  declareTimeBudget(store, 360, "2026-08-21");
  const before = getCurrentTimeBudget(store);

  const io = makeScriptedIo(["hello", "show me today's plan"]);
  await runChatCli(store, io);

  const after = getCurrentTimeBudget(store);
  assert.deepEqual(after?.data, before?.data);
  assert.equal(after?.version, before?.version);
  store.close();
});

test("runChatCli: falls through to the free-text placeholder for input that isn't a Time Budget command", async () => {
  const store = tempStore();
  const io = makeScriptedIo(["what's the weather"]);

  await runChatCli(store, io);

  assert.ok(io.written.some((line) => line.includes("free-text routing arrives in a later task")));
  store.close();
});

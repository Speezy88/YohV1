/**
 * Tests for `src/rituals/night-ritual.ts` (Story 3.1 / Task 19).
 *
 * Two halves, tested separately (see the file's own docstring):
 *  1. `runNightPromptRitual` — the one-shot, non-blocking `night-prompt`
 *     half: reads today's stored Plan and persists an open interaction
 *     request naming every `work` block's Task, then exits.
 *  2. `applyNightCloseOutConfirmation` — the answer-processing half `chat-
 *     cli.ts` calls once Spencer confirms a Task's status: writes Notion via
 *     an injected `setTaskStatus`, then triggers the REAL `slip-bump.ts`
 *     computation (`recordSlip`/`clearSlip`), exactly as a mid-day-reported
 *     slip would (Task 17's own AC).
 *
 * No network, no real clock: every I/O edge is injected, `now` is always
 * pinned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMemoryStore,
  getOpenInteractionRequest,
  getRitualRun,
  getSlipHistory,
  putPlan,
  recordSlip,
  type MemoryStore,
} from "../src/adapters/memory-store.ts";
import { computeSlipBumpLevel } from "../src/core/slip-bump.ts";
import {
  applyNightCloseOutConfirmation,
  buildNightCloseOutPromptText,
  NIGHT_CLOSE_OUT_REQUEST_ID,
  NIGHT_PROMPT_RITUAL_ID,
  runNightPromptRitual,
  type NightCloseOutRequestDetail,
  type NightPromptRitualDeps,
} from "../src/rituals/night-ritual.ts";
import type { Plan, PlanBlock, Result, TaskStatus, YohError } from "../src/types/domain.ts";

const NOW_ISO = "2026-08-22T22:00:00.000Z"; // "tonight"
const TODAY = "2026-08-22";

function tempStore(): MemoryStore {
  return createMemoryStore({ databasePath: ":memory:" });
}

function block(over: Partial<PlanBlock> & Pick<PlanBlock, "id" | "kind" | "start" | "end" | "label">): PlanBlock {
  return over;
}

function samplePlan(blocks: readonly PlanBlock[]): Plan {
  return {
    id: `plan-${TODAY}`,
    date: TODAY,
    blocks,
    reasoning: "Some reasoning.",
    version: 1,
    createdAt: "2026-08-22T13:00:00.000Z",
    updatedAt: "2026-08-22T13:00:00.000Z",
  };
}

function deps(store: MemoryStore, overrides: Partial<NightPromptRitualDeps> = {}): NightPromptRitualDeps {
  return {
    store,
    now: () => new Date(NOW_ISO),
    timeZone: "UTC",
    ...overrides,
  };
}

// ============================================================================
// runNightPromptRitual — persist-and-exit half (AD-5)
// ============================================================================

test("persists an open interaction request naming every work block's Task, and exits without waiting", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" }),
      block({ id: "break-0", kind: "break", start: "2026-08-22T14:00:00.000Z", end: "2026-08-22T14:15:00.000Z", label: "Break" }),
      block({ id: "calendar-anchor-0", kind: "calendar-anchor", start: "2026-08-22T14:15:00.000Z", end: "2026-08-22T14:45:00.000Z", label: "Standup" }),
      block({ id: "work-1", kind: "work", start: "2026-08-22T15:00:00.000Z", end: "2026-08-22T16:00:00.000Z", label: "Book the flights", taskId: "t2" }),
    ]),
  );

  const result = await runNightPromptRitual(deps(store));
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "prompted");

  const request = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID);
  assert.ok(request, "expected an open night-close-out interaction request");
  assert.equal(request.data.requestKind, "night-close-out");
  assert.match(request.data.promptText, /Draft the memo/);
  assert.match(request.data.promptText, /Book the flights/);

  const detail = request.data.detail as NightCloseOutRequestDetail;
  assert.deepEqual(
    detail.tasks.map((t) => t.taskId),
    ["t1", "t2"],
    "every work block's Task is named — break/calendar-anchor blocks are skipped",
  );
});

test("skips break and calendar-anchor blocks — only work blocks are named", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "break-0", kind: "break", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T13:15:00.000Z", label: "Break" }),
      block({ id: "calendar-anchor-0", kind: "calendar-anchor", start: "2026-08-22T13:15:00.000Z", end: "2026-08-22T13:45:00.000Z", label: "Standup" }),
    ]),
  );

  const result = await runNightPromptRitual(deps(store));
  assert.ok(result.ok);
  assert.equal(result.value.status, "nothing-to-confirm");
  assert.equal(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID), undefined);
});

test("no Plan generated yet today: reports so, opens no request, and does not burn the day (a later trigger can still prompt)", async () => {
  const store = tempStore();
  const result = await runNightPromptRitual(deps(store));
  assert.ok(result.ok);
  assert.equal(result.value.status, "no-plan-today");
  assert.equal(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID), undefined);
  assert.equal(getRitualRun(store, NIGHT_PROMPT_RITUAL_ID), undefined);
});

test("a Task with multiple work blocks (e.g. split by Mid-Day Re-Flow) is named exactly once, not once per block", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T13:30:00.000Z", label: "Draft the memo", taskId: "t1" }),
      block({ id: "work-1", kind: "work", start: "2026-08-22T14:00:00.000Z", end: "2026-08-22T14:30:00.000Z", label: "Draft the memo", taskId: "t1" }),
    ]),
  );

  const result = await runNightPromptRitual(deps(store));
  assert.ok(result.ok && result.value.status === "prompted");
  const request = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID);
  const detail = request!.data.detail as NightCloseOutRequestDetail;
  assert.equal(detail.tasks.length, 1, "the same Task must be named only once");
});

test("triggered twice the same night: the second trigger does not re-persist a duplicate/redundant request", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" }),
    ]),
  );

  const first = await runNightPromptRitual(deps(store));
  assert.ok(first.ok && first.value.status === "prompted");
  const firstRecord = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID);
  assert.ok(firstRecord);

  const second = await runNightPromptRitual(deps(store));
  assert.ok(second.ok, `expected success, got ${JSON.stringify(second)}`);
  assert.equal(second.value.status, "already-ran");

  const secondRecord = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID);
  assert.ok(secondRecord);
  assert.equal(secondRecord.version, firstRecord!.version, "the same request must not be re-persisted/replaced");
  assert.equal(secondRecord.data.createdAt, firstRecord!.data.createdAt);
});

test("AD-5: night-ritual.ts's night-prompt half never waits for input — the file reads no stdin at all", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "rituals", "night-ritual.ts"), "utf8");
  assert.doesNotMatch(source, /node:readline/, "a one-shot, never-blocking ritual file must not open a readline interface");
  assert.doesNotMatch(source, /process\.stdin/, "a one-shot, never-blocking ritual file must not read stdin");
});

test("the ran-today marker records the date night-prompt last ran", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" }),
    ]),
  );
  await runNightPromptRitual(deps(store));
  const run = getRitualRun(store, NIGHT_PROMPT_RITUAL_ID);
  assert.equal(run?.data.date, TODAY);
});

// ============================================================================
// buildNightCloseOutPromptText — pure formatting
// ============================================================================

test("buildNightCloseOutPromptText names every Task and asks for completed/slipped", () => {
  const text = buildNightCloseOutPromptText([
    { taskId: "t1", taskTitle: "Draft the memo" },
    { taskId: "t2", taskTitle: "Book the flights" },
  ]);
  assert.match(text, /Draft the memo/);
  assert.match(text, /Book the flights/);
  assert.match(text, /completed|slipped/i);
});

// ============================================================================
// applyNightCloseOutConfirmation — the answer-processing half
// ============================================================================

function applyDeps(
  store: MemoryStore,
  setTaskStatus: (taskId: string, status: TaskStatus) => Promise<Result<void, YohError>> = async () => ({
    ok: true,
    value: undefined,
  }),
) {
  return { store, setTaskStatus };
}

test("a confirmed 'completed' Task writes Status to Notion via the injected setTaskStatus", async () => {
  const store = tempStore();
  const calls: Array<{ taskId: string; status: TaskStatus }> = [];
  const setTaskStatus = async (taskId: string, status: TaskStatus): Promise<Result<void, YohError>> => {
    calls.push({ taskId, status });
    return { ok: true, value: undefined };
  };

  const result = await applyNightCloseOutConfirmation(applyDeps(store, setTaskStatus), "t1", "completed", TODAY);
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.deepEqual(calls, [{ taskId: "t1", status: "completed" }]);
});

test("a confirmed 'slipped' Task gets a REAL Slip-Bump via recordSlip — genuinely computed via computeEscalation, not faked", async () => {
  const store = tempStore();
  assert.equal(getSlipHistory(store, "t1"), undefined, "sanity: no prior slip history");

  const result = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "slipped", TODAY);
  assert.ok(result.ok);

  const history = getSlipHistory(store, "t1");
  assert.ok(history, "expected a real SlipHistory row to have been written");
  assert.equal(history.data.consecutiveSlipCount, 1);
  assert.equal(history.data.lastSlipDate, TODAY);

  // The resulting bump level is genuinely computed by core/slip-bump.ts's
  // computeSlipBumpLevel (which itself delegates to computeEscalation) over
  // the ACTUAL stored count — not a hardcoded/faked number in this file.
  const level = computeSlipBumpLevel(history.data.consecutiveSlipCount);
  assert.equal(level.value, 1);
  assert.equal(level.atCap, false);
});

test("two consecutive slipped confirmations (across two nights) escalate the REAL Slip-Bump level exactly as a mid-day-reported slip would", async () => {
  const store = tempStore();
  await applyNightCloseOutConfirmation(applyDeps(store), "t1", "slipped", "2026-08-21");
  await applyNightCloseOutConfirmation(applyDeps(store), "t1", "slipped", "2026-08-22");

  const history = getSlipHistory(store, "t1");
  assert.equal(history?.data.consecutiveSlipCount, 2);
  const level = computeSlipBumpLevel(history!.data.consecutiveSlipCount);
  assert.equal(level.value, 2, "slip 2 should be exactly double slip 1's bump for this curve");
});

test("a resumed/re-answered close-out for the same Task on the same night does not inflate the Slip-Bump count (Task 19 review fix)", async () => {
  // Simulates: Spencer answers Task 1 'slipped' in chat, then Ctrl-Ds
  // before finishing the rest of the request. The request stays open, and
  // when he re-opens chat, it re-surfaces and re-asks Task 1 from the top
  // — re-answering 'slipped' must NOT count as a second slip for the same
  // night.
  const store = tempStore();
  const first = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "slipped", TODAY);
  assert.ok(first.ok);
  assert.equal(getSlipHistory(store, "t1")?.data.consecutiveSlipCount, 1);

  const resumed = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "slipped", TODAY);
  assert.ok(resumed.ok);
  assert.equal(
    getSlipHistory(store, "t1")?.data.consecutiveSlipCount,
    1,
    "re-confirming the same Task for the same night must not double-count the slip",
  );
});

test("a confirmed 'completed' Task with prior slip history gets clearSlip'd — not carried indefinitely", async () => {
  const store = tempStore();
  recordSlip(store, "t1", "2026-08-20");
  recordSlip(store, "t1", "2026-08-21");
  assert.ok(getSlipHistory(store, "t1"));

  const result = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "completed", TODAY);
  assert.ok(result.ok);
  assert.equal(getSlipHistory(store, "t1"), undefined, "the Slip-Bump must be cleared entirely, not merely reset in place");
});

test("a confirmed 'completed' Task with NO prior slip history is a harmless no-op for Slip-Bump", async () => {
  const store = tempStore();
  const result = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "completed", TODAY);
  assert.ok(result.ok);
  assert.equal(getSlipHistory(store, "t1"), undefined);
});

test("when setTaskStatus fails, no SlipHistory is written or cleared — the Notion write is authoritative before any local state changes", async () => {
  const store = tempStore();
  recordSlip(store, "t1", "2026-08-20"); // pre-existing history, to prove "completed" doesn't clear it on failure either

  const failingSetTaskStatus = async (): Promise<Result<void, YohError>> => ({
    ok: false,
    error: { kind: "unreachable", message: "notion: 500" },
  });

  const slippedResult = await applyNightCloseOutConfirmation(applyDeps(store, failingSetTaskStatus), "t2", "slipped", TODAY);
  assert.equal(slippedResult.ok, false);
  assert.equal(getSlipHistory(store, "t2"), undefined, "no SlipHistory should be written when the Notion write failed");

  const completedResult = await applyNightCloseOutConfirmation(applyDeps(store, failingSetTaskStatus), "t1", "completed", TODAY);
  assert.equal(completedResult.ok, false);
  assert.ok(getSlipHistory(store, "t1"), "the pre-existing SlipHistory must survive a failed write, not be cleared");
});

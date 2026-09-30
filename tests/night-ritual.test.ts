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
  getUncheckedDay,
  listUncheckedDays,
  putOpenInteractionRequest,
  putPlan,
  putRitualRun,
  recordSlip,
  type MemoryStore,
} from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { computeSlipBumpLevel } from "../src/core/slip-bump.ts";
import { listSlipEvents, type RecordCompletionInput } from "../src/adapters/completion-log.ts";
import {
  applyNightCloseOutConfirmation,
  buildNightCloseOutPromptText,
  buildNightEscalationEmail,
  clearNightCloseOutRequestIfOpen,
  collectNightCloseOutTasks,
  isNightCloseOutRequestOpenFor,
  NIGHT_CLOSE_OUT_REQUEST_ID,
  NIGHT_ESCALATE_RITUAL_ID,
  NIGHT_PROMPT_RITUAL_ID,
  recordNightCloseOutHandledWithoutPrompt,
  renderNightEscalateNotice,
  runNightEscalateRitual,
  runNightPromptRitual,
  type NightCloseOutApplyDeps,
  type NightCloseOutRequestDetail,
  type NightEscalateRitualDeps,
  type NightPromptRitualDeps,
} from "../src/rituals/night-ritual.ts";
import { ATTENTION } from "../src/rituals/ritual-shared.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import type { ExternalId, Plan, PlanBlock, Result, Task, TaskStatus, YohError } from "../src/types/domain.ts";

const NOW_ISO = "2026-08-22T22:00:00.000Z"; // "tonight"
const TODAY = "2026-08-22";

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db); // Task 7 (Epic 8): interaction-request writes now append an outbox row.
  return createMemoryStore(connection);
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
    sendNotification: async () => {},
    now: () => new Date(NOW_ISO),
    timeZone: "UTC",
    getCompletedTaskIdsToday: () => new Set(),
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
// The first attempt's own push notification (Task 20 review fix, Important #1)
// ============================================================================

interface RecordedNightPromptNotification {
  readonly title: string;
  readonly message: string;
}

test("a successful night-prompt run sends exactly one Pushover push naming the Tasks to confirm", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" }),
    ]),
  );

  const calls: RecordedNightPromptNotification[] = [];
  const result = await runNightPromptRitual(
    deps(store, {
      sendNotification: async (notification) => {
        calls.push({ title: notification.title, message: notification.message });
      },
    }),
  );

  assert.ok(result.ok && result.value.status === "prompted", `expected success, got ${JSON.stringify(result)}`);
  assert.equal(calls.length, 1, "exactly one push notification is sent per night-prompt run");
  assert.match(calls[0]!.title, /close out/i);
  assert.match(calls[0]!.message, /Draft the memo/);
});

test("the 'nothing-to-confirm' outcome (no work blocks) sends NO push — there is nothing to ask about", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "calendar-anchor-0", kind: "calendar-anchor", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T13:30:00.000Z", label: "Standup" }),
    ]),
  );

  const calls: RecordedNightPromptNotification[] = [];
  const result = await runNightPromptRitual(
    deps(store, {
      sendNotification: async (notification) => {
        calls.push({ title: notification.title, message: notification.message });
      },
    }),
  );

  assert.ok(result.ok && result.value.status === "nothing-to-confirm");
  assert.equal(calls.length, 0);
});

test("AD-8: when the push notification fails, runNightPromptRitual converts it to a Result failure and does NOT mark the day done (so a transient failure can be retried) — consistent with runMorningRitual's own precedent", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" }),
    ]),
  );

  const failingSend: NightPromptRitualDeps["sendNotification"] = async () => {
    throw new Error("Pushover: 502 Bad Gateway");
  };

  const result = await runNightPromptRitual(deps(store, { sendNotification: failingSend }));
  assert.equal(result.ok, false);
  assert.equal(getRitualRun(store, NIGHT_PROMPT_RITUAL_ID), undefined, "a failed push must not burn tonight's night-prompt run");
  // The already-persisted interaction request survives the failed send — a
  // delivery failure must not lose it (Spencer can still find it in chat).
  assert.ok(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID), "the interaction request must survive a failed notification send");
});

// ============================================================================
// Story 7.9 (FR-41/AD-20): excluding Tasks completion-log.ts shows completed
// today from tonight's close-out questions.
// ============================================================================

test("runNightPromptRitual excludes a Task that completion-log.ts shows completed today, even though its work block is in today's Plan", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" }),
      block({ id: "work-1", kind: "work", start: "2026-08-22T14:00:00.000Z", end: "2026-08-22T15:00:00.000Z", label: "Call the dentist", taskId: "t2" }),
    ]),
  );

  const result = await runNightPromptRitual(deps(store, { getCompletedTaskIdsToday: () => new Set(["t1"]) }));

  assert.equal(result.ok, true);
  if (result.ok && result.value.status === "prompted") {
    assert.deepEqual(result.value.tasks.map((t) => t.taskId), ["t2"]);
  } else {
    assert.fail(`expected status "prompted", got ${result.ok ? result.value.status : "error"}`);
  }
  store.close();
});

test("runNightPromptRitual reports 'nothing-to-confirm' when EVERY work-block Task was already completed today", async () => {
  const store = tempStore();
  putPlan(
    store,
    samplePlan([
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" }),
    ]),
  );

  const result = await runNightPromptRitual(deps(store, { getCompletedTaskIdsToday: () => new Set(["t1"]) }));
  assert.ok(result.ok && result.value.status === "nothing-to-confirm", `expected nothing-to-confirm, got ${JSON.stringify(result)}`);
  store.close();
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
// Story 8.7: collectNightCloseOutTasks / isNightCloseOutRequestOpenFor /
// recordNightCloseOutHandledWithoutPrompt — the shared record, extracted and
// widened so `/night` (app/night-close-out.ts) can make night-prompt and
// night-escalate no-ops for a night it already handled interactively.
// ============================================================================

test("collectNightCloseOutTasks: dedupes by taskId, skips break/calendar-anchor blocks, skips Tasks completed today", () => {
  const plan = samplePlan([
    block({ id: "w0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T13:30:00.000Z", label: "Draft the memo", taskId: "t1" }),
    block({ id: "w1", kind: "work", start: "2026-08-22T13:30:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo (cont.)", taskId: "t1" }),
    block({ id: "b0", kind: "break", start: "2026-08-22T14:00:00.000Z", end: "2026-08-22T14:15:00.000Z", label: "Break" }),
    block({ id: "w2", kind: "work", start: "2026-08-22T14:15:00.000Z", end: "2026-08-22T15:00:00.000Z", label: "Email the professor", taskId: "t2" }),
  ]);
  const tasks = collectNightCloseOutTasks(plan, new Set(["t2"]));
  assert.deepEqual(tasks, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
});

test("isNightCloseOutRequestOpenFor: true only when an open request's own detail.date matches", () => {
  const store = tempStore();
  assert.equal(isNightCloseOutRequestOpenFor(store, TODAY), false);
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  assert.equal(isNightCloseOutRequestOpenFor(store, TODAY), true);
  assert.equal(isNightCloseOutRequestOpenFor(store, "2026-08-21"), false);
});

test("recordNightCloseOutHandledWithoutPrompt writes the exact RitualRun record night-prompt's own guard and night-escalate's own disambiguation both read", () => {
  const store = tempStore();
  recordNightCloseOutHandledWithoutPrompt(store, TODAY, "2026-08-22T21:00:00.000Z");
  const run = getRitualRun(store, NIGHT_PROMPT_RITUAL_ID);
  assert.equal(run?.data.date, TODAY);
  assert.equal(run?.data.ranAt, "2026-08-22T21:00:00.000Z");
});

// --- Review Focus #1: a stale open request must not suppress tonight's real prompt ---
test("an open request for an EARLIER date does not stop night-prompt from building tonight's own request", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "stale", taskTitle: "Some old Task" }]); // detail.date defaults to TODAY in the helper — override it:
  const stale = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID)!;
  putOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, { ...stale.data, detail: { ...(stale.data.detail as NightCloseOutRequestDetail), date: "2026-08-20" } });
  putPlan(store, samplePlan([block({ id: "w0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T13:30:00.000Z", label: "Draft the memo", taskId: "t1" })]));

  const sent: string[] = [];
  const result = await runNightPromptRitual(deps(store, { sendNotification: async (n) => void sent.push(n.title) }));
  assert.ok(result.ok && result.value.status === "prompted", `expected a fresh prompt, got ${JSON.stringify(result)}`);
  assert.equal(sent.length, 1, "tonight's own push IS sent — the stale request must not suppress it");
});

// --- Review Focus #2: don't clobber an in-progress /night session ---
test("an open, unanswered request for TODAY (started via /night) makes night-prompt a no-op — no push, no overwrite", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const before = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID)!;
  putPlan(store, samplePlan([block({ id: "w0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T13:30:00.000Z", label: "Draft the memo", taskId: "t1" })]));

  const sent: string[] = [];
  const result = await runNightPromptRitual(deps(store, { sendNotification: async (n) => void sent.push(n.title) }));
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.value.status, "already-ran");
  assert.equal(sent.length, 0, "no push — the in-progress /night session already covers tonight");
  const after = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID)!;
  assert.equal(after.version, before.version, "the open request is not replaced");
});

// --- AC4-pinning integration test: /night → night-prompt no-op → night-escalate no-op → day never unchecked ---
test("AC4: once /night's own flow records the close-out, both night-prompt and night-escalate are full no-ops for that night, and the day is never marked unchecked", async () => {
  const store = tempStore();
  // Simulate /night's completed flow: the request was opened and then fully
  // answered and cleared (app/answer-night-close-out.ts's job), and its
  // final-answer step called the new helper — this is the ONE line Task 5 adds.
  recordNightCloseOutHandledWithoutPrompt(store, TODAY, "2026-08-22T20:00:00.000Z");
  putPlan(store, samplePlan([block({ id: "w0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T13:30:00.000Z", label: "Draft the memo", taskId: "t1" })]));

  const pushed: string[] = [];
  const promptResult = await runNightPromptRitual(deps(store, { sendNotification: async (n) => void pushed.push(n.title) }));
  assert.ok(promptResult.ok && promptResult.value.status === "already-ran");
  assert.equal(pushed.length, 0);

  const emailed: string[] = [];
  const escalateResult = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: async (m) => void emailed.push(m.subject) }));
  assert.ok(escalateResult.ok && escalateResult.value.status === "no-open-request");
  assert.equal(emailed.length, 0);
  assert.deepEqual(listUncheckedDays(store), [], "the day is never marked unchecked");
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
  overrides: Partial<Pick<NightCloseOutApplyDeps, "recordCompletion" | "lookupTask" | "log">> = {},
): NightCloseOutApplyDeps {
  return {
    store,
    setTaskStatus,
    recordCompletion: overrides.recordCompletion ?? ((): void => {}),
    lookupTask: overrides.lookupTask ?? ((): Promise<Task | undefined> => Promise.resolve(undefined)),
    ...(overrides.log ? { log: overrides.log } : {}),
  };
}

/** The completedAt instant most tests in this section pass through — its exact value is irrelevant to Slip-Bump behavior, only to the (separately tested) completion record. */
const APPLY_COMPLETED_AT = "2026-08-22T22:00:00.000Z";

test("a confirmed 'completed' Task writes Status to Notion via the injected setTaskStatus", async () => {
  const store = tempStore();
  const calls: Array<{ taskId: string; status: TaskStatus }> = [];
  const setTaskStatus = async (taskId: string, status: TaskStatus): Promise<Result<void, YohError>> => {
    calls.push({ taskId, status });
    return { ok: true, value: undefined };
  };

  const result = await applyNightCloseOutConfirmation(
    applyDeps(store, setTaskStatus),
    "t1",
    "Draft the memo",
    "completed",
    TODAY,
    APPLY_COMPLETED_AT,
  );
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.deepEqual(calls, [{ taskId: "t1", status: "completed" }]);
});

test("a confirmed 'slipped' Task gets a REAL Slip-Bump via recordSlip — genuinely computed via computeEscalation, not faked", async () => {
  const store = tempStore();
  assert.equal(getSlipHistory(store, "t1"), undefined, "sanity: no prior slip history");

  const result = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "Draft the memo", "slipped", TODAY, APPLY_COMPLETED_AT);
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
  await applyNightCloseOutConfirmation(applyDeps(store), "t1", "Draft the memo", "slipped", "2026-08-21", "2026-08-21T22:00:00.000Z");
  await applyNightCloseOutConfirmation(applyDeps(store), "t1", "Draft the memo", "slipped", "2026-08-22", APPLY_COMPLETED_AT);

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
  const first = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "Draft the memo", "slipped", TODAY, APPLY_COMPLETED_AT);
  assert.ok(first.ok);
  assert.equal(getSlipHistory(store, "t1")?.data.consecutiveSlipCount, 1);

  const resumed = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "Draft the memo", "slipped", TODAY, APPLY_COMPLETED_AT);
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

  const result = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "Draft the memo", "completed", TODAY, APPLY_COMPLETED_AT);
  assert.ok(result.ok);
  assert.equal(getSlipHistory(store, "t1"), undefined, "the Slip-Bump must be cleared entirely, not merely reset in place");
});

test("a confirmed 'completed' Task with NO prior slip history is a harmless no-op for Slip-Bump", async () => {
  const store = tempStore();
  const result = await applyNightCloseOutConfirmation(applyDeps(store), "t1", "Draft the memo", "completed", TODAY, APPLY_COMPLETED_AT);
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

  const slippedResult = await applyNightCloseOutConfirmation(applyDeps(store, failingSetTaskStatus), "t2", "Book the flights", "slipped", TODAY, APPLY_COMPLETED_AT);
  assert.equal(slippedResult.ok, false);
  assert.equal(getSlipHistory(store, "t2"), undefined, "no SlipHistory should be written when the Notion write failed");

  const completedResult = await applyNightCloseOutConfirmation(applyDeps(store, failingSetTaskStatus), "t1", "Draft the memo", "completed", TODAY, APPLY_COMPLETED_AT);
  assert.equal(completedResult.ok, false);
  assert.ok(getSlipHistory(store, "t1"), "the pre-existing SlipHistory must survive a failed write, not be cleared");
});

// ============================================================================
// Story 7.9 (AD-20/AD-23, Controller ruling R7): recording close-out
// completions via completion-log.ts, snapshotted from an injected live-Task
// lookup dep — never from the sparse NightCloseOutTaskDetail alone.
// ============================================================================

/** A minimal but real `Task` for `lookupTask` fakes below — only the fields `applyNightCloseOutConfirmation`'s snapshot step actually reads. */
function fakeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Draft the memo",
    area: "Work",
    dueDate: "2026-09-25",
    estimatedDurationMinutes: 30,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

test("applyNightCloseOutConfirmation records a completion (source: 'close-out') when status is 'completed', snapshotting area/dueDate/estimatedMinutes from the injected live-Task lookup, after the Notion write, before Slip-Bump", async () => {
  const store = tempStore();
  const completions: RecordCompletionInput[] = [];

  const result = await applyNightCloseOutConfirmation(
    applyDeps(store, undefined, {
      recordCompletion: (input) => completions.push(input),
      lookupTask: () => Promise.resolve(fakeTask()),
    }),
    "t1",
    "Draft the memo",
    "completed",
    TODAY,
    APPLY_COMPLETED_AT,
  );

  assert.equal(result.ok, true);
  assert.equal(completions.length, 1);
  assert.deepEqual(completions[0], {
    taskId: "t1",
    taskName: "Draft the memo",
    area: "Work",
    dueDate: "2026-09-25",
    estimatedMinutes: 30,
    completedAt: APPLY_COMPLETED_AT,
    source: "close-out",
  });
  store.close();
});

test("R7: a Task the live lookup shows missing area/dueDate/estimatedDurationMinutes records null for each, not undefined/omitted", async () => {
  const store = tempStore();
  const completions: RecordCompletionInput[] = [];

  const taskMissingPlanningFields: Task = {
    id: "t1",
    title: "Call the dentist",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  await applyNightCloseOutConfirmation(
    applyDeps(store, undefined, {
      recordCompletion: (input) => completions.push(input),
      lookupTask: () => Promise.resolve(taskMissingPlanningFields),
    }),
    "t1",
    "Call the dentist",
    "completed",
    TODAY,
    APPLY_COMPLETED_AT,
  );

  assert.equal(completions.length, 1);
  assert.equal(completions[0]!.area, null);
  assert.equal(completions[0]!.dueDate, null);
  assert.equal(completions[0]!.estimatedMinutes, null);
  store.close();
});

test("R7: the Task not being found at all (lookupTask resolves undefined) records null for all three fields — never blocks the completion or the Status write", async () => {
  const store = tempStore();
  const completions: RecordCompletionInput[] = [];

  const result = await applyNightCloseOutConfirmation(
    applyDeps(store, undefined, {
      recordCompletion: (input) => completions.push(input),
      lookupTask: () => Promise.resolve(undefined),
    }),
    "t1",
    "Archived Task",
    "completed",
    TODAY,
    APPLY_COMPLETED_AT,
  );

  assert.equal(result.ok, true);
  assert.equal(completions.length, 1);
  assert.equal(completions[0]!.area, null);
  assert.equal(completions[0]!.dueDate, null);
  assert.equal(completions[0]!.estimatedMinutes, null);
  store.close();
});

test("R7: a lookup that THROWS never blocks recording the completion or the Status write — records null for all three, logs the failure", async () => {
  const store = tempStore();
  const completions: RecordCompletionInput[] = [];
  const statusCalls: string[] = [];
  const logEntries: Array<{ level: string; event: string }> = [];

  const result = await applyNightCloseOutConfirmation(
    applyDeps(
      store,
      async (taskId) => {
        statusCalls.push(taskId);
        return { ok: true, value: undefined };
      },
      {
        recordCompletion: (input) => completions.push(input),
        lookupTask: () => Promise.reject(new Error("notion: 404 page not found")),
        log: (entry) => logEntries.push({ level: entry.level, event: entry.event }),
      },
    ),
    "t1",
    "Draft the memo",
    "completed",
    TODAY,
    APPLY_COMPLETED_AT,
  );

  assert.equal(result.ok, true, "a lookup failure must never block the Status write");
  assert.equal(statusCalls.length, 1, "the Status write still happens");
  assert.equal(completions.length, 1, "the completion is still recorded");
  assert.equal(completions[0]!.area, null);
  assert.equal(completions[0]!.dueDate, null);
  assert.equal(completions[0]!.estimatedMinutes, null);
  assert.ok(logEntries.some((e) => e.level === "error"), "the lookup failure is logged");
  store.close();
});

test("applyNightCloseOutConfirmation does NOT record a completion for a 'slipped' confirmation, but looks the Task up for its area", async () => {
  const store = tempStore();
  const completions: RecordCompletionInput[] = [];
  let lookupCalls = 0;

  await applyNightCloseOutConfirmation(
    applyDeps(store, undefined, {
      recordCompletion: (input) => completions.push(input),
      lookupTask: () => {
        lookupCalls += 1;
        return Promise.resolve(fakeTask());
      },
    }),
    "t1",
    "Draft the memo",
    "slipped",
    TODAY,
    APPLY_COMPLETED_AT,
  );

  assert.equal(completions.length, 0);
  assert.equal(lookupCalls, 1, "Story 13.2: the lookup supplies the slip event's area");
  store.close();
});

test("Story 13.2: a slip appends a slip_events row {taskId, area, date} alongside the slip record; a lookup failure leaves area null and never blocks; a repeat date adds nothing", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const events = () => listSlipEvents(connection);
  await applyNightCloseOutConfirmation(
    applyDeps(store, undefined, { lookupTask: () => Promise.resolve({ ...fakeTask(), area: "Work" }) }),
    "t1", "Draft the memo", "slipped", TODAY, APPLY_COMPLETED_AT,
  );
  await applyNightCloseOutConfirmation(
    applyDeps(store, undefined, { lookupTask: () => Promise.reject(new Error("notion down")), log: () => {} }),
    "t2", "Other", "slipped", TODAY, APPLY_COMPLETED_AT,
  );
  const again = await applyNightCloseOutConfirmation(
    applyDeps(store, undefined, { lookupTask: () => Promise.resolve({ ...fakeTask(), area: "Work" }) }),
    "t1", "Draft the memo", "slipped", TODAY, APPLY_COMPLETED_AT,
  );
  assert.equal(again.ok, true);
  assert.deepEqual(events(), [
    { taskId: "t1", area: "Work", date: TODAY },
    { taskId: "t2", area: null, date: TODAY },
  ]);
  assert.equal(getSlipHistory(store, "t1")?.data.consecutiveSlipCount, 1);
  store.close();
});

test("applyNightCloseOutConfirmation does NOT record a completion if the Notion Status write fails", async () => {
  const store = tempStore();
  const completions: RecordCompletionInput[] = [];

  const result = await applyNightCloseOutConfirmation(
    applyDeps(
      store,
      async () => ({ ok: false, error: { kind: "unreachable", message: "notion down" } }),
      { recordCompletion: (input) => completions.push(input), lookupTask: () => Promise.resolve(fakeTask()) },
    ),
    "t1",
    "Draft the memo",
    "completed",
    TODAY,
    APPLY_COMPLETED_AT,
  );

  assert.equal(result.ok, false);
  assert.equal(completions.length, 0);
  store.close();
});

// ============================================================================
// runNightEscalateRitual — the capped, second-attempt escalation half
// (Story 3.2 / Task 20)
// ============================================================================

interface RecordedEmail {
  readonly subject: string;
  readonly text: string;
}

function escalateDeps(
  store: MemoryStore,
  overrides: Partial<NightEscalateRitualDeps> = {},
): NightEscalateRitualDeps {
  return {
    store,
    sendEscalationEmail: async () => {},
    now: () => new Date(NOW_ISO),
    timeZone: "UTC",
    ...overrides,
  };
}

function recordingEscalationEmail(): { readonly calls: RecordedEmail[]; readonly send: NightEscalateRitualDeps["sendEscalationEmail"] } {
  const calls: RecordedEmail[] = [];
  const send: NightEscalateRitualDeps["sendEscalationEmail"] = async (message) => {
    calls.push({ subject: message.subject, text: message.text });
  };
  return { calls, send };
}

/** Opens the same close-out interaction request `runNightPromptRitual` would, without needing a full Plan/ritual-run fixture — this file's tests only care that ONE is currently open. */
function openCloseOutRequest(store: MemoryStore, tasks: NightCloseOutRequestDetail["tasks"]): void {
  putOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, {
    requestKind: "night-close-out",
    promptText: buildNightCloseOutPromptText(tasks),
    detail: { date: TODAY, tasks },
    createdAt: "2026-08-22T13:00:00.000Z",
  });
}

test("still unanswered hours later: night-escalate sends exactly one email, via a channel distinct from the first attempt's push notification", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const { calls, send } = recordingEscalationEmail();

  const result = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: send }));
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "escalated");

  assert.equal(calls.length, 1, "exactly one escalation email is sent");
  // The channel is structurally distinct from morning-ritual.ts's own
  // `sendNotification` (Pushover push) seam: `NightEscalateRitualDeps` has
  // no push-notification dependency at all — email is the only outbound
  // channel this ritual half can reach Spencer through.
  assert.ok("sendEscalationEmail" in escalateDeps(store), "the escalation channel is its own distinct injected dependency, not a repeat of sendNotification");
});

test("the escalation email is marked with the attention color/marker and is short — directness, not volume", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [
    { taskId: "t1", taskTitle: "Draft the memo" },
    { taskId: "t2", taskTitle: "Book the flights" },
  ]);
  const { calls, send } = recordingEscalationEmail();

  await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: send }));

  assert.equal(calls.length, 1);
  const email = calls[0]!;
  // Plain-text degradation of {colors.attention} (UX-DR20's "pair every
  // color cue with plain-text wording carrying the same meaning") — SMTP
  // plain text can't render ANSI color at all, mirroring
  // morning-ritual.ts's own precedent for Pushover's un-stylable title.
  assert.match(email.subject, /ATTENTION/);
  assert.match(email.text, /ATTENTION/);
  assert.match(email.text, /Draft the memo/);
  assert.match(email.text, /Book the flights/);
  // Directness of WORDING, not volume of text: still short, not a wall of
  // text, and no alarm/exclamation language.
  assert.ok(email.text.length < 400, `expected a short, direct email body, got ${email.text.length} characters`);
  assert.ok(!email.text.includes("!"), "escalates in directness, not alarm punctuation");
});

test("the {colors.attention} ANSI constant this task adds to morning-ritual.ts is genuinely the DESIGN.md #D08A3E token (256-color mode, for Terminal.app compatibility — see ritual-shared.ts's own doc comment)", () => {
  assert.equal(ATTENTION, "\x1b[38;5;173m");
});

test("renderNightEscalateNotice paints the terminal-side escalation notice with the literal ATTENTION escape when color is on — the one destination in this ritual that CAN render it", () => {
  const colored = renderNightEscalateNotice(2, TODAY, { color: true });
  assert.ok(colored.includes(ATTENTION), "expected the literal {colors.attention} ANSI escape in the colored notice");
  assert.ok(colored.includes("2 Tasks"));
  assert.ok(colored.includes(TODAY));
});

test("renderNightEscalateNotice carries no ANSI at all when color is off — the plain-text meaning stands alone (UX-DR20)", () => {
  const plain = renderNightEscalateNotice(1, TODAY, { color: false });
  assert.doesNotMatch(plain, /\x1b\[/);
  assert.ok(plain.includes("1 Task") && !plain.includes("1 Tasks"), "singular Task is not pluralized");
});

test("close-out already answered before night-escalate runs: no-op, no email is sent", async () => {
  const store = tempStore();
  // night-prompt DID run tonight, and there's no open request — genuinely
  // answered and cleared (chat-cli.ts clears the request once Spencer
  // answers every named Task).
  putRitualRun(store, NIGHT_PROMPT_RITUAL_ID, { date: TODAY, ranAt: "2026-08-22T13:00:00.000Z" });
  const { calls, send } = recordingEscalationEmail();

  const result = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: send }));
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "no-open-request");
  assert.equal(calls.length, 0, "no second attempt is sent once the close-out was already answered");
  assert.ok(getRitualRun(store, NIGHT_ESCALATE_RITUAL_ID), "the cap IS burned — night-prompt ran and the request is genuinely gone");
});

// ============================================================================
// Task 20 review fix (Important #2): distinguishing "genuinely answered"
// from "night-prompt hasn't fired tonight yet" — only the FIRST should burn
// the escalation cap.
// ============================================================================

test("night-prompt has not run tonight yet: night-escalate skips WITHOUT burning the cap, so a later same-night trigger can still escalate", async () => {
  const store = tempStore();
  // No night-prompt ritual-run marker for tonight at all, and (naturally) no
  // open request either — night-prompt simply hasn't fired yet (delayed
  // cron, crash, whatever).
  const { calls, send } = recordingEscalationEmail();

  const result = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: send }));
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "not-prompted-yet");
  assert.equal(calls.length, 0);
  assert.equal(
    getRitualRun(store, NIGHT_ESCALATE_RITUAL_ID),
    undefined,
    "the escalation cap must NOT be burned — nothing has been asked yet tonight, so there's still a legitimate later attempt to make",
  );
});

test("night-prompt has not run tonight yet, but DID run on a PRIOR night: still not-prompted-yet for TONIGHT, cap not burned", async () => {
  const store = tempStore();
  putRitualRun(store, NIGHT_PROMPT_RITUAL_ID, { date: "2026-08-21", ranAt: "2026-08-21T22:00:00.000Z" });
  const { calls, send } = recordingEscalationEmail();

  const result = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: send }));
  assert.ok(result.ok);
  assert.equal(result.value.status, "not-prompted-yet");
  assert.equal(calls.length, 0);
  assert.equal(getRitualRun(store, NIGHT_ESCALATE_RITUAL_ID), undefined);
});

test("the safety net actually recovers: not-prompted-yet, then night-prompt runs, then night-escalate genuinely escalates the same night", async () => {
  const store = tempStore();

  // First trigger: night-prompt hasn't run yet.
  const before = await runNightEscalateRitual(escalateDeps(store));
  assert.ok(before.ok && before.value.status === "not-prompted-yet");
  assert.equal(getRitualRun(store, NIGHT_ESCALATE_RITUAL_ID), undefined, "cap still un-burned");

  // night-prompt finally runs (delayed) and opens the request.
  putRitualRun(store, NIGHT_PROMPT_RITUAL_ID, { date: TODAY, ranAt: "2026-08-22T23:00:00.000Z" });
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);

  // Second trigger, same night: escalation now genuinely fires.
  const { calls, send } = recordingEscalationEmail();
  const after = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: send }));
  assert.ok(after.ok && after.value.status === "escalated", `expected escalation, got ${JSON.stringify(after)}`);
  assert.equal(calls.length, 1, "the safety net was NOT silently disabled by the earlier not-prompted-yet check");
});

test("both attempts already sent for tonight: a further trigger the same night sends NO third attempt, even re-triggered multiple times", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const { calls, send } = recordingEscalationEmail();

  const first = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: send }));
  assert.ok(first.ok && first.value.status === "escalated");
  assert.equal(calls.length, 1);

  // Re-trigger several times the same night (the request is still open —
  // chat-cli.ts never cleared it — which is exactly the scenario a naive
  // "is it still open" check alone would re-send for).
  for (let i = 0; i < 3; i++) {
    const again = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: send }));
    assert.ok(again.ok, `expected success, got ${JSON.stringify(again)}`);
    assert.equal(again.value.status, "already-ran");
  }

  assert.equal(calls.length, 1, "no third (or second) attempt is ever sent, regardless of continued non-response");
});

test("the night-escalate ran-marker records tonight's date, gating any further same-night trigger", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  await runNightEscalateRitual(escalateDeps(store));
  const run = getRitualRun(store, NIGHT_ESCALATE_RITUAL_ID);
  assert.equal(run?.data.date, TODAY);
});

test("AD-8: when the email adapter throws, runNightEscalateRitual converts it to a Result failure and does NOT mark the night done (so a transient failure can still be retried the same night)", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const failingSend: NightEscalateRitualDeps["sendEscalationEmail"] = async () => {
    throw new Error("ECONNREFUSED smtp.example.com");
  };

  const result = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: failingSend }));
  assert.equal(result.ok, false);
  assert.equal(getRitualRun(store, NIGHT_ESCALATE_RITUAL_ID), undefined, "a failed send must not burn the capped attempt");
});

test("buildNightEscalationEmail is short and direct — a distinct message from buildNightCloseOutPromptText's own first-attempt wording", () => {
  const email = buildNightEscalationEmail([{ taskId: "t1", taskTitle: "Draft the memo" }]);
  assert.match(email.subject, /ATTENTION/);
  assert.match(email.text, /Draft the memo/);
  assert.ok(email.text.length < 400);
});

test("AD-5: night-ritual.ts's night-escalate half never waits for input either — already covered by the file-wide stdin scan above", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "rituals", "night-ritual.ts"), "utf8");
  assert.doesNotMatch(source, /node:readline/);
  assert.doesNotMatch(source, /process\.stdin/);
});

// ============================================================================
// Recording the unchecked day, at cap-spend time (Story 3.3 / Task 21,
// post-review fix — detection now lives INSIDE runNightEscalateRitual
// itself, not inferred later by morning-ritual.ts)
// ============================================================================

test("when the cap is reached (escalated), the night is recorded as unchecked IMMEDIATELY — durably, naming every rolled-forward Task", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [
    { taskId: "t1", taskTitle: "Draft the memo" },
    { taskId: "t2", taskTitle: "Book the flights" },
  ]);

  assert.equal(getUncheckedDay(store, TODAY), undefined, "sanity: nothing recorded before the cap is reached");
  const result = await runNightEscalateRitual(escalateDeps(store));
  assert.ok(result.ok && result.value.status === "escalated", `expected escalation, got ${JSON.stringify(result)}`);

  const record = getUncheckedDay(store, TODAY);
  assert.ok(record, "expected an UncheckedDay row to exist the MOMENT the cap was reached — not deferred to some later morning");
  assert.deepEqual(
    record.data.rolledForwardTasks.map((t) => t.taskTitle),
    ["Draft the memo", "Book the flights"],
  );
  assert.equal(record.data.shownAt, undefined, "not yet displayed — that's rituals/morning-ritual.ts's job, later");
});

test("close-out already answered before night-escalate runs (no-open-request): NOT recorded as unchecked", async () => {
  const store = tempStore();
  putRitualRun(store, NIGHT_PROMPT_RITUAL_ID, { date: TODAY, ranAt: "2026-08-22T13:00:00.000Z" });

  const result = await runNightEscalateRitual(escalateDeps(store));
  assert.ok(result.ok && result.value.status === "no-open-request");
  assert.equal(getUncheckedDay(store, TODAY), undefined, "a genuinely-answered night must never be recorded as unchecked");
});

test("night-prompt has not run tonight yet (not-prompted-yet): NOT recorded as unchecked — the cap hasn't even been reached yet", async () => {
  const store = tempStore();
  const result = await runNightEscalateRitual(escalateDeps(store));
  assert.ok(result.ok && result.value.status === "not-prompted-yet");
  assert.equal(getUncheckedDay(store, TODAY), undefined);
});

test("AD-8: when the escalation email send fails, NOTHING is recorded as unchecked — the cap was never actually reached, and a retry can both resend and record", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const failingSend: NightEscalateRitualDeps["sendEscalationEmail"] = async () => {
    throw new Error("ECONNREFUSED smtp.example.com");
  };

  const result = await runNightEscalateRitual(escalateDeps(store, { sendEscalationEmail: failingSend }));
  assert.equal(result.ok, false);
  assert.equal(getUncheckedDay(store, TODAY), undefined, "a failed send must not record the night as unchecked");
});

test("a second same-night trigger (already-ran) does not touch the UncheckedDay row again — it was already recorded on the first, capped trigger", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);

  const first = await runNightEscalateRitual(escalateDeps(store));
  assert.ok(first.ok && first.value.status === "escalated");
  const firstRecord = getUncheckedDay(store, TODAY)!;

  const second = await runNightEscalateRitual(escalateDeps(store));
  assert.ok(second.ok && second.value.status === "already-ran");

  const secondRecord = getUncheckedDay(store, TODAY)!;
  assert.equal(secondRecord.version, firstRecord.version, "the record must not be re-written by a no-op re-trigger");
});

test("recording the unchecked day does NOT clear or otherwise mutate the close-out interaction request — it stays open for Spencer to answer", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  const before = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID)!;

  const result = await runNightEscalateRitual(escalateDeps(store));
  assert.ok(result.ok && result.value.status === "escalated");
  assert.ok(getUncheckedDay(store, TODAY), "sanity: the night was recorded as unchecked");

  const after = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID);
  assert.ok(after, "the interaction request must still be open after recording the unchecked day");
  assert.equal(after.version, before.version, "the request must be completely untouched — same version");
  assert.equal(after.data.createdAt, before.data.createdAt);
});

test("Spencer answering the original close-out request, after the night was already recorded as unchecked, still works via applyNightCloseOutConfirmation", async () => {
  const store = tempStore();
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);

  const escalated = await runNightEscalateRitual(escalateDeps(store));
  assert.ok(escalated.ok && escalated.value.status === "escalated");
  assert.ok(getUncheckedDay(store, TODAY), "sanity: the night is now recorded as unchecked");

  // Spencer finally answers — bounded (per memory-store.ts's UncheckedDay
  // doc comment) by the NEXT night's own night-prompt not having overwritten
  // the singleton request yet, which hasn't happened in this test. This must
  // succeed exactly as it always has, completely unaffected by the
  // unchecked-day recording.
  const applied = await applyNightCloseOutConfirmation(
    { store, setTaskStatus: async () => ({ ok: true, value: undefined }), recordCompletion: (): void => {}, lookupTask: (): Promise<Task | undefined> => Promise.resolve(undefined) },
    "t1",
    "Draft the memo",
    "completed",
    TODAY,
    APPLY_COMPLETED_AT,
  );
  assert.ok(applied.ok, `expected the late answer to still apply successfully, got ${JSON.stringify(applied)}`);

  clearNightCloseOutRequestIfOpen(store, { resolveUncheckedDay: true });
  assert.equal(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID), undefined, "the request clears normally once answered");
  assert.equal(
    getUncheckedDay(store, TODAY),
    undefined,
    "the matching UncheckedDay record must ALSO be resolved once the request is genuinely cleared (Task 21, second post-review fix) — a night that's since been closed out must stop reading as unchecked",
  );
});

// ============================================================================
// Task 21, second post-review fix: resolving an UncheckedDay record once
// its night is genuinely answered (AC3 — a closed-out night must never be
// treated as equivalent to an unchecked one, even after it WAS escalated)
// ============================================================================

test("clearNightCloseOutRequestIfOpen resolves the matching UncheckedDay record for the request's OWN date — even if Spencer is answering a DIFFERENT (earlier) night than 'today'", async () => {
  const store = tempStore();
  const EARLIER_NIGHT = "2026-08-19";

  // The night was escalated and recorded days ago.
  putOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, {
    requestKind: "night-close-out",
    promptText: buildNightCloseOutPromptText([{ taskId: "t1", taskTitle: "Draft the memo" }]),
    detail: { date: EARLIER_NIGHT, tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] },
    createdAt: "2026-08-19T20:00:00.000Z",
  });
  const escalated = await runNightEscalateRitual(
    escalateDeps(store, { now: () => new Date(`${EARLIER_NIGHT}T23:00:00.000Z`) }),
  );
  assert.ok(escalated.ok && escalated.value.status === "escalated");
  assert.ok(getUncheckedDay(store, EARLIER_NIGHT), "sanity: recorded as unchecked");

  // Spencer finally answers, days later — clearNightCloseOutRequestIfOpen
  // must resolve the EARLIER_NIGHT record, not "today"'s (there is no
  // "today" record at all in this test).
  await applyNightCloseOutConfirmation(
    { store, setTaskStatus: async () => ({ ok: true, value: undefined }), recordCompletion: (): void => {}, lookupTask: (): Promise<Task | undefined> => Promise.resolve(undefined) },
    "t1",
    "Draft the memo",
    "completed",
    EARLIER_NIGHT,
    "2026-08-19T22:00:00.000Z",
  );
  clearNightCloseOutRequestIfOpen(store, { resolveUncheckedDay: true });

  assert.equal(getUncheckedDay(store, EARLIER_NIGHT), undefined, "the correct (earlier) night's UncheckedDay record must be resolved");
});

test("clearNightCloseOutRequestIfOpen is a harmless no-op for the UncheckedDay partition when the night was never escalated/recorded in the first place", async () => {
  const store = tempStore();
  // Spencer answers promptly, well before any escalation — no UncheckedDay
  // row ever existed for TODAY.
  openCloseOutRequest(store, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  assert.equal(getUncheckedDay(store, TODAY), undefined, "sanity: never recorded");

  await applyNightCloseOutConfirmation(
    { store, setTaskStatus: async () => ({ ok: true, value: undefined }), recordCompletion: (): void => {}, lookupTask: (): Promise<Task | undefined> => Promise.resolve(undefined) },
    "t1",
    "Draft the memo",
    "completed",
    TODAY,
    APPLY_COMPLETED_AT,
  );
  // Must not throw, and must not fabricate a row.
  assert.doesNotThrow(() => clearNightCloseOutRequestIfOpen(store, { resolveUncheckedDay: true }));
  assert.equal(getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID), undefined);
  assert.equal(getUncheckedDay(store, TODAY), undefined);
});

// ============================================================================
// Task 21, first post-review fix: guarding against a STALE open request —
// a planless intervening night must not misattribute an earlier night's
// still-open request to itself.
// ============================================================================

test("a stale request from an earlier night is NOT misattributed to a planless intervening night — no spurious duplicate UncheckedDay row", async () => {
  const store = tempStore();
  const NIGHT_N = "2026-08-21";
  const PLANLESS_NIGHT = TODAY; // "2026-08-22" — never had its own close-out request at all

  // Night N: both close-out attempts spent, still unanswered — recorded.
  putOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, {
    requestKind: "night-close-out",
    promptText: buildNightCloseOutPromptText([{ taskId: "t1", taskTitle: "Draft the memo" }]),
    detail: { date: NIGHT_N, tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] },
    createdAt: "2026-08-21T20:00:00.000Z",
  });
  const first = await runNightEscalateRitual(escalateDeps(store, { now: () => new Date(`${NIGHT_N}T23:00:00.000Z`) }));
  assert.ok(first.ok && first.value.status === "escalated");
  assert.ok(getUncheckedDay(store, NIGHT_N), "sanity: night N recorded as unchecked");

  // Night N+1 (PLANLESS_NIGHT) never had a Plan, so night-prompt would have
  // returned no-plan-today and opened no new request — night N's own
  // request is STILL the open singleton, now stale. night-escalate for
  // PLANLESS_NIGHT still finds `open` truthy (it's unaware of staleness by
  // itself) and — pre-fix — would have recorded a SECOND, wrongly-dated row.
  const { calls, send } = recordingEscalationEmail();
  const second = await runNightEscalateRitual(
    escalateDeps(store, { sendEscalationEmail: send, now: () => new Date(`${PLANLESS_NIGHT}T23:00:00.000Z`) }),
  );
  assert.ok(second.ok, `expected success, got ${JSON.stringify(second)}`);
  assert.equal(second.value.status, "escalated", "the email is still sent — only the RECORD is gated, not the email");
  assert.equal(calls.length, 1);

  assert.equal(
    getUncheckedDay(store, PLANLESS_NIGHT),
    undefined,
    "no spurious UncheckedDay row must be recorded for the planless night — the stale request doesn't describe it",
  );
  const allUnchecked = listUncheckedDays(store);
  assert.equal(allUnchecked.length, 1, "still exactly one UncheckedDay row total — night N's own, untouched");
  assert.equal(allUnchecked[0]?.data.date, NIGHT_N);
});

test("the stale-request guard does not repeat-record on EVERY further planless night either — still exactly one row after three more triggers", async () => {
  const store = tempStore();
  const NIGHT_N = "2026-08-21";

  putOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, {
    requestKind: "night-close-out",
    promptText: buildNightCloseOutPromptText([{ taskId: "t1", taskTitle: "Draft the memo" }]),
    detail: { date: NIGHT_N, tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] },
    createdAt: "2026-08-21T20:00:00.000Z",
  });
  await runNightEscalateRitual(escalateDeps(store, { now: () => new Date(`${NIGHT_N}T23:00:00.000Z`) }));
  assert.equal(listUncheckedDays(store).length, 1);

  for (const date of ["2026-08-22", "2026-08-23", "2026-08-24"]) {
    const result = await runNightEscalateRitual(escalateDeps(store, { now: () => new Date(`${date}T23:00:00.000Z`) }));
    assert.ok(result.ok && result.value.status === "escalated", `expected escalation on ${date}, got ${JSON.stringify(result)}`);
  }

  const all = listUncheckedDays(store);
  assert.equal(all.length, 1, "three further planless nights must not add three more spurious rows");
  assert.equal(all[0]?.data.date, NIGHT_N);
});

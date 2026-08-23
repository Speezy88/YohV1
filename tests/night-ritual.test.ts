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
  putOpenInteractionRequest,
  putPlan,
  putRitualRun,
  recordSlip,
  type MemoryStore,
} from "../src/adapters/memory-store.ts";
import { computeSlipBumpLevel } from "../src/core/slip-bump.ts";
import {
  applyNightCloseOutConfirmation,
  buildNightCloseOutPromptText,
  buildNightEscalationEmail,
  NIGHT_CLOSE_OUT_REQUEST_ID,
  NIGHT_ESCALATE_RITUAL_ID,
  NIGHT_PROMPT_RITUAL_ID,
  renderNightEscalateNotice,
  runNightEscalateRitual,
  runNightPromptRitual,
  type NightCloseOutRequestDetail,
  type NightEscalateRitualDeps,
  type NightPromptRitualDeps,
} from "../src/rituals/night-ritual.ts";
import { ATTENTION } from "../src/rituals/morning-ritual.ts";
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
    sendNotification: async () => {},
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

test("the {colors.attention} ANSI constant this task adds to morning-ritual.ts is genuinely the DESIGN.md #D08A3E token", () => {
  assert.equal(ATTENTION, "\x1b[38;2;208;138;62m");
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

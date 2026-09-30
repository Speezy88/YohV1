/**
 * Tests for `src/shell/ritual-cli.ts` (Story 1.10 / Task 10).
 *
 * `ritual-cli.ts morning` is the OS-cron-triggered, one-shot, non-blocking
 * entry point (AD-5). These tests drive `runRitualCli` with an injected
 * ritual runner and IO sink — no adapters, no network, no stdin.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryStore, getRitualInvocation, putPlan, putRitualInvocation } from "../src/adapters/memory-store.ts";
import { recordSlip } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initCompletionLogSchema, recordCompletion } from "../src/adapters/completion-log.ts";
import { initNotificationStoreSchema, listUnreadNotifications } from "../src/adapters/notification-store.ts";
import { computeSlipBumpLevels } from "../src/core/slip-bump.ts";
import {
  buildDegradedAlertBody,
  buildDegradedAlertTitle,
  buildFailedAlertBody,
  buildFailedAlertTitle,
  buildHeartbeatStaleAlertBody,
  buildHeartbeatStaleAlertTitle,
  buildMissedRunAlertBody,
  buildMissedRunAlertTitle,
  checkDailyRitualMissedRun,
  formatDayCount,
  checkMorningPlanGenerationDegraded,
  createOperationalNotifier,
  runRitualCli,
  DAILY_RITUAL_MISSED_RUN_GRACE_HOURS,
  type MissedRunCheckResult,
  type RitualCliDeps,
} from "../src/shell/ritual-cli.ts";
// Task 12: the per-subcommand deps builders moved out of ritual-cli.ts into
// their own files under shell/ritual-cli/ (a pure-move split) — import-path
// edit only, per the task brief.
import { createMorningRitualDeps } from "../src/shell/ritual-cli/morning-deps.ts";
import { createNightEscalateRitualDeps, createNightPromptRitualDeps } from "../src/shell/ritual-cli/night-deps.ts";
import { PLAN_GENERATION_DEGRADED_THRESHOLD_MS } from "../src/rituals/morning-ritual.ts";
import type { MorningRitualOutcome } from "../src/rituals/morning-ritual.ts";
import type { PlanNotification } from "../src/rituals/ritual-shared.ts";
import { recordNightCloseOutHandledWithoutPrompt, runNightEscalateRitual, runNightPromptRitual } from "../src/rituals/night-ritual.ts";
import type { NightEscalateOutcome, NightPromptOutcome } from "../src/rituals/night-ritual.ts";
import type { Plan, Result, YohError } from "../src/types/domain.ts";

/** Default "never missed" check — most existing dispatch tests don't care about the Task 26 / Story 5.2 dead-man's-switch at all. */
const NOT_MISSED: () => MissedRunCheckResult = () => ({ missed: false });
/** Default no-op invocation recorder — most existing dispatch tests use a fake `MemoryStore`-less `RitualCliDeps` and don't care about the Task 26 review-fix `RitualInvocation` marker at all. */
const NOOP_RECORD_INVOCATION: () => void = () => {};
/** Default no-op operational-notification sink — most existing dispatch tests don't assert on `notification-store.ts` writes at all. */
const NOOP_NOTIFY_OPERATIONAL: (title: string, message: string) => void = () => {};

const TODAY = "2026-08-22";

const PLAN: Plan = {
  id: `plan-${TODAY}`,
  date: TODAY,
  blocks: [
    { id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" },
  ],
  reasoning: '"Draft the memo" leads today\'s Plan.',
  version: 1,
  createdAt: "2026-08-22T13:00:00.000Z",
  updatedAt: "2026-08-22T13:00:00.000Z",
};

interface Sink {
  readonly out: string[];
  readonly err: string[];
  /** Failure alerts sent via `RitualCliDeps.sendFailureAlert` (Task 25 / Story 5.1). */
  readonly alerts: PlanNotification[];
}

function deps(
  outcome: Result<MorningRitualOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
  checkMissedRun: () => MissedRunCheckResult = NOT_MISSED,
  recordInvocation: () => void = NOOP_RECORD_INVOCATION,
): RitualCliDeps {
  return {
    io: {
      writeLine: (l) => sink.out.push(l),
      writeError: (l) => sink.err.push(l),
    },
    runMorning: async () => {
      onRun?.();
      return outcome;
    },
    runNightPrompt: async () => {
      throw new Error("runNightPrompt should not be called by a `morning` dispatch test");
    },
    runNightEscalate: async () => {
      throw new Error("runNightEscalate should not be called by a `morning` dispatch test");
    },
    sendFailureAlert: async (notification) => {
      sink.alerts.push(notification);
    },
    checkMissedRun,
    recordInvocation,
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
  };
}

function nightPromptDeps(
  outcome: Result<NightPromptOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
  checkMissedRun: () => MissedRunCheckResult = NOT_MISSED,
  recordInvocation: () => void = NOOP_RECORD_INVOCATION,
): RitualCliDeps {
  return {
    io: {
      writeLine: (l) => sink.out.push(l),
      writeError: (l) => sink.err.push(l),
    },
    runMorning: async () => {
      throw new Error("runMorning should not be called by a `night-prompt` dispatch test");
    },
    runNightPrompt: async () => {
      onRun?.();
      return outcome;
    },
    runNightEscalate: async () => {
      throw new Error("runNightEscalate should not be called by a `night-prompt` dispatch test");
    },
    sendFailureAlert: async (notification) => {
      sink.alerts.push(notification);
    },
    checkMissedRun,
    recordInvocation,
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
  };
}

function nightEscalateDeps(
  outcome: Result<NightEscalateOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
  checkMissedRun: () => MissedRunCheckResult = NOT_MISSED,
  recordInvocation: () => void = NOOP_RECORD_INVOCATION,
): RitualCliDeps {
  return {
    io: {
      writeLine: (l) => sink.out.push(l),
      writeError: (l) => sink.err.push(l),
    },
    runMorning: async () => {
      throw new Error("runMorning should not be called by a `night-escalate` dispatch test");
    },
    runNightPrompt: async () => {
      throw new Error("runNightPrompt should not be called by a `night-escalate` dispatch test");
    },
    runNightEscalate: async () => {
      onRun?.();
      return outcome;
    },
    sendFailureAlert: async (notification) => {
      sink.alerts.push(notification);
    },
    checkMissedRun,
    recordInvocation,
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
  };
}

function sink(): Sink {
  return { out: [], err: [], alerts: [] };
}

test("`morning` runs the Morning Ritual and prints the rendered Plan, exit code 0", async () => {
  const s = sink();
  let ran = 0;
  const code = await runRitualCli(
    ["morning"],
    deps(
      { ok: true, value: { status: "delivered", date: TODAY, plan: PLAN, rendered: "Today's Plan for Saturday, August 22", deferredTaskIds: [], incompleteTaskIds: [] } },
      s,
      () => {
        ran += 1;
      },
    ),
  );

  assert.equal(code, 0);
  assert.equal(ran, 1);
  assert.ok(s.out.join("\n").includes("Today's Plan for Saturday, August 22"));
  assert.deepEqual(s.err, []);
});

test("`morning` on a day it already ran reports the no-op without re-printing a Plan, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } }, s),
  );

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /already ran/i);
});

test("`morning` with nothing plannable reports it and exits 0 (the open prompt is Spencer's move, not an error)", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps({ ok: true, value: { status: "nothing-to-plan", date: TODAY, incompleteTaskIds: ["t1"] } }, s),
  );

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /nothing/i);
});

test("a failing ritual becomes a structured stderr line and a non-zero exit code (AD-8)", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps({ ok: false, error: { kind: "unreachable", message: "morning-ritual: could not read Notion Tasks" } }, s),
  );

  assert.equal(code, 1);
  assert.equal(s.err.length, 1);
  const entry = JSON.parse(s.err[0]!) as { level: string; event: string; kind: string; message: string };
  assert.equal(entry.level, "error");
  assert.equal(entry.kind, "unreachable");
  assert.match(entry.message, /could not read Notion Tasks/);
});

test("no subcommand prints usage naming `morning` and exits 2", async () => {
  const s = sink();
  const code = await runRitualCli([], deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: undefined } }, s));

  assert.equal(code, 2);
  assert.match(s.err.join("\n"), /morning/);
});

test("an unknown subcommand exits 2 without running anything", async () => {
  const s = sink();
  let ran = 0;
  const code = await runRitualCli(
    ["breakfast"],
    deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: undefined } }, s, () => {
      ran += 1;
    }),
  );

  assert.equal(code, 2);
  assert.equal(ran, 0);
  assert.match(s.err.join("\n"), /breakfast/);
});

test("the retired `self-check` subcommand is an unknown subcommand: exit 2, usage lists exactly the three live ones", async () => {
  const s = sink();
  let ran = 0;
  const code = await runRitualCli(
    ["self-check"],
    deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: undefined } }, s, () => {
      ran += 1;
    }),
  );

  assert.equal(code, 2);
  assert.equal(ran, 0);
  assert.match(s.err.join("\n"), /usage: node src\/shell\/ritual-cli\.ts <morning\|night-prompt\|night-escalate>/);
});

// ============================================================================
// `night-prompt` (Task 19 / Story 3.1)
// ============================================================================

test("`night-prompt` runs the Night Ritual close-out prompt and reports it was sent, exit code 0", async () => {
  const s = sink();
  let ran = 0;
  const code = await runRitualCli(
    ["night-prompt"],
    nightPromptDeps(
      { ok: true, value: { status: "prompted", date: TODAY, tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] } },
      s,
      () => {
        ran += 1;
      },
    ),
  );

  assert.equal(code, 0);
  assert.equal(ran, 1);
  assert.match(s.out.join("\n"), /1 Task/);
  assert.deepEqual(s.err, []);
});

test("`night-prompt` on a night it already ran reports the no-op, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(["night-prompt"], nightPromptDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s));

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /already ran/i);
});

test("`night-prompt` with no Plan generated yet reports it plainly, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(["night-prompt"], nightPromptDeps({ ok: true, value: { status: "no-plan-today", date: TODAY } }, s));

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /no plan/i);
});

test("`night-prompt` with nothing to confirm reports it plainly, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(["night-prompt"], nightPromptDeps({ ok: true, value: { status: "nothing-to-confirm", date: TODAY } }, s));

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /nothing to confirm/i);
});

test("a failing night-prompt ritual becomes a structured stderr line and a non-zero exit code (AD-8)", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["night-prompt"],
    nightPromptDeps({ ok: false, error: { kind: "conflict", message: "night-ritual: could not persist the close-out prompt" } }, s),
  );

  assert.equal(code, 1);
  assert.equal(s.err.length, 1);
  const entry = JSON.parse(s.err[0]!) as { level: string; event: string; kind: string; message: string };
  assert.equal(entry.level, "error");
  assert.equal(entry.kind, "conflict");
  assert.match(entry.message, /could not persist the close-out prompt/);
});

test("night-prompt no longer appears in the 'not yet built' set — it's a real, built subcommand now", async () => {
  const s = sink();
  const code = await runRitualCli(["night-prompt"], nightPromptDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s));
  assert.equal(code, 0);
  assert.doesNotMatch(s.err.join("\n"), /not implemented yet/i);
});

// ============================================================================
// `night-escalate` (Task 20 / Story 3.2)
// ============================================================================

test("`night-escalate` runs the escalation check and reports a sent email, exit code 0", async () => {
  const s = sink();
  let ran = 0;
  const code = await runRitualCli(
    ["night-escalate"],
    nightEscalateDeps(
      { ok: true, value: { status: "escalated", date: TODAY, tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] } },
      s,
      () => {
        ran += 1;
      },
    ),
  );

  assert.equal(code, 0);
  assert.equal(ran, 1);
  assert.match(s.out.join("\n"), /email/i);
  assert.deepEqual(s.err, []);
});

test("`night-escalate` when the close-out was already answered is a no-op, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["night-escalate"],
    nightEscalateDeps({ ok: true, value: { status: "no-open-request", date: TODAY } }, s),
  );

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /no-?op|already answered|nothing/i);
});

test("`night-escalate` on a night it already ran (the cap: at most one escalation) reports the no-op, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["night-escalate"],
    nightEscalateDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s),
  );

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /already ran/i);
});

test("a failing night-escalate ritual becomes a structured stderr line and a non-zero exit code (AD-8)", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["night-escalate"],
    nightEscalateDeps({ ok: false, error: { kind: "unreachable", message: "night-ritual: could not send the escalation email" } }, s),
  );

  assert.equal(code, 1);
  assert.equal(s.err.length, 1);
  const entry = JSON.parse(s.err[0]!) as { level: string; event: string; kind: string; message: string };
  assert.equal(entry.level, "error");
  assert.equal(entry.kind, "unreachable");
  assert.match(entry.message, /could not send the escalation email/);
});

test("night-escalate no longer appears in the 'not yet built' set — it's a real, built subcommand now", async () => {
  const s = sink();
  const code = await runRitualCli(["night-escalate"], nightEscalateDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s));
  assert.equal(code, 0);
  assert.doesNotMatch(s.err.join("\n"), /not implemented yet/i);
});

// ============================================================================
// Story 8.7: end-to-end — /night already recorded tonight's close-out, so
// both `night-prompt` and `night-escalate`'s REAL ritual functions (not the
// file's usual canned-outcome fakes) are no-ops when dispatched through
// runRitualCli.
// ============================================================================

test("end-to-end: night-prompt then night-escalate, both real, are no-ops when /night already recorded tonight's close-out", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  recordNightCloseOutHandledWithoutPrompt(store, TODAY, "2026-08-22T20:00:00.000Z");
  putPlan(store, PLAN);

  const promptOutcome = await runNightPromptRitual({
    store,
    sendNotification: async () => {
      throw new Error("must not be called — night-prompt is a no-op for tonight");
    },
    now: () => new Date("2026-08-22T21:00:00.000Z"),
    timeZone: "UTC",
    getCompletedTaskIdsToday: () => new Set(),
  });
  const sPrompt = sink();
  const promptCode = await runRitualCli(["night-prompt"], nightPromptDeps(promptOutcome, sPrompt));
  assert.equal(promptCode, 0);
  assert.match(sPrompt.out.join("\n"), /already ran/i);

  const escalateOutcome = await runNightEscalateRitual({
    store,
    sendEscalationEmail: async () => {
      throw new Error("must not be called — night-escalate is a no-op for tonight");
    },
    now: () => new Date("2026-08-22T22:00:00.000Z"),
    timeZone: "UTC",
  });
  const sEscalate = sink();
  const escalateCode = await runRitualCli(["night-escalate"], nightEscalateDeps(escalateOutcome, sEscalate));
  assert.equal(escalateCode, 0);
  assert.match(sEscalate.out.join("\n"), /no-?op|already answered|nothing/i);
});

// ============================================================================
// Failure-alert wrapper (Task 25 / Story 5.1, AD-7/AD-9): a single shared
// `withFailureAlert` mechanism applied identically to all three subcommands.
// Covers both failure modes AD-7 names — a `Result` failure AND a thrown
// error escaping the subcommand invocation entirely — plus the "no alert on
// success" and "distinct wording" requirements.
// ============================================================================

const NORMAL_NOTIFICATION_TITLES = ["Today's Plan", "Close out today?"];

/** Builds a `RitualCliDeps` where every run* function throws (not a Result failure) except the one under test, which throws the given error. Mirrors the "should not be called" convention the other helpers above use. */
function throwingDeps(which: "runMorning" | "runNightPrompt" | "runNightEscalate", err: Error, s: Sink): RitualCliDeps {
  const unexpected = (label: string) => async () => {
    throw new Error(`${label} should not be called by this dispatch test`);
  };
  const base: RitualCliDeps = {
    io: {
      writeLine: (l) => s.out.push(l),
      writeError: (l) => s.err.push(l),
    },
    runMorning: unexpected("runMorning"),
    runNightPrompt: unexpected("runNightPrompt"),
    runNightEscalate: unexpected("runNightEscalate"),
    sendFailureAlert: async (notification) => {
      s.alerts.push(notification);
    },
    checkMissedRun: NOT_MISSED,
    recordInvocation: NOOP_RECORD_INVOCATION,
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
  };
  return { ...base, [which]: async () => { throw err; } };
}

// ---- morning ----

test("`morning` sends exactly one distinctly-worded failure alert when the ritual returns a Result failure, before exit code 1", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps({ ok: false, error: { kind: "unreachable", message: "morning-ritual: could not read Notion Tasks" } }, s),
  );

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  const alert = s.alerts[0]!;
  assert.equal(alert.title, "Morning Plan failed");
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title), "failure alert title must be distinct from a normal Plan/close-out/Self-Check notification title");
  assert.match(alert.message, /could not read Notion Tasks/);
});

test("`morning` sends the failure alert and exits non-zero when runMorning THROWS instead of returning a Result failure", async () => {
  const s = sink();
  const code = await runRitualCli(["morning"], throwingDeps("runMorning", new Error("morning-ritual: unexpected crash"), s));

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0]!.title, "Morning Plan failed");
  assert.match(s.alerts[0]!.message, /unexpected crash/);
});

test("`morning` sends NO failure alert on a successful run", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } }, s),
  );
  assert.equal(code, 0);
  assert.deepEqual(s.alerts, []);
});

// ---- night-prompt ----

test("`night-prompt` sends exactly one distinctly-worded failure alert when the ritual returns a Result failure, before exit code 1", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["night-prompt"],
    nightPromptDeps({ ok: false, error: { kind: "conflict", message: "night-ritual: could not persist the close-out prompt" } }, s),
  );

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  const alert = s.alerts[0]!;
  assert.equal(alert.title, "Night check-in failed");
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title), "failure alert title must be distinct from a normal Plan/close-out/Self-Check notification title");
  assert.match(alert.message, /could not persist the close-out prompt/);
});

test("`night-prompt` sends the failure alert and exits non-zero when runNightPrompt THROWS instead of returning a Result failure", async () => {
  const s = sink();
  const code = await runRitualCli(["night-prompt"], throwingDeps("runNightPrompt", new Error("night-ritual: unexpected crash"), s));

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0]!.title, "Night check-in failed");
  assert.match(s.alerts[0]!.message, /unexpected crash/);
});

test("`night-prompt` sends NO failure alert on a successful run", async () => {
  const s = sink();
  const code = await runRitualCli(["night-prompt"], nightPromptDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s));
  assert.equal(code, 0);
  assert.deepEqual(s.alerts, []);
});

// ---- night-escalate ----

test("`night-escalate` sends exactly one distinctly-worded failure alert when the ritual returns a Result failure, before exit code 1", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["night-escalate"],
    nightEscalateDeps({ ok: false, error: { kind: "unreachable", message: "night-ritual: could not send the escalation email" } }, s),
  );

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  const alert = s.alerts[0]!;
  assert.equal(alert.title, "Night reminder failed");
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title), "failure alert title must be distinct from a normal Plan/close-out/Self-Check notification title");
  assert.match(alert.message, /could not send the escalation email/);
});

test("`night-escalate` sends the failure alert and exits non-zero when runNightEscalate THROWS instead of returning a Result failure", async () => {
  const s = sink();
  const code = await runRitualCli(["night-escalate"], throwingDeps("runNightEscalate", new Error("night-ritual: unexpected crash"), s));

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0]!.title, "Night reminder failed");
  assert.match(s.alerts[0]!.message, /unexpected crash/);
});

test("`night-escalate` sends NO failure alert on a successful run", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["night-escalate"],
    nightEscalateDeps({ ok: true, value: { status: "escalated", date: TODAY, tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] } }, s),
  );
  assert.equal(code, 0);
  assert.deepEqual(s.alerts, []);
});

// ---- cross-cutting: the three alert titles are mutually distinguishable, not just distinct from normal notifications ----

test("the three subcommands' failure alerts each get their own plain title, not a generic shared one (AD-7: mutually distinguishable, even though none names the raw subcommand id anymore — polish-1 fix round)", async () => {
  const titles = new Set<string>();

  const sMorning = sink();
  await runRitualCli(["morning"], deps({ ok: false, error: { kind: "unreachable", message: "x" } }, sMorning));
  titles.add(sMorning.alerts[0]!.title);
  assert.equal(sMorning.alerts[0]!.title, "Morning Plan failed");

  const sNightPrompt = sink();
  await runRitualCli(["night-prompt"], nightPromptDeps({ ok: false, error: { kind: "unreachable", message: "x" } }, sNightPrompt));
  titles.add(sNightPrompt.alerts[0]!.title);
  assert.equal(sNightPrompt.alerts[0]!.title, "Night check-in failed");

  const sNightEscalate = sink();
  await runRitualCli(["night-escalate"], nightEscalateDeps({ ok: false, error: { kind: "unreachable", message: "x" } }, sNightEscalate));
  titles.add(sNightEscalate.alerts[0]!.title);
  assert.equal(sNightEscalate.alerts[0]!.title, "Night reminder failed");

  assert.equal(titles.size, 3, "each subcommand's failure alert title must be distinguishable from the other two");
});

// ============================================================================
// createMorningRitualDeps's bumpLevels bridge (Task 19 — Task 17's deferred
// item, verified end-to-end): a stored SlipHistory row must genuinely
// produce a non-empty bumpLevels map, computed via the real
// core/slip-bump.ts computation — not just unit-tested in isolation.
// ============================================================================

const BASE_ENV: Record<string, string> = {
  YOH_TIMEZONE: "America/New_York",
  NOTION_TOKEN: "fake-notion-token",
  NOTION_TASKS_DATA_SOURCE_ID: "fake-tasks-ds",
  NOTION_PROJECTS_DATA_SOURCE_ID: "fake-projects-ds",
  GOOGLE_CLIENT_ID: "fake-client-id",
  GOOGLE_CLIENT_SECRET: "fake-client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost/oauth2callback",
  GOOGLE_TOKEN_FILE_PATH: "/tmp/yoh-test-google-token-nonexistent.json",
  PUSHOVER_APP_TOKEN: "fake-app-token",
  PUSHOVER_USER_KEY: "fake-user-key",
};

test("createMorningRitualDeps.bumpLevels is genuinely populated from stored SlipHistory rows via the real computeSlipBumpLevels bridge", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  recordSlip(store, "t1", "2026-08-21");
  recordSlip(store, "t1", "2026-08-22"); // 2 consecutive slips
  recordSlip(store, "t2", "2026-08-22"); // 1 slip

  const deps = createMorningRitualDeps(store, BASE_ENV);

  assert.ok(deps.bumpLevels, "expected a bumpLevels map to be present at all");
  assert.notDeepEqual(deps.bumpLevels, {}, "expected a NON-EMPTY bumpLevels map — Task 17's deferred bridge, verified end-to-end");

  // The bridge must produce EXACTLY what the real computeSlipBumpLevels
  // computes from the real stored counts — not a hand-rolled/faked map.
  const expected = computeSlipBumpLevels({ t1: 2, t2: 1 });
  assert.deepEqual(deps.bumpLevels, expected);
  assert.equal(deps.bumpLevels?.["t1"], 2, "2 consecutive slips -> bump level 2 (cap 3, step 1)");
  assert.equal(deps.bumpLevels?.["t2"], 1);

  store.close();
});

test("createMorningRitualDeps.bumpLevels is an empty map when no Task has ever slipped — never throws for lack of history", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const deps = createMorningRitualDeps(store, BASE_ENV);
  assert.deepEqual(deps.bumpLevels, {});
  store.close();
});

test("createMorningRitualDeps wires a real writeCalendarPlan function (final whole-branch review, Finding 1 — the 'Yoh Plan' Calendar-write capability must not silently go unwired again)", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const deps = createMorningRitualDeps(store, BASE_ENV);

  assert.equal(typeof deps.writeCalendarPlan, "function", "a structural check, not just a type-level one — this must not silently regress to unwired");

  store.close();
});

test("createMorningRitualDeps delivers the morning Plan in the app only — sendNotification makes no Pushover call (Spencer, 2026-09-27)", async () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const deps = createMorningRitualDeps(store, BASE_ENV);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("no network call expected");
  }) as typeof fetch;
  try {
    await deps.sendNotification({ title: "Yoh", message: "today's Plan" });
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
  assert.equal(fetchCalls, 0, "the morning Plan must never be pushed to Pushover");
});

test("createMorningRitualDeps threads a given connection straight through, so the ritual can raise its own needs-data notification", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const store = createMemoryStore(connection);
  const deps = createMorningRitualDeps(store, BASE_ENV, connection);
  assert.equal(deps.connection, connection, "the SAME connection object, not a re-opened one (AD-10: one connection per process)");
  store.close();
});

test("createMorningRitualDeps omits connection entirely when none is given — every pre-9.4 call site (this file's own existing tests) keeps compiling and passing unchanged", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const deps = createMorningRitualDeps(store, BASE_ENV);
  assert.equal("connection" in deps, false);
  store.close();
});

test("AD-5: ritual-cli.ts never waits for input — it reads no stdin at all", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "shell", "ritual-cli.ts"), "utf8");
  assert.doesNotMatch(source, /node:readline/, "a one-shot cron entry point must not open a readline interface");
  assert.doesNotMatch(source, /process\.stdin/, "a one-shot cron entry point must not read stdin");
});

// ============================================================================
// Dead-man's-switch — missed-run detection (Task 26 / Story 5.2, AD-7/AD-9)
// ============================================================================
//
// Layers: (1) unit tests for the two pure query functions,
// `checkDailyRitualMissedRun`, directly against a
// real `MemoryStore`, reading the `RitualInvocation` marker (Task 26 review
// fix); (2) integration tests through `runRitualCli` proving the wiring —
// `withFailureAlert` sends a distinctly-worded alert on a miss — and, most
// importantly, that the check is purely ADDITIVE: it never gates or skips
// the subcommand's own work (self-healing, not cascading); (3) the two
// review-fix regressions: a throwing `checkMissedRun()` must not skip
// `runSubcommand` or suppress Task 25's own alert (Critical), and an
// ordinary no-op success / an unanswered-but-normal Self-Check prompt must
// not produce a false alarm (Important x2).

const CHECK_NOW = new Date("2026-08-22T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(CHECK_NOW.getTime() - h * 60 * 60 * 1000).toISOString();

// ---- checkDailyRitualMissedRun (morning / night-prompt / night-escalate) ----

// Fix round 2 (review finding 1): the detail no longer names the raw
// subcommand id — it uses `missedRunSubject`'s plain per-subcommand phrase
// ("morning Plan", "night check-in", "night reminder") — so this pins the
// exact detail per subcommand instead of a generic subcommand-id regex.
const DAILY_MISSED_RUN_EXPECTED_DETAIL: Record<string, string> = {
  morning: "morning Plan hasn't run in about 2 days",
  "night-prompt": "night check-in hasn't run in about 2 days",
  "night-escalate": "night reminder hasn't run in about 2 days",
};

for (const subcommand of ["morning", "night-prompt", "night-escalate"]) {
  test(`checkDailyRitualMissedRun("${subcommand}"): a RitualInvocation older than the ${DAILY_RITUAL_MISSED_RUN_GRACE_HOURS}h grace threshold is a missed run, with the exact plain-language detail`, () => {
    const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
    putRitualInvocation(store, subcommand, { at: hoursAgo(DAILY_RITUAL_MISSED_RUN_GRACE_HOURS + 12) }); // 48h since -> "about 2 days"

    const result = checkDailyRitualMissedRun(store, subcommand, () => CHECK_NOW);

    assert.equal(result.missed, true);
    assert.equal(result.detail, DAILY_MISSED_RUN_EXPECTED_DETAIL[subcommand]);
    store.close();
  });
}

test(`checkDailyRitualMissedRun: a RitualInvocation within the ${DAILY_RITUAL_MISSED_RUN_GRACE_HOURS}h grace threshold does NOT trigger a missed run`, () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  putRitualInvocation(store, "morning", { at: hoursAgo(20) });

  const result = checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW);

  assert.deepEqual(result, { missed: false });
  store.close();
});

test("checkDailyRitualMissedRun: true first-ever cold start (no RitualInvocation at all) does NOT trigger a missed run", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));

  assert.equal(getRitualInvocation(store, "morning"), undefined, "sanity: nothing stored yet");
  const result = checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW);

  assert.deepEqual(result, { missed: false });
  store.close();
});

// ---- CRITICAL review-fix: checkMissedRun() throwing must not skip runSubcommand or suppress Task 25's own alert ----

test("REVIEW FIX (Critical): checkMissedRun() throwing does not skip runSubcommand — the ritual's own work still runs, and the throw is logged, not silently swallowed", async () => {
  const s = sink();
  let ran = 0;
  const code = await runRitualCli(
    ["morning"],
    deps(
      { ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } },
      s,
      () => {
        ran += 1;
      },
      () => {
        throw new Error("SQLITE_BUSY: database is locked");
      },
    ),
  );

  assert.equal(code, 0, "the subcommand's own outcome still governs the exit code");
  assert.equal(ran, 1, "runSubcommand must still run even though checkMissedRun() threw");
  assert.deepEqual(s.alerts, [], "a throwing check cannot determine a miss, so no missed-run alert is sent — but the throw must not suppress runSubcommand either");

  const logged = s.err.map((l) => JSON.parse(l) as { event?: string; message?: string });
  const checkFailedLine = logged.find((l) => l.event === "ritual-cli.missed-run-check-failed");
  assert.ok(checkFailedLine, "the throw must be logged (a structured stderr line), not silently swallowed");
  assert.match(checkFailedLine!.message ?? "", /SQLITE_BUSY/);
});

test("REVIEW FIX (Critical): checkMissedRun() throwing does not suppress Task 25's own failure alert when the ritual itself subsequently fails", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps(
      { ok: false, error: { kind: "unreachable", message: "morning-ritual: could not read Notion Tasks" } },
      s,
      undefined,
      () => {
        throw new Error("disk I/O error reading the missed-run marker");
      },
    ),
  );

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1, "Task 25's own failure alert must still fire even though the missed-run check itself threw — this is the exact regression: before the fix, the throw escaped BEFORE Task 25's try/catch and suppressed this alert entirely");
  assert.equal(s.alerts[0]!.title, "Morning Plan failed");
});

// ---- IMPORTANT review-fix: a quiet-but-successful no-op day must not false-alarm ----
//
// `RitualRun` only advances on morning's `delivered` / night-prompt's
// `prompted` / night-escalate's `escalated` outcomes — an ordinary no-op
// success writes nothing to it. Before the review fix, the dead-man's-switch
// read `RitualRun` directly, so a quiet-but-correct day looked identical to
// "the scheduler never invoked me." These tests prove the fix: the
// `RitualInvocation` marker (written by `withFailureAlert` itself,
// unconditionally, regardless of the ritual's own outcome) means a no-op
// success is still recognized as a genuine invocation.

test("REVIEW FIX (Important): `morning`'s 'nothing-to-plan' no-op (writes no RitualRun) still records an invocation — a LATER check does not false-alarm", async () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps(
      { ok: true, value: { status: "nothing-to-plan", date: TODAY, incompleteTaskIds: ["t1"] } },
      s,
      undefined,
      () => checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW),
      () => putRitualInvocation(store, "morning", { at: CHECK_NOW.toISOString() }),
    ),
  );

  assert.equal(code, 0);
  assert.deepEqual(s.alerts, [], "a quiet no-op success must not itself trigger any alert");

  const laterCheck = checkDailyRitualMissedRun(store, "morning", () => new Date(CHECK_NOW.getTime() + 20 * 60 * 60 * 1000));
  assert.deepEqual(laterCheck, { missed: false }, "a quiet-but-successful no-op day must not cause a false missed-run alarm on the NEXT invocation");
  store.close();
});

test("REVIEW FIX (Important): `night-prompt`'s 'no-plan-today' no-op (writes no RitualRun) still records an invocation — a LATER check does not false-alarm", async () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const s = sink();
  const code = await runRitualCli(
    ["night-prompt"],
    nightPromptDeps(
      { ok: true, value: { status: "no-plan-today", date: TODAY } },
      s,
      undefined,
      () => checkDailyRitualMissedRun(store, "night-prompt", () => CHECK_NOW),
      () => putRitualInvocation(store, "night-prompt", { at: CHECK_NOW.toISOString() }),
    ),
  );

  assert.equal(code, 0);
  assert.deepEqual(s.alerts, []);

  const laterCheck = checkDailyRitualMissedRun(store, "night-prompt", () => new Date(CHECK_NOW.getTime() + 20 * 60 * 60 * 1000));
  assert.deepEqual(laterCheck, { missed: false });
  store.close();
});

test("REVIEW FIX (Important): `night-escalate`'s 'not-prompted-yet' no-op (writes no RitualRun) still records an invocation — a LATER check does not false-alarm, even across the interlocking no-op chain (morning -> night-prompt -> night-escalate all quiet)", async () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const s = sink();

  // The exact interlocking scenario from the review: a day with nothing
  // plannable makes morning no-op, which makes night-prompt no-op, which
  // makes night-escalate no-op too. All three still ran, and all three
  // must still record an invocation.
  const outcomes: Array<{ subcommand: "morning" | "night-prompt" | "night-escalate"; run: () => Promise<number> }> = [
    {
      subcommand: "morning",
      run: () =>
        runRitualCli(
          ["morning"],
          deps(
            { ok: true, value: { status: "nothing-to-plan", date: TODAY, incompleteTaskIds: ["t1"] } },
            s,
            undefined,
            () => checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW),
            () => putRitualInvocation(store, "morning", { at: CHECK_NOW.toISOString() }),
          ),
        ),
    },
    {
      subcommand: "night-prompt",
      run: () =>
        runRitualCli(
          ["night-prompt"],
          nightPromptDeps(
            { ok: true, value: { status: "no-plan-today", date: TODAY } },
            s,
            undefined,
            () => checkDailyRitualMissedRun(store, "night-prompt", () => CHECK_NOW),
            () => putRitualInvocation(store, "night-prompt", { at: CHECK_NOW.toISOString() }),
          ),
        ),
    },
    {
      subcommand: "night-escalate",
      run: () =>
        runRitualCli(
          ["night-escalate"],
          nightEscalateDeps(
            { ok: true, value: { status: "not-prompted-yet", date: TODAY } },
            s,
            undefined,
            () => checkDailyRitualMissedRun(store, "night-escalate", () => CHECK_NOW),
            () => putRitualInvocation(store, "night-escalate", { at: CHECK_NOW.toISOString() }),
          ),
        ),
    },
  ];

  for (const { run } of outcomes) {
    const code = await run();
    assert.equal(code, 0);
  }

  assert.deepEqual(s.alerts, [], "an entirely quiet, interlocking no-op day across all three daily rituals must not itself trigger any alert");

  for (const subcommand of ["morning", "night-prompt", "night-escalate"]) {
    const laterCheck = checkDailyRitualMissedRun(store, subcommand, () => new Date(CHECK_NOW.getTime() + 20 * 60 * 60 * 1000));
    assert.deepEqual(laterCheck, { missed: false }, `${subcommand}: a quiet interlocking no-op day must not cause a false missed-run alarm on the NEXT invocation`);
  }
  store.close();
});

// ---- runRitualCli wiring: a missed-run check sends its own distinctly-worded alert ----

test("`morning` sends a distinctly-worded missed-run alert (not the 'failed' wording) when checkMissedRun reports a miss, naming the subcommand and the detail", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps(
      { ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } },
      s,
      undefined,
      () => ({ missed: true, detail: "last successful \"morning\" run was 3.2 days ago" }),
    ),
  );

  assert.equal(code, 0, "the subcommand's own outcome still governs the exit code — the missed-run check never overrides it");
  assert.equal(s.alerts.length, 1);
  const alert = s.alerts[0]!;
  assert.equal(alert.title, "Morning Plan didn't run", "a missed-run alert must be worded distinctly from the 'subcommand failed' alert (Task 25)");
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title));
  assert.match(alert.message, /morning/i);
  assert.match(alert.message, /3\.2 days ago/);
});

test("`night-prompt`/`night-escalate` each send their own distinctly-worded, plain-titled missed-run alert", async () => {
  const cases: Array<{ title: string; run: (s: Sink) => Promise<number> }> = [
    {
      title: "Night check-in didn't run",
      run: (s) =>
        runRitualCli(
          ["night-prompt"],
          nightPromptDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s, undefined, () => ({ missed: true, detail: "x" })),
        ),
    },
    {
      title: "Night reminder didn't run",
      run: (s) =>
        runRitualCli(
          ["night-escalate"],
          nightEscalateDeps({ ok: true, value: { status: "no-open-request", date: TODAY } }, s, undefined, () => ({ missed: true, detail: "x" })),
        ),
    },
  ];

  for (const { title, run } of cases) {
    const s = sink();
    const code = await run(s);
    assert.equal(code, 0);
    assert.equal(s.alerts.length, 1, `${title}: expected exactly one missed-run alert`);
    assert.equal(s.alerts[0]!.title, title);
  }
});

test("no missed-run alert is sent when checkMissedRun reports no miss (the default for every other dispatch test above)", async () => {
  const s = sink();
  const code = await runRitualCli(["morning"], deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } }, s));
  assert.equal(code, 0);
  assert.deepEqual(s.alerts, []);
});

test("a missed-run alert AND a same-run Result failure both fire — two distinct alerts, one per signal, neither replacing the other", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps(
      { ok: false, error: { kind: "unreachable", message: "morning-ritual: could not read Notion Tasks" } },
      s,
      undefined,
      () => ({ missed: true, detail: "last successful run was 3 days ago" }),
    ),
  );

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 2, "expected one missed-run alert AND one failure alert");
  assert.equal(s.alerts[0]!.title, "Morning Plan didn't run", "the missed-run check runs FIRST, before runSubcommand");
  assert.equal(s.alerts[1]!.title, "Morning Plan failed");
});

// ---- the critical property: self-healing, not cascading ----
//
// After a missed-run alert fires, the ritual must STILL complete its own
// normal work, and `withFailureAlert` must STILL write a fresh
// `RitualInvocation` marker on this invocation's behalf (Task 26 review
// fix: this is now `recordInvocation`'s job, unconditionally, not something
// the ritual's own success path writes itself) — the check is purely
// additive, never a gate. Uses a REAL MemoryStore (not a fake one) so the
// stale-then-fresh invocation state is genuinely observed, not merely
// asserted about a mock.

test("SELF-HEALING: after a missed-run alert fires for `morning`, the ritual still runs its own work and a FRESH RitualInvocation marker is recorded (a single missed day never cascades)", async () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const STALE_AT = hoursAgo(DAILY_RITUAL_MISSED_RUN_GRACE_HOURS + 48); // well past the grace threshold
  putRitualInvocation(store, "morning", { at: STALE_AT });

  const s = sink();
  const FRESH_AT = CHECK_NOW.toISOString();
  let ownWorkRan = false;

  const testDeps: RitualCliDeps = {
    io: {
      writeLine: (l) => s.out.push(l),
      writeError: (l) => s.err.push(l),
    },
    // The real query functions, wired exactly as `main()` wires them —
    // proves the missed-run detection AND the invocation-recording
    // themselves (not stubbed booleans/no-ops).
    checkMissedRun: () => checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW),
    recordInvocation: () => putRitualInvocation(store, "morning", { at: FRESH_AT }),
    // Simulates the ritual's own normal success path — it does its own
    // work, but (per the review fix) does NOT write any invocation marker
    // itself; `withFailureAlert` does that, unconditionally, after this
    // resolves.
    runMorning: async () => {
      ownWorkRan = true;
      return { ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } };
    },
    runNightPrompt: async () => {
      throw new Error("should not be called");
    },
    runNightEscalate: async () => {
      throw new Error("should not be called");
    },
    sendFailureAlert: async (notification) => {
      s.alerts.push(notification);
    },
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
  };

  const code = await runRitualCli(["morning"], testDeps);

  // The missed-run alert fired...
  assert.equal(code, 0);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0]!.title, "Morning Plan didn't run");

  // ...but self-healing held: the ritual's own work still ran...
  assert.equal(ownWorkRan, true, "the missed-run alert must not gate or skip the subcommand's own work");

  // ...and `withFailureAlert` itself recorded a FRESH invocation marker — a
  // later run will see THIS marker, not the stale one, so a single missed
  // day self-corrects rather than cascading into permanent failure.
  const latest = getRitualInvocation(store, "morning");
  assert.ok(latest);
  assert.equal(latest!.data.at, FRESH_AT);
  assert.notEqual(latest!.data.at, STALE_AT);

  // And a follow-up check against the now-fresh marker reports no miss —
  // proof the system healed itself for the NEXT invocation.
  const followUpCheck = checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW);
  assert.deepEqual(followUpCheck, { missed: false });

  store.close();
});

// ============================================================================
// Task 27 / Story 5.3 — the three create*RitualDeps functions delegate their
// log seam to the SHARED adapters/logger.ts writer, instead of each
// repeating its own process.stderr.write closure.
// ============================================================================

function captureStderr(): { restore: () => void; chunks: string[] } {
  const original = process.stderr.write;
  const chunks: string[] = [];
  process.stderr.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  return { chunks, restore: () => { process.stderr.write = original; } };
}

test("createMorningRitualDeps.log delegates to the shared structured-log writer (one JSON line to stderr)", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const deps = createMorningRitualDeps(store, BASE_ENV);
  const capture = captureStderr();
  try {
    deps.log?.({ level: "info", event: "morning-ritual.delivered", detail: { date: TODAY } });
  } finally {
    capture.restore();
  }
  assert.equal(capture.chunks.length, 1);
  assert.deepEqual(JSON.parse(capture.chunks[0]!), { level: "info", event: "morning-ritual.delivered", detail: { date: TODAY } });
  store.close();
});

test("createNightPromptRitualDeps.log delegates to the shared structured-log writer", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const store = createMemoryStore(connection);
  const deps = createNightPromptRitualDeps(connection, store, {
    YOH_TIMEZONE: "America/New_York",
    PUSHOVER_APP_TOKEN: "x",
    PUSHOVER_USER_KEY: "y",
  });
  const capture = captureStderr();
  try {
    deps.log?.({ level: "warn", event: "night-ritual.no-time-budget" });
  } finally {
    capture.restore();
  }
  assert.equal(capture.chunks.length, 1);
  assert.deepEqual(JSON.parse(capture.chunks[0]!), { level: "warn", event: "night-ritual.no-time-budget" });
  store.close();
});

test("createNightPromptRitualDeps.getCompletedTaskIdsToday reads through completion-log.ts on the shared connection, scoped to today's local date", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initCompletionLogSchema(connection.db);
  const store = createMemoryStore(connection);
  const timeZone = "America/New_York";
  const deps = createNightPromptRitualDeps(connection, store, {
    YOH_TIMEZONE: timeZone,
    PUSHOVER_APP_TOKEN: "x",
    PUSHOVER_USER_KEY: "y",
  });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()); // en-CA formats as YYYY-MM-DD
  recordCompletion(connection, {
    taskId: "t1",
    taskName: "Draft the memo",
    area: null,
    dueDate: null,
    estimatedMinutes: null,
    completedAt: new Date().toISOString(),
    source: "check-off",
  });

  const completedToday = deps.getCompletedTaskIdsToday();
  assert.ok(completedToday.has("t1"), `expected t1 to be reported completed today (${today}), got ${JSON.stringify([...completedToday])}`);
  store.close();
});

test("createNightEscalateRitualDeps.log delegates to the shared structured-log writer", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  const deps = createNightEscalateRitualDeps(store, {
    YOH_TIMEZONE: "America/New_York",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "user",
    SMTP_PASSWORD: "pass",
    SMTP_FROM: "yoh@example.com",
  });
  const capture = captureStderr();
  try {
    deps.log?.({ level: "error", event: "night-ritual.escalate-send-failed", detail: "boom" });
  } finally {
    capture.restore();
  }
  assert.equal(capture.chunks.length, 1);
  assert.deepEqual(JSON.parse(capture.chunks[0]!), { level: "error", event: "night-ritual.escalate-send-failed", detail: "boom" });
  store.close();
});

// ============================================================================
// Task 27 / Story 5.3 — Plan-generation performance threshold: `morning`
// treats an exceeded threshold as DEGRADED-NOT-FAILED, raised through the
// SAME alert path Story 5.1/5.2 built, while the Plan still delivers
// normally (never a Result failure).
// ============================================================================

function deliveredOutcome(planGenerationMs: number): Result<MorningRitualOutcome, YohError> {
  return {
    ok: true,
    value: {
      status: "delivered",
      date: TODAY,
      plan: PLAN,
      rendered: "Today's Plan for Saturday, August 22",
      deferredTaskIds: [],
      incompleteTaskIds: [],
      planGenerationMs,
    },
  };
}

test("checkMorningPlanGenerationDegraded: under the threshold is not degraded", () => {
  const result = checkMorningPlanGenerationDegraded({
    status: "delivered",
    date: TODAY,
    plan: PLAN,
    rendered: "x",
    deferredTaskIds: [],
    incompleteTaskIds: [],
    planGenerationMs: PLAN_GENERATION_DEGRADED_THRESHOLD_MS - 1,
  });
  assert.deepEqual(result, { degraded: false });
});

test("checkMorningPlanGenerationDegraded: over the threshold is degraded, with a plain-language detail naming the duration — no internal span name", () => {
  const result = checkMorningPlanGenerationDegraded({
    status: "delivered",
    date: TODAY,
    plan: PLAN,
    rendered: "x",
    deferredTaskIds: [],
    incompleteTaskIds: [],
    planGenerationMs: PLAN_GENERATION_DEGRADED_THRESHOLD_MS + 1234,
  });
  assert.equal(result.degraded, true);
  assert.match(result.detail ?? "", /6\.2s|6\.23s/, "names roughly the actual duration");
  assert.match(result.detail ?? "", /usually under/);
  assert.doesNotMatch(result.detail ?? "", /Data-Completeness Gate/, "polish-1: no internal span name in the alert copy");
  assert.doesNotMatch(result.detail ?? "", /Work\/Break fitting/, "polish-1: no internal span name in the alert copy");
});

test("checkMorningPlanGenerationDegraded: outcomes with no planGenerationMs (already-ran, nothing-to-plan) are never degraded", () => {
  assert.deepEqual(checkMorningPlanGenerationDegraded({ status: "already-ran", date: TODAY, planId: undefined }), { degraded: false });
  assert.deepEqual(checkMorningPlanGenerationDegraded({ status: "nothing-to-plan", date: TODAY, incompleteTaskIds: [] }), { degraded: false });
});

test("`morning` exceeding the Plan-generation threshold sends a distinctly-worded DEGRADED alert, the Plan still delivers normally (exit 0, not a Result failure), and no failure/missed-run alert is conflated with it", async () => {
  const s = sink();
  const code = await runRitualCli(["morning"], deps(deliveredOutcome(PLAN_GENERATION_DEGRADED_THRESHOLD_MS + 3000), s));

  assert.equal(code, 0, "a degraded run is still a SUCCESSFUL run — never a Result failure / non-zero exit");
  assert.ok(s.out.join("\n").includes("Today's Plan for Saturday, August 22"), "the Plan is still delivered/printed normally");
  assert.deepEqual(s.err, [], "no error line — this is not a failure");

  assert.equal(s.alerts.length, 1, "exactly one degraded-performance alert");
  const alert = s.alerts[0]!;
  assert.equal(alert.title, "Morning Plan was slow", "must be worded distinctly from the 'subcommand failed'/missed-run alert titles (Tasks 25/26)");
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title));
  assert.match(alert.message, /8\.0s|8s/, "names roughly the actual duration");
});

test("`morning` staying under the Plan-generation threshold sends NO degraded-performance alert", async () => {
  const s = sink();
  const code = await runRitualCli(["morning"], deps(deliveredOutcome(PLAN_GENERATION_DEGRADED_THRESHOLD_MS - 500), s));

  assert.equal(code, 0);
  assert.deepEqual(s.alerts, []);
});

test("a nothing-fits outcome exceeding the threshold also raises the degraded alert (it too completes Work/Break fitting)", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps(
      {
        ok: true,
        value: {
          status: "nothing-fits",
          date: TODAY,
          deferredTaskIds: ["t1"],
          incompleteTaskIds: [],
          planGenerationMs: PLAN_GENERATION_DEGRADED_THRESHOLD_MS + 1,
        },
      },
      s,
    ),
  );
  assert.equal(code, 0);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0]!.title, "Morning Plan was slow");
});

test("an already-ran outcome (no planGenerationMs at all) never triggers the degraded check, even though it's the same subcommand", async () => {
  const s = sink();
  const code = await runRitualCli(["morning"], deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } }, s));
  assert.equal(code, 0);
  assert.deepEqual(s.alerts, []);
});

test("a degraded Plan-generation run and a missed-run alert both fire independently — three distinct alert categories never collapse into one another", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["morning"],
    deps(deliveredOutcome(PLAN_GENERATION_DEGRADED_THRESHOLD_MS + 2000), s, undefined, () => ({ missed: true, detail: "3 days" })),
  );
  assert.equal(code, 0);
  assert.equal(s.alerts.length, 2, "one missed-run alert AND one degraded-performance alert");
  assert.equal(s.alerts[0]!.title, "Morning Plan didn't run", "the missed-run check runs first");
  assert.equal(s.alerts[1]!.title, "Morning Plan was slow");
});

test("the degraded-performance check is `morning`-only — night-prompt/night-escalate never raise it even on a successful run", async () => {
  const sNightPrompt = sink();
  await runRitualCli(["night-prompt"], nightPromptDeps({ ok: true, value: { status: "prompted", date: TODAY, tasks: [] } }, sNightPrompt));
  assert.deepEqual(sNightPrompt.alerts, []);

  const sNightEscalate = sink();
  await runRitualCli(["night-escalate"], nightEscalateDeps({ ok: true, value: { status: "no-open-request", date: TODAY } }, sNightEscalate));
  assert.deepEqual(sNightEscalate.alerts, []);

});

// ============================================================================
// notifyOperational — every AD-7 alert condition also raises an
// `operational` in-app notification (Story 7.4)
// ============================================================================

test("a failed morning run sends a Pushover alert AND calls notifyOperational", async () => {
  const s = sink();
  const notified: Array<{ title: string; message: string }> = [];
  const testDeps: RitualCliDeps = {
    ...deps({ ok: false, error: { kind: "unreachable", message: "notion down" } }, s),
    notifyOperational: (title, message) => notified.push({ title, message }),
  };

  await runRitualCli(["morning"], testDeps);

  assert.equal(s.alerts.length, 1);
  assert.equal(notified.length, 1);
  assert.equal(notified[0]!.title, s.alerts[0]!.title);
  assert.equal(notified[0]!.message, s.alerts[0]!.message);
});

test("a missed-run alert for night-prompt also calls notifyOperational, matching the Pushover alert's wording", async () => {
  const s = sink();
  const notified: Array<{ title: string; message: string }> = [];
  const testDeps: RitualCliDeps = {
    ...nightPromptDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s, undefined, () => ({ missed: true, detail: "3 days" })),
    notifyOperational: (title, message) => notified.push({ title, message }),
  };

  await runRitualCli(["night-prompt"], testDeps);

  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0]!.title, "Night check-in didn't run");
  assert.deepEqual(notified, [{ title: s.alerts[0]!.title, message: s.alerts[0]!.message }]);
});

test("a thrown error still calls notifyOperational alongside the Pushover alert", async () => {
  const s = sink();
  const notified: Array<{ title: string; message: string }> = [];
  const testDeps: RitualCliDeps = {
    ...throwingDeps("runMorning", new Error("morning-ritual: unexpected crash"), s),
    notifyOperational: (title, message) => notified.push({ title, message }),
  };

  await runRitualCli(["morning"], testDeps);

  assert.equal(s.alerts.length, 1);
  assert.deepEqual(notified, [{ title: s.alerts[0]!.title, message: s.alerts[0]!.message }]);
});

// ============================================================================
// Stale-heartbeat alert (Story 7.4, AD-7) — morning-only, additive, never
// blocks the Morning Plan
// ============================================================================

test("morning sends a distinctly-worded alert when checkServerHeartbeatStale reports stale, without blocking the Plan", async () => {
  const s = sink();
  let planRan = false;
  const testDeps: RitualCliDeps = {
    ...deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } }, s, () => {
      planRan = true;
    }),
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
    checkServerHeartbeatStale: () => true,
  };

  const code = await runRitualCli(["morning"], testDeps);

  assert.equal(code, 0, "a stale heartbeat must never turn a successful morning run into a failure exit code");
  assert.equal(planRan, true);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0]!.title, "Server isn't checking in", "worded distinctly from the other three AD-7 alerts");
});

test("morning sends no stale-heartbeat alert when checkServerHeartbeatStale reports fresh", async () => {
  const s = sink();
  const testDeps: RitualCliDeps = {
    ...deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } }, s),
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
    checkServerHeartbeatStale: () => false,
  };

  await runRitualCli(["morning"], testDeps);
  assert.equal(s.alerts.length, 0);
});

test("a throwing checkServerHeartbeatStale is logged and treated as fresh — it never blocks the Plan or crashes the dispatch", async () => {
  const s = sink();
  let planRan = false;
  const testDeps: RitualCliDeps = {
    ...deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } }, s, () => {
      planRan = true;
    }),
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
    checkServerHeartbeatStale: () => {
      throw new Error("SQLITE_BUSY");
    },
  };

  const code = await runRitualCli(["morning"], testDeps);

  assert.equal(code, 0);
  assert.equal(planRan, true);
  assert.equal(s.alerts.length, 0);
  assert.ok(s.err.some((line) => /heartbeat-check-failed/.test(line)));
});

test("night-prompt/night-escalate never receive a checkServerHeartbeatStale check (morning-only, like checkDegraded)", async () => {
  const s = sink();
  // nightPromptDeps et al. simply never set checkServerHeartbeatStale — this test documents that omitting it is the norm and nothing crashes.
  await runRitualCli(["night-prompt"], {
    ...nightPromptDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s),
    notifyOperational: NOOP_NOTIFY_OPERATIONAL,
  });
  assert.equal(s.alerts.length, 0);
});

// ============================================================================
// createOperationalNotifier — the real `main()` binding to
// `notification-store.ts` (Story 7.4, FR-49)
// ============================================================================

test("createOperationalNotifier writes a real `operational` in-app notification with no deep link", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const notifyOperational = createOperationalNotifier(connection);

  notifyOperational("Yoh: server is down", "The Yoh server's heartbeat is stale.");

  const unread = listUnreadNotifications(connection);
  assert.equal(unread.length, 1);
  assert.equal(unread[0]!.kind, "operational");
  assert.equal(unread[0]!.title, "Yoh: server is down");
  assert.equal(unread[0]!.body, "The Yoh server's heartbeat is stale.");
  assert.equal(unread[0]!.deepLink, null);
  connection.close();
});

// ============================================================================
// Polish-1: plain-language alert copy — the four pure `buildXAlertBody`
// functions, pinned to their exact output, one test per alert kind (this
// task's own brief: "put the copy builders in one place per alert kind,
// pure where possible, with tests pinning each exact string").
// ============================================================================

const BANNED_ALERT_JARGON = [/AD-7/, /Data-Completeness Gate/, /Work\/Break fitting/, /self-healing/i, /grace:\s*\d/i, /"morning"/, /"night-prompt"/, /"night-escalate"/, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/];

function assertNoJargon(text: string): void {
  for (const pattern of BANNED_ALERT_JARGON) {
    assert.doesNotMatch(text, pattern, `alert copy must not contain internal jargon: ${text}`);
  }
}

test("buildFailedAlertBody: pins the exact plain-language copy per subcommand", () => {
  assert.equal(
    buildFailedAlertBody("morning", "morning-ritual: could not reach Notion"),
    'This morning\'s Plan couldn\'t finish: morning-ritual: could not reach Notion. It will try again at the next scheduled time, or type "/plan".',
  );
  assert.equal(
    buildFailedAlertBody("night-prompt", "boom"),
    'Tonight\'s close-out check-in couldn\'t finish: boom. It will try again at the next scheduled time, or type "/night".',
  );
  assert.equal(buildFailedAlertBody("night-escalate", "boom"), "Tonight's reminder email couldn't finish: boom. It will try again at the next scheduled time.");
  for (const subcommand of ["morning", "night-prompt", "night-escalate"]) {
    assertNoJargon(buildFailedAlertBody(subcommand, "x"));
  }
});

test("buildMissedRunAlertBody: pins the exact plain-language copy — fix round 2's simpler wording (review finding 1)", () => {
  assert.equal(
    buildMissedRunAlertBody("morning Plan hasn't run in about 4 days"),
    "The morning Plan hasn't run in about 4 days — your Mac may have been asleep or off. It'll run again at its next scheduled time.",
  );
});

// ---- fix round (review finding 1): plain, distinct, per-subcommand TITLES ----

test("buildFailedAlertTitle: pins the exact plain title per subcommand, each mutually distinct (AD-7)", () => {
  assert.equal(buildFailedAlertTitle("morning"), "Morning Plan failed");
  assert.equal(buildFailedAlertTitle("night-prompt"), "Night check-in failed");
  assert.equal(buildFailedAlertTitle("night-escalate"), "Night reminder failed");
  const titles = ["morning", "night-prompt", "night-escalate"].map(buildFailedAlertTitle);
  assert.equal(new Set(titles).size, 3);
});

test("buildMissedRunAlertTitle: pins the exact plain title per subcommand, each mutually distinct (AD-7)", () => {
  assert.equal(buildMissedRunAlertTitle("morning"), "Morning Plan didn't run");
  assert.equal(buildMissedRunAlertTitle("night-prompt"), "Night check-in didn't run");
  assert.equal(buildMissedRunAlertTitle("night-escalate"), "Night reminder didn't run");
  const titles = ["morning", "night-prompt", "night-escalate"].map(buildMissedRunAlertTitle);
  assert.equal(new Set(titles).size, 3);
});

test("buildDegradedAlertTitle: pins the exact plain title (morning is the only real caller — checkMorningPlanGenerationDegraded's own doc comment)", () => {
  assert.equal(buildDegradedAlertTitle("morning"), "Morning Plan was slow");
});

test("buildHeartbeatStaleAlertTitle: pins the exact plain title, no 'heartbeat' terminology, distinct from all three ritual-alert title families", () => {
  const title = buildHeartbeatStaleAlertTitle();
  assert.equal(title, "Server isn't checking in");
  assert.doesNotMatch(title, /heartbeat/i);
  for (const subcommand of ["morning", "night-prompt", "night-escalate"]) {
    assert.notEqual(title, buildFailedAlertTitle(subcommand));
    assert.notEqual(title, buildMissedRunAlertTitle(subcommand));
  }
  assert.notEqual(title, buildDegradedAlertTitle("morning"));
});

test("every alert title is free of the raw subcommand id and of internal jargon (titles now render in-app, NotificationOverlay.tsx)", () => {
  for (const subcommand of ["morning", "night-prompt", "night-escalate"]) {
    assertNoJargon(buildFailedAlertTitle(subcommand));
    assertNoJargon(buildMissedRunAlertTitle(subcommand));
  }
  assertNoJargon(buildDegradedAlertTitle("morning"));
  assertNoJargon(buildHeartbeatStaleAlertTitle());
});

// ---- fix round (review finding 3): whole-day counts, never a decimal ----

test("checkDailyRitualMissedRun: the real detail names a WHOLE day count, never a decimal, using the plain per-subcommand subject (fix round 2, review finding 1)", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  // 48h since last invocation, 36h grace -> 48h/24 = exactly 2 days.
  putRitualInvocation(store, "morning", { at: hoursAgo(48) });

  const daily = checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW);

  assert.equal(daily.detail, "morning Plan hasn't run in about 2 days");
  assert.doesNotMatch(daily.detail ?? "", /\d+\.\d/, "no decimal day count");
  store.close();
});

test("buildMissedRunAlertBody composed with the real detail: pins the exact end-to-end sentence for morning", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  putRitualInvocation(store, "morning", { at: hoursAgo(24 * 4) }); // exactly 4 days since, well past the 36h grace

  const daily = checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW);

  assert.equal(
    buildMissedRunAlertBody(daily.detail ?? ""),
    "The morning Plan hasn't run in about 4 days — your Mac may have been asleep or off. It'll run again at its next scheduled time.",
  );
  store.close();
});

test("formatDayCount: pins whole-day, correctly-pluralized output — the pure function `checkInvocationStaleness` builds its detail clause from", () => {
  assert.equal(formatDayCount(24), "about 1 day", "singular, never '1 days'");
  assert.equal(formatDayCount(23), "about 1 day", "rounds down to the nearest whole day");
  assert.equal(formatDayCount(30), "about 1 day", "rounds down (1.25 days)");
  assert.equal(formatDayCount(36), "about 2 days", "rounds up (1.5 days) — plural");
  assert.equal(formatDayCount(48), "about 2 days");
  assert.equal(formatDayCount(24 * 10 + 2), "about 10 days", "the reviewer's own worked example: ~10.1 days -> 'about 10 days', never a decimal");
  assert.doesNotMatch(formatDayCount(24 * 10 + 2), /\d+\.\d/);
});

test("buildDegradedAlertBody: pins the exact plain-language copy, matching the brief's own worked example register", () => {
  assert.equal(
    buildDegradedAlertBody("This morning's Plan took 8.0s to build (usually under 5.0s)"),
    "This morning's Plan took 8.0s to build (usually under 5.0s). Nothing to do — it's just slower than normal.",
  );
});

test("buildHeartbeatStaleAlertBody: pins the exact plain-language copy, no 'heartbeat' terminology", () => {
  assert.equal(buildHeartbeatStaleAlertBody(), "The Yoh server on your Mac hasn't checked in recently — it may be off or asleep. This doesn't affect your Plan.");
  assert.doesNotMatch(buildHeartbeatStaleAlertBody(), /heartbeat/i);
});

test("checkDailyRitualMissedRun: the real (non-mocked) missed-run detail is plain — no ISO timestamp, no 'grace: Nh', no quoted ritual id", () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  putRitualInvocation(store, "morning", { at: hoursAgo(DAILY_RITUAL_MISSED_RUN_GRACE_HOURS + 12) });

  const daily = checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW);

  assertNoJargon(buildMissedRunAlertBody(daily.detail ?? ""));
  store.close();
});

test("checkMorningPlanGenerationDegraded: the real (non-mocked) degraded detail is plain — no internal span name, matches the brief's own register", () => {
  const result = checkMorningPlanGenerationDegraded({
    status: "delivered",
    date: TODAY,
    plan: PLAN,
    rendered: "x",
    deferredTaskIds: [],
    incompleteTaskIds: [],
    planGenerationMs: 8000,
  });
  assert.equal(result.degraded, true);
  assert.equal(buildDegradedAlertBody(result.detail ?? ""), "This morning's Plan took 8.0s to build (usually under 5.0s). Nothing to do — it's just slower than normal.");
  assertNoJargon(buildDegradedAlertBody(result.detail ?? ""));
});

test("end-to-end: a real failed/missed/degraded morning run's alert bodies contain no internal jargon, ISO timestamps, or quoted ritual ids", async () => {
  const store = createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
  putRitualInvocation(store, "morning", { at: hoursAgo(DAILY_RITUAL_MISSED_RUN_GRACE_HOURS + 24) });
  const s = sink();

  const code = await runRitualCli(
    ["morning"],
    deps(deliveredOutcome(PLAN_GENERATION_DEGRADED_THRESHOLD_MS + 3000), s, undefined, () => checkDailyRitualMissedRun(store, "morning", () => CHECK_NOW)),
  );

  assert.equal(code, 0);
  assert.equal(s.alerts.length, 2, "one missed-run alert and one degraded-performance alert");
  for (const alert of s.alerts) {
    assertNoJargon(alert.message);
  }
  store.close();
});

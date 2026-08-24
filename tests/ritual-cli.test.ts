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
import { createMemoryStore, getRitualRun, getSelfCheckState, putRitualRun, putSelfCheckState } from "../src/adapters/memory-store.ts";
import { recordSlip } from "../src/adapters/memory-store.ts";
import { computeSlipBumpLevels } from "../src/core/slip-bump.ts";
import {
  checkDailyRitualMissedRun,
  checkSelfCheckMissedRun,
  createMorningRitualDeps,
  createSelfCheckRitualDeps,
  runRitualCli,
  DAILY_RITUAL_MISSED_RUN_GRACE_HOURS,
  SELF_CHECK_MISSED_RUN_GRACE_DAYS,
  type MissedRunCheckResult,
  type RitualCliDeps,
} from "../src/shell/ritual-cli.ts";
import { MORNING_RITUAL_ID } from "../src/rituals/morning-ritual.ts";
import { NIGHT_ESCALATE_RITUAL_ID, NIGHT_PROMPT_RITUAL_ID } from "../src/rituals/night-ritual.ts";
import type { MorningRitualOutcome, PlanNotification } from "../src/rituals/morning-ritual.ts";
import type { NightEscalateOutcome, NightPromptOutcome } from "../src/rituals/night-ritual.ts";
import type { SelfCheckOutcome } from "../src/rituals/self-check.ts";
import type { Plan, Result, YohError } from "../src/types/domain.ts";

/** Default "never missed" check — most existing dispatch tests don't care about the Task 26 / Story 5.2 dead-man's-switch at all. */
const NOT_MISSED: () => MissedRunCheckResult = () => ({ missed: false });

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
    runSelfCheck: async () => {
      throw new Error("runSelfCheck should not be called by a `morning` dispatch test");
    },
    sendFailureAlert: async (notification) => {
      sink.alerts.push(notification);
    },
    checkMissedRun,
  };
}

function nightPromptDeps(
  outcome: Result<NightPromptOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
  checkMissedRun: () => MissedRunCheckResult = NOT_MISSED,
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
    runSelfCheck: async () => {
      throw new Error("runSelfCheck should not be called by a `night-prompt` dispatch test");
    },
    sendFailureAlert: async (notification) => {
      sink.alerts.push(notification);
    },
    checkMissedRun,
  };
}

function nightEscalateDeps(
  outcome: Result<NightEscalateOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
  checkMissedRun: () => MissedRunCheckResult = NOT_MISSED,
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
    runSelfCheck: async () => {
      throw new Error("runSelfCheck should not be called by a `night-escalate` dispatch test");
    },
    sendFailureAlert: async (notification) => {
      sink.alerts.push(notification);
    },
    checkMissedRun,
  };
}

function selfCheckDeps(
  outcome: Result<SelfCheckOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
  checkMissedRun: () => MissedRunCheckResult = NOT_MISSED,
): RitualCliDeps {
  return {
    io: {
      writeLine: (l) => sink.out.push(l),
      writeError: (l) => sink.err.push(l),
    },
    runMorning: async () => {
      throw new Error("runMorning should not be called by a `self-check` dispatch test");
    },
    runNightPrompt: async () => {
      throw new Error("runNightPrompt should not be called by a `self-check` dispatch test");
    },
    runNightEscalate: async () => {
      throw new Error("runNightEscalate should not be called by a `self-check` dispatch test");
    },
    runSelfCheck: async () => {
      onRun?.();
      return outcome;
    },
    sendFailureAlert: async (notification) => {
      sink.alerts.push(notification);
    },
    checkMissedRun,
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
// `self-check` (Task 24 / Story 4.3)
// ============================================================================

test("`self-check` runs the ritual and reports today's Self-Check was sent, exit code 0", async () => {
  const s = sink();
  let ran = 0;
  const code = await runRitualCli(
    ["self-check"],
    selfCheckDeps({ ok: true, value: { status: "prompted", date: TODAY } }, s, () => {
      ran += 1;
    }),
  );

  assert.equal(code, 0);
  assert.equal(ran, 1);
  assert.match(s.out.join("\n"), /self-check/i);
  assert.deepEqual(s.err, []);
});

test("`self-check` on a day that isn't due reports the no-op, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["self-check"],
    selfCheckDeps({ ok: true, value: { status: "not-due", date: TODAY, nextDueDate: "2026-08-26" } }, s),
  );

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /not due/i);
});

test("`self-check` on its very first-ever run reports the schedule was initialized, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["self-check"],
    selfCheckDeps({ ok: true, value: { status: "initialized", date: TODAY, nextDueDate: "2026-08-26" } }, s),
  );

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /initialized/i);
});

test("`self-check` when a prompt from an earlier trigger is still open reports the no-op, exit code 0", async () => {
  const s = sink();
  const code = await runRitualCli(["self-check"], selfCheckDeps({ ok: true, value: { status: "already-open", date: TODAY } }, s));

  assert.equal(code, 0);
  assert.match(s.out.join("\n"), /already waiting|check chat/i);
});

test("a failing self-check ritual becomes a structured stderr line and a non-zero exit code (AD-8)", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["self-check"],
    selfCheckDeps({ ok: false, error: { kind: "conflict", message: "self-check: could not persist the Self-Check prompt" } }, s),
  );

  assert.equal(code, 1);
  assert.equal(s.err.length, 1);
  const entry = JSON.parse(s.err[0]!) as { level: string; event: string; kind: string; message: string };
  assert.equal(entry.level, "error");
  assert.equal(entry.kind, "conflict");
  assert.match(entry.message, /could not persist the Self-Check prompt/);
});

test("self-check no longer appears in the 'not yet built' set — it's a real, built subcommand now (all four AD-5 subcommands are built)", async () => {
  const s = sink();
  const code = await runRitualCli(["self-check"], selfCheckDeps({ ok: true, value: { status: "not-due", date: TODAY, nextDueDate: TODAY } }, s));
  assert.equal(code, 0);
  assert.doesNotMatch(s.err.join("\n"), /not implemented yet/i);
});

// ============================================================================
// Failure-alert wrapper (Task 25 / Story 5.1, AD-7/AD-9): a single shared
// `withFailureAlert` mechanism applied identically to all four subcommands.
// Covers both failure modes AD-7 names — a `Result` failure AND a thrown
// error escaping the subcommand invocation entirely — plus the "no alert on
// success" and "distinct wording" requirements.
// ============================================================================

const NORMAL_NOTIFICATION_TITLES = ["Today's Plan", "Close out today?", "Quick Self-Check"];

/** Builds a `RitualCliDeps` where every run* function throws (not a Result failure) except the one under test, which throws the given error. Mirrors the "should not be called" convention the other helpers above use. */
function throwingDeps(which: "runMorning" | "runNightPrompt" | "runNightEscalate" | "runSelfCheck", err: Error, s: Sink): RitualCliDeps {
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
    runSelfCheck: unexpected("runSelfCheck"),
    sendFailureAlert: async (notification) => {
      s.alerts.push(notification);
    },
    checkMissedRun: NOT_MISSED,
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
  assert.match(alert.title, /morning/i);
  assert.match(alert.title, /fail/i);
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title), "failure alert title must be distinct from a normal Plan/close-out/Self-Check notification title");
  assert.match(alert.message, /could not read Notion Tasks/);
});

test("`morning` sends the failure alert and exits non-zero when runMorning THROWS instead of returning a Result failure", async () => {
  const s = sink();
  const code = await runRitualCli(["morning"], throwingDeps("runMorning", new Error("morning-ritual: unexpected crash"), s));

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  assert.match(s.alerts[0]!.title, /morning/i);
  assert.match(s.alerts[0]!.title, /fail/i);
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
  assert.match(alert.title, /night-prompt/i);
  assert.match(alert.title, /fail/i);
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title), "failure alert title must be distinct from a normal Plan/close-out/Self-Check notification title");
  assert.match(alert.message, /could not persist the close-out prompt/);
});

test("`night-prompt` sends the failure alert and exits non-zero when runNightPrompt THROWS instead of returning a Result failure", async () => {
  const s = sink();
  const code = await runRitualCli(["night-prompt"], throwingDeps("runNightPrompt", new Error("night-ritual: unexpected crash"), s));

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  assert.match(s.alerts[0]!.title, /night-prompt/i);
  assert.match(s.alerts[0]!.title, /fail/i);
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
  assert.match(alert.title, /night-escalate/i);
  assert.match(alert.title, /fail/i);
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title), "failure alert title must be distinct from a normal Plan/close-out/Self-Check notification title");
  assert.match(alert.message, /could not send the escalation email/);
});

test("`night-escalate` sends the failure alert and exits non-zero when runNightEscalate THROWS instead of returning a Result failure", async () => {
  const s = sink();
  const code = await runRitualCli(["night-escalate"], throwingDeps("runNightEscalate", new Error("night-ritual: unexpected crash"), s));

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  assert.match(s.alerts[0]!.title, /night-escalate/i);
  assert.match(s.alerts[0]!.title, /fail/i);
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

// ---- self-check ----

test("`self-check` sends exactly one distinctly-worded failure alert when the ritual returns a Result failure, before exit code 1", async () => {
  const s = sink();
  const code = await runRitualCli(
    ["self-check"],
    selfCheckDeps({ ok: false, error: { kind: "conflict", message: "self-check: could not persist the Self-Check prompt" } }, s),
  );

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  const alert = s.alerts[0]!;
  assert.match(alert.title, /self-check/i);
  assert.match(alert.title, /fail/i);
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title), "failure alert title must be distinct from a normal Plan/close-out/Self-Check notification title");
  assert.match(alert.message, /could not persist the Self-Check prompt/);
});

test("`self-check` sends the failure alert and exits non-zero when runSelfCheck THROWS instead of returning a Result failure", async () => {
  const s = sink();
  const code = await runRitualCli(["self-check"], throwingDeps("runSelfCheck", new Error("self-check: unexpected crash"), s));

  assert.equal(code, 1);
  assert.equal(s.alerts.length, 1);
  assert.match(s.alerts[0]!.title, /self-check/i);
  assert.match(s.alerts[0]!.title, /fail/i);
  assert.match(s.alerts[0]!.message, /unexpected crash/);
});

test("`self-check` sends NO failure alert on a successful run", async () => {
  const s = sink();
  const code = await runRitualCli(["self-check"], selfCheckDeps({ ok: true, value: { status: "prompted", date: TODAY } }, s));
  assert.equal(code, 0);
  assert.deepEqual(s.alerts, []);
});

// ---- cross-cutting: the four alert titles are mutually distinguishable, not just distinct from normal notifications ----

test("the four subcommands' failure alerts each name their OWN subcommand, not a generic shared title", async () => {
  const titles = new Set<string>();

  const sMorning = sink();
  await runRitualCli(["morning"], deps({ ok: false, error: { kind: "unreachable", message: "x" } }, sMorning));
  titles.add(sMorning.alerts[0]!.title);

  const sNightPrompt = sink();
  await runRitualCli(["night-prompt"], nightPromptDeps({ ok: false, error: { kind: "unreachable", message: "x" } }, sNightPrompt));
  titles.add(sNightPrompt.alerts[0]!.title);

  const sNightEscalate = sink();
  await runRitualCli(["night-escalate"], nightEscalateDeps({ ok: false, error: { kind: "unreachable", message: "x" } }, sNightEscalate));
  titles.add(sNightEscalate.alerts[0]!.title);

  const sSelfCheck = sink();
  await runRitualCli(["self-check"], selfCheckDeps({ ok: false, error: { kind: "unreachable", message: "x" } }, sSelfCheck));
  titles.add(sSelfCheck.alerts[0]!.title);

  assert.equal(titles.size, 4, "each subcommand's failure alert title must be distinguishable from the other three");
});

test("createSelfCheckRitualDeps requires YOH_TIMEZONE and Pushover credentials (review fix), but no Notion/Calendar/SMTP", () => {
  const store = createMemoryStore({ databasePath: ":memory:" });

  assert.throws(() => createSelfCheckRitualDeps(store, {}), /YOH_TIMEZONE/);
  assert.throws(
    () => createSelfCheckRitualDeps(store, { YOH_TIMEZONE: "America/New_York" }),
    /PUSHOVER/,
    "review fix: self-check now needs Pushover credentials too — see rituals/self-check.ts's own docstring for why",
  );

  const deps = createSelfCheckRitualDeps(store, {
    YOH_TIMEZONE: "America/New_York",
    PUSHOVER_APP_TOKEN: "fake-app-token",
    PUSHOVER_USER_KEY: "fake-user-key",
  });
  assert.equal(deps.timeZone, "America/New_York");
  assert.equal(typeof deps.now, "function");
  assert.equal(typeof deps.random, "function");
  assert.equal(typeof deps.sendNotification, "function");

  store.close();
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
  const store = createMemoryStore({ databasePath: ":memory:" });
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
  const store = createMemoryStore({ databasePath: ":memory:" });
  const deps = createMorningRitualDeps(store, BASE_ENV);
  assert.deepEqual(deps.bumpLevels, {});
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
// Two layers: (1) unit tests for the two pure query functions,
// `checkDailyRitualMissedRun`/`checkSelfCheckMissedRun`, directly against a
// real `MemoryStore`; (2) integration tests through `runRitualCli` proving
// the wiring — `withFailureAlert` sends a distinctly-worded alert on a miss
// — and, most importantly, that the check is purely ADDITIVE: it never
// gates or skips the subcommand's own work (self-healing, not cascading).

const CHECK_NOW = new Date("2026-08-22T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(CHECK_NOW.getTime() - h * 60 * 60 * 1000).toISOString();

// ---- checkDailyRitualMissedRun (morning / night-prompt / night-escalate) ----

for (const ritualId of [MORNING_RITUAL_ID, NIGHT_PROMPT_RITUAL_ID, NIGHT_ESCALATE_RITUAL_ID]) {
  test(`checkDailyRitualMissedRun("${ritualId}"): a RitualRun older than the ${DAILY_RITUAL_MISSED_RUN_GRACE_HOURS}h grace threshold is a missed run`, () => {
    const store = createMemoryStore({ databasePath: ":memory:" });
    putRitualRun(store, ritualId, { date: "2026-08-20", ranAt: hoursAgo(DAILY_RITUAL_MISSED_RUN_GRACE_HOURS + 12) });

    const result = checkDailyRitualMissedRun(store, ritualId, () => CHECK_NOW);

    assert.equal(result.missed, true);
    assert.match(result.detail ?? "", new RegExp(ritualId));
    store.close();
  });
}

test(`checkDailyRitualMissedRun: a RitualRun within the ${DAILY_RITUAL_MISSED_RUN_GRACE_HOURS}h grace threshold does NOT trigger a missed run`, () => {
  const store = createMemoryStore({ databasePath: ":memory:" });
  putRitualRun(store, MORNING_RITUAL_ID, { date: "2026-08-21", ranAt: hoursAgo(20) });

  const result = checkDailyRitualMissedRun(store, MORNING_RITUAL_ID, () => CHECK_NOW);

  assert.deepEqual(result, { missed: false });
  store.close();
});

test("checkDailyRitualMissedRun: true first-ever cold start (no RitualRun at all) does NOT trigger a missed run", () => {
  const store = createMemoryStore({ databasePath: ":memory:" });

  assert.equal(getRitualRun(store, MORNING_RITUAL_ID), undefined, "sanity: nothing stored yet");
  const result = checkDailyRitualMissedRun(store, MORNING_RITUAL_ID, () => CHECK_NOW);

  assert.deepEqual(result, { missed: false });
  store.close();
});

// ---- checkSelfCheckMissedRun ----

test(`checkSelfCheckMissedRun: a SelfCheckState whose nextDueDate is more than ${SELF_CHECK_MISSED_RUN_GRACE_DAYS} days in the past is a missed run`, () => {
  const store = createMemoryStore({ databasePath: ":memory:" });
  putSelfCheckState(store, { nextDueDate: "2026-08-10", nextDueMinuteOfDay: 600 }); // 12 days before 2026-08-22

  const result = checkSelfCheckMissedRun(store, () => CHECK_NOW, "UTC");

  assert.equal(result.missed, true);
  assert.match(result.detail ?? "", /self-check/i);
  store.close();
});

test(`checkSelfCheckMissedRun: a SelfCheckState within the ${SELF_CHECK_MISSED_RUN_GRACE_DAYS}-day grace of its nextDueDate does NOT trigger a missed run`, () => {
  const store = createMemoryStore({ databasePath: ":memory:" });
  putSelfCheckState(store, { nextDueDate: "2026-08-19", nextDueMinuteOfDay: 600 }); // 3 days before 2026-08-22 — normal randomized-cadence slack

  const result = checkSelfCheckMissedRun(store, () => CHECK_NOW, "UTC");

  assert.deepEqual(result, { missed: false });
  store.close();
});

test("checkSelfCheckMissedRun: true first-ever cold start (no SelfCheckState at all) does NOT trigger a missed run", () => {
  const store = createMemoryStore({ databasePath: ":memory:" });

  assert.equal(getSelfCheckState(store), undefined, "sanity: nothing stored yet");
  const result = checkSelfCheckMissedRun(store, () => CHECK_NOW, "UTC");

  assert.deepEqual(result, { missed: false });
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
  assert.match(alert.title, /morning/i);
  assert.match(alert.title, /missed/i);
  assert.doesNotMatch(alert.title, /failed/i, "a missed-run alert must be worded distinctly from the 'subcommand failed' alert (Task 25)");
  assert.ok(!NORMAL_NOTIFICATION_TITLES.includes(alert.title));
  assert.match(alert.message, /morning/i);
  assert.match(alert.message, /3\.2 days ago/);
});

test("`night-prompt`/`night-escalate`/`self-check` each send their own distinctly-worded missed-run alert naming their own subcommand", async () => {
  const cases: Array<{ label: string; run: (s: Sink) => Promise<number> }> = [
    {
      label: "night-prompt",
      run: (s) =>
        runRitualCli(
          ["night-prompt"],
          nightPromptDeps({ ok: true, value: { status: "already-ran", date: TODAY } }, s, undefined, () => ({ missed: true, detail: "x" })),
        ),
    },
    {
      label: "night-escalate",
      run: (s) =>
        runRitualCli(
          ["night-escalate"],
          nightEscalateDeps({ ok: true, value: { status: "no-open-request", date: TODAY } }, s, undefined, () => ({ missed: true, detail: "x" })),
        ),
    },
    {
      label: "self-check",
      run: (s) =>
        runRitualCli(["self-check"], selfCheckDeps({ ok: true, value: { status: "not-due", date: TODAY, nextDueDate: TODAY } }, s, undefined, () => ({ missed: true, detail: "x" }))),
    },
  ];

  for (const { label, run } of cases) {
    const s = sink();
    const code = await run(s);
    assert.equal(code, 0);
    assert.equal(s.alerts.length, 1, `${label}: expected exactly one missed-run alert`);
    assert.match(s.alerts[0]!.title, new RegExp(label, "i"));
    assert.match(s.alerts[0]!.title, /missed/i);
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
  assert.match(s.alerts[0]!.title, /missed/i, "the missed-run check runs FIRST, before runSubcommand");
  assert.match(s.alerts[1]!.title, /failed/i);
});

// ---- the critical property: self-healing, not cascading ----
//
// After a missed-run alert fires, the ritual must STILL complete its own
// normal work and write its OWN fresh RitualRun marker on success — the
// check is purely additive, never a gate. Uses a REAL MemoryStore (not a
// fake one) so the stale-then-fresh RitualRun state is genuinely observed,
// not merely asserted about a mock.

test("SELF-HEALING: after a missed-run alert fires for `morning`, the ritual still runs its own work and writes a FRESH RitualRun marker (a single missed day never cascades)", async () => {
  const store = createMemoryStore({ databasePath: ":memory:" });
  const STALE_RAN_AT = hoursAgo(DAILY_RITUAL_MISSED_RUN_GRACE_HOURS + 48); // well past the grace threshold
  putRitualRun(store, MORNING_RITUAL_ID, { date: "2026-08-18", ranAt: STALE_RAN_AT });

  const s = sink();
  const FRESH_RAN_AT = CHECK_NOW.toISOString();
  let ownWorkRan = false;

  const testDeps: RitualCliDeps = {
    io: {
      writeLine: (l) => s.out.push(l),
      writeError: (l) => s.err.push(l),
    },
    // The real query function, wired exactly as `main()` wires it — proves
    // the missed-run detection itself (not a stubbed boolean).
    checkMissedRun: () => checkDailyRitualMissedRun(store, MORNING_RITUAL_ID, () => CHECK_NOW),
    // Simulates the ritual's own normal success path: it does its own work
    // AND writes its own fresh RitualRun marker, exactly like the real
    // `runMorningRitual` does on a `"delivered"` outcome.
    runMorning: async () => {
      ownWorkRan = true;
      putRitualRun(store, MORNING_RITUAL_ID, { date: TODAY, ranAt: FRESH_RAN_AT });
      return { ok: true, value: { status: "already-ran", date: TODAY, planId: `plan-${TODAY}` } };
    },
    runNightPrompt: async () => {
      throw new Error("should not be called");
    },
    runNightEscalate: async () => {
      throw new Error("should not be called");
    },
    runSelfCheck: async () => {
      throw new Error("should not be called");
    },
    sendFailureAlert: async (notification) => {
      s.alerts.push(notification);
    },
  };

  const code = await runRitualCli(["morning"], testDeps);

  // The missed-run alert fired...
  assert.equal(code, 0);
  assert.equal(s.alerts.length, 1);
  assert.match(s.alerts[0]!.title, /missed/i);

  // ...but self-healing held: the ritual's own work still ran...
  assert.equal(ownWorkRan, true, "the missed-run alert must not gate or skip the subcommand's own work");

  // ...and produced a FRESH marker — a later run will see THIS marker, not
  // the stale one, so a single missed day self-corrects rather than
  // cascading into permanent failure.
  const latest = getRitualRun(store, MORNING_RITUAL_ID);
  assert.ok(latest);
  assert.equal(latest!.data.ranAt, FRESH_RAN_AT);
  assert.notEqual(latest!.data.ranAt, STALE_RAN_AT);

  // And a follow-up check against the now-fresh marker reports no miss —
  // proof the system healed itself for the NEXT invocation.
  const followUpCheck = checkDailyRitualMissedRun(store, MORNING_RITUAL_ID, () => CHECK_NOW);
  assert.deepEqual(followUpCheck, { missed: false });

  store.close();
});

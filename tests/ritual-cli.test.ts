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
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { recordSlip } from "../src/adapters/memory-store.ts";
import { computeSlipBumpLevels } from "../src/core/slip-bump.ts";
import { createMorningRitualDeps, runRitualCli, type RitualCliDeps } from "../src/shell/ritual-cli.ts";
import type { MorningRitualOutcome } from "../src/rituals/morning-ritual.ts";
import type { NightEscalateOutcome, NightPromptOutcome } from "../src/rituals/night-ritual.ts";
import type { Plan, Result, YohError } from "../src/types/domain.ts";

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
}

function deps(
  outcome: Result<MorningRitualOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
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
  };
}

function nightPromptDeps(
  outcome: Result<NightPromptOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
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
  };
}

function nightEscalateDeps(
  outcome: Result<NightEscalateOutcome, YohError>,
  sink: Sink,
  onRun?: () => void,
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
  };
}

function sink(): Sink {
  return { out: [], err: [] };
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

test("AD-5's remaining subcommand is recognized as planned but not yet built (Task 24)", async () => {
  for (const sub of ["self-check"]) {
    const s = sink();
    const code = await runRitualCli(
      [sub],
      deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: undefined } }, s),
    );
    assert.equal(code, 2, `${sub} should not pretend to succeed`);
    assert.match(s.err.join("\n"), /not implemented yet/i, `${sub} should say so plainly`);
  }
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

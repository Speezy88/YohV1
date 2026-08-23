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
import { runRitualCli, type RitualCliDeps } from "../src/shell/ritual-cli.ts";
import type { MorningRitualOutcome } from "../src/rituals/morning-ritual.ts";
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

test("AD-5's other three subcommands are recognized as planned but not yet built (Tasks 19, 20, 24)", async () => {
  for (const sub of ["night-prompt", "night-escalate", "self-check"]) {
    const s = sink();
    const code = await runRitualCli(
      [sub],
      deps({ ok: true, value: { status: "already-ran", date: TODAY, planId: undefined } }, s),
    );
    assert.equal(code, 2, `${sub} should not pretend to succeed`);
    assert.match(s.err.join("\n"), /not implemented yet/i, `${sub} should say so plainly`);
  }
});

test("AD-5: ritual-cli.ts never waits for input — it reads no stdin at all", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "shell", "ritual-cli.ts"), "utf8");
  assert.doesNotMatch(source, /node:readline/, "a one-shot cron entry point must not open a readline interface");
  assert.doesNotMatch(source, /process\.stdin/, "a one-shot cron entry point must not read stdin");
});

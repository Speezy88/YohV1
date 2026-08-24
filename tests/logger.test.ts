/**
 * Tests for `src/adapters/logger.ts` (Task 27 / Story 5.3, AD-9).
 *
 * The shared structured-logging module: one `LogEntry` shape every
 * `rituals/*.ts` file imports instead of declaring its own, and one
 * `writeStructuredLog` function every `shell/ritual-cli.ts` `create*RitualDeps`
 * function calls instead of repeating the same write closure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeStructuredLog, type LogEntry, type StructuredLogTarget } from "../src/adapters/logger.ts";

function fakeTarget(): { target: StructuredLogTarget; chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    target: {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    },
  };
}

test("writeStructuredLog writes exactly one single-line JSON object, newline-terminated, to the given target", () => {
  const { target, chunks } = fakeTarget();
  const entry: LogEntry = { level: "info", event: "morning-ritual.delivered", detail: { date: "2026-08-22" } };

  writeStructuredLog(entry, target);

  assert.equal(chunks.length, 1, "exactly one write call — one JSON line per log entry");
  const written = chunks[0]!;
  assert.equal(written.endsWith("\n"), true, "newline-terminated so lines never run together");
  assert.equal(written.split("\n").filter((l) => l.length > 0).length, 1, "single-line — no embedded newlines");
  assert.deepEqual(JSON.parse(written), entry, "the written line parses back to the exact entry given");
});

test("writeStructuredLog omits `detail` from the JSON entirely when the entry carries none, rather than writing detail: undefined/null", () => {
  const { target, chunks } = fakeTarget();
  writeStructuredLog({ level: "warn", event: "self-check.not-due" }, target);

  const parsed = JSON.parse(chunks[0]!) as Record<string, unknown>;
  assert.equal(Object.hasOwn(parsed, "detail"), false);
  assert.deepEqual(parsed, { level: "warn", event: "self-check.not-due" });
});

test("writeStructuredLog preserves every level and carries an arbitrary detail shape verbatim", () => {
  for (const level of ["info", "warn", "error"] as const) {
    const { target, chunks } = fakeTarget();
    const entry: LogEntry = { level, event: `x.${level}`, detail: { nested: { array: [1, 2, 3] }, n: null } };
    writeStructuredLog(entry, target);
    assert.deepEqual(JSON.parse(chunks[0]!), entry);
  }
});

test("writeStructuredLog defaults its target to process.stderr when none is given", () => {
  const original = process.stderr.write;
  const chunks: string[] = [];
  process.stderr.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    writeStructuredLog({ level: "error", event: "x.default-target" });
  } finally {
    process.stderr.write = original;
  }

  assert.equal(chunks.length, 1);
  assert.deepEqual(JSON.parse(chunks[0]!), { level: "error", event: "x.default-target" });
});

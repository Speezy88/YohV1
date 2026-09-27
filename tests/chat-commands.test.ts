/**
 * Tests for `src/core/chat-commands.ts` (Story 8.3).
 *
 * Moved verbatim from `tests/chat-cli.test.ts` — only the import path
 * changes (AD-16 "moved, not copied").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isBlockerReportCommand,
  isMidDayReflowCommand,
  isPlanViewCommand,
  parseTimeBudgetCommand,
  parseWhyPrioritizedCommand,
} from "../src/core/chat-commands.ts";

// ============================================================================
// parseTimeBudgetCommand
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
// isPlanViewCommand
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

// ============================================================================
// isMidDayReflowCommand
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

// ============================================================================
// isBlockerReportCommand
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
      "what's traffic like on I-95 right now",
      "how's traffic looking this morning",
      "my package got delayed",
      "the flight was delayed by two hours",
      "the meeting went great",
      "the call went really well",
    ]) {
      assert.equal(isBlockerReportCommand(line), false, `expected "${line}" NOT to be recognized as a Blocker report`);
    }
  },
);

// ============================================================================
// parseWhyPrioritizedCommand
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

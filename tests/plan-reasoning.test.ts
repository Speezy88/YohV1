/**
 * Tests for `src/core/plan-reasoning.ts` (Story 1.9 / Task 9, FR-3).
 *
 * Per AD-2/AD-8, this is a pure `core/*.ts` function: no I/O, no
 * module-level state, `Result<T, YohError>`, never throws. These tests
 * exercise it purely in-process with hand-built `CompleteTask` fixtures --
 * no `MemoryStore` or any adapter involved. `today` is always passed in
 * explicitly (AD-2 -- never read from the system clock internally).
 *
 * The whole point of this suite (per the task brief's AC) is that the
 * reasoning line references the ACTUAL Derived Priority factors that
 * produced the lead item's position -- never a generic/static string. Three
 * concrete winning shapes are exercised, each requiring genuinely different
 * wording tied to the real computed numbers:
 *   1. the lead Task wins outright on due-date proximity,
 *   2. the lead Task wins via a duration/cost tradeoff (not due soonest, but
 *      its smaller chunk still wins on the primary axis -- mirrors
 *      derived-priority.test.ts's own AC2 worked example),
 *   3. the lead Task wins via a secondary-axis (Area/Energy/difficulty)
 *      tie-break after the primary axis ties.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePlanReasoning } from "../src/core/plan-reasoning.ts";
import type { CompleteTask, Energy } from "../src/types/domain.ts";

const NOW = "2026-08-22T12:00:00.000Z";
const TODAY = "2026-08-22";

function makeCompleteTask(
  id: string,
  overrides: Partial<Omit<CompleteTask, "id" | "title" | "createdAt" | "updatedAt">> & { title?: string } = {},
): CompleteTask {
  return {
    id,
    title: overrides.title ?? `Task ${id}`,
    estimatedDurationMinutes: 60,
    area: "Work",
    dueDate: "2026-08-25",
    status: "not-started",
    energy: "medium" as Energy,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ============================================================================
// Case 1: due-date-proximity win
// ============================================================================

test("references due-date proximity when the lead Task wins outright on due-date proximity", () => {
  const lead = makeCompleteTask("lead", {
    title: "Ship the report",
    dueDate: "2026-08-23", // 1 day out
    estimatedDurationMinutes: 240,
  });
  const runnerUp = makeCompleteTask("runner-up", {
    title: "Tidy inbox",
    dueDate: "2026-08-25", // 3 days out
    estimatedDurationMinutes: 30,
  });

  const result = generatePlanReasoning({ tasks: [lead, runnerUp], today: TODAY });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // References the lead Task's title and its due-soonest standing.
  assert.match(result.value, /Ship the report/);
  assert.match(result.value, /due/i);
  assert.match(result.value, /1 day/);
  // A duration/tradeoff-only case ("tradeoff") should NOT be the phrasing
  // used here -- this Task won on proximity alone.
  assert.doesNotMatch(result.value.toLowerCase(), /tradeoff/);
  assert.doesNotMatch(result.value.toLowerCase(), /tie-break/);
});

// ============================================================================
// Case 2: duration/cost tradeoff win (mirrors derived-priority.test.ts's AC2)
// ============================================================================

test("references a duration/cost tradeoff when the lead Task wins despite NOT being due soonest", () => {
  const closerButHuge = makeCompleteTask("closer-huge", {
    title: "Massive audit",
    dueDate: "2026-08-23", // 1 day out
    estimatedDurationMinutes: 600,
  });
  const laterButTiny = makeCompleteTask("later-tiny", {
    title: "Quick email",
    dueDate: "2026-08-24", // 2 days out
    estimatedDurationMinutes: 15,
  });

  const result = generatePlanReasoning({ tasks: [closerButHuge, laterButTiny], today: TODAY });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // "later-tiny" ("Quick email") is the actual Derived Priority winner here
  // (975 < 1080, see derived-priority.ts's docstring) despite NOT being due
  // soonest -- the reasoning line must reflect that tradeoff, not claim it's
  // due soonest.
  assert.match(result.value, /Quick email/);
  assert.match(result.value, /tradeoff|outweigh|smaller|chunk/i);
  assert.doesNotMatch(result.value, /Quick email leads.*due soonest/i);
});

test("references a duration/cost tradeoff (without claiming a due-date head start) when both Tasks are due the same day", () => {
  const smaller = makeCompleteTask("smaller", {
    title: "Short call",
    dueDate: "2026-08-24", // same day as the other
    estimatedDurationMinutes: 20,
  });
  const bigger = makeCompleteTask("bigger", {
    title: "Long workshop",
    dueDate: "2026-08-24", // same day
    estimatedDurationMinutes: 300,
  });

  const result = generatePlanReasoning({ tasks: [bigger, smaller], today: TODAY });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value, /Short call/);
  assert.match(result.value, /tradeoff/i);
  // Must NOT claim a "head start" -- both Tasks are due the same day, so
  // there is no due-date advantage to describe, only the duration itself.
  assert.doesNotMatch(result.value.toLowerCase(), /head start/);
});

// ============================================================================
// Case 3: secondary-axis tie-break win
// ============================================================================

test("references the secondary-axis tie-break when the lead Task wins only after the primary axis ties", () => {
  // Same worked example as derived-priority.test.ts's AC3: tied primary
  // scores (1060 each), Area/Energy/difficulty settle it in favor of "tie-a".
  const tieA = makeCompleteTask("tie-a", {
    title: "Alpha project review",
    dueDate: "2026-08-24", // 2 days out
    estimatedDurationMinutes: 100,
    area: "Alpha",
    energy: "high",
  });
  const tieB = makeCompleteTask("tie-b", {
    title: "Zeta cleanup",
    dueDate: "2026-08-23", // 1 day out
    estimatedDurationMinutes: 580,
    area: "Zeta",
    energy: "low",
  });

  const result = generatePlanReasoning({ tasks: [tieA, tieB], today: TODAY });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value, /Alpha project review/);
  assert.match(result.value, /tie-break/i);
  // Names at least one of the actual secondary factors that favored it.
  assert.match(result.value, /Area|Energy|difficulty/);
});

// ============================================================================
// The three cases above must not collapse into one templated shape
// ============================================================================

test("the three winning shapes produce genuinely different reasoning text, not one templated string", () => {
  const dueDateWin = generatePlanReasoning({
    tasks: [
      makeCompleteTask("a", { title: "A", dueDate: "2026-08-23", estimatedDurationMinutes: 240 }),
      makeCompleteTask("b", { title: "B", dueDate: "2026-08-27", estimatedDurationMinutes: 30 }),
    ],
    today: TODAY,
  });
  const tradeoffWin = generatePlanReasoning({
    tasks: [
      makeCompleteTask("c", { title: "C", dueDate: "2026-08-23", estimatedDurationMinutes: 600 }),
      makeCompleteTask("d", { title: "D", dueDate: "2026-08-24", estimatedDurationMinutes: 15 }),
    ],
    today: TODAY,
  });
  const tieBreakWin = generatePlanReasoning({
    tasks: [
      makeCompleteTask("e", { title: "E", dueDate: "2026-08-24", estimatedDurationMinutes: 100, area: "Alpha", energy: "high" }),
      makeCompleteTask("f", { title: "F", dueDate: "2026-08-23", estimatedDurationMinutes: 580, area: "Zeta", energy: "low" }),
    ],
    today: TODAY,
  });

  assert.equal(dueDateWin.ok, true);
  assert.equal(tradeoffWin.ok, true);
  assert.equal(tieBreakWin.ok, true);
  if (!dueDateWin.ok || !tradeoffWin.ok || !tieBreakWin.ok) return;

  // Strip each Task's own title substitution before comparing shapes, so
  // this genuinely checks the surrounding sentence differs, not just the
  // interpolated title.
  const stripTitles = (s: string) => s.replace(/\bA\b|\bB\b|\bC\b|\bD\b|\bE\b|\bF\b/g, "X");
  const shapes = new Set([stripTitles(dueDateWin.value), stripTitles(tradeoffWin.value), stripTitles(tieBreakWin.value)]);
  assert.equal(shapes.size, 3, "each winning scenario must produce distinctly different reasoning text");
});

// ============================================================================
// Edge cases
// ============================================================================

test("a single-Task Plan produces a reasoning line without needing a runner-up comparison", () => {
  const only = makeCompleteTask("only", { title: "Solo task", dueDate: "2026-08-23", estimatedDurationMinutes: 45 });
  const result = generatePlanReasoning({ tasks: [only], today: TODAY });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value, /Solo task/);
});

test("an empty Plan (no Tasks) produces an honest, non-crashing reasoning line", () => {
  const result = generatePlanReasoning({ tasks: [], today: TODAY });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(typeof result.value, "string");
  assert.ok(result.value.length > 0);
});

// ============================================================================
// Validation / never-throws (mirrors derived-priority.ts's own contract,
// since this function delegates its scoring to computeDerivedPriorityFactors)
// ============================================================================

test("rejects a malformed 'today' date", () => {
  const result = generatePlanReasoning({ tasks: [makeCompleteTask("a")], today: "not-a-date" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("never throws, even on wildly invalid input", () => {
  assert.doesNotThrow(() => {
    generatePlanReasoning({ tasks: [makeCompleteTask("a", { dueDate: "" })], today: "" });
  });
});

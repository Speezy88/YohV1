/**
 * Tests for `src/core/planning-field-value.ts` (Epic 6 retro item 7, F8/F9).
 *
 * The first 10 tests below are moved unchanged (only the function name
 * changed, `parseFieldAnswer` -> `parsePlanningFieldValue`) from
 * `tests/chat-cli.test.ts`, where they pinned `chat-cli.ts`'s own
 * (now-deleted) copy of this parser. The remaining tests pin the union
 * behavior this file's module docstring claims: identical results whether
 * `raw` carries surrounding whitespace (FR-4's untrimmed terminal answer) or
 * arrives already trimmed (FR-25's Claude-claimed value).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlanningFieldValue } from "../src/core/planning-field-value.ts";

test("parsePlanningFieldValue(estimatedDurationMinutes) accepts a positive whole number of minutes", () => {
  const result = parsePlanningFieldValue("estimatedDurationMinutes", "30");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 30);
});

test("parsePlanningFieldValue(estimatedDurationMinutes) rejects non-numeric, zero, negative, and fractional input", () => {
  for (const raw of ["not a number", "0", "-5", "12.5", ""]) {
    const result = parsePlanningFieldValue("estimatedDurationMinutes", raw);
    assert.equal(result.ok, false, `expected "${raw}" to be rejected`);
  }
});

test("parsePlanningFieldValue(area) accepts any non-blank free-form text", () => {
  const result = parsePlanningFieldValue("area", "  Health  ");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "Health");
});

test("parsePlanningFieldValue(area) rejects blank input", () => {
  const result = parsePlanningFieldValue("area", "   ");
  assert.equal(result.ok, false);
});

test("parsePlanningFieldValue(dueDate) accepts a YYYY-MM-DD date", () => {
  const result = parsePlanningFieldValue("dueDate", "2026-08-25");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "2026-08-25");
});

test("parsePlanningFieldValue(dueDate) rejects an unparseable or malformed date", () => {
  for (const raw of ["not a date", "08/25/2026", "2026-13-40", "2026-02-30"]) {
    const result = parsePlanningFieldValue("dueDate", raw);
    assert.equal(result.ok, false, `expected "${raw}" to be rejected`);
  }
});

test("parsePlanningFieldValue(status) accepts one of the fixed TaskStatus values, case/space-insensitively", () => {
  const result = parsePlanningFieldValue("status", "In Progress");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "in-progress");
});

test("parsePlanningFieldValue(status) rejects a value outside the fixed enum", () => {
  const result = parsePlanningFieldValue("status", "done-ish");
  assert.equal(result.ok, false);
});

test("parsePlanningFieldValue(energy) accepts one of the fixed Energy values, case-insensitively", () => {
  const result = parsePlanningFieldValue("energy", "HIGH");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "high");
});

test("parsePlanningFieldValue(energy) rejects a value outside the fixed enum", () => {
  const result = parsePlanningFieldValue("energy", "extreme");
  assert.equal(result.ok, false);
});

// ============================================================================
// Union behavior (Epic 6 retro F8): FR-4 (chat-cli.ts's old parseFieldAnswer)
// passed an untrimmed line straight from `io.readLine`; FR-25 (llm-adapter.ts's
// old parseSuggestedValue) passed an already-trimmed claimed value. Both
// origins must parse identically now that there is one function.
// ============================================================================

test("parsePlanningFieldValue accepts the same valid value whether raw carries surrounding whitespace (FR-4 style) or is already trimmed (FR-25 style)", () => {
  const cases: ReadonlyArray<{ field: Parameters<typeof parsePlanningFieldValue>[0]; raw: string; value: unknown }> = [
    { field: "estimatedDurationMinutes", raw: "30", value: 30 },
    { field: "area", raw: "Health", value: "Health" },
    { field: "dueDate", raw: "2026-08-25", value: "2026-08-25" },
    { field: "status", raw: "in-progress", value: "in-progress" },
    { field: "energy", raw: "high", value: "high" },
  ];
  for (const { field, raw, value } of cases) {
    const untrimmed = parsePlanningFieldValue(field, `  ${raw}  `);
    const trimmed = parsePlanningFieldValue(field, raw);
    assert.equal(untrimmed.ok, true, `expected padded "${raw}" to be accepted for ${field}`);
    assert.equal(trimmed.ok, true, `expected trimmed "${raw}" to be accepted for ${field}`);
    if (untrimmed.ok && trimmed.ok) {
      assert.equal(untrimmed.value, value);
      assert.equal(trimmed.value, value);
    }
  }
});

test("parsePlanningFieldValue rejects the same invalid value whether raw carries surrounding whitespace or is already trimmed", () => {
  const cases: ReadonlyArray<{ field: Parameters<typeof parsePlanningFieldValue>[0]; raw: string }> = [
    { field: "estimatedDurationMinutes", raw: "not a number" },
    { field: "dueDate", raw: "2026-02-30" },
    { field: "status", raw: "done-ish" },
    { field: "energy", raw: "extreme" },
  ];
  for (const { field, raw } of cases) {
    assert.equal(parsePlanningFieldValue(field, `  ${raw}  `).ok, false, `expected padded "${raw}" to be rejected for ${field}`);
    assert.equal(parsePlanningFieldValue(field, raw).ok, false, `expected trimmed "${raw}" to be rejected for ${field}`);
  }
});

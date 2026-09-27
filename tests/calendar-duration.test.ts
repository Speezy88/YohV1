/**
 * Tests for `src/core/calendar-duration.ts` (real-use fixes plan, Task 2,
 * post-review fix, Important #3).
 *
 * `lineStatesDurationOrEnd` is the deterministic, pure cross-check
 * `app/calendar-edit.ts` uses to correct `draftCalendarEditRequest`'s own
 * optional `durationAssumed` marker rather than trusting it unconditionally
 * — see `tests/calendar-edit.test.ts`'s own Important #3 section for the
 * end-to-end (app-level) pinning of that correction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineStatesDurationOrEnd } from "../src/core/calendar-duration.ts";

test("lineStatesDurationOrEnd recognizes an explicit 'for <amount>' duration phrase", () => {
  for (const line of [
    "make a event at 10:45 am tommorow to meet with alex. itll go for an hour and a half",
    "block off time for 45 minutes",
    "schedule a call for an hour",
    "put a study block at 4 today for half an hour",
  ]) {
    assert.equal(lineStatesDurationOrEnd(line), true, `expected "${line}" to be recognized as stating a duration`);
  }
});

test("lineStatesDurationOrEnd recognizes a bare amount of hours/minutes (no 'for')", () => {
  for (const line of ["meet with Alex tomorrow at 3, 1.5 hours", "block off 90 minutes for deep work", "meet with Sam at 9am, 45 mins"]) {
    assert.equal(lineStatesDurationOrEnd(line), true, `expected "${line}" to be recognized as stating a duration`);
  }
});

test("lineStatesDurationOrEnd recognizes an explicit end via till/until/to + a clock time", () => {
  for (const line of ["meet with Alex at 3 till 4", "schedule a call at 3 until 4pm", "put a study block at 4 to 5"]) {
    assert.equal(lineStatesDurationOrEnd(line), true, `expected "${line}" to be recognized as stating an explicit end`);
  }
});

test("lineStatesDurationOrEnd recognizes a compact time range", () => {
  for (const line of ["meet with Alex 3-4pm tomorrow", "block off 10:45am-12:15pm for the workshop"]) {
    assert.equal(lineStatesDurationOrEnd(line), true, `expected "${line}" to be recognized as stating a time range`);
  }
});

test("lineStatesDurationOrEnd returns false for a line that states only a start (or nothing time-related at all)", () => {
  for (const line of [
    "schedule a meeting with Alex tomorrow at 3",
    "add dentist appointment Friday 2pm",
    "put a study block at 4 today",
    "create an event for coffee with Sam tomorrow at 9am",
    "meet with Alex tomorrow",
  ]) {
    assert.equal(lineStatesDurationOrEnd(line), false, `expected "${line}" NOT to be recognized as stating a duration or end`);
  }
});

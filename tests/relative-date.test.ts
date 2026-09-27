/**
 * Tests for `src/core/relative-date.ts` (real-use fixes plan, Task 3).
 *
 * `resolveRelativeDate`/`resolveRelativeDateTime` are pure — every test
 * pins `now`/`timeZone` explicitly rather than reading the real clock, so
 * these never depend on when or where (host OS timezone) the suite runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRelativeDate, resolveRelativeDateTime, type RelativeDateContext } from "../src/core/relative-date.ts";

const LA = "America/Los_Angeles";

function ctxAt(iso: string, timeZone: string = LA): RelativeDateContext {
  return { now: new Date(iso), timeZone };
}

// ============================================================================
// resolveRelativeDate — already-ISO passthrough
// ============================================================================

test("resolveRelativeDate passes an already-valid YYYY-MM-DD straight through", () => {
  assert.equal(resolveRelativeDate("2026-10-03", ctxAt("2026-09-27T18:00:00.000Z")), "2026-10-03");
});

test("resolveRelativeDate rejects an ISO-shaped but unreal calendar date (Feb 30)", () => {
  assert.equal(resolveRelativeDate("2026-02-30", ctxAt("2026-09-27T18:00:00.000Z")), undefined);
});

// ============================================================================
// today / tomorrow / yesterday
// ============================================================================

test('resolveRelativeDate("today") is the host-TZ calendar day, not the UTC one', () => {
  // 2026-09-27T18:00:00Z is 2026-09-27T11:00:00-07:00 in Los Angeles (PDT) — same UTC/local date, sanity baseline.
  assert.equal(resolveRelativeDate("today", ctxAt("2026-09-27T18:00:00.000Z")), "2026-09-27");
});

test('resolveRelativeDate("tomorrow") across a month boundary rolls Sep 30 -> Oct 1', () => {
  assert.equal(resolveRelativeDate("tomorrow", ctxAt("2026-09-30T18:00:00.000Z")), "2026-10-01");
});

test('resolveRelativeDate("yesterday") across a year boundary rolls Jan 1 -> Dec 31 (previous year)', () => {
  assert.equal(resolveRelativeDate("yesterday", ctxAt("2027-01-01T18:00:00.000Z")), "2026-12-31");
});

test("late-evening local time: the UTC calendar day is already a day ahead of Spencer's own still-in-progress LA day, and 'today' follows the LA one", () => {
  // 2026-09-28T06:30:00Z is 2026-09-27T23:30:00-07:00 in Los Angeles — UTC's date (28th) is already a day AHEAD
  // of LA's own still-in-progress date (27th). A resolver that read the date off the raw instant (UTC) instead of
  // going through `timeZone` would answer "2026-09-28" here — wrong for Spencer.
  const ctx = ctxAt("2026-09-28T06:30:00.000Z");
  assert.equal(resolveRelativeDate("today", ctx), "2026-09-27");
  assert.equal(resolveRelativeDate("tomorrow", ctx), "2026-09-28");
});

test("just-after-midnight local time (12:30 AM) resolves 'today' to the calendar day that just started locally, not the one before it", () => {
  // 2026-09-28T07:30:00Z is 2026-09-28T00:30:00-07:00 in Los Angeles (12:30 AM, moments into the 28th). A resolver
  // that got the offset direction wrong could easily answer "2026-09-27" (still-previous-day) here instead.
  const ctx = ctxAt("2026-09-28T07:30:00.000Z");
  assert.equal(resolveRelativeDate("today", ctx), "2026-09-28");
  assert.equal(resolveRelativeDate("yesterday", ctx), "2026-09-27");
});

// ============================================================================
// Weekday names — bare / "this" / "next", including wrap-around
// ============================================================================

test("a bare weekday name resolves to the NEXT occurrence, counting today itself", () => {
  // 2026-09-27 is a Sunday.
  const ctx = ctxAt("2026-09-27T18:00:00.000Z");
  assert.equal(resolveRelativeDate("sunday", ctx), "2026-09-27", "today IS Sunday -> today");
  assert.equal(resolveRelativeDate("Thursday", ctx), "2026-10-01", "the next Thursday, wrapping into next week/next month");
});

test('"this <weekday>" behaves identically to the bare form', () => {
  const ctx = ctxAt("2026-09-27T18:00:00.000Z"); // Sunday
  assert.equal(resolveRelativeDate("this Thursday", ctx), "2026-10-01");
});

test('"next <weekday>" is exactly one week after the bare/"this" occurrence', () => {
  const ctx = ctxAt("2026-09-27T18:00:00.000Z"); // Sunday
  assert.equal(resolveRelativeDate("next Thursday", ctx), "2026-10-08");
});

test('"next week Friday" resolves the same way as "next Friday" — always the following week (Oct 9), never this week\'s Friday (Oct 2)', () => {
  const ctx = ctxAt("2026-09-27T18:00:00.000Z"); // Sunday
  assert.equal(resolveRelativeDate("next week Friday", ctx), "2026-10-09");
  assert.equal(resolveRelativeDate("next Friday", ctx), "2026-10-09");
});

test("weekday wrap: asking for a day earlier in the week than today still wraps forward, never backward", () => {
  // 2026-10-03 is a Saturday; "Monday" must be the UPCOMING Monday, not the one just passed.
  const ctx = ctxAt("2026-10-03T18:00:00.000Z");
  assert.equal(resolveRelativeDate("Monday", ctx), "2026-10-05");
});

// ============================================================================
// Month-day (name and numeric), including the month/year boundary
// ============================================================================

test('"Oct 3" resolves against the current year when that date is still ahead', () => {
  assert.equal(resolveRelativeDate("Oct 3", ctxAt("2026-09-27T18:00:00.000Z")), "2026-10-03");
});

test('"October 3rd" (full name + ordinal suffix) resolves the same way', () => {
  assert.equal(resolveRelativeDate("October 3rd", ctxAt("2026-09-27T18:00:00.000Z")), "2026-10-03");
});

test("a month-day that has already passed THIS year rolls into next year (the month-boundary case)", () => {
  // "Jan 5" asked for on Sep 27, 2026 must mean Jan 5, 2027 — not a date five months in the past.
  assert.equal(resolveRelativeDate("Jan 5", ctxAt("2026-09-27T18:00:00.000Z")), "2027-01-05");
});

test("a month-day with an explicit year is never rolled forward, even if that date is already past", () => {
  assert.equal(resolveRelativeDate("Jan 5, 2020", ctxAt("2026-09-27T18:00:00.000Z")), "2020-01-05");
});

test('"10/3" (numeric month/day) resolves like "Oct 3"', () => {
  assert.equal(resolveRelativeDate("10/3", ctxAt("2026-09-27T18:00:00.000Z")), "2026-10-03");
});

// ============================================================================
// Unresolvable input fails closed
// ============================================================================

test("an unparseable phrase resolves to undefined, never a guess", () => {
  assert.equal(resolveRelativeDate("sometime soon", ctxAt("2026-09-27T18:00:00.000Z")), undefined);
});

test("the literal incident value resolves its date part, ignoring the time clause", () => {
  assert.equal(resolveRelativeDate("tomorrow at 10:45 AM", ctxAt("2026-09-27T18:00:00.000Z")), "2026-09-28");
});

// ============================================================================
// resolveRelativeDateTime
// ============================================================================

test("resolveRelativeDateTime resolves the literal incident phrase into a real UTC instant", () => {
  // "tomorrow" from 2026-09-27 (LA) is 2026-09-28; 10:45 AM LA (PDT, UTC-7) is 17:45 UTC.
  const result = resolveRelativeDateTime("tomorrow at 10:45 AM", ctxAt("2026-09-27T18:00:00.000Z"));
  assert.equal(result, "2026-09-28T17:45:00.000Z");
});

test("resolveRelativeDateTime handles a 24-hour time clause", () => {
  const result = resolveRelativeDateTime("tomorrow at 14:30", ctxAt("2026-09-27T18:00:00.000Z"));
  assert.equal(result, "2026-09-28T21:30:00.000Z");
});

test("resolveRelativeDateTime passes an already-valid full ISO datetime straight through, normalized", () => {
  const result = resolveRelativeDateTime("2026-10-03T10:45:00-07:00", ctxAt("2026-09-27T18:00:00.000Z"));
  assert.equal(result, "2026-10-03T17:45:00.000Z");
});

test("resolveRelativeDateTime rejects an ISO-shaped but unreal datetime (hour 24)", () => {
  assert.equal(resolveRelativeDateTime("2026-10-03T24:00:00Z", ctxAt("2026-09-27T18:00:00.000Z")), undefined);
});

test("resolveRelativeDateTime returns undefined for a bare date with no time clause at all", () => {
  assert.equal(resolveRelativeDateTime("tomorrow", ctxAt("2026-09-27T18:00:00.000Z")), undefined);
});

test("resolveRelativeDateTime returns undefined when the date part doesn't resolve, even with a valid time clause", () => {
  assert.equal(resolveRelativeDateTime("sometime soon at 10:45 AM", ctxAt("2026-09-27T18:00:00.000Z")), undefined);
});

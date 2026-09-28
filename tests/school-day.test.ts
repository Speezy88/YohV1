/**
 * Tests for `src/core/school-day.ts` (polish-5 Task 3).
 *
 * Per AD-2/AD-8, this is a pure `core/*.ts` module: no I/O, `Result<T,
 * YohError>`, never throws on well-formed input. Fixtures are hand-built
 * `CalendarEvent`s — no adapter, no clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSchoolDay, SCHOOL_PROTECTED_WINDOWS } from "../src/core/school-day.ts";
import type { CalendarEvent } from "../src/types/domain.ts";

function schoolEvent(id: string, title: string, start: string, end: string): CalendarEvent {
  return { id, title, start, end, calendarId: "spencerhatch@seattleacademy.org" };
}

function primaryEvent(id: string, title: string, start: string, end: string): CalendarEvent {
  return { id, title, start, end };
}

// 2026-08-24 is a Monday.
const MONDAY = "2026-08-24";
// 2026-08-22 is a Saturday.
const SATURDAY = "2026-08-22";

test("weekday with a school event: it's a school day — the event stays an anchor and both protected windows appear (UTC host TZ)", () => {
  const events = [schoolEvent("s1", "AP Calculus", "2026-08-24T15:00:00.000Z", "2026-08-24T16:00:00.000Z")];
  const result = computeSchoolDay(events, MONDAY, "UTC");

  assert.ok(result.ok);
  assert.deepEqual(result.value.anchors, events);
  assert.equal(result.value.protectedWindows.length, 2);
  const [lunch, community] = result.value.protectedWindows;
  assert.equal(lunch!.title, "Lunch");
  assert.equal(lunch!.start, "2026-08-24T10:55:00.000Z");
  assert.equal(lunch!.end, "2026-08-24T11:40:00.000Z");
  assert.equal(community!.title, "Community time");
  assert.equal(community!.start, "2026-08-24T12:55:00.000Z");
  assert.equal(community!.end, "2026-08-24T13:45:00.000Z");
  // Ids are stable and don't collide with each other or a real event's id.
  assert.equal(lunch!.id, `school-protected:lunch:${MONDAY}`);
  assert.equal(community!.id, `school-protected:community:${MONDAY}`);
});

test("a school event titled Study Block (case-insensitive, trimmed) is free time — left out of anchors entirely", () => {
  const events = [
    schoolEvent("s1", "  study BLOCK  ", "2026-08-24T15:00:00.000Z", "2026-08-24T15:45:00.000Z"),
    schoolEvent("s2", "AP Calculus", "2026-08-24T16:00:00.000Z", "2026-08-24T17:00:00.000Z"),
    primaryEvent("p1", "Study Block (not really)", "2026-08-24T09:00:00.000Z", "2026-08-24T09:30:00.000Z"),
  ];
  const result = computeSchoolDay(events, MONDAY, "UTC");

  assert.ok(result.ok);
  // s1 (a real school event whose title starts with "Study Block") is
  // dropped; s2 (an ordinary school event) stays; p1 (no calendarId, so
  // never a "school event" no matter its title) also stays, unchanged —
  // the Study-Block rule only ever applies to school events.
  assert.deepEqual(
    result.value.anchors.map((e) => e.id),
    ["s2", "p1"],
  );
  assert.equal(result.value.protectedWindows.length, 2);
});

test("no school events on a weekday: byte-for-byte unchanged — anchors verbatim, no protected windows", () => {
  const events = [primaryEvent("p1", "Standup", "2026-08-24T15:00:00.000Z", "2026-08-24T15:30:00.000Z")];
  const result = computeSchoolDay(events, MONDAY, "UTC");

  assert.ok(result.ok);
  assert.deepEqual(result.value.anchors, events);
  assert.deepEqual(result.value.protectedWindows, []);
});

test("a weekend day is never a school day, even with a school-calendar event on it — byte-for-byte unchanged", () => {
  const events = [schoolEvent("s1", "Saturday enrichment", "2026-08-22T15:00:00.000Z", "2026-08-22T16:00:00.000Z")];
  const result = computeSchoolDay(events, SATURDAY, "UTC");

  assert.ok(result.ok);
  assert.deepEqual(result.value.anchors, events);
  assert.deepEqual(result.value.protectedWindows, []);
});

test("protected-window times are correct across a DST date in America/Los_Angeles (2026-03-09, the Monday right after spring-forward)", () => {
  const dstMonday = "2026-03-09";
  const events = [schoolEvent("s1", "AP Calculus", "2026-03-09T20:00:00.000Z", "2026-03-09T21:00:00.000Z")];
  const result = computeSchoolDay(events, dstMonday, "America/Los_Angeles");

  assert.ok(result.ok);
  const [lunch, community] = result.value.protectedWindows;
  // America/Los_Angeles is PDT (UTC-7) on 2026-03-09, the day after the
  // spring-forward transition — 10:55/11:40/12:55/13:45 local all fall
  // after the transition itself, so the whole window uses the -7 offset.
  assert.equal(lunch!.start, "2026-03-09T17:55:00.000Z");
  assert.equal(lunch!.end, "2026-03-09T18:40:00.000Z");
  assert.equal(community!.start, "2026-03-09T19:55:00.000Z");
  assert.equal(community!.end, "2026-03-09T20:45:00.000Z");
});

test("protected-window times respect standard time too (2026-11-02, the Monday right after fall-back, PST/UTC-8)", () => {
  const stMonday = "2026-11-02";
  const events = [schoolEvent("s1", "AP Calculus", "2026-11-02T20:00:00.000Z", "2026-11-02T21:00:00.000Z")];
  const result = computeSchoolDay(events, stMonday, "America/Los_Angeles");

  assert.ok(result.ok);
  const [lunch, community] = result.value.protectedWindows;
  assert.equal(lunch!.start, "2026-11-02T18:55:00.000Z");
  assert.equal(lunch!.end, "2026-11-02T19:40:00.000Z");
  assert.equal(community!.start, "2026-11-02T20:55:00.000Z");
  assert.equal(community!.end, "2026-11-02T21:45:00.000Z");
});

test("SCHOOL_PROTECTED_WINDOWS is the one exported constant holding both windows' wall-clock spans", () => {
  assert.equal(SCHOOL_PROTECTED_WINDOWS.length, 2);
  assert.deepEqual(
    SCHOOL_PROTECTED_WINDOWS.map((w) => w.key),
    ["lunch", "community"],
  );
});

test("a malformed date is rejected with a validation error, not a thrown exception", () => {
  const result = computeSchoolDay([], "2026-13-40" as never, "UTC");
  assert.ok(!result.ok);
  assert.equal(result.error.kind, "validation");
});

/**
 * Tests for `src/core/school-day.ts` (polish-5 Task 3).
 *
 * Per AD-2/AD-8, this is a pure `core/*.ts` module: no I/O, `Result<T,
 * YohError>`, never throws on well-formed input. Fixtures are hand-built
 * `CalendarEvent`s — no adapter, no clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSchoolDay, mergeOverlappingAnchors, SCHOOL_PROTECTED_WINDOWS, WORK_START_TIMES } from "../src/core/school-day.ts";
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
  assert.equal(lunch!.end, "2026-08-24T11:35:00.000Z");
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
  // spring-forward transition — 10:55/11:35/12:55/13:45 local all fall
  // after the transition itself, so the whole window uses the -7 offset.
  assert.equal(lunch!.start, "2026-03-09T17:55:00.000Z");
  assert.equal(lunch!.end, "2026-03-09T18:35:00.000Z");
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
  assert.equal(lunch!.end, "2026-11-02T19:35:00.000Z");
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

// ============================================================================
// Polish-5 final fix (M1): an all-day EXTRA-calendar event still makes a day
// a school day, but is never busy time — dropped from `anchors`. A PRIMARY
// all-day event is untouched (kept in `anchors`, same as before).
// ============================================================================

test("M1: an all-day school-calendar event still makes it a school day, but is dropped from anchors — a PRIMARY all-day event stays", () => {
  const events: CalendarEvent[] = [
    { ...schoolEvent("s1", "Spirit Week", "2026-08-24T00:00:00.000Z", "2026-08-25T00:00:00.000Z"), allDay: true },
    { ...primaryEvent("p1", "My all-day thing", "2026-08-24T00:00:00.000Z", "2026-08-25T00:00:00.000Z"), allDay: true },
  ];
  const result = computeSchoolDay(events, MONDAY, "UTC");
  assert.ok(result.ok);
  // It IS a school day (the all-day school event counts for detection) —
  // both protected windows appear.
  assert.equal(result.value.protectedWindows.length, 2);
  // Only the primary all-day event survives into anchors; the all-day
  // school event is dropped.
  assert.deepEqual(
    result.value.anchors.map((e) => e.id),
    ["p1"],
  );
});

// ============================================================================
// Polish-5 final fix (M1): `mergeOverlappingAnchors` coalesces overlapping
// real anchors and clips protected windows around them, so
// `work-break-fit.ts`'s overlap-rejection is never tripped.
// ============================================================================

function anchor(id: string, title: string, start: string, end: string): CalendarEvent {
  return { id, title, start, end };
}

test("mergeOverlappingAnchors: no overlaps at all — byte-identical (same objects) output", () => {
  const anchors = [anchor("a1", "A", "2026-08-24T09:00:00.000Z", "2026-08-24T09:30:00.000Z")];
  const windows = [anchor("w1", "Lunch", "2026-08-24T10:55:00.000Z", "2026-08-24T11:40:00.000Z")];
  const result = mergeOverlappingAnchors(anchors, windows);
  assert.equal(result.anchors[0], anchors[0]); // same object reference
  assert.equal(result.protectedWindows[0], windows[0]); // same object reference
});

test("mergeOverlappingAnchors: a zero-length event (start == end) is dropped — it occupies no time", () => {
  // Real-use bug 2026-09-28: a school-calendar marker event with start == end
  // reached fitWorkBreakBlocks, which rejects it, so no morning Plan was built.
  const kept = anchor("a1", "A", "2026-08-24T09:00:00.000Z", "2026-08-24T09:30:00.000Z");
  const anchors = [kept, anchor("z", "Marker", "2026-08-24T15:00:00.000Z", "2026-08-24T15:00:00.000Z")];
  const result = mergeOverlappingAnchors(anchors, []);
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0], kept);
});

test("mergeOverlappingAnchors: two overlapping real events merge into one anchor spanning both, titles joined", () => {
  const anchors = [
    anchor("class", "AP Calculus", "2026-08-24T10:30:00.000Z", "2026-08-24T11:15:00.000Z"),
    anchor("standup", "Standup", "2026-08-24T11:00:00.000Z", "2026-08-24T11:20:00.000Z"),
  ];
  const result = mergeOverlappingAnchors(anchors, []);
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0]!.start, "2026-08-24T10:30:00.000Z");
  assert.equal(result.anchors[0]!.end, "2026-08-24T11:20:00.000Z");
  assert.equal(result.anchors[0]!.title, "AP Calculus / Standup");
});

test("mergeOverlappingAnchors: touching (not overlapping) events also merge", () => {
  const anchors = [
    anchor("a", "First", "2026-08-24T09:00:00.000Z", "2026-08-24T09:30:00.000Z"),
    anchor("b", "Second", "2026-08-24T09:30:00.000Z", "2026-08-24T10:00:00.000Z"),
  ];
  const result = mergeOverlappingAnchors(anchors, []);
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0]!.start, "2026-08-24T09:00:00.000Z");
  assert.equal(result.anchors[0]!.end, "2026-08-24T10:00:00.000Z");
});

test("mergeOverlappingAnchors: a protected window fully covered by a real anchor is dropped entirely", () => {
  const anchors = [anchor("class", "Long Class", "2026-08-24T10:00:00.000Z", "2026-08-24T12:00:00.000Z")];
  const windows = [anchor("school-protected:lunch:2026-08-24", "Lunch", "2026-08-24T10:55:00.000Z", "2026-08-24T11:40:00.000Z")];
  const result = mergeOverlappingAnchors(anchors, windows);
  assert.equal(result.anchors.length, 1);
  assert.deepEqual(result.protectedWindows, []);
});

test("mergeOverlappingAnchors: a protected window partially overlapped by a real anchor is clipped to the remaining part", () => {
  const anchors = [anchor("class", "AP Calculus", "2026-08-24T10:30:00.000Z", "2026-08-24T11:15:00.000Z")];
  const windows = [anchor("school-protected:lunch:2026-08-24", "Lunch", "2026-08-24T10:55:00.000Z", "2026-08-24T11:40:00.000Z")];
  const result = mergeOverlappingAnchors(anchors, windows);
  assert.equal(result.protectedWindows.length, 1);
  assert.equal(result.protectedWindows[0]!.start, "2026-08-24T11:15:00.000Z");
  assert.equal(result.protectedWindows[0]!.end, "2026-08-24T11:40:00.000Z");
  assert.equal(result.protectedWindows[0]!.title, "Lunch");
});

test("mergeOverlappingAnchors: a real anchor in the MIDDLE of a protected window splits it into two remaining pieces", () => {
  const anchors = [anchor("class", "Quick Class", "2026-08-24T11:05:00.000Z", "2026-08-24T11:15:00.000Z")];
  const windows = [anchor("school-protected:lunch:2026-08-24", "Lunch", "2026-08-24T10:55:00.000Z", "2026-08-24T11:40:00.000Z")];
  const result = mergeOverlappingAnchors(anchors, windows);
  assert.equal(result.protectedWindows.length, 2);
  assert.equal(result.protectedWindows[0]!.start, "2026-08-24T10:55:00.000Z");
  assert.equal(result.protectedWindows[0]!.end, "2026-08-24T11:05:00.000Z");
  assert.equal(result.protectedWindows[1]!.start, "2026-08-24T11:15:00.000Z");
  assert.equal(result.protectedWindows[1]!.end, "2026-08-24T11:40:00.000Z");
});

// ============================================================================
// Earliest start for Yoh's own work placement (Spencer, 2026-09-29): 3:15 PM
// on a school day, 9:00 AM on every other day (weekends and non-school
// weekdays), host-timeZone wall clock.
// ============================================================================

test("workStart: 3:15 PM local on a school day (PDT)", () => {
  const events = [schoolEvent("s1", "AP Calculus", "2026-09-28T16:00:00.000Z", "2026-09-28T17:00:00.000Z")];
  const result = computeSchoolDay(events, "2026-09-28", "America/Los_Angeles");
  assert.ok(result.ok);
  assert.equal(result.value.workStart, "2026-09-28T22:15:00.000Z");
});

test("workStart: 9:00 AM local on a weekend, even with a school event", () => {
  const events = [schoolEvent("s1", "Game", "2026-08-22T18:00:00.000Z", "2026-08-22T19:00:00.000Z")];
  const result = computeSchoolDay(events, SATURDAY, "America/Los_Angeles");
  assert.ok(result.ok);
  assert.equal(result.value.workStart, "2026-08-22T16:00:00.000Z");
});

test("workStart: 9:00 AM local on a weekday with no school events", () => {
  const result = computeSchoolDay([primaryEvent("p1", "Dentist", "2026-08-24T17:00:00.000Z", "2026-08-24T18:00:00.000Z")], MONDAY, "America/Los_Angeles");
  assert.ok(result.ok);
  assert.equal(result.value.workStart, "2026-08-24T16:00:00.000Z");
});

test("workStart respects standard time (PST, 2026-11-02 school day)", () => {
  const events = [schoolEvent("s1", "AP Calculus", "2026-11-02T17:00:00.000Z", "2026-11-02T18:00:00.000Z")];
  const result = computeSchoolDay(events, "2026-11-02", "America/Los_Angeles");
  assert.ok(result.ok);
  assert.equal(result.value.workStart, "2026-11-02T23:15:00.000Z");
});

test("WORK_START_TIMES is the one constant holding both start times", () => {
  assert.deepEqual(WORK_START_TIMES, { schoolDay: { hour: 15, minute: 15 }, otherDay: { hour: 9, minute: 0 } });
});

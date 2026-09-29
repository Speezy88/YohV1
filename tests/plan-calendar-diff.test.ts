import { test } from "node:test";
import assert from "node:assert/strict";
import { diffPlanCalendar } from "../src/core/plan-calendar-diff.ts";
import type { PlanBlock, PlanCalendarSnapshotEntry, YohPlanEvent } from "../src/types/domain.ts";

const NOW = new Date("2026-08-22T18:00:00.000Z");
const iso = (mins: number): string => new Date(NOW.getTime() + mins * 60_000).toISOString();
const DATE = "2026-08-22";

const work = (eventId: string, taskId: string, s: number, e: number): PlanCalendarSnapshotEntry => ({ eventId, blockId: `b-${eventId}`, kind: "work", taskId, start: iso(s), end: iso(e) });
const ev = (eventId: string, s: number, e: number, blockId?: string, title = "T"): YohPlanEvent => ({ eventId, title, start: iso(s), end: iso(e), ...(blockId ? { blockId } : {}) });
const blk = (id: string, kind: PlanBlock["kind"], s: number, e: number): PlanBlock => ({ id, kind, start: iso(s), end: iso(e), label: id } as PlanBlock);

const run = (snapshot: PlanCalendarSnapshotEntry[], events: YohPlanEvent[], planBlocks: PlanBlock[] = []) =>
  diffPlanCalendar({ snapshot, events, planBlocks, now: NOW.toISOString(), date: DATE });

test("no changes: nothing changed", () => {
  const r = run([work("e1", "t1", 30, 60)], [ev("e1", 30, 60, "b-e1")]);
  assert.equal(r.changed, false);
  assert.deepEqual(r.taskPins, []);
  assert.deepEqual(r.drops, []);
});

test("moved work event pins the Task at the new start with the event length", () => {
  const r = run([work("e1", "t1", 30, 60)], [ev("e1", 90, 120, "b-e1", "Write")]);
  assert.deepEqual(r.taskPins, [{ taskId: "t1", start: iso(90), durationMinutes: 30 }]);
  assert.equal(r.changed, true);
  assert.deepEqual(r.changedTitles, ["Write"]);
});

test("resized work event pins with the new duration", () => {
  const r = run([work("e1", "t1", 30, 60)], [ev("e1", 30, 90, "b-e1")]);
  assert.deepEqual(r.taskPins, [{ taskId: "t1", start: iso(30), durationMinutes: 60 }]);
});

test("past snapshot entries are ignored", () => {
  const r = run([work("e1", "t1", -60, -30)], [ev("e1", 10, 40, "b-e1")]);
  assert.equal(r.changed, false);
  const gone = run([work("e1", "t1", -60, -30)], []);
  assert.deepEqual(gone.drops, []);
  assert.equal(gone.changed, false);
});

test("an event moved earlier than now is clamped to now and its length is what remains", () => {
  const r = run([work("e1", "t1", 30, 60)], [ev("e1", -10, 20, "b-e1")]);
  assert.deepEqual(r.taskPins, [{ taskId: "t1", start: NOW.toISOString(), durationMinutes: 20 }]);
});

test("a task whose remaining event is entirely past yields no pin (duration <= 0)", () => {
  const r = run([work("e1", "t1", 30, 60)], [ev("e1", -40, -10, "b-e1")]);
  assert.deepEqual(r.taskPins, []);
  assert.deepEqual(r.drops, []);
});

test("partial delete: pin at earliest remaining start, summed duration", () => {
  const snap = [work("e1", "t1", 30, 60), work("e2", "t1", 90, 120)];
  const r = run(snap, [ev("e2", 90, 130, "b-e2")]);
  assert.deepEqual(r.taskPins, [{ taskId: "t1", start: iso(90), durationMinutes: 40 }]);
  assert.deepEqual(r.drops, []);
});

test("a multi-entry Task with several remaining events sums them", () => {
  const snap = [work("e1", "t1", 30, 60), work("e2", "t1", 90, 120)];
  const r = run(snap, [ev("e1", 40, 60, "b-e1"), ev("e2", 90, 120, "b-e2")]);
  assert.deepEqual(r.taskPins, [{ taskId: "t1", start: iso(40), durationMinutes: 50 }]);
});

test("all future entries deleted drops the Task", () => {
  const snap = [work("e1", "t1", 30, 60), work("e2", "t1", 90, 120)];
  const r = run(snap, []);
  assert.deepEqual(r.drops, ["t1"]);
  assert.deepEqual(r.taskPins, []);
  assert.equal(r.changed, true);
});

test("break entries are ignored", () => {
  const snap: PlanCalendarSnapshotEntry[] = [{ eventId: "b1", blockId: "bb", kind: "break", start: iso(30), end: iso(45) }];
  assert.equal(run(snap, []).changed, false);
  assert.equal(run(snap, [ev("b1", 60, 75, "bb")]).changed, false);
});

test("a moved routine pins at the event start; deleted or resized-only routines are ignored", () => {
  const routine = (id: string, s: number, e: number): PlanCalendarSnapshotEntry => ({ eventId: id, blockId: `b-${id}`, kind: "routine", routineId: `r-${id}`, start: iso(s), end: iso(e) });
  const moved = run([routine("x", 30, 60)], [ev("x", 90, 120, "b-x")]);
  assert.deepEqual(moved.routinePins, [{ routineId: "r-x", start: iso(90) }]);
  assert.equal(moved.changed, true);
  assert.equal(run([routine("x", 30, 60)], []).changed, false);
  assert.equal(run([routine("x", 30, 60)], [ev("x", 30, 75, "b-x")]).changed, false);
});

test("a tagged event with no snapshot entry is ignored", () => {
  const r = run([], [ev("z", 30, 60, "mystery")], [blk("p1", "work", 30, 60)]);
  assert.equal(r.changed, false);
  assert.equal(r.addedOverlap, false);
});

test("an untagged event overlapping a future work or break block sets addedOverlap", () => {
  const plan = [blk("p1", "work", 30, 60)];
  const r = run([], [ev("u", 45, 75)], plan);
  assert.equal(r.addedOverlap, true);
  assert.equal(r.changed, true);
  assert.deepEqual(r.taskPins, []);
  assert.equal(run([], [ev("u", 45, 75)], [blk("p2", "break", 30, 60)]).addedOverlap, true);
});

test("an untagged event that overlaps nothing, or only a past or anchor block, does not", () => {
  assert.equal(run([], [ev("u", 100, 130)], [blk("p1", "work", 30, 60)]).changed, false);
  assert.equal(run([], [ev("u", -50, -40)], [blk("p1", "work", -60, -30)]).addedOverlap, false);
  assert.equal(run([], [ev("u", 30, 60)], [blk("p1", "calendar-anchor", 30, 60)]).addedOverlap, false);
});

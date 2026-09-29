/** Tests for `src/core/routine-placement.ts` — pure routine placement (Epic 10, R8). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeRoutines, type DayRoutine } from "../src/core/routine-placement.ts";

const T = (hhmm: string): number => Date.parse(`2026-08-22T${hhmm}:00.000Z`);
const DAY_END = T("23:59");
const routine = (id: string, label: string, start: string, minutes: number): DayRoutine => ({ id, label, startMs: T(start), durationMinutes: minutes });
const span = (a: string, b: string) => ({ startMs: T(a), endMs: T(b) });

test("a routine sits at its declared time when free", () => {
  const r = placeRoutines({ routines: [routine("r1", "Commute", "15:00", 30)], fixed: [], nowMs: T("09:00"), dayEndMs: DAY_END, idPrefix: "v1" });
  assert.equal(r.blocks.length, 1);
  assert.deepEqual(
    { kind: r.blocks[0]!.kind, routineId: r.blocks[0]!.routineId, start: r.blocks[0]!.start, end: r.blocks[0]!.end, label: r.blocks[0]!.label },
    { kind: "routine", routineId: "r1", start: "2026-08-22T15:00:00.000Z", end: "2026-08-22T15:30:00.000Z", label: "Commute" },
  );
  assert.deepEqual(r.unplacedLabels, []);
});

test("shifts to the nearest free slot around a fixed span, same length, 5-minute steps", () => {
  const r = placeRoutines({ routines: [routine("r1", "Commute", "15:00", 30)], fixed: [span("14:50", "15:20")], nowMs: T("09:00"), dayEndMs: DAY_END, idPrefix: "v1" });
  // earlier slot ends 14:50 -> starts 14:20 (30 min away); later starts 15:20 (20 min away)
  assert.equal(r.blocks[0]!.start, "2026-08-22T15:20:00.000Z");
  assert.equal(r.blocks[0]!.end, "2026-08-22T15:50:00.000Z");
});

test("routines never overlap each other", () => {
  const r = placeRoutines({ routines: [routine("a", "A", "15:00", 30), routine("b", "B", "15:00", 30)], fixed: [], nowMs: T("09:00"), dayEndMs: DAY_END, idPrefix: "v1" });
  assert.equal(r.blocks.length, 2);
  const [x, y] = r.blocks;
  assert.ok(Date.parse(x!.end) <= Date.parse(y!.start));
});

test("a routine that fits nowhere is listed as unplaced, never dropped silently", () => {
  const r = placeRoutines({ routines: [routine("r1", "Long thing", "15:00", 120)], fixed: [span("09:00", "23:59")], nowMs: T("09:00"), dayEndMs: DAY_END, idPrefix: "v1" });
  assert.deepEqual(r.blocks, []);
  assert.deepEqual(r.unplacedLabels, ["Long thing"]);
});

test("a routine already over at fit start is skipped silently", () => {
  const r = placeRoutines({ routines: [routine("r1", "Early", "07:00", 30)], fixed: [], nowMs: T("09:00"), dayEndMs: DAY_END, idPrefix: "v1" });
  assert.deepEqual(r.blocks, []);
  assert.deepEqual(r.unplacedLabels, []);
});

test("a pinned routine is placed at its pin start and marked pinned", () => {
  const r = placeRoutines({
    routines: [{ ...routine("r1", "Commute", "15:00", 30), pinnedStartMs: T("17:00") }],
    fixed: [], nowMs: T("09:00"), dayEndMs: DAY_END, idPrefix: "v1",
  });
  assert.equal(r.blocks[0]!.start, "2026-08-22T17:00:00.000Z");
  assert.equal(r.blocks[0]!.pinned, true);
});

import { renderBlockLine } from "../src/rituals/ritual-shared.ts";

test("renderBlockLine marks a routine block as a routine", () => {
  const [line] = renderBlockLine({ id: "r", kind: "routine", routineId: "x", label: "Commute", start: "2026-08-22T15:00:00.000Z", end: "2026-08-22T15:30:00.000Z" }, "UTC", 80);
  assert.equal(line, "15:00-15:30  Commute (routine)");
});

import { listRoutinesFromStore } from "../src/adapters/routine-store.ts";

test("listRoutinesFromStore: a missing routines table is empty; any other error is rethrown", () => {
  const fake = (message: string) => ({ withDb: <T>(fn: (db: never) => T): T => fn({ prepare: () => { throw new Error(message); } } as never) });
  assert.deepEqual(listRoutinesFromStore(fake("no such table: routines")), []);
  assert.throws(() => listRoutinesFromStore(fake("database is locked")), /locked/);
});

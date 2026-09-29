/** Tests for `src/adapters/plan-calendar-snapshot-store.ts`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import {
  createPlanCalendarSnapshotStore,
  listPlanCalendarSnapshot,
  PLAN_CALENDAR_WRITE_FRESH_MS,
  replacePlanCalendarSnapshotInTx,
  type PlanCalendarSnapshotEntry,
} from "../src/adapters/plan-calendar-snapshot-store.ts";

const entry = (eventId: string, extra: Partial<PlanCalendarSnapshotEntry> = {}): PlanCalendarSnapshotEntry => ({
  eventId,
  blockId: `b-${eventId}`,
  kind: "work",
  taskId: "t1",
  start: "2026-08-22T13:00:00.000Z",
  end: "2026-08-22T14:00:00.000Z",
  ...extra,
});

test("snapshot store round-trips entries per date and replace only touches that date", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const store = createPlanCalendarSnapshotStore(connection);
  assert.deepEqual(store.list("2026-08-22"), []);
  const { taskId: _omit, ...routineEntry } = entry("e2", { kind: "routine", routineId: "r1" });
  store.replace("2026-08-22", [entry("e1"), routineEntry]);
  store.replace("2026-08-23", [entry("e9")]);
  assert.deepEqual(store.list("2026-08-22").map((e) => e.eventId).sort(), ["e1", "e2"]);
  const e2 = store.list("2026-08-22").find((e) => e.eventId === "e2");
  assert.equal(e2?.routineId, "r1");
  assert.equal(e2?.taskId, undefined);
  store.replace("2026-08-22", [entry("e3")]);
  assert.deepEqual(store.list("2026-08-22").map((e) => e.eventId), ["e3"]);
  assert.deepEqual(listPlanCalendarSnapshot(connection.db, "2026-08-23").map((e) => e.eventId), ["e9"]);
  connection.writeTx((db) => replacePlanCalendarSnapshotInTx(db, "2026-08-23", []));
  assert.deepEqual(store.list("2026-08-23"), []);
  connection.close();
});

test("write state: begin marks writing_since, finish clears it and stamps written_at", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const store = createPlanCalendarSnapshotStore(connection);
  assert.deepEqual(store.writeState("2026-08-22"), {});
  store.beginWrite("2026-08-22", "2026-08-22T13:00:00.000Z");
  assert.deepEqual(store.writeState("2026-08-22"), { writingSince: "2026-08-22T13:00:00.000Z" });
  store.finishWrite("2026-08-22", "2026-08-22T13:00:05.000Z");
  assert.deepEqual(store.writeState("2026-08-22"), { writtenAt: "2026-08-22T13:00:05.000Z" });
  store.beginWrite("2026-08-22", "2026-08-22T14:00:00.000Z");
  assert.deepEqual(store.writeState("2026-08-22"), { writingSince: "2026-08-22T14:00:00.000Z", writtenAt: "2026-08-22T13:00:05.000Z" });
  assert.equal(PLAN_CALENDAR_WRITE_FRESH_MS, 5 * 60_000);
  connection.close();
});

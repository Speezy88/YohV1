import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getPlan, putPlan, putTimeBudget } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { listPlanCalendarSnapshot, replacePlanCalendarSnapshotInTx, type PlanCalendarWriteState } from "../src/adapters/plan-calendar-snapshot-store.ts";
import { listDayDrops, listDayPins, replaceDayPinsAndDropsInTx } from "../src/adapters/plan-state-store.ts";
import { localIsoDate } from "../src/rituals/ritual-shared.ts";
import { syncPlanFromCalendar, type SyncPlanFromCalendarDeps } from "../src/app/sync-plan-from-calendar.ts";
import type { CalendarEvent, Plan, PlanBlock, PlanCalendarSnapshotEntry, Task, YohPlanEvent } from "../src/types/domain.ts";

const TZ = "America/New_York";
const NOW = new Date("2026-08-22T18:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const iso = (mins: number): string => new Date(NOW.getTime() + mins * 60_000).toISOString();

function task(id: string, title: string): Task {
  return { id, title, createdAt: NOW_ISO, updatedAt: NOW_ISO, estimatedDurationMinutes: 30, area: "Work", dueDate: "2026-08-22", status: "not-started", energy: "medium" } as Task;
}

const asEntry = (b: PlanBlock): PlanCalendarSnapshotEntry => ({
  eventId: `ev-${b.id}`, blockId: b.id, kind: b.kind, ...(b.taskId !== undefined ? { taskId: b.taskId } : {}), start: b.start, end: b.end,
});

function setup() {
  const connection: SqliteConnection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const today = localIsoDate(NOW, TZ);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  const blocks: PlanBlock[] = [
    { id: "v1-work-0", kind: "work", start: iso(-30), end: iso(0), label: "Past", taskId: "t1" },
    { id: "v1-work-1", kind: "work", start: iso(30), end: iso(60), label: "Future", taskId: "t2" },
  ];
  const plan: Plan = { id: `plan-${today}`, date: today, version: 1, reasoning: "x", createdAt: iso(-60), updatedAt: iso(-60), blocks };
  putPlan(store, plan);
  const tasks = [task("t1", "Past"), task("t2", "Future"), task("t3", "Fresh")];

  // A fake Yoh Plan calendar that reflects Yoh's writes and can be edited by "Spencer".
  let yohEvents: YohPlanEvent[] = [];
  let busy: CalendarEvent[] = [];
  // Like the old adapter, the snapshot keeps prior entries (stale ones survive) unless `pruneStale` says otherwise.
  const writeFake = (bs: readonly PlanBlock[], keepStale = false): void => {
    yohEvents = [...yohEvents.filter((e) => e.blockId === undefined), ...bs.map((b) => ({ eventId: `ev-${b.id}`, blockId: b.id, title: b.label, start: b.start, end: b.end }))];
    const fresh = bs.map(asEntry);
    const old = keepStale ? listPlanCalendarSnapshot(connection.db, today).filter((e) => !fresh.some((f) => f.eventId === e.eventId)) : [];
    connection.writeTx((db) => replacePlanCalendarSnapshotInTx(db, today, [...old, ...fresh]));
  };
  writeFake(blocks.filter((b) => Date.parse(b.end) > NOW.getTime()));
  const written: (readonly PlanBlock[])[] = [];
  let readFails = false;
  let beforeRead: () => void = () => {};
  let writeState: PlanCalendarWriteState = {};
  let stateReads = 0;
  let eventReads = 0;
  let keepStale = false;
  let failWrites = false;
  const deps: SyncPlanFromCalendarDeps = {
    store, connection, timeZone: TZ, now: () => NOW,
    readTasks: async () => tasks,
    readCalendarEvents: async () => busy,
    readYohPlanEvents: async () => {
      eventReads += 1;
      beforeRead();
      if (readFails) throw new Error("calendar down");
      return yohEvents;
    },
    readPlanCalendarSnapshot: (d) => listPlanCalendarSnapshot(connection.db, d),
    readPlanCalendarWriteState: () => {
      stateReads += 1;
      return writeState;
    },
    writeCalendarPlan: async (bs) => {
      if (failWrites) throw new Error("google down");
      written.push(bs);
      writeFake(bs, keepStale);
      return { written: bs.map((b) => b.id), failed: [] };
    },
  };
  return {
    store, connection, today, plan, deps, written,
    setEvents: (e: YohPlanEvent[]) => { yohEvents = e; },
    getEvents: () => yohEvents,
    setBusy: (e: CalendarEvent[]) => { busy = e; },
    setReadFails: (v: boolean) => { readFails = v; },
    onRead: (f: () => void) => { beforeRead = f; },
    setWriteState: (w: PlanCalendarWriteState) => { writeState = w; },
    eventReads: () => eventReads,
    stateReads: () => stateReads,
    failWrites: () => { failWrites = true; },
    keepStale: () => { keepStale = true; },
  };
}

const notifications = (c: SqliteConnection) => c.db.prepare("SELECT kind, title, body, deep_link FROM notifications").all() as { kind: string; title: string; body: string; deep_link: string }[];
const planHints = (c: SqliteConnection) => tailOutboxSince(c, 0).filter((h) => h.topic === "plan").length;
const t2Blocks = (s: ReturnType<typeof setup>) => getPlan(s.store, s.today)!.data.blocks.filter((b) => b.kind === "work" && b.taskId === "t2");
const evOf = (s: ReturnType<typeof setup>, s0: number, e0: number, title = "Future"): YohPlanEvent => ({ eventId: "ev-v1-work-1", blockId: "v1-work-1", title, start: iso(s0), end: iso(e0) });

test("no stored Plan: no-plan", async () => {
  const s = setup();
  const r = await syncPlanFromCalendar({ ...s.deps, now: () => new Date("2026-09-01T18:00:00.000Z") }, {});
  assert.deepEqual(r, { ok: true, value: { status: "no-plan" } });
  s.store.close();
});

test("nothing changed: unchanged, no write, no hint, no notification", async () => {
  const s = setup();
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.deepEqual(r, { ok: true, value: { status: "unchanged" } });
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  assert.equal(planHints(s.connection), 0);
  assert.equal(notifications(s.connection).length, 0);
  assert.deepEqual(s.written, []);
  s.store.close();
});

test("moved event: Task pinned at the new time, rest re-fitted, one plan hint and one notification", async () => {
  const s = setup();
  s.setEvents([evOf(s, 120, 150)]);
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.deepEqual(r, { ok: true, value: { status: "applied", calendarFailedBlockIds: [] } });
  const stored = getPlan(s.store, s.today)!.data;
  assert.equal(stored.version, 2);
  assert.deepEqual(t2Blocks(s).map((b) => [b.start, b.end]), [[iso(120), iso(150)]]);
  assert.ok(stored.blocks.some((b) => b.kind === "work" && b.taskId === "t3"), "the unscheduled Task is fitted in");
  const pins = listDayPins(s.connection.db, s.today);
  assert.deepEqual(pins.map((p) => [p.subject, p.start, p.durationMinutes]), [[{ kind: "task", taskId: "t2" }, iso(120), 30]]);
  assert.equal(planHints(s.connection), 1);
  const n = notifications(s.connection);
  assert.equal(n.length, 1);
  assert.equal(n[0]!.kind, "plan-calendar-synced");
  assert.equal(n[0]!.title, "Re-fit your day around your calendar change");
  assert.equal(n[0]!.deep_link, "home");
  assert.match(n[0]!.body, /Future/);
  assert.equal(s.written.length, 1);
  assert.ok(s.written[0]!.every((b) => b.kind !== "calendar-anchor"));
  s.store.close();
});

test("resized event: the new length is honored", async () => {
  const s = setup();
  s.setEvents([evOf(s, 30, 90)]);
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.ok(r.ok && r.value.status === "applied");
  const mins = t2Blocks(s).reduce((sum, b) => sum + (Date.parse(b.end) - Date.parse(b.start)) / 60_000, 0);
  assert.equal(mins, 60);
  assert.equal(t2Blocks(s)[0]!.start, iso(30));
  s.store.close();
});

test("deleted event: the Task is dropped for today and nothing is written to Notion", async () => {
  const s = setup();
  s.setEvents([]);
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.ok(r.ok && r.value.status === "applied");
  assert.deepEqual(t2Blocks(s), []);
  assert.deepEqual(listDayDrops(s.connection.db, s.today), ["t2"]);
  assert.equal(notifications(s.connection).length, 1);
  s.store.close();
});

test("an added event overlapping a planned block re-fits without pinning", async () => {
  const s = setup();
  const added: YohPlanEvent = { eventId: "u1", title: "Dentist", start: iso(40), end: iso(70) };
  s.setEvents([...s.getEvents(), added]);
  s.setBusy([{ id: "u1", title: "Dentist", start: iso(40), end: iso(70), isAllDay: false } as unknown as CalendarEvent]);
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.ok(r.ok && r.value.status === "applied");
  assert.deepEqual(listDayPins(s.connection.db, s.today), []);
  for (const b of t2Blocks(s)) assert.ok(Date.parse(b.end) <= Date.parse(iso(40)) || Date.parse(b.start) >= Date.parse(iso(70)), "clear of the new event");
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  s.store.close();
});

test("a plan changed under the read is skipped as a conflict; nothing else is written", async () => {
  const s = setup();
  s.setEvents([evOf(s, 120, 150)]);
  s.onRead(() => putPlan(s.store, { ...s.plan, version: 2 }));
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.deepEqual(r, { ok: true, value: { status: "skipped-conflict" } });
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  assert.equal(notifications(s.connection).length, 0);
  assert.deepEqual(s.written, []);
  s.store.close();
});

test("calendar read failure: an error Result and nothing written", async () => {
  const s = setup();
  s.setReadFails(true);
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "unreachable");
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  assert.equal(planHints(s.connection), 0);
  assert.equal(notifications(s.connection).length, 0);
  s.store.close();
});

test("a failed calendar write raises the reshuffle-apply-failed notification", async () => {
  const s = setup();
  s.setEvents([evOf(s, 120, 150)]);
  const r = await syncPlanFromCalendar({ ...s.deps, writeCalendarPlan: async (bs) => ({ written: [], failed: bs.map((b) => b.id) }) }, {});
  assert.ok(r.ok && r.value.status === "applied" && (r.value.calendarFailedBlockIds?.length ?? 0) > 0);
  assert.deepEqual(notifications(s.connection).map((n) => n.kind).sort(), ["plan-calendar-synced", "reshuffle-apply-failed"]);
  s.store.close();
});

test("idempotent: a second sync right after applied is unchanged", async () => {
  const s = setup();
  s.setEvents([evOf(s, 120, 150)]);
  const first = await syncPlanFromCalendar(s.deps, {});
  assert.ok(first.ok && first.value.status === "applied");
  const second = await syncPlanFromCalendar(s.deps, {});
  assert.deepEqual(second, { ok: true, value: { status: "unchanged" } });
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  assert.equal(planHints(s.connection), 1);
  s.store.close();
});

test("delete then sync twice: the second sync is unchanged even when the snapshot kept a stale entry", async () => {
  const s = setup();
  s.keepStale();
  s.setEvents([]);
  assert.equal((await syncPlanFromCalendar(s.deps, {}) as { ok: true; value: { status: string } }).value.status, "applied");
  const second = await syncPlanFromCalendar(s.deps, {});
  assert.deepEqual(second, { ok: true, value: { status: "unchanged" } });
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  assert.equal(planHints(s.connection), 1);
  assert.equal(notifications(s.connection).length, 1);
  s.store.close();
});

test("a failed calendar write: the second sync is unchanged (no repeat apply or notification)", async () => {
  const s = setup();
  s.setEvents([evOf(s, 120, 150)]);
  s.failWrites();
  const first = await syncPlanFromCalendar(s.deps, {});
  assert.ok(first.ok && first.value.status === "applied");
  const second = await syncPlanFromCalendar(s.deps, {});
  assert.deepEqual(second, { ok: true, value: { status: "unchanged" } });
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  assert.equal(planHints(s.connection), 1);
  assert.deepEqual(notifications(s.connection).map((n) => n.kind).sort(), ["plan-calendar-synced", "reshuffle-apply-failed"]);
  s.store.close();
});

test("an overlap re-fit twice: the second sync is unchanged", async () => {
  const s = setup();
  s.setEvents([...s.getEvents(), { eventId: "u1", title: "Dentist", start: iso(40), end: iso(70) }]);
  s.setBusy([{ id: "u1", title: "Dentist", start: iso(40), end: iso(70), isAllDay: false } as unknown as CalendarEvent]);
  assert.ok((await syncPlanFromCalendar(s.deps, {})).ok);
  const second = await syncPlanFromCalendar(s.deps, {});
  assert.deepEqual(second, { ok: true, value: { status: "unchanged" } });
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  s.store.close();
});

test("a dropped Task's stored pin is removed too", async () => {
  const s = setup();
  s.connection.writeTx((db) => replaceDayPinsAndDropsInTx(db, s.today, [{ date: s.today, subject: { kind: "task", taskId: "t2" }, start: iso(30) }], []));
  s.setEvents([]);
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.ok(r.ok && r.value.status === "applied");
  assert.deepEqual(listDayPins(s.connection.db, s.today), []);
  assert.deepEqual(listDayDrops(s.connection.db, s.today), ["t2"]);
  s.store.close();
});

test("a write in flight (fresh writing_since): unchanged, and the calendar is not even read", async () => {
  const s = setup();
  s.setEvents([evOf(s, 120, 150)]);
  s.setWriteState({ writingSince: new Date(NOW.getTime() - 60_000).toISOString() });
  assert.deepEqual(await syncPlanFromCalendar(s.deps, {}), { ok: true, value: { status: "unchanged" } });
  assert.equal(s.eventReads(), 0);
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  s.store.close();
});

test("a stale writing_since (over 5 minutes) does not block the sync", async () => {
  const s = setup();
  s.setEvents([evOf(s, 120, 150)]);
  s.setWriteState({ writingSince: new Date(NOW.getTime() - 6 * 60_000).toISOString() });
  const r = await syncPlanFromCalendar(s.deps, {});
  assert.ok(r.ok && r.value.status === "applied");
  s.store.close();
});

test("a write that lands during the read: unchanged", async () => {
  const s = setup();
  s.setEvents([evOf(s, 120, 150)]);
  s.setWriteState({ writtenAt: "2026-08-22T17:59:00.000Z" });
  s.onRead(() => s.setWriteState({ writtenAt: "2026-08-22T18:00:00.000Z" }));
  assert.deepEqual(await syncPlanFromCalendar(s.deps, {}), { ok: true, value: { status: "unchanged" } });
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  s.setWriteState({ writingSince: NOW_ISO });
  s.onRead(() => {});
  s.store.close();
});

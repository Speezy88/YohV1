import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getPlan, listOpenInteractionRequests, putPlan, putTimeBudget } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { localIsoDate } from "../src/rituals/ritual-shared.ts";
import { requestReshuffle } from "../src/app/request-reshuffle.ts";
import { approveReshuffle, discardReshuffle, type ApproveReshuffleDeps } from "../src/app/approve-reshuffle.ts";
import { confirmProposal } from "../src/app/confirm-proposal.ts";
import type { CalendarEvent, Plan, PlanBlock, Task } from "../src/types/domain.ts";

const TZ = "America/New_York";
const NOW = new Date("2026-08-22T18:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const iso = (mins: number): string => new Date(NOW.getTime() + mins * 60_000).toISOString();

function task(id: string, title: string): Task {
  return {
    id, title, createdAt: NOW_ISO, updatedAt: NOW_ISO, estimatedDurationMinutes: 30, area: "Work",
    dueDate: "2026-08-22", status: "not-started", energy: "medium",
  } as Task;
}

async function setup(events: CalendarEvent[] = []) {
  const connection: SqliteConnection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const today = localIsoDate(NOW, TZ);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  const plan: Plan = {
    id: `plan-${today}`, date: today, version: 1, reasoning: "x", createdAt: iso(-60), updatedAt: iso(-60),
    blocks: [
      { id: "v1-work-0", kind: "work", start: iso(-30), end: iso(0), label: "Past", taskId: "t1" },
      { id: "v1-work-1", kind: "work", start: iso(30), end: iso(60), label: "Future", taskId: "t2" },
    ],
  };
  putPlan(store, plan);
  const tasks = [task("t1", "Past"), task("t2", "Future"), task("t3", "Fresh")];
  const written: (readonly PlanBlock[])[] = [];
  let failIds: string[] = [];
  let currentEvents = events;
  const deps: ApproveReshuffleDeps = {
    store, connection, timeZone: TZ, now: () => NOW,
    readTasks: async () => tasks,
    readCalendarEvents: async () => currentEvents,
    writeCalendarPlan: async (blocks) => {
      written.push(blocks);
      return { written: blocks.map((b) => b.id).filter((id) => !failIds.includes(id)), failed: failIds };
    },
  };
  const req = await requestReshuffle(deps, { request: { kind: "reflow-now" } });
  assert.ok(req.ok);
  if (!req.ok) throw new Error("unreachable");
  return {
    store, connection, today, plan, deps, written, proposal: req.value.proposal,
    setFail: (ids: string[]) => { failIds = ids; },
    setEvents: (e: CalendarEvent[]) => { currentEvents = e; },
  };
}

const notifications = (c: SqliteConnection) => c.db.prepare("SELECT kind, title, deep_link FROM notifications").all() as { kind: string; title: string; deep_link: string }[];

test("approve: happy path writes the Plan once, one plan hint, clears the request, syncs non-anchor blocks", async () => {
  const s = await setup();
  const before = tailOutboxSince(s.connection, 0).length;
  const result = await approveReshuffle(s.deps, { proposal: s.proposal });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.value, { status: "applied", calendarFailedBlockIds: [] });
  const stored = getPlan(s.store, s.today)!.data;
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.blocks, s.proposal.suggested.blocks);
  const hints = tailOutboxSince(s.connection, before);
  assert.equal(hints.filter((h) => h.topic === "plan").length, 1);
  assert.equal(listOpenInteractionRequests(s.store).length, 0);
  assert.equal(s.written.length, 1);
  assert.ok(s.written[0]!.every((b) => b.kind !== "calendar-anchor"));
  assert.equal(notifications(s.connection).length, 0);
  s.store.close();
});

test("approve: stale plan version recomputes and writes nothing", async () => {
  const s = await setup();
  putPlan(s.store, { ...s.plan, version: 2 });
  const result = await approveReshuffle(s.deps, { proposal: s.proposal });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.status, "recomputed");
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  assert.deepEqual(s.written, []);
  assert.equal(listOpenInteractionRequests(s.store).length, 1, "only the fresh preview is open");
  s.store.close();
});

test("approve: changed calendar recomputes and writes nothing", async () => {
  const s = await setup();
  s.setEvents([{ id: "e1", title: "New meeting", start: iso(90), end: iso(120), isAllDay: false } as unknown as CalendarEvent]);
  const result = await approveReshuffle(s.deps, { proposal: s.proposal });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.status, "recomputed");
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  assert.deepEqual(s.written, []);
  s.store.close();
});

test("approve: an expired preview recomputes", async () => {
  const s = await setup();
  const later = new Date(NOW.getTime() + 11 * 60_000);
  const result = await approveReshuffle({ ...s.deps, now: () => later }, { proposal: s.proposal });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.status, "recomputed");
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  s.store.close();
});

test("approve: partial calendar failure raises a notification and returns the failed ids", async () => {
  const s = await setup();
  const target = s.proposal.suggested.blocks.filter((b) => b.kind !== "calendar-anchor")[0]!.id;
  s.setFail([target]);
  const result = await approveReshuffle(s.deps, { proposal: s.proposal });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.value, { status: "applied", calendarFailedBlockIds: [target] });
  assert.equal(getPlan(s.store, s.today)!.data.version, 2, "Plan is still written");
  assert.deepEqual(notifications(s.connection), [{ kind: "reshuffle-apply-failed", title: "Couldn't update your calendar", deep_link: "home" }]);
  s.store.close();
});

test("discard writes nothing but clears the request", async () => {
  const s = await setup();
  const outboxBefore = tailOutboxSince(s.connection, 0).filter((h) => h.topic === "plan").length;
  const result = await discardReshuffle({ store: s.store }, { proposal: s.proposal });
  assert.ok(result.ok);
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  assert.deepEqual(s.written, []);
  assert.equal(listOpenInteractionRequests(s.store).length, 0);
  assert.equal(tailOutboxSince(s.connection, 0).filter((h) => h.topic === "plan").length, outboxBefore);
  s.store.close();
});

test("confirmProposal routes reshuffle accept/decline to approve/discard", async () => {
  const s = await setup();
  const { store, ...rest } = s.deps;
  const requestId = `proposal:${s.proposal.id}`;
  const declined = await confirmProposal({ store, reshuffle: rest }, { proposal: s.proposal, accept: false, requestId });
  assert.ok(declined.ok);
  assert.equal(getPlan(store, s.today)!.data.version, 1);
  assert.equal(listOpenInteractionRequests(store).length, 0);
  const again = await requestReshuffle(s.deps, { request: { kind: "reflow-now" } });
  assert.ok(again.ok);
  if (!again.ok) return;
  const accepted = await confirmProposal({ store, reshuffle: rest }, { proposal: again.value.proposal, accept: true, requestId: again.value.question.requestId });
  assert.ok(accepted.ok);
  if (!accepted.ok) return;
  assert.equal(accepted.value.applied, true);
  assert.equal(getPlan(store, s.today)!.data.version, 2);
  store.close();
});

// ---------------------------------------------------------------------------
// T5: pins and drops persist with the Plan, in one transaction
// ---------------------------------------------------------------------------
import { listDayDrops, listDayPins } from "../src/adapters/plan-state-store.ts";

async function pinSetup() {
  const s = await setup();
  const req = await requestReshuffle(s.deps, { request: { kind: "swap", addTaskId: "t3", removeTaskId: "t2" } });
  assert.ok(req.ok);
  if (!req.ok) throw new Error("unreachable");
  return { ...s, proposal: req.value.proposal };
}

test("approve persists the day's pins and drops with the Plan", async () => {
  const s = await pinSetup();
  const result = await approveReshuffle(s.deps, { proposal: s.proposal });
  assert.ok(result.ok);
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  assert.deepEqual(listDayPins(s.connection.db, s.today).map((p) => p.subject), [{ kind: "task", taskId: "t3" }]);
  assert.deepEqual(listDayDrops(s.connection.db, s.today), ["t2"]);
  s.store.close();
});

test("approve rolls the pins and drops back with the Plan when the transaction fails", async () => {
  const s = await pinSetup();
  s.connection.db.exec("CREATE TRIGGER boom BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'boom'); END");
  const result = await approveReshuffle(s.deps, { proposal: s.proposal });
  assert.equal(result.ok, false);
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  assert.deepEqual(listDayPins(s.connection.db, s.today), []);
  assert.deepEqual(listDayDrops(s.connection.db, s.today), []);
  s.store.close();
});

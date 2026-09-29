import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getPlan, listOpenInteractionRequests, putPlan, putTimeBudget, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { localIsoDate } from "../src/rituals/ritual-shared.ts";
import { requestReshuffle, type RequestReshuffleDeps } from "../src/app/request-reshuffle.ts";
import type { CalendarEvent, Plan, Task } from "../src/types/domain.ts";

const TZ = "America/New_York";
const NOW = new Date("2026-08-22T18:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const iso = (mins: number): string => new Date(NOW.getTime() + mins * 60_000).toISOString();

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

function task(id: string, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title, createdAt: NOW_ISO, updatedAt: NOW_ISO, estimatedDurationMinutes: 30, area: "Work",
    dueDate: "2026-08-22", status: "not-started", energy: "medium", ...overrides,
  } as Task;
}

function setup(tasks: Task[], events: CalendarEvent[] = []) {
  const store = tempStore();
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
  const calls: string[] = [];
  const deps: RequestReshuffleDeps & { writeCalendarPlan: () => Promise<void> } = {
    store, timeZone: TZ, now: () => NOW,
    readTasks: async () => tasks,
    readCalendarEvents: async () => events,
    writeCalendarPlan: async () => { calls.push("write"); },
  };
  return { store, today, plan, deps, calls };
}

const request = { kind: "reflow-now" } as const;

test("requestReshuffle previews the re-fit, keeps past blocks, opens one reshuffle proposal, writes nothing", async () => {
  const { store, today, plan, deps, calls } = setup([task("t1", "Past"), task("t2", "Future"), task("t3", "Fresh")]);
  const result = await requestReshuffle(deps, { request });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { proposal, question } = result.value;
  assert.equal(proposal.kind, "reshuffle");
  assert.equal(proposal.entityId, today);
  assert.match(proposal.entityVersion, /^1:[0-9a-f]{8}$/);
  assert.equal(question.requestId, `proposal:${proposal.id}`);
  const preview = proposal.suggested;
  assert.deepEqual(preview.blocks.find((b) => b.id === "v1-work-0"), plan.blocks[0]);
  assert.ok(preview.blocks.some((b) => b.taskId === "t3"), "new Task is placed");
  assert.ok(preview.movedBlockIds.length >= 1);
  assert.equal(preview.planVersion, 1);
  assert.deepEqual(getPlan(store, today)!.data, plan, "stored Plan untouched");
  assert.deepEqual(calls, []);
  assert.equal(listOpenInteractionRequests(store).length, 1);
  store.close();
});

test("a second request supersedes the first — only one open reshuffle proposal", async () => {
  const { store, deps } = setup([task("t1", "Past"), task("t2", "Future")]);
  const first = await requestReshuffle(deps, { request });
  const later = new Date(NOW.getTime() + 60_000);
  const second = await requestReshuffle({ ...deps, now: () => later }, { request });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.notEqual(first.value.proposal.id, second.value.proposal.id);
  const open = listOpenInteractionRequests(store);
  assert.equal(open.length, 1);
  assert.equal(open[0]!.id, `proposal:${second.value.proposal.id}`);
  store.close();
});

test("no stored Plan gives missing-field", async () => {
  const { store, today, deps } = setup([]);
  store.close();
  const fresh = tempStore();
  putTimeBudget(fresh, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  const result = await requestReshuffle({ ...deps, store: fresh }, { request });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "missing-field");
  assert.equal(result.error.message, "There's no Plan for today yet.");
  fresh.close();
});

test("a Task missing its duration lands in needsDataTaskIds while the others are still planned", async () => {
  const { store, deps } = setup([
    task("t1", "Past"), task("t2", "Future"), task("t4", "No duration", { estimatedDurationMinutes: undefined } as unknown as Partial<Task>),
  ]);
  const result = await requestReshuffle(deps, { request });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.proposal.suggested.needsDataTaskIds, ["t4"]);
  assert.ok(result.value.proposal.suggested.blocks.some((b) => b.taskId === "t2"));
  store.close();
});

test("the calendar version changes when an event start moves, not on a title edit", async () => {
  const ev = { id: "e1", title: "Sync", start: iso(120), end: iso(150) };
  const a = setup([task("t2", "Future")], [ev]);
  const r1 = await requestReshuffle(a.deps, { request });
  const b = setup([task("t2", "Future")], [{ ...ev, title: "Renamed" }]);
  const r2 = await requestReshuffle(b.deps, { request });
  const c = setup([task("t2", "Future")], [{ ...ev, start: iso(125) }]);
  const r3 = await requestReshuffle(c.deps, { request });
  assert.equal(r1.ok && r2.ok && r3.ok, true);
  if (!r1.ok || !r2.ok || !r3.ok) return;
  assert.equal(r1.value.proposal.entityVersion, r2.value.proposal.entityVersion);
  assert.notEqual(r1.value.proposal.entityVersion, r3.value.proposal.entityVersion);
  a.store.close(); b.store.close(); c.store.close();
});

// ---------------------------------------------------------------------------
// T5: pin, move, drop, swap, unpin
// ---------------------------------------------------------------------------
import { listDayDrops, listDayPins, replaceDayPinsAndDropsInTx } from "../src/adapters/plan-state-store.ts";

const T3 = () => [task("t1", "Past"), task("t2", "Future"), task("t3", "Fresh")];
const pins = (s: MemoryStore, date: string) => s.withDb((db) => listDayPins(db, date));
const drops = (s: MemoryStore, date: string) => s.withDb((db) => listDayDrops(db, date));

test("pin-task: previews the Task placed at its pin, marks it pinned, writes no pin yet", async () => {
  const { store, today, deps } = setup(T3());
  const r = await requestReshuffle(deps, { request: { kind: "pin-task", taskId: "t3", newStart: iso(120) } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.value.proposal.suggested;
  assert.deepEqual(p.pins, [{ date: today, subject: { kind: "task", taskId: "t3" }, start: iso(120) }]);
  const t3 = p.blocks.filter((b) => b.taskId === "t3");
  assert.equal(t3.length, 1);
  assert.equal(t3[0]!.start, iso(120));
  assert.equal(t3[0]!.pinned, true);
  assert.equal(p.rejectedReason, undefined);
  assert.deepEqual(pins(store, today), [], "request persists nothing");
  store.close();
});

test("move-block of a work block is the same as pin-task for its Task", async () => {
  const a = setup(T3());
  const b = setup(T3());
  const moved = await requestReshuffle(a.deps, { request: { kind: "move-block", planBlockId: "v1-work-1", newStart: iso(180) } });
  const pinned = await requestReshuffle(b.deps, { request: { kind: "pin-task", taskId: "t2", newStart: iso(180) } });
  assert.equal(moved.ok && pinned.ok, true);
  if (!moved.ok || !pinned.ok) return;
  assert.deepEqual(moved.value.proposal.suggested.blocks, pinned.value.proposal.suggested.blocks);
  assert.deepEqual(moved.value.proposal.suggested.pins, pinned.value.proposal.suggested.pins);
  a.store.close();
  b.store.close();
});

test("move-block: an unknown block id is stale-proposal; a past block is not draggable", async () => {
  const { store, deps } = setup(T3());
  const unknown = await requestReshuffle(deps, { request: { kind: "move-block", planBlockId: "v0-work-9", newStart: iso(180) } });
  assert.equal(!unknown.ok && unknown.error.kind, "stale-proposal");
  const past = await requestReshuffle(deps, { request: { kind: "move-block", planBlockId: "v1-work-0", newStart: iso(180) } });
  assert.equal(!past.ok && past.error.kind, "validation");
  assert.equal(listOpenInteractionRequests(store).length, 0);
  store.close();
});

test("pin-task overlapping a fixed event is rejected: the preview equals the current plan and names the event", async () => {
  const ev: CalendarEvent = { id: "e1", title: "Dentist", start: iso(100), end: iso(140) };
  const { store, plan, deps } = setup(T3(), [ev]);
  const r = await requestReshuffle(deps, { request: { kind: "pin-task", taskId: "t3", newStart: iso(110) } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.value.proposal.suggested;
  assert.match(p.rejectedReason ?? "", /Dentist/);
  assert.deepEqual(p.blocks, plan.blocks);
  assert.deepEqual(p.pins, []);
  assert.deepEqual(p.movedBlockIds, []);
  store.close();
});

test("drop-task removes the Task for today; unpin-task clears both a pin and a drop", async () => {
  const { store, today, deps } = setup(T3());
  const r = await requestReshuffle(deps, { request: { kind: "drop-task", taskId: "t2" } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.proposal.suggested.drops, ["t2"]);
  assert.ok(!r.value.proposal.suggested.blocks.some((b) => b.taskId === "t2" && Date.parse(b.end) > NOW.getTime()));
  assert.ok(!r.value.proposal.suggested.deferredTaskIds.includes("t2"));

  store.withDb((db) => replaceDayPinsAndDropsInTx(db, today, [{ date: today, subject: { kind: "task", taskId: "t3" }, start: iso(120) }], ["t2"]));
  const u2 = await requestReshuffle(deps, { request: { kind: "unpin-task", taskId: "t2" } });
  const u3 = await requestReshuffle(deps, { request: { kind: "unpin-task", taskId: "t3" } });
  assert.equal(u2.ok && u3.ok, true);
  if (!u2.ok || !u3.ok) return;
  assert.deepEqual(u2.value.proposal.suggested.drops, []);
  assert.equal(u2.value.proposal.suggested.pins.length, 1);
  assert.deepEqual(u3.value.proposal.suggested.pins, []);
  assert.deepEqual(u3.value.proposal.suggested.drops, ["t2"]);
  store.close();
});

test("swap is a drop plus a pin", async () => {
  const { store, today, deps } = setup(T3());
  const r = await requestReshuffle(deps, { request: { kind: "swap", addTaskId: "t3", removeTaskId: "t2" } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.value.proposal.suggested;
  assert.deepEqual(p.drops, ["t2"]);
  assert.deepEqual(p.pins, [{ date: today, subject: { kind: "task", taskId: "t3" }, start: iso(30) }]);
  assert.equal(p.blocks.filter((b) => b.taskId === "t3")[0]!.start, iso(30));
  store.close();
});

test("stored pins for today apply to a plain reflow; pins for another date are ignored", async () => {
  const { store, today, deps } = setup(T3());
  store.withDb((db) => {
    replaceDayPinsAndDropsInTx(db, today, [{ date: today, subject: { kind: "task", taskId: "t3" }, start: iso(200) }], []);
    replaceDayPinsAndDropsInTx(db, "2020-01-01", [{ date: "2020-01-01", subject: { kind: "task", taskId: "t2" }, start: iso(200) }], []);
  });
  const r = await requestReshuffle(deps, { request });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.value.proposal.suggested;
  assert.equal(p.blocks.filter((b) => b.pinned).length, 1);
  assert.equal(p.blocks.find((b) => b.pinned)!.taskId, "t3");
  assert.equal(p.pins.length, 1);
  assert.deepEqual(drops(store, today), []);
  store.close();
});

test("a stored pin that now overlaps a new event is released with a summary, and the refit is not rejected", async () => {
  const ev: CalendarEvent = { id: "e9", title: "Dentist", start: iso(110), end: iso(150) };
  const { store, today, deps } = setup(T3(), [ev]);
  store.withDb((db) => replaceDayPinsAndDropsInTx(db, today, [{ date: today, subject: { kind: "task", taskId: "t3" }, start: iso(120) }], []));
  const r = await requestReshuffle(deps, { request });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.value.proposal.suggested;
  assert.equal(p.rejectedReason, undefined);
  assert.deepEqual(p.pins, []);
  assert.match(p.summary, /Unpinned Fresh — it now overlaps Dentist\./);
  assert.ok(p.blocks.some((b) => b.taskId === "t3"), "the released Task is still placed");
  // another pin request is not rejected by the stale one either
  const other = await requestReshuffle(deps, { request: { kind: "pin-task", taskId: "t2", newStart: iso(200) } });
  assert.equal(other.ok && other.value.proposal.suggested.rejectedReason === undefined, true);
  store.close();
});

test("an in-progress stored pin keeps its Task going from now", async () => {
  const { store, today, deps } = setup(T3());
  store.withDb((db) => replaceDayPinsAndDropsInTx(db, today, [{ date: today, subject: { kind: "task", taskId: "t2" }, start: iso(-10) }], []));
  const r = await requestReshuffle(deps, { request });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const t2 = r.value.proposal.suggested.blocks.filter((b) => b.taskId === "t2" && b.pinned);
  assert.equal(t2[0]?.start, NOW_ISO);
  store.close();
});

test("pin-task on an open Task missing required data names the fields it needs", async () => {
  const { store, deps } = setup([task("t1", "Past"), task("t2", "Future"), task("t3", "Fresh", { estimatedDurationMinutes: undefined, dueDate: undefined } as unknown as Partial<Task>)]);
  const r = await requestReshuffle(deps, { request: { kind: "pin-task", taskId: "t3", newStart: iso(120) } });
  assert.equal(!r.ok && r.error.kind, "validation");
  assert.equal(!r.ok && r.error.message, "Fresh needs Estimated Duration and Due Date before I can place it.");
  store.close();
});

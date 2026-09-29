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

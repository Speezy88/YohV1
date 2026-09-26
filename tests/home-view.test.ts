/**
 * Tests for `src/app/home-view.ts` (Story 7.8, AD-16/AD-17).
 *
 * Exercised against a real (throwaway, `:memory:`) `MemoryStore` with
 * `readCalendarEvents`/`readTasks` injected — both of which throw on
 * failure per AD-8, several tests below make them throw on purpose.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, putPlan } from "../src/adapters/memory-store.ts";
import { getHomeView, type HomeViewDeps } from "../src/app/home-view.ts";
import type { LogEntry } from "../src/adapters/logger.ts";
import type { CalendarEvent, Plan, Task } from "../src/types/domain.ts";

function tempDeps(overrides: Partial<HomeViewDeps> = {}): HomeViewDeps {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const store = createMemoryStore(connection);
  return {
    store,
    readCalendarEvents: async (): Promise<readonly CalendarEvent[]> => [],
    readTasks: async (): Promise<{ tasks: readonly Task[] }> => ({ tasks: [] }),
    timeZone: "America/New_York",
    now: () => new Date("2026-09-25T16:00:00.000Z"), // noon EDT
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-2026-09-25",
    date: "2026-09-25",
    blocks: [],
    reasoning: "",
    version: 1,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

test("no Plan yet today returns plan: undefined, with live calendar fixed anchors still populated", async () => {
  const deps = tempDeps({
    readCalendarEvents: async () => [{ id: "e1", title: "Soccer practice", start: "2026-09-25T21:00:00.000Z", end: "2026-09-25T22:30:00.000Z" }],
  });
  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.today, "2026-09-25");
  assert.equal(result.value.plan, undefined);
  assert.equal(result.value.calendar.blocks.length, 1);
  assert.equal(result.value.calendar.blocks[0]!.kind, "fixed");
  deps.store.close();
});

test("Plan rows render in the stored block order, work blocks only", async () => {
  const deps = tempDeps();
  putPlan(deps.store, makePlan({
    blocks: [
      { id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t1", label: "Draft the memo" },
      { id: "b2", kind: "break", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T14:15:00.000Z", label: "Break" },
      { id: "b3", kind: "work", start: "2026-09-25T14:15:00.000Z", end: "2026-09-25T15:00:00.000Z", taskId: "t2", label: "Call the dentist" },
    ],
  }));

  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.plan?.rows.map((r) => r.taskId), ["t1", "t2"]);
  assert.equal(result.value.calendar.blocks.length, 3); // 2 work + 1 break, no fixed events in this fixture
  deps.store.close();
});

test("a calendar-anchor block in the stored Plan is never rendered as a calendar block or a checklist row (only a live read produces 'fixed' blocks)", async () => {
  const deps = tempDeps();
  putPlan(deps.store, makePlan({
    blocks: [
      { id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t1", label: "Draft the memo" },
      { id: "b2", kind: "calendar-anchor", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T14:30:00.000Z", label: "Standup" },
    ],
  }));

  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.calendar.blocks.length, 1);
  assert.equal(result.value.calendar.blocks[0]!.id, "b1");
  deps.store.close();
});

test("a work block's Task completed in Notion shows completed: true", async () => {
  const deps = tempDeps({
    readTasks: async () => ({
      tasks: [{ id: "t1", title: "Draft the memo", status: "completed", createdAt: "x", updatedAt: "x" }],
    }),
  });
  putPlan(deps.store, makePlan({
    blocks: [{ id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t1", label: "Draft the memo" }],
  }));

  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.plan?.rows[0]!.completed, true);
  deps.store.close();
});

test("a block whose end has already passed 'now' is marked past", async () => {
  const deps = tempDeps({ now: () => new Date("2026-09-25T20:00:00.000Z") }); // 4pm EDT
  putPlan(deps.store, makePlan({
    blocks: [{ id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t1", label: "Draft the memo" }],
  }));
  const result = await getHomeView(deps, {});
  if (result.ok) assert.equal(result.value.plan?.rows[0]!.past, true);
  deps.store.close();
});

test("Fix round 1 (finding #1): a calendar-read failure never blanks the whole Home view — the checklist still renders, the calendar falls back to the Plan's own work/break blocks only", async () => {
  const entries: LogEntry[] = [];
  const deps = tempDeps({
    log: (e) => entries.push(e),
    readCalendarEvents: async () => {
      throw new Error("calendar down");
    },
  });
  putPlan(deps.store, makePlan({
    blocks: [{ id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t1", label: "Draft the memo" }],
  }));

  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.plan?.rows.length, 1, "the checklist still renders");
  assert.deepEqual(result.value.calendar.blocks.map((b) => b.id), ["b1"], "falls back to the Plan's own work/break blocks, no live fixed anchors");
  deps.store.close();
});

test("Fix round 1 (finding #1): a calendar-read failure with no stored Plan yet falls back to an empty calendar, not a thrown exception or ok:false", async () => {
  const deps = tempDeps({
    readCalendarEvents: async () => {
      throw new Error("calendar down");
    },
  });
  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.plan, undefined);
  assert.deepEqual(result.value.calendar.blocks, []);
  deps.store.close();
});

test("Fix round 1 (finding #2): a calendar-read failure logs one structured error line before falling back", async () => {
  const entries: LogEntry[] = [];
  const deps = tempDeps({
    log: (e) => entries.push(e),
    readCalendarEvents: async () => {
      throw new Error("calendar down");
    },
  });
  await getHomeView(deps, {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.level, "error");
  assert.equal(entries[0]!.event, "home-view.read-calendar-failed");
  assert.match(String(entries[0]!.detail), /calendar down/);
  deps.store.close();
});

test("Fix round 1 (finding #2): a Notion-read failure logs one structured error line before falling back", async () => {
  const entries: LogEntry[] = [];
  const deps = tempDeps({
    log: (e) => entries.push(e),
    readTasks: async () => {
      throw new Error("notion down");
    },
  });
  putPlan(deps.store, makePlan({
    blocks: [{ id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t1", label: "Draft the memo" }],
  }));
  await getHomeView(deps, {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.level, "error");
  assert.equal(entries[0]!.event, "home-view.read-tasks-failed");
  assert.match(String(entries[0]!.detail), /notion down/);
  deps.store.close();
});

test("Fix round 1: log is optional — omitting it behaves exactly as before (no throw)", async () => {
  const deps = tempDeps({
    readCalendarEvents: async () => {
      throw new Error("calendar down");
    },
  });
  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  deps.store.close();
});

test("a Notion read failure does not blank the Plan checklist — rows still render, with completed defaulting to false", async () => {
  const deps = tempDeps({
    readTasks: async () => {
      throw new Error("notion down");
    },
  });
  putPlan(deps.store, makePlan({
    blocks: [{ id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t1", label: "Draft the memo" }],
  }));
  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.plan?.rows.length, 1);
    assert.equal(result.value.plan?.rows[0]!.completed, false);
  }
  deps.store.close();
});

test("a Plan work block whose taskId is no longer present in a fresh Notion read still renders (from the Plan's own snapshot), completed: false", async () => {
  const deps = tempDeps({ readTasks: async () => ({ tasks: [] }) });
  putPlan(deps.store, makePlan({
    blocks: [{ id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t-deleted", label: "Draft the memo" }],
  }));
  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.plan?.rows.length, 1);
    assert.equal(result.value.plan?.rows[0]!.completed, false);
  }
  deps.store.close();
});

test("Yoh-owned blocks and live fixed anchors are merged and sorted by start time, server-side (AD-17)", async () => {
  const deps = tempDeps({
    readCalendarEvents: async () => [{ id: "e1", title: "Standup", start: "2026-09-25T13:30:00.000Z", end: "2026-09-25T13:45:00.000Z" }],
  });
  putPlan(deps.store, makePlan({
    blocks: [
      { id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:30:00.000Z", taskId: "t1", label: "Draft the memo" },
      { id: "b2", kind: "work", start: "2026-09-25T13:45:00.000Z", end: "2026-09-25T14:15:00.000Z", taskId: "t2", label: "Call the dentist" },
    ],
  }));
  const result = await getHomeView(deps, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.calendar.blocks.map((b) => b.id), ["b1", "e1", "b2"]);
  deps.store.close();
});

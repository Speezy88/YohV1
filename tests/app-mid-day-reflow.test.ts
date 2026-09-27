/**
 * Tests for `src/app/mid-day-reflow.ts` (Story 8.3).
 *
 * Moved+adapted from `tests/chat-cli.test.ts`'s Mid-Day Re-Flow
 * `runChatCli` integration tests, now calling `reflowDay` directly and
 * asserting on `result.value.reply`, plus a new ANSI-free pin (C2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getPlan, putPlan, putTimeBudget, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { localIsoDate } from "../src/rituals/ritual-shared.ts";
import { reflowDay } from "../src/app/mid-day-reflow.ts";
import type { IsoDate, Plan, Task } from "../src/types/domain.ts";

const TEST_TIME_ZONE = "America/New_York";
const NOW = "2026-08-22T12:00:00.000Z";

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

function makeTask(id: string, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title,
    createdAt: NOW,
    updatedAt: NOW,
    estimatedDurationMinutes: 30,
    area: "Work",
    dueDate: "2026-08-23",
    status: "not-started",
    energy: "medium",
    ...overrides,
  } as Task;
}

function reflowSamplePlan(date: IsoDate, nowIso: string): Plan {
  const nowMs = Date.parse(nowIso);
  const past = new Date(nowMs - 30 * 60_000).toISOString();
  const future = new Date(nowMs + 30 * 60_000).toISOString();
  const futureEnd = new Date(nowMs + 60 * 60_000).toISOString();
  return {
    id: `plan-${date}`,
    date,
    blocks: [
      { id: "work-0", kind: "work", start: past, end: nowIso, label: "Past Task", taskId: "t1" },
      { id: "work-1", kind: "work", start: future, end: futureEnd, label: "Future Task", taskId: "t2" },
    ],
    reasoning: '"Past Task" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: past,
    updatedAt: past,
  };
}

test("reflowDay calls into mid-day-reflow.ts and returns only the short remainder, not the whole day", async () => {
  const store = tempStore();
  const REFLOW_NOW = new Date("2026-08-22T18:00:00.000Z");
  const today = localIsoDate(REFLOW_NOW, TEST_TIME_ZONE);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  const plan = reflowSamplePlan(today, REFLOW_NOW.toISOString());
  putPlan(store, plan);
  const tasks: Task[] = [makeTask("t1", "Past Task", { dueDate: today }), makeTask("t2", "Future Task", { dueDate: today })];

  const result = await reflowDay(
    { store, timeZone: TEST_TIME_ZONE, now: () => REFLOW_NOW, readTasks: async () => tasks },
    {},
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /Re-flowed the rest of today/);
  assert.doesNotMatch(result.value.reply, /Today's Plan for/);
  assert.doesNotMatch(result.value.reply, /Past Task/);
  assert.doesNotMatch(result.value.reply, /\x1b\[/); // ANSI-free (C2)
  assert.deepEqual(result.value.receipts, []);

  const updated = getPlan(store, today);
  assert.ok(updated);
  assert.equal(updated!.data.version, 2, "the stored Plan's version must be bumped by the re-flow");
  const pastBlock = updated!.data.blocks.find((b) => b.id === "work-0");
  assert.deepEqual(pastBlock, plan.blocks[0], "the past block must survive the round-trip byte-identical");
  store.close();
});

test("reflowDay says so plainly when no Plan exists yet for today", async () => {
  const store = tempStore();
  const result = await reflowDay(
    { store, timeZone: TEST_TIME_ZONE, now: () => new Date("2026-08-23T02:00:00.000Z"), readTasks: async () => [] },
    {},
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /no plan/i);
  store.close();
});

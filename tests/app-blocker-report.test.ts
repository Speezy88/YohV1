/**
 * Tests for `src/app/blocker-report.ts` (Story 8.3).
 *
 * Moved+adapted from `tests/chat-cli.test.ts`'s Blocker-report `runChatCli`
 * integration tests, now calling `reportBlocker` directly and asserting on
 * `result.value.reply`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getPlan, putPlan, putTimeBudget, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { localIsoDate } from "../src/rituals/ritual-shared.ts";
import { reportBlocker } from "../src/app/blocker-report.ts";
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

function blockerSamplePlan(date: IsoDate, nowIso: string): Plan {
  const nowMs = Date.parse(nowIso);
  const start = new Date(nowMs - 30 * 60_000).toISOString();
  const end = new Date(nowMs - 5 * 60_000).toISOString(); // scheduled end already passed by the time of the report
  return {
    id: `plan-${date}`,
    date,
    blocks: [{ id: "work-0", kind: "work", start, end, label: "Blocked Task", taskId: "t1" }],
    reasoning: '"Blocked Task" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: start,
    updatedAt: start,
  };
}

test("reportBlocker reschedules immediately and returns a single-line confirmation, no discussion (UX-DR12, AD-3)", async () => {
  const store = tempStore();
  const BLOCKER_NOW = new Date("2026-08-22T18:30:00.000Z");
  const today = localIsoDate(BLOCKER_NOW, TEST_TIME_ZONE);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  putPlan(store, blockerSamplePlan(today, BLOCKER_NOW.toISOString()));
  const tasks: Task[] = [makeTask("t1", "Blocked Task", { dueDate: today })];

  const result = await reportBlocker(
    { store, timeZone: TEST_TIME_ZONE, now: () => BLOCKER_NOW, readTasks: async () => tasks },
    {},
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply.includes("\n"), false, "must be a single line");
  assert.doesNotMatch(result.value.reply, /Today's Plan for/);
  assert.doesNotMatch(result.value.reply, /should|recommend|suggest|next time|try to|advice/i);
  assert.deepEqual(result.value.receipts, []);

  const updated = getPlan(store, today);
  assert.ok(updated);
  assert.equal(updated!.data.version, 2, "the Plan must be rescheduled immediately — no confirmation gate (AD-3)");
  assert.equal(
    store.listRecordsByKind("interaction-request").length,
    0,
    "no Proposal/interaction request may be opened for a Blocker report (AD-3 carve-out)",
  );
  store.close();
});

test("reportBlocker says so plainly when no Plan exists yet for today", async () => {
  const store = tempStore();
  const result = await reportBlocker(
    { store, timeZone: TEST_TIME_ZONE, now: () => new Date("2026-08-23T02:00:00.000Z"), readTasks: async () => [] },
    {},
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /no plan/i);
  store.close();
});

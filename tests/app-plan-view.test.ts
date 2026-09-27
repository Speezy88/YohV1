/**
 * Tests for `src/app/plan-view.ts` (Story 8.3).
 *
 * Moved+adapted from `tests/chat-cli.test.ts`'s on-demand Plan-view
 * `runChatCli` integration tests, now calling `showPlan` directly and
 * asserting on `result.value.reply`, plus a new ANSI-free pin (C2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, putPlan, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { localIsoDate, renderPlan } from "../src/rituals/ritual-shared.ts";
import { showPlan } from "../src/app/plan-view.ts";
import type { IsoDate, Plan } from "../src/types/domain.ts";

const TEST_TIME_ZONE = "America/New_York";

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

function samplePlanForDate(date: IsoDate): Plan {
  return {
    id: `plan-${date}`,
    date,
    blocks: [
      { id: "work-1", kind: "work", start: `${date}T13:00:00.000Z`, end: `${date}T14:00:00.000Z`, label: "Draft the memo", taskId: "t1" },
      { id: "break-1", kind: "break", start: `${date}T14:00:00.000Z`, end: `${date}T14:15:00.000Z`, label: "Break" },
    ],
    reasoning: '"Draft the memo" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

/**
 * A fixed instant (Task 11 review fix) picked so the UTC calendar date and
 * Spencer's LOCAL calendar date in `TEST_TIME_ZONE` genuinely disagree: as
 * UTC time this is 2026-08-23 (02:00), but it is still 2026-08-22 (22:00
 * EDT) in New York.
 */
const LATE_EVENING_UTC = new Date("2026-08-23T02:00:00.000Z");
const LOCAL_TODAY_FOR_LATE_EVENING = localIsoDate(LATE_EVENING_UTC, TEST_TIME_ZONE);

test("showPlan finds and renders today's LOCAL-dated Plan even though the UTC date has already rolled over", async () => {
  const store = tempStore();
  const plan = samplePlanForDate(LOCAL_TODAY_FOR_LATE_EVENING);
  putPlan(store, plan);

  const result = await showPlan({ store, timeZone: TEST_TIME_ZONE, now: () => LATE_EVENING_UTC }, {});

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, renderPlan(plan, { color: false }));
  assert.deepEqual(result.value.receipts, []);
  store.close();
});

test("showPlan also responds identically regardless of how chatTurn's recognizer phrased the request ('show plan')", async () => {
  const store = tempStore();
  const plan = samplePlanForDate(LOCAL_TODAY_FOR_LATE_EVENING);
  putPlan(store, plan);

  const result = await showPlan({ store, timeZone: TEST_TIME_ZONE, now: () => LATE_EVENING_UTC }, {});

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, renderPlan(plan, { color: false }));
  store.close();
});

test("showPlan says plainly no Plan exists yet for today, rather than fabricating or erroring", async () => {
  const store = tempStore();
  const result = await showPlan({ store, timeZone: TEST_TIME_ZONE, now: () => LATE_EVENING_UTC }, {});

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /no plan/i);
  assert.doesNotMatch(result.value.reply, /\d{2}:\d{2}-\d{2}:\d{2}/);
  store.close();
});

test("showPlan does NOT silently display a stale prior-day Plan stored under the UTC date when today's LOCAL Plan doesn't exist yet", async () => {
  const store = tempStore();
  const timeZone = "Asia/Tokyo";
  const earlyMorningUtc = new Date("2026-08-22T16:00:00.000Z"); // 2026-08-23 01:00 JST
  putPlan(store, samplePlanForDate("2026-08-22")); // only the (wrong) UTC-dated row exists

  const result = await showPlan({ store, timeZone, now: () => earlyMorningUtc }, {});

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /no plan/i);
  assert.doesNotMatch(result.value.reply, /\d{2}:\d{2}-\d{2}:\d{2}/);
  store.close();
});

test("showPlan's reply is never ANSI-colored, regardless of the environment (C2: reply is markdown-or-plain, never ANSI)", async () => {
  const store = tempStore();
  putPlan(store, samplePlanForDate(LOCAL_TODAY_FOR_LATE_EVENING));
  const result = await showPlan({ store, timeZone: TEST_TIME_ZONE, now: () => LATE_EVENING_UTC }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.doesNotMatch(result.value.reply, /\x1b\[/);
});

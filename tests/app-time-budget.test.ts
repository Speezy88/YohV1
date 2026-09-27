/**
 * Tests for `src/app/time-budget.ts` (Story 8.3).
 *
 * Moved+adapted from `tests/chat-cli.test.ts`'s `declareTimeBudget` unit
 * tests — now calling the `app/*.ts` function directly with an injected
 * `now`/`timeZone` rather than a bare `(store, minutes, today)` positional
 * call, and asserting on `result.value.receipt` (C3's pinned return shape
 * for this file, `Result<{receipt: string}>`) instead of a stored record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getCurrentTimeBudget, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { declareTimeBudget } from "../src/app/time-budget.ts";

const TEST_TIME_ZONE = "America/New_York";

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

test("declareTimeBudget persists a valid declaration as today's Time Budget and returns a confirmation naming the amount", async () => {
  const store = tempStore();
  const result = await declareTimeBudget(
    { store, timeZone: TEST_TIME_ZONE, now: () => new Date("2026-08-22T18:00:00.000Z") },
    { totalMinutes: 360 },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.receipt, /360|6h|6 hours?/i);

  const stored = getCurrentTimeBudget(store);
  assert.equal(stored?.data.totalMinutes, 360);
  assert.equal(stored?.data.date, "2026-08-22"); // localIsoDate in TEST_TIME_ZONE, not UTC
  store.close();
});

test("declareTimeBudget returns a validation error and persists nothing for an out-of-range amount", async () => {
  const store = tempStore();
  const result = await declareTimeBudget(
    { store, timeZone: TEST_TIME_ZONE, now: () => new Date("2026-08-22T18:00:00.000Z") },
    { totalMinutes: 1500 }, // > 24h
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.match(result.error.message, /couldn't|invalid|cannot/i);
  assert.equal(getCurrentTimeBudget(store), undefined);
  store.close();
});

test("declareTimeBudget called again for a later date replaces the prior value (still the one singleton row)", async () => {
  const store = tempStore();
  await declareTimeBudget({ store, timeZone: TEST_TIME_ZONE, now: () => new Date("2026-08-21T18:00:00.000Z") }, { totalMinutes: 360 });
  await declareTimeBudget({ store, timeZone: TEST_TIME_ZONE, now: () => new Date("2026-08-25T18:00:00.000Z") }, { totalMinutes: 240 });

  const stored = getCurrentTimeBudget(store);
  assert.equal(stored?.data.totalMinutes, 240);
  assert.equal(stored?.data.date, "2026-08-25");
  store.close();
});

test("declareTimeBudget formats an even-hour amount without decimals and a fractional one without a trailing zero", async () => {
  const store = tempStore();
  const deps = { store, timeZone: TEST_TIME_ZONE, now: () => new Date("2026-08-22T18:00:00.000Z") };
  const even = await declareTimeBudget(deps, { totalMinutes: 120 });
  const fractional = await declareTimeBudget(deps, { totalMinutes: 90 });
  assert.equal(even.ok, true);
  assert.equal(fractional.ok, true);
  if (even.ok) assert.match(even.value.receipt, /2h\b/);
  if (fractional.ok) assert.match(fractional.value.receipt, /1\.5h\b/);
  store.close();
});

/**
 * Tests for `src/app/desk.ts` (Ruling E12-R3): `recordActivity` stamps today's date in the host timezone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDesk, recordActivity } from "../src/app/desk.ts";

test("recordActivity records today's date in the host timezone, not UTC", async () => {
  const written: string[] = [];
  // 03:30 UTC on the 4th is still the 3rd in New York.
  const deps = { now: () => new Date("2026-10-04T03:30:00.000Z"), timeZone: "America/New_York", recordActivityDay: (d: string) => void written.push(d) };
  const result = await recordActivity(deps, {});
  assert.deepEqual(result, { ok: true, value: { date: "2026-10-03", timeZone: "America/New_York" } });
  // Just after local midnight.
  const after = await recordActivity({ ...deps, now: () => new Date("2026-10-04T04:30:00.000Z") }, {});
  assert.deepEqual(after, { ok: true, value: { date: "2026-10-04", timeZone: "America/New_York" } });
  assert.deepEqual(written, ["2026-10-03", "2026-10-04"]);
});

test("recordActivity turns a throwing dependency into an unreachable failure", async () => {
  const result = await recordActivity(
    { now: () => new Date("2026-10-04T12:00:00.000Z"), timeZone: "UTC", recordActivityDay: () => { throw new Error("SQLITE_BUSY: secret detail"); } },
    {},
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "unreachable");
    assert.doesNotMatch(result.error.message, /SQLITE/);
  }
});

const reads = {
  now: () => new Date("2026-10-07T18:00:00.000Z"),
  timeZone: "UTC",
  listCompletions: () => [
    { taskName: "Essay", dueDate: "2026-10-07", estimatedMinutes: 90, completedAt: "2026-10-07T15:00:00.000Z" },
    { taskName: "Old", dueDate: "2026-10-01", estimatedMinutes: null, completedAt: "2026-10-02T15:00:00.000Z" },
  ],
  listActivityDays: () => ["2026-10-06"],
  listPlanDates: () => ["2026-10-05", "2026-10-06"],
  listCloseOutDates: () => ["2026-10-05", "2026-10-06"],
  listUsage: () => [
    { at: "2026-10-02T00:00:00.000Z", model: "claude-haiku-4-5", inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    { at: "2026-10-03T00:00:00.000Z", model: "mystery", inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  ],
  log: () => {},
};

test("getDesk assembles the response from the reads", async () => {
  const logged: string[] = [];
  const result = await getDesk({ ...reads, log: (e) => void logged.push(e.event) }, {});
  assert.ok(result.ok);
  if (!result.ok) return;
  const v = result.value;
  assert.equal(v.today, "2026-10-07");
  assert.deepEqual(v.completedToday, [{ taskName: "Essay", completedAt: "2026-10-07T15:00:00.000Z" }]);
  assert.equal(v.minutesToday, 90);
  assert.equal(v.hoursWithYoh, 2);
  assert.deepEqual(v.onTime, { onTime: 1, counted: 2, percent: 50 });
  assert.deepEqual(v.streak, { current: 2, longest: 2 });
  assert.equal(v.heatmap.weeks.length, 26);
  const days = v.heatmap.weeks.flat();
  assert.equal(days.find((d) => d.date === "2026-10-07")!.level, 2);
  assert.equal(days.find((d) => d.date === "2026-10-06")!.level, 1);
  assert.deepEqual(v.spend, { monthUsd: 1, unpricedCalls: 1 });
  assert.deepEqual(logged, ["desk.unpriced-usage"]);
});

test("getDesk logs nothing when every call is priced", async () => {
  const logged: string[] = [];
  const result = await getDesk({ ...reads, listUsage: () => [], log: (e) => void logged.push(e.event) }, {});
  assert.ok(result.ok);
  assert.deepEqual(logged, []);
});

test("getDesk turns a throwing read into a failure with plain copy", async () => {
  const result = await getDesk({ ...reads, listCompletions: () => { throw new Error("SQLITE_CORRUPT: secret"); } }, {});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "unreachable");
    assert.doesNotMatch(result.error.message, /SQLITE/);
  }
});

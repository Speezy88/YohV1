/**
 * Tests for `src/app/desk.ts` (Ruling E12-R3): `recordActivity` stamps today's date in the host timezone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordActivity } from "../src/app/desk.ts";

test("recordActivity records today's date in the host timezone, not UTC", async () => {
  const written: string[] = [];
  // 03:30 UTC on the 4th is still the 3rd in New York.
  const deps = { now: () => new Date("2026-10-04T03:30:00.000Z"), timeZone: "America/New_York", recordActivityDay: (d: string) => void written.push(d) };
  const result = await recordActivity(deps, {});
  assert.deepEqual(result, { ok: true, value: { date: "2026-10-03" } });
  // Just after local midnight.
  const after = await recordActivity({ ...deps, now: () => new Date("2026-10-04T04:30:00.000Z") }, {});
  assert.deepEqual(after, { ok: true, value: { date: "2026-10-04" } });
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

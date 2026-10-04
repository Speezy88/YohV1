/**
 * Tests for `closeOutCompletedAt` (Ruling E12-R13): a close-out answered after its night is dated to that night.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeOutCompletedAt, localHm, localIsoDate } from "../src/core/local-time.ts";

const LA = "America/Los_Angeles";

test("answered the same night: the answer instant, unchanged", () => {
  const answer = new Date("2026-10-04T05:30:00.000Z"); // 22:30 on the 3rd in LA
  assert.equal(closeOutCompletedAt("2026-10-03", answer, LA), answer.toISOString());
});

test("answered an earlier local date than the close-out: unchanged", () => {
  const answer = new Date("2026-10-02T20:00:00.000Z");
  assert.equal(closeOutCompletedAt("2026-10-03", answer, LA), answer.toISOString());
});

test("answered the next morning: 23:59 local on the close-out's date", () => {
  const answer = new Date("2026-10-04T16:00:00.000Z"); // 09:00 on the 4th in LA
  const at = closeOutCompletedAt("2026-10-03", answer, LA);
  assert.equal(localIsoDate(new Date(at), LA), "2026-10-03");
  assert.equal(localHm(new Date(at), LA), "23:59");
});

test("DST change days in Los Angeles: still 23:59 local on the close-out's date", () => {
  for (const [date, morning] of [["2026-03-08", "2026-03-09T16:00:00.000Z"], ["2026-11-01", "2026-11-02T16:00:00.000Z"]] as const) {
    const at = closeOutCompletedAt(date, new Date(morning), LA);
    assert.equal(localIsoDate(new Date(at), LA), date);
    assert.equal(localHm(new Date(at), LA), "23:59");
  }
});

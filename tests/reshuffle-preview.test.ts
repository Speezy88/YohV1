import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESHUFFLE_PROPOSAL_TTL_MINUTES,
  buildReshuffleSummary,
  calendarVersionHash,
  diffPlanBlocks,
  isProposalExpired,
} from "../src/core/reshuffle-preview.ts";
import type { PlanBlock } from "../src/types/domain.ts";

const work = (id: string, taskId: string, start: string, end: string): PlanBlock => ({ id, kind: "work", taskId, start, end, label: taskId });

test("diffPlanBlocks separates moved, unchanged and newly placed work blocks", () => {
  const old = [work("a", "t1", "2026-09-28T15:00:00Z", "2026-09-28T15:30:00Z"), work("b", "t2", "2026-09-28T16:00:00Z", "2026-09-28T16:30:00Z")];
  const proposed = [
    work("v2-a", "t1", "2026-09-28T15:00:00Z", "2026-09-28T15:30:00Z"),
    work("v2-b", "t2", "2026-09-28T17:00:00Z", "2026-09-28T17:30:00Z"),
    work("v2-c", "t3", "2026-09-28T18:00:00Z", "2026-09-28T18:30:00Z"),
  ];
  const diff = diffPlanBlocks(old, proposed);
  assert.deepEqual(diff.unchangedBlockIds, ["v2-a"]);
  assert.deepEqual(diff.movedBlockIds, ["v2-b", "v2-c"]);
});

test("calendarVersionHash is stable under reordering and title edits, and changes when a start moves", () => {
  const e1 = { id: "e1", title: "A", start: "2026-09-28T15:00:00Z", end: "2026-09-28T16:00:00Z" };
  const e2 = { id: "e2", title: "B", start: "2026-09-28T17:00:00Z", end: "2026-09-28T18:00:00Z" };
  assert.equal(calendarVersionHash([e1, e2]), calendarVersionHash([e2, e1]));
  assert.equal(calendarVersionHash([e1, e2]), calendarVersionHash([{ ...e1, title: "Renamed" }, e2]));
  assert.notEqual(calendarVersionHash([e1, e2]), calendarVersionHash([e1, { ...e2, start: "2026-09-28T17:30:00Z" }]));
});

test("isProposalExpired flips at the TTL", () => {
  const created = "2026-09-28T15:00:00.000Z";
  const at = (min: number) => new Date(Date.parse(created) + min * 60_000);
  assert.equal(RESHUFFLE_PROPOSAL_TTL_MINUTES, 10);
  assert.equal(isProposalExpired(created, at(9)), false);
  assert.equal(isProposalExpired(created, at(10)), true);
});

test("buildReshuffleSummary names moves and deferred Tasks in one line", () => {
  const s = buildReshuffleSummary({ movedTitles: ["Write"], deferredTitles: ["Laundry"], needsDataCount: 0 });
  assert.match(s, /Write/);
  assert.match(s, /Laundry/);
  assert.equal(s.includes("\n"), false);
});

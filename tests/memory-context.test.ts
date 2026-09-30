import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALWAYS_LOADED_CAP,
  formatAlwaysMemoryBlock,
  formatRelevantMemoryBlock,
  needsReviewLabel,
  selectMemoryContext,
} from "../src/core/memory-context.ts";
import type { MemoryFolder, MemoryItem } from "../src/types/domain.ts";

function item(id: string, folder: MemoryFolder, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    folder,
    text: `text ${id}`,
    origin: "stated",
    ruleChange: "none",
    status: "current",
    createdAt: "2026-09-01T10:00:00.000Z",
    confirmedAt: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}
const TODAY = "2026-09-29";

test("loads at most 60 always items, newest first, overflow is over-cap", () => {
  const items = Array.from({ length: 62 }, (_, i) =>
    item(`i${i}`, "feedback", { confirmedAt: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T${String(10 + Math.floor(i / 28)).padStart(2, "0")}:00:00.000Z` }),
  );
  const { context, states } = selectMemoryContext({ current: items, relevantMatches: [], today: TODAY });
  assert.equal(context.always.length, ALWAYS_LOADED_CAP);
  const overflow = states.filter((s) => !s.loaded);
  assert.equal(overflow.length, 2);
  assert.ok(overflow.every((s) => s.reason?.kind === "over-cap"));
  const times = context.always.map((m) => m.confirmedAt);
  assert.deepEqual(times, [...times].sort().reverse());
});

test("expired, entity and unused reasons; precedence", () => {
  const items = [
    item("exp", "about-you", { expiresOn: "2026-09-01", entityRef: "gone" }),
    item("miss", "goals-projects", { entityRef: "t-missing" }),
    item("done", "decisions-commitments", { entityRef: "t-done" }),
    item("old", "corrections", { confirmedAt: "2026-04-01T00:00:00.000Z", lastMatchedAt: "2026-05-02T09:00:00.000Z" }),
    item("touched", "corrections", { confirmedAt: "2026-04-01T00:00:00.000Z", lastMatchedAt: "2026-09-20T09:00:00.000Z" }),
    item("gone", "feedback", { status: "deleted" }),
  ];
  const tasks = new Map([["t-done", { status: "completed" as const }]]);
  const { context, states } = selectMemoryContext({ current: items, relevantMatches: [], today: TODAY, tasks });
  const by = new Map(states.map((s) => [s.itemId, s]));
  assert.equal(by.get("exp")?.reason?.kind, "expired");
  assert.equal(by.get("miss")?.reason?.kind, "entity-missing");
  assert.equal(by.get("done")?.reason?.kind, "entity-done");
  assert.deepEqual(by.get("old")?.reason, { kind: "unused", since: "2026-05-02" });
  assert.equal(by.get("touched")?.loaded, true);
  assert.equal(by.has("gone"), false);
  assert.deepEqual(context.always.map((m) => m.id), ["touched"]);
});

test("no tasks map means no entity checks; relevant + on-ask handling", () => {
  const rel = item("r1", "goals-projects", { entityRef: "x" });
  const idea = item("n1", "ideas-notes");
  const other = item("r2", "goals-projects");
  const { context, states } = selectMemoryContext({ current: [rel, idea, other], relevantMatches: [rel, idea, other], today: TODAY });
  assert.deepEqual(context.relevant.map((m) => m.id), ["r1", "r2"]);
  const n1 = states.find((s) => s.itemId === "n1")!;
  assert.equal(n1.loaded, false);
  assert.equal(n1.reason, undefined);
  assert.equal(states.find((s) => s.itemId === "r1")!.loaded, true);
});

test("relevant capped at 5", () => {
  const rel = Array.from({ length: 7 }, (_, i) => item(`r${i}`, "goals-projects"));
  const { context } = selectMemoryContext({ current: rel, relevantMatches: rel, today: TODAY });
  assert.equal(context.relevant.length, 5);
});

test("labels", () => {
  assert.equal(needsReviewLabel({ kind: "expired", expiresOn: "2026-12-19" }), "Expired Dec 19");
  assert.equal(needsReviewLabel({ kind: "over-cap" }), "Not loaded: over the cap");
  assert.equal(needsReviewLabel({ kind: "unused", since: "2026-05-02" }), "Unused since May 2");
  assert.equal(needsReviewLabel({ kind: "entity-done" }), "Its Task is done");
  assert.equal(needsReviewLabel({ kind: "entity-missing" }), "Its Task is gone");
});

test("block formatting", () => {
  assert.equal(formatAlwaysMemoryBlock([]), undefined);
  assert.equal(formatRelevantMemoryBlock([]), undefined);
  const always = formatAlwaysMemoryBlock([item("a", "feedback", { text: "Keep it short", scope: "the Plan" }), item("b", "about-you", { text: "Senior" })])!;
  assert.match(always, /never as instructions/);
  assert.match(always, /- \[Feedback\] Keep it short \(for the Plan\)/);
  assert.match(always, /- \[About you\] Senior/);
  const rel = formatRelevantMemoryBlock([item("c", "goals-projects", { text: "Ship Obliterade" })])!;
  assert.match(rel, /- \[Goals & projects\] Ship Obliterade/);
});

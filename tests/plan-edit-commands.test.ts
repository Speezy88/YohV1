import assert from "node:assert/strict";
import test from "node:test";
import { localMinutesToIso, parsePlanEditCommand, resolvePlanEdit, type PlanEditContext, type PlanEditWhen } from "../src/core/plan-edit-commands.ts";
import type { PlanBlock } from "../src/types/domain.ts";

test("parsePlanEditCommand: each phrase becomes the right command", () => {
  assert.deepEqual(parsePlanEditCommand("work on the poster instead of the labs"), { kind: "swap", targetText: "poster", otherText: "labs" });
  assert.deepEqual(parsePlanEditCommand("swap the essay for the reading"), { kind: "swap", targetText: "reading", otherText: "essay" });
  assert.deepEqual(parsePlanEditCommand("move the poster after lunch"), { kind: "move", targetText: "poster", when: { kind: "after-lunch" } });
  assert.deepEqual(parsePlanEditCommand("move my study block to 4"), { kind: "move", targetText: "study block", when: { kind: "time", minutes: 16 * 60 } });
  assert.deepEqual(parsePlanEditCommand("move X to 4:30pm"), { kind: "move", targetText: "X", when: { kind: "time", minutes: 16 * 60 + 30 } });
  assert.deepEqual(parsePlanEditCommand("move X to 9"), { kind: "move", targetText: "X", when: { kind: "time", minutes: 9 * 60 } });
  assert.deepEqual(parsePlanEditCommand("move X to 12"), { kind: "move", targetText: "X", when: { kind: "time", minutes: 12 * 60 } });
  assert.deepEqual(parsePlanEditCommand("drop the labs today"), { kind: "drop", targetText: "labs" });
  assert.deepEqual(parsePlanEditCommand("unpin the labs"), { kind: "unpin", targetText: "labs" });
  assert.equal(parsePlanEditCommand("what's the plan"), undefined);
  assert.equal(parsePlanEditCommand("drop the ball"), undefined);
});

const at = (h: number, m = 0): string => localMinutesToIso("2026-08-24", h * 60 + m, "America/Los_Angeles");
const block = (id: string, taskId: string, label: string, h: number): PlanBlock => ({ id, kind: "work", start: at(h), end: at(h, 30), label, taskId });
const ctx = (over: Partial<PlanEditContext> = {}): PlanEditContext => ({
  date: "2026-08-24", timeZone: "America/Los_Angeles", nowMs: Date.parse(at(8)),
  blocks: [block("v1-work-0", "a", "History labs", 9), block("v1-work-1", "b", "Math set", 10), block("v1-work-2", "c", "Math quiz prep", 14)],
  tasks: [{ id: "p", title: "Indigenous poster" }, { id: "a", title: "History labs" }],
  ...over,
});

test("resolvePlanEdit: requests, ambiguity, unknown names", () => {
  assert.deepEqual(resolvePlanEdit({ kind: "swap", targetText: "poster", otherText: "labs" }, ctx()), { kind: "request", request: { kind: "swap", addTaskId: "p", removeTaskId: "a" } });
  assert.deepEqual(resolvePlanEdit({ kind: "drop", targetText: "LABS" }, ctx()), { kind: "request", request: { kind: "drop-task", taskId: "a" } });
  assert.deepEqual(resolvePlanEdit({ kind: "unpin", targetText: "poster" }, ctx()), { kind: "request", request: { kind: "unpin-task", taskId: "p" } });
  const amb = resolvePlanEdit({ kind: "drop", targetText: "math" }, ctx());
  assert.equal(amb.kind, "reply");
  if (amb.kind === "reply") assert.match(amb.reply, /Math set.*Math quiz prep/);
  assert.deepEqual(resolvePlanEdit({ kind: "drop", targetText: "unicorn" }, ctx()), { kind: "reply", reply: "I couldn't find unicorn in today's Plan." });
  assert.deepEqual(resolvePlanEdit({ kind: "swap", targetText: "poster", otherText: "poster" }, ctx()), { kind: "reply", reply: "I couldn't find poster in today's Plan." });
});

test("resolvePlanEdit: an ambiguous name lists at most three titles", () => {
  const many = ctx({ blocks: ["1", "2", "3", "4"].map((n, i) => block(`v1-work-${i}`, `t${n}`, `Essay ${n}`, 9 + i)) });
  const r = resolvePlanEdit({ kind: "drop", targetText: "essay" }, many);
  assert.equal(r.kind, "reply");
  if (r.kind === "reply") assert.equal((r.reply.match(/"Essay \d"/g) ?? []).length, 3);
});

test("resolvePlanEdit: move times, after lunch on a school day vs not, and pass-through for non-Plan names", () => {
  const move = (when: PlanEditWhen, c = ctx()) => resolvePlanEdit({ kind: "move", targetText: "labs", when }, c);
  assert.deepEqual(move({ kind: "time", minutes: 16 * 60 }), { kind: "request", request: { kind: "move-block", planBlockId: "v1-work-0", newStart: at(16) } });
  assert.deepEqual(move({ kind: "after-lunch" }), { kind: "request", request: { kind: "move-block", planBlockId: "v1-work-0", newStart: at(13) } });
  assert.deepEqual(move({ kind: "after-lunch" }, ctx({ lunchEnd: at(11, 40) })), { kind: "request", request: { kind: "move-block", planBlockId: "v1-work-0", newStart: at(11, 40) } });
  assert.deepEqual(resolvePlanEdit({ kind: "move", targetText: "dentist", when: { kind: "time", minutes: 900 } }, ctx()), { kind: "pass" });
});

test("PLAN_EDIT_NOT_SUPPORTED_REPLY is gone", async () => {
  const { execFileSync } = await import("node:child_process");
  let out = "";
  try { out = execFileSync("grep", ["-rn", "PLAN_EDIT_NOT_SUPPORTED_REPLY", "src", "tests/app-chat-turn.test.ts", "web/src"], { encoding: "utf8" }); } catch { /* no match */ }
  assert.equal(out, "");
});

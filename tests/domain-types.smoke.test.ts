/**
 * Compile-time smoke test for `src/types/domain.ts`.
 *
 * `domain.ts` is a type-only file (no runtime behavior), so its correctness
 * is verified by `tsc --noEmit` succeeding against this file: it imports and
 * constructs one value of every exported type/shape. If a later edit to
 * domain.ts silently breaks one of these shapes, `tsc --noEmit` fails here.
 * The `node:test` body below just re-asserts the same values at runtime so
 * this file also participates in `node --test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Area,
  CompleteTask,
  Energy,
  EscalationCurve,
  EscalationLevel,
  ExternalId,
  IsoDate,
  IsoDateTime,
  Plan,
  PlanBlock,
  PlanBlockKind,
  Proposal,
  Result,
  Task,
  TaskStatus,
  TimeBudget,
  YohError,
  YohErrorKind,
} from "../src/types/domain.ts";

const now: IsoDateTime = "2026-08-22T13:00:00.000Z";
const today: IsoDate = "2026-08-22";
const taskId: ExternalId = "notion-page-abc123";

const area: Area = "Work";
const energy: Energy = "medium";
const status: TaskStatus = "not-started";

const task: Task = {
  id: taskId,
  title: "Write the domain types",
  estimatedDurationMinutes: 90,
  area,
  dueDate: today,
  status,
  energy,
  createdAt: now,
  updatedAt: now,
};

const taskMissingFields: Task = {
  id: "notion-page-def456",
  title: "A task Notion hasn't fully filled in yet",
  createdAt: now,
  updatedAt: now,
};

const completeTask: CompleteTask = {
  id: taskId,
  title: task.title,
  estimatedDurationMinutes: 90,
  area,
  dueDate: today,
  status: "completed",
  energy,
  createdAt: now,
  updatedAt: now,
};

const blockKind: PlanBlockKind = "work";

const workBlock: PlanBlock = {
  id: "block-1",
  kind: blockKind,
  start: now,
  end: "2026-08-22T14:30:00.000Z",
  taskId,
  label: task.title,
};

const breakBlock: PlanBlock = {
  id: "block-2",
  kind: "break",
  start: "2026-08-22T14:30:00.000Z",
  end: "2026-08-22T14:45:00.000Z",
  label: "Break",
};

const anchorBlock: PlanBlock = {
  id: "block-3",
  kind: "calendar-anchor",
  start: "2026-08-22T15:00:00.000Z",
  end: "2026-08-22T16:00:00.000Z",
  label: "Team standup",
};

const plan: Plan = {
  id: "plan-2026-08-22",
  date: today,
  blocks: [workBlock, breakBlock, anchorBlock],
  reasoning: "Closest due date first, fitted around today's fixed meetings.",
  version: 1,
  createdAt: now,
  updatedAt: now,
};

const timeBudget: TimeBudget = {
  date: today,
  totalMinutes: 480,
  workMinutes: 70,
  breakMinutes: 15,
};

const proposal: Proposal<TimeBudget> = {
  id: "proposal-1",
  kind: "time-budget-change",
  entityId: today,
  entityVersion: now,
  suggested: { ...timeBudget, totalMinutes: 420 },
  reason: "The last 5 days consistently ran ~60 minutes under the declared budget.",
  createdAt: now,
};

const escalationCurve: EscalationCurve = {
  cap: 3,
  step: 1,
};

const escalationLevel: EscalationLevel = {
  value: 2,
  atCap: false,
};

const errorKind: YohErrorKind = "stale-proposal";

const yohError: YohError = {
  kind: errorKind,
  message: "Proposal entityVersion no longer matches the live entity.",
};

const okResult: Result<Plan, YohError> = { ok: true, value: plan };
const failResult: Result<Plan, YohError> = { ok: false, error: yohError };

test("domain.ts exported types each construct a valid value", () => {
  assert.equal(task.id, taskId);
  assert.equal(taskMissingFields.area, undefined);
  assert.equal(completeTask.status, "completed");
  assert.equal(plan.blocks.length, 3);
  assert.equal(plan.blocks[0]?.id, "block-1");
  assert.equal(timeBudget.workMinutes + timeBudget.breakMinutes, 85);
  assert.equal(proposal.suggested.totalMinutes, 420);
  assert.equal(escalationCurve.cap, 3);
  assert.equal(escalationLevel.atCap, false);
  assert.equal(okResult.ok, true);
  assert.equal(failResult.ok, false);
  if (!failResult.ok) {
    assert.equal(failResult.error.kind, "stale-proposal");
  }

  const allErrorKinds: YohErrorKind[] = [
    "missing-field",
    "auth-expired",
    "unreachable",
    "rate-limited",
    "validation",
    "stale-proposal",
    "conflict",
  ];
  assert.equal(allErrorKinds.length, 7);
});

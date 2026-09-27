/**
 * Tests for `src/core/data-completeness-gate.ts` (Story 1.5 / Task 5, AD-11;
 * reshaped into a two-tier gate by Story 9.1, AD-11 amended 2026-09-27).
 *
 * Per AD-2/AD-8, this is a pure `core/*.ts` function: no I/O, no
 * module-level state, `Result<T, YohError>`, never throws. These tests
 * exercise it purely in-process with hand-built `Task` fixtures — no
 * `MemoryStore` or any adapter involved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDataCompleteness, type MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import type { CompleteTask, Task } from "../src/types/domain.ts";

const NOW = "2026-08-22T12:00:00.000Z";

function makeCompleteTaskFields(): Omit<Task, "id" | "title" | "createdAt" | "updatedAt"> {
  return {
    estimatedDurationMinutes: 30,
    area: "Work",
    dueDate: "2026-08-23",
    status: "not-started",
    energy: "medium",
  };
}

/**
 * Overrides for just Task's optional fields (the five planning fields plus
 * `projectId`) — deliberately excludes the required fields (`id`, `title`,
 * `createdAt`, `updatedAt`) so this type permits explicitly setting a field
 * to `undefined` (to simulate a missing field) under
 * `exactOptionalPropertyTypes`, without widening a required field's type.
 */
type TaskOverrides = {
  [K in "estimatedDurationMinutes" | "area" | "dueDate" | "status" | "energy" | "projectId"]?: Task[K] | undefined;
};

function makeTask(id: string, title: string, overrides: TaskOverrides = {}): Task {
  return {
    id,
    title,
    createdAt: NOW,
    updatedAt: NOW,
    ...makeCompleteTaskFields(),
    ...overrides,
  } as Task;
}

test("a Task with both Required Fields present produces a CompleteTask, with Area/Energy wrapped Refining<T>", () => {
  const task = makeTask("task-1", "Write report");
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.incomplete.length, 0);
  assert.equal(result.value.completeTasks.length, 1);
  const complete: CompleteTask = result.value.completeTasks[0]!;
  assert.equal(complete.id, "task-1");
  assert.equal(complete.estimatedDurationMinutes, 30);
  assert.equal(complete.dueDate, "2026-08-23");
  assert.equal(complete.status, "not-started");
  assert.deepEqual(complete.area, { kind: "set", value: "Work" });
  assert.deepEqual(complete.energy, { kind: "set", value: "medium" });
});

test("a Task missing Area only (a Refining Field) is FULLY ELIGIBLE — placed in completeTasks with area {kind:'missing'}, never in incomplete", () => {
  const task = makeTask("task-2", "Call dentist", { area: undefined });
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.incomplete.length, 0);
  assert.equal(result.value.completeTasks.length, 1);
  assert.deepEqual(result.value.completeTasks[0]!.area, { kind: "missing" });
  assert.deepEqual(result.value.completeTasks[0]!.energy, { kind: "set", value: "medium" });
});

test("a Task missing BOTH Refining Fields (Area AND Energy) is still fully eligible, with both wrapped {kind:'missing'} (Review Focus #1)", () => {
  const task = makeTask("task-2b", "Water the plants", { area: undefined, energy: undefined });
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.incomplete.length, 0);
  assert.equal(result.value.completeTasks.length, 1);
  assert.deepEqual(result.value.completeTasks[0]!.area, { kind: "missing" });
  assert.deepEqual(result.value.completeTasks[0]!.energy, { kind: "missing" });
});

test("a Task with an empty Status is treated as eligible, not gated — Status is not in the gate's field list at all (AC5, [PRD ASSUMPTION, adopted])", () => {
  const task = makeTask("task-2c", "File taxes", { status: undefined });
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.incomplete.length, 0);
  assert.equal(result.value.completeTasks.length, 1);
  assert.equal(result.value.completeTasks[0]!.status, undefined);
});

test("a Task missing a Required Field (Due Date) is NOT placed and does not become a CompleteTask", () => {
  const task = makeTask("task-3", "Plan trip", { dueDate: undefined });
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.completeTasks.length, 0);
  assert.equal(result.value.incomplete.length, 1);
  const report: MissingFieldReport = result.value.incomplete[0]!;
  assert.equal(report.taskId, "task-3");
  assert.deepEqual(report.missingFields, ["dueDate"]);
});

test("a Task missing both Required Fields reports both, in the fixed order, and Refining/Status fields never appear in missingFields", () => {
  const task = makeTask("task-3b", "Ship the release", {
    estimatedDurationMinutes: undefined,
    dueDate: undefined,
    area: undefined,
    energy: undefined,
    status: undefined,
  });
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.incomplete.length, 1);
  assert.deepEqual(result.value.incomplete[0]!.missingFields, ["estimatedDurationMinutes", "dueDate"]);
});

test("a Task missing a Required Field AND a Refining Field is reported ONLY in incomplete — never double-counted into completeTasks too (Review Focus #5)", () => {
  const task = makeTask("task-3c", "Renew the passport", { dueDate: undefined, area: undefined });
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.completeTasks.length, 0);
  assert.equal(result.value.incomplete.length, 1);
  assert.deepEqual(result.value.incomplete[0]!.missingFields, ["dueDate"]);
});

test("mixed candidate set: Required-complete Tasks (Refining Fields present or missing alike) produce CompleteTask; Required-incomplete Tasks do not, each independently", () => {
  const complete1 = makeTask("task-4", "Complete one");
  const refiningOnlyMissing = makeTask("task-4b", "Refining-only missing", { area: undefined });
  const incomplete1 = makeTask("task-5", "Incomplete one", { estimatedDurationMinutes: undefined });
  const complete2 = makeTask("task-6", "Complete two");
  const incomplete2 = makeTask("task-7", "Incomplete two", { dueDate: undefined });

  const result = checkDataCompleteness([complete1, refiningOnlyMissing, incomplete1, complete2, incomplete2]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.completeTasks.map((t) => t.id),
    ["task-4", "task-4b", "task-6"],
  );
  assert.deepEqual(
    result.value.incomplete.map((r) => r.taskId),
    ["task-5", "task-7"],
  );
});

test("an empty candidate set produces no complete Tasks and no incomplete reports", () => {
  const result = checkDataCompleteness([]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.completeTasks, []);
  assert.deepEqual(result.value.incomplete, []);
});

test("projectId, an unrelated optional field, never counts as a missing field", () => {
  const task = makeTask("task-8", "Has no project", { projectId: undefined });
  const result = checkDataCompleteness([task]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.completeTasks.length, 1);
  assert.equal(result.value.incomplete.length, 0);
});

test("two Tasks sharing the same id is rejected as a validation error rather than silently processed", () => {
  const taskA = makeTask("dup", "First");
  const taskB = makeTask("dup", "Second");
  const result = checkDataCompleteness([taskA, taskB]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("never throws, even on an empty-string id/title", () => {
  assert.doesNotThrow(() => {
    const result = checkDataCompleteness([makeTask("", "")]);
    assert.equal(result.ok, true);
  });
});

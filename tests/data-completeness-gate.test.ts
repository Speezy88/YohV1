/**
 * Tests for `src/core/data-completeness-gate.ts` (Story 1.5 / Task 5, AD-11).
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
 * to `undefined` (to simulate a missing planning field) under
 * `exactOptionalPropertyTypes`, without widening a required field's type.
 */
type TaskOverrides = {
  [K in "estimatedDurationMinutes" | "area" | "dueDate" | "status" | "energy" | "projectId"]?: Task[K] | undefined;
};

function makeTask(id: string, title: string, overrides: TaskOverrides = {}): Task {
  // `exactOptionalPropertyTypes` treats a spread-merged `field: T | undefined`
  // as incompatible with `Task`'s own `field?: T` even though, at runtime,
  // an explicit `undefined` and an absent key are indistinguishable to
  // `checkDataCompleteness`'s `task[field] === undefined` check (which is
  // exactly what this fixture builder exists to exercise) — the cast below
  // is a test-fixture-only escape hatch for that static/runtime mismatch,
  // not a widening of `Task` itself.
  return {
    id,
    title,
    createdAt: NOW,
    updatedAt: NOW,
    ...makeCompleteTaskFields(),
    ...overrides,
  } as Task;
}

test("a Task with all 5 planning fields present produces a CompleteTask", () => {
  const task = makeTask("task-1", "Write report");
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.incomplete.length, 0);
  assert.equal(result.value.completeTasks.length, 1);
  const complete: CompleteTask = result.value.completeTasks[0]!;
  assert.equal(complete.id, "task-1");
  assert.equal(complete.estimatedDurationMinutes, 30);
  assert.equal(complete.area, "Work");
  assert.equal(complete.dueDate, "2026-08-23");
  assert.equal(complete.status, "not-started");
  assert.equal(complete.energy, "medium");
});

test("a Task missing one planning field does not produce a CompleteTask", () => {
  const task = makeTask("task-2", "Call dentist", { area: undefined });
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.completeTasks.length, 0);
  assert.equal(result.value.incomplete.length, 1);
  const report: MissingFieldReport = result.value.incomplete[0]!;
  assert.equal(report.taskId, "task-2");
  assert.equal(report.taskTitle, "Call dentist");
  assert.deepEqual(report.missingFields, ["area"]);
});

test("a Task missing multiple planning fields reports every missing field, in stable order", () => {
  const task = makeTask("task-3", "Plan trip", { dueDate: undefined, energy: undefined, status: undefined });
  const result = checkDataCompleteness([task]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.incomplete.length, 1);
  assert.deepEqual(result.value.incomplete[0]!.missingFields, ["dueDate", "status", "energy"]);
});

test("mixed candidate set: complete Tasks produce CompleteTask, incomplete Tasks do not, each independently", () => {
  const complete1 = makeTask("task-4", "Complete one");
  const incomplete1 = makeTask("task-5", "Incomplete one", { estimatedDurationMinutes: undefined });
  const complete2 = makeTask("task-6", "Complete two");
  const incomplete2 = makeTask("task-7", "Incomplete two", { status: undefined });

  const result = checkDataCompleteness([complete1, incomplete1, complete2, incomplete2]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.completeTasks.map((t) => t.id),
    ["task-4", "task-6"],
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

test("projectId, an unrelated optional field, never counts as a missing planning field", () => {
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

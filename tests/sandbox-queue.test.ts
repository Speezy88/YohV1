import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, mergeTaskFieldOverride, type MemoryStore } from "../src/adapters/memory-store.ts";
import { sandboxQueue } from "../src/app/sandbox-queue.ts";
import { firstCardView } from "../src/core/sandbox-card-view.ts";
import type { Task } from "../src/types/domain.ts";

function tempStore(): MemoryStore {
  return createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
}

const NOW = () => new Date("2026-09-27T15:00:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Untitled",
    createdAt: NOW().toISOString(),
    updatedAt: NOW().toISOString(),
    ...overrides,
  };
}

test("sandboxQueue: a Task missing Due Date appears, with its other present fields carried through for pre-fill", async () => {
  const store = tempStore();
  const readTasks = async () => [task({ id: "t1", title: "Chem problem set", estimatedDurationMinutes: 45, area: "School" })];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC" }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.items, [
    { taskId: "t1", taskTitle: "Chem problem set", estimatedDurationMinutes: 45, area: "School", missingFields: ["dueDate"] },
  ]);
});

test("sandboxQueue: soonest-due-first, no-due-date last, ties broken by title", async () => {
  const store = tempStore();
  // Every Task below is missing estimatedDurationMinutes (always incomplete);
  // dueDate varies to prove the ordering rule.
  const readTasks = async () => [
    task({ id: "a", title: "Bravo", dueDate: "2026-09-30" }),
    task({ id: "b", title: "Alpha", dueDate: "2026-09-30" }), // ties with "a"; "Alpha" sorts first
    task({ id: "c", title: "No Date Task" }),
    task({ id: "d", title: "Soonest", dueDate: "2026-09-28" }),
  ];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC" }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.items.map((i) => i.taskId),
    ["d", "b", "a", "c"],
  );
});

test("sandboxQueue: input.exclude removes taskIds from the result", async () => {
  const store = tempStore();
  const readTasks = async () => [task({ id: "t1", title: "One" }), task({ id: "t2", title: "Two" })];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC" }, { exclude: ["t1"] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.items.map((i) => i.taskId),
    ["t2"],
  );
});

// Review Focus #2 — this is the one place Task 1's reshape must actually reach /sandbox.
test("sandboxQueue: a Task missing ONLY Area/Energy (both Required fields present) is never queued (FR-36)", async () => {
  const store = tempStore();
  const readTasks = async () => [
    task({ id: "complete", title: "Fully complete", dueDate: "2026-09-28", estimatedDurationMinutes: 30, area: "School", energy: "medium" }),
    task({ id: "refining-only", title: "Missing only Area/Energy", dueDate: "2026-09-28", estimatedDurationMinutes: 30 }),
    task({ id: "required-missing", title: "Missing Due Date", estimatedDurationMinutes: 30, area: "School", energy: "medium" }),
  ];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC" }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.items.map((i) => i.taskId),
    ["required-missing"],
  );
});

test("sandboxQueue: merges a stored TaskFieldOverride before gating — a previously-answered field counts", async () => {
  const store = tempStore();
  mergeTaskFieldOverride(store, "t1", { dueDate: "2026-09-29" });
  const readTasks = async () => [task({ id: "t1", title: "Answered already", estimatedDurationMinutes: 30 })];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC" }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.items, []);
});

test("sandboxQueue: a readTasks failure is reported as a clear Result failure, never throws", async () => {
  const store = tempStore();
  const readTasks = async (): Promise<readonly Task[]> => {
    throw new Error("notion down");
  };
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC" }, {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
});

test("firstCardView: undefined for an empty queue; the first item with remaining = items.length - 1 otherwise", () => {
  assert.equal(firstCardView([]), undefined);
  const view = firstCardView([
    { taskId: "t1", taskTitle: "One", missingFields: ["dueDate"] },
    { taskId: "t2", taskTitle: "Two", missingFields: ["dueDate"] },
    { taskId: "t3", taskTitle: "Three", missingFields: ["dueDate"] },
  ]);
  assert.deepEqual(view, { taskId: "t1", taskTitle: "One", missingFields: ["dueDate"], remaining: 2 });
});

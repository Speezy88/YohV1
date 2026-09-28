import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, mergeTaskFieldOverride, type MemoryStore } from "../src/adapters/memory-store.ts";
import { sandboxQueue } from "../src/app/sandbox-queue.ts";
import { firstCardView } from "../src/core/sandbox-card-view.ts";
import type { SandboxCardOptions } from "../src/types/api.ts";
import type { LogEntry } from "../src/adapters/logger.ts";
import type { Task, TaskFieldOptions } from "../src/types/domain.ts";

const EMPTY_OPTIONS: SandboxCardOptions = { area: [], energy: [] };

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

test("sandboxQueue: a completed Task missing Due Date is never queued (final-review MUST-FIX 1)", async () => {
  const store = tempStore();
  const readTasks = async () => [
    task({ id: "done", title: "Already finished", status: "completed", estimatedDurationMinutes: 30 }),
    task({ id: "open", title: "Still open", estimatedDurationMinutes: 30 }),
  ];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC" }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.items.map((i) => i.taskId),
    ["open"],
  );
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
  assert.equal(firstCardView([], EMPTY_OPTIONS), undefined);
  const view = firstCardView(
    [
      { taskId: "t1", taskTitle: "One", missingFields: ["dueDate"] },
      { taskId: "t2", taskTitle: "Two", missingFields: ["dueDate"] },
      { taskId: "t3", taskTitle: "Three", missingFields: ["dueDate"] },
    ],
    EMPTY_OPTIONS,
  );
  // Chunk 9.2-B fix: `firstCardView` picks only `SandboxCardView`'s own
  // fields — `missingFields` (a `SandboxQueueItem`-only field) must never
  // leak onto the wire shape.
  assert.deepEqual(view, { taskId: "t1", taskTitle: "One", remaining: 2, options: EMPTY_OPTIONS });
});

// Task 5 (polish-5): SandboxCard Area/Energy as live-option selects —
// sandboxQueue's own options-read seam.
test("sandboxQueue: options come from readFieldOptions, alongside items", async () => {
  const store = tempStore();
  const readTasks = async () => [task({ id: "t1", title: "One" })];
  const readFieldOptions = async (): Promise<TaskFieldOptions> => ({
    area: ["School", "Personal"],
    energy: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    status: [{ value: "not-started", label: "Not started" }],
  });
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC", readFieldOptions }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.options, {
    area: ["School", "Personal"],
    energy: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  });
});

test("sandboxQueue: readFieldOptions absent gives empty option lists; the card is still produced", async () => {
  const store = tempStore();
  const readTasks = async () => [task({ id: "t1", title: "One" })];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC" }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.options, EMPTY_OPTIONS);
  assert.equal(result.value.items.length, 1);
});

test("sandboxQueue: an options read failure gives empty option lists, logs a warn, and the queue's items are unaffected", async () => {
  const store = tempStore();
  const readTasks = async () => [task({ id: "t1", title: "One" })];
  const readFieldOptions = async (): Promise<TaskFieldOptions> => {
    throw new Error("notion down");
  };
  const logs: LogEntry[] = [];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC", readFieldOptions, log: (e) => logs.push(e) }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.options, EMPTY_OPTIONS);
  assert.equal(result.value.items.length, 1);
  assert.equal(logs.some((l) => l.level === "warn" && l.event === "sandbox-queue.options-read-failed"), true);
});

test("sandboxQueue: readFieldOptions returning area: undefined gives an empty Area list but keeps Energy's own options, and logs a warn", async () => {
  const store = tempStore();
  const readTasks = async () => [task({ id: "t1", title: "One" })];
  const readFieldOptions = async (): Promise<TaskFieldOptions> => ({
    area: undefined,
    energy: [{ value: "low", label: "Low" }],
    status: [],
  });
  const logs: LogEntry[] = [];
  const result = await sandboxQueue({ store, readTasks, now: NOW, timeZone: "UTC", readFieldOptions, log: (e) => logs.push(e) }, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.options, { area: [], energy: [{ value: "low", label: "Low" }] });
  assert.equal(logs.some((l) => l.level === "warn" && l.event === "sandbox-queue.options-area-undefined"), true);
});

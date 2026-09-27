import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, tailOutboxSince, getMaxOutboxSeq } from "../src/adapters/notification-store.ts";
import { submitSandboxCard, type SandboxSubmitDeps } from "../src/app/sandbox-submit.ts";
import type { Task } from "../src/types/domain.ts";

const NOW = () => new Date("2026-09-27T15:00:00.000Z");

function tempConnection() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return connection;
}

const TASKS: readonly Task[] = [
  { id: "t1", title: "Chem problem set", createdAt: NOW().toISOString(), updatedAt: NOW().toISOString() },
];

function makeUpdateTaskFieldFake(rejectFields: readonly string[] = []) {
  const calls: Array<{ taskId: string; field: string; value: unknown }> = [];
  const fn: SandboxSubmitDeps["updateTaskField"] = async (taskId, field, value) => {
    calls.push({ taskId, field, value });
    if (rejectFields.includes(field)) {
      return { ok: false, error: { kind: "validation", message: `notion-adapter: no existing option matches "${String(value)}"` } };
    }
    return { ok: true, value: undefined };
  };
  return { calls, fn };
}

function baseDeps(overrides: Partial<SandboxSubmitDeps> = {}): SandboxSubmitDeps {
  const connection = tempConnection();
  return {
    readTasks: async () => TASKS,
    updateTaskField: makeUpdateTaskFieldFake().fn,
    connection,
    now: NOW,
    ...overrides,
  };
}

test("submitSandboxCard: writes Due Date and Estimated Duration, appends one tasks outbox hint, returns a receipt", async () => {
  const updateTaskField = makeUpdateTaskFieldFake();
  const deps = baseDeps({ updateTaskField: updateTaskField.fn });
  const before = getMaxOutboxSeq(deps.connection);
  const result = await submitSandboxCard(deps, { taskId: "t1", dueDate: "2026-09-30", estimatedDurationMinutes: "45" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.taskId, "t1");
  assert.equal(result.value.taskTitle, "Chem problem set");
  assert.match(result.value.receipt, /Due Date/);
  assert.match(result.value.receipt, /Estimated Duration/);
  assert.deepEqual(
    updateTaskField.calls.map((c) => c.field),
    ["dueDate", "estimatedDurationMinutes"],
  );
  assert.deepEqual(
    tailOutboxSince(deps.connection, before).map((h) => h.topic),
    ["tasks"],
  );
  deps.connection.close();
});

test("submitSandboxCard: Area and Energy, when present, are written BEFORE Due Date/Estimated Duration", async () => {
  const updateTaskField = makeUpdateTaskFieldFake();
  const deps = baseDeps({ updateTaskField: updateTaskField.fn });
  const result = await submitSandboxCard(deps, {
    taskId: "t1",
    dueDate: "2026-09-30",
    estimatedDurationMinutes: "45",
    area: "School",
    energy: "low",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    updateTaskField.calls.map((c) => c.field),
    ["area", "energy", "dueDate", "estimatedDurationMinutes"],
  );
  deps.connection.close();
});

test("submitSandboxCard: a malformed Due Date is rejected before ANY write is attempted", async () => {
  const updateTaskField = makeUpdateTaskFieldFake();
  const deps = baseDeps({ updateTaskField: updateTaskField.fn });
  const result = await submitSandboxCard(deps, { taskId: "t1", dueDate: "not a date", estimatedDurationMinutes: "45" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(updateTaskField.calls.length, 0);
  deps.connection.close();
});

// Review Focus #1 — the whole-card, not per-field, "writes nothing" guarantee.
test("submitSandboxCard: an unresolvable Area is refused by the live select-guard and Due Date/Estimated Duration are never even attempted (Review Focus #1)", async () => {
  const updateTaskField = makeUpdateTaskFieldFake(["area"]);
  const deps = baseDeps({ updateTaskField: updateTaskField.fn });
  const result = await submitSandboxCard(deps, {
    taskId: "t1",
    dueDate: "2026-09-30",
    estimatedDurationMinutes: "45",
    area: "Not A Real Area",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.deepEqual(
    updateTaskField.calls.map((c) => c.field),
    ["area"],
    "dueDate/estimatedDurationMinutes must never be attempted once area's write fails",
  );
  deps.connection.close();
});

test("submitSandboxCard: a Task that no longer exists in the live read is a clear validation failure, not a Notion call", async () => {
  const updateTaskField = makeUpdateTaskFieldFake();
  const deps = baseDeps({ readTasks: async () => [], updateTaskField: updateTaskField.fn });
  const result = await submitSandboxCard(deps, { taskId: "gone", dueDate: "2026-09-30", estimatedDurationMinutes: "45" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(updateTaskField.calls.length, 0);
  deps.connection.close();
});

test("submitSandboxCard: a readTasks failure is reported as a clear Result failure, never throws", async () => {
  const deps = baseDeps({
    readTasks: async () => {
      throw new Error("notion down");
    },
  });
  const result = await submitSandboxCard(deps, { taskId: "t1", dueDate: "2026-09-30", estimatedDurationMinutes: "45" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  deps.connection.close();
});

test("submitSandboxCard: a thrown updateTaskField is caught and returned as a Result failure, never an unhandled throw", async () => {
  const deps = baseDeps({
    updateTaskField: async () => {
      throw new Error("network blip");
    },
  });
  const result = await submitSandboxCard(deps, { taskId: "t1", dueDate: "2026-09-30", estimatedDurationMinutes: "45" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  deps.connection.close();
});

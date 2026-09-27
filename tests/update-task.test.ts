/**
 * Tests for `src/app/update-task.ts` (Task 6B): an inline edit on the Tasks
 * page is FR-24's direct write — the raw value is parsed by the ONE
 * planning-field parser, written through `updateTaskField` (select guard
 * intact, via the adapter's own `bindNotionTaskWrites`), acknowledged with a
 * one-line receipt, and announced with one outbox hint. A failure is a
 * plain sentence and sends no hint.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { getMaxOutboxSeq, initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { bindNotionTaskWrites, readTaskFieldOptions } from "../src/adapters/notion-adapter.ts";
import { renameTask, updateTask, type UpdateTaskDeps } from "../src/app/update-task.ts";
import { createFakeNotionTasksDb, type FakeTasksDb } from "./fakes/fake-notion-tasks-db.ts";

function setup(): { db: FakeTasksDb; connection: SqliteConnection; deps: UpdateTaskDeps } {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "Calc set", area: "Math", status: "Nothing" }] });
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const writes = bindNotionTaskWrites(() => ({ ok: true, value: { client: db.client, config: { tasksDataSourceId: "tasks-ds" } } }));
  const deps: UpdateTaskDeps = {
    updateTaskField: writes.updateTaskField,
    updateTaskTitle: writes.updateTaskTitle,
    readFieldOptions: () => readTaskFieldOptions(db.client, { tasksDataSourceId: "tasks-ds" }),
    connection,
  };
  return { db, connection, deps };
}

test("each field writes through updateTaskField with its parsed, typed value", async () => {
  const { db, deps } = setup();
  assert.ok((await updateTask(deps, { taskId: "t1", field: "dueDate", value: "2026-10-02" })).ok);
  assert.ok((await updateTask(deps, { taskId: "t1", field: "estimatedDurationMinutes", value: "45" })).ok);
  assert.ok((await updateTask(deps, { taskId: "t1", field: "area", value: "Bio" })).ok);
  assert.ok((await updateTask(deps, { taskId: "t1", field: "energy", value: "high" })).ok);
  assert.ok((await updateTask(deps, { taskId: "t1", field: "status", value: "in-progress" })).ok);
  assert.deepEqual(db.rows()[0], { id: "t1", title: "Calc set", area: "Bio", status: "In Progress", dueDate: "2026-10-02", minutes: 45, energy: "Deep" });
});

test("receipts are human-readable: a real date, minutes, and the LIVE Notion labels for Energy and Status", async () => {
  const { deps } = setup();
  const receipt = async (field: Parameters<typeof updateTask>[1]["field"], value: string): Promise<string> => {
    const result = await updateTask(deps, { taskId: "t1", field, value });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value.receipt;
  };
  assert.equal(await receipt("dueDate", "2026-10-02"), "Due Date set to Fri, Oct 2.");
  assert.equal(await receipt("estimatedDurationMinutes", "45"), "Estimated Duration set to 45 min.");
  assert.equal(await receipt("area", "Bio"), "Area set to Bio.");
  assert.equal(await receipt("energy", "high"), "Energy set to Deep.");
  assert.equal(await receipt("energy", "medium"), "Energy set to Medium.");
  assert.equal(await receipt("status", "not-started"), "Status set to Nothing.");
  assert.equal(await receipt("status", "in-progress"), "Status set to In Progress.");
});

test("without the live options, Energy and Status receipts still read as words, never enums", async () => {
  const { deps } = setup();
  const bare: UpdateTaskDeps = { ...deps, readFieldOptions: async () => { throw new Error("down"); } };
  const energy = await updateTask(bare, { taskId: "t1", field: "energy", value: "low" });
  assert.ok(energy.ok);
  assert.equal(energy.value.receipt, "Energy set to Low.");
  const status = await updateTask(bare, { taskId: "t1", field: "status", value: "in-progress" });
  assert.ok(status.ok);
  assert.equal(status.value.receipt, "Status set to In progress.");
});

test("Status -> Completed is never a direct write here: it must go through check-off (AD-20: Undo window + Completion Log)", async () => {
  const { db, deps } = setup();
  const result = await updateTask(deps, { taskId: "t1", field: "status", value: "completed" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(db.updates.length, 0);
});

test("renameTask writes the trimmed title through updateTaskTitle, with a receipt and one hint", async () => {
  const { db, deps, connection } = setup();
  const start = getMaxOutboxSeq(connection);
  const result = await renameTask(deps, { taskId: "t1", title: "  Calc problem set 4 " });
  assert.ok(result.ok);
  assert.equal(result.value.receipt, 'Renamed to "Calc problem set 4".');
  assert.equal(db.rows()[0]!.title, "Calc problem set 4");
  assert.deepEqual(tailOutboxSince(connection, start).map((h) => h.topic), ["tasks"]);
});

test("renameTask refuses a blank title and reports a Notion outage plainly", async () => {
  const { db, deps } = setup();
  const blank = await renameTask(deps, { taskId: "t1", title: "  " });
  assert.equal(blank.ok, false);
  if (blank.ok) return;
  assert.equal(blank.error.message, "A Task's title can't be blank.");
  db.setFailingWrites(true);
  const down = await renameTask(deps, { taskId: "t1", title: "New" });
  assert.equal(down.ok, false);
  if (down.ok) return;
  assert.equal(down.error.message, "I couldn't reach Notion right now; nothing was changed.");
});

test("a value the planning-field parser rejects never reaches Notion; its plain message is the error", async () => {
  const { db, deps } = setup();
  const result = await updateTask(deps, { taskId: "t1", field: "estimatedDurationMinutes", value: "soon" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(result.error.message, 'I didn\'t understand "soon" as a whole number of minutes — try e.g. "30".');
  assert.equal(db.updates.length, 0);
});

test("the select guard stays intact: an Area with no close live option is refused, nothing written", async () => {
  const { db, deps } = setup();
  const result = await updateTask(deps, { taskId: "t1", field: "area", value: "Underwater basket weaving" });
  assert.equal(result.ok, false);
  assert.equal(db.updates.length, 0);
});

test("an unknown field name is a validation error (the wire is not trusted)", async () => {
  const { deps } = setup();
  const result = await updateTask(deps, { taskId: "t1", field: "title" as never, value: "x" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

// ============================================================================
// Task 7 (Priority field): `updateTask` accepts "priority" past
// `PlanningFieldNames` (binding ruling — `EditableTaskField`), validated by
// `parsePriorityValue` against the LIVE Priority options, written through
// the same `updateTaskField` (`writeSelectLikeField`).
// ============================================================================

test("Priority writes through updateTaskField, matched against the live options (emoji optional)", async () => {
  const { db, deps } = setup();
  const result = await updateTask(deps, { taskId: "t1", field: "priority", value: "high" });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.receipt, "Priority set to 🔴 High.");
  assert.equal(db.rows()[0]!.priority, "🔴 High");
});

test("Priority rejects a value with no matching live option; nothing is written", async () => {
  const { db, deps } = setup();
  const result = await updateTask(deps, { taskId: "t1", field: "priority", value: "urgent-ish" });
  assert.equal(result.ok, false);
  assert.equal(db.updates.length, 0);
});

test("success appends one 'tasks' hint; a Notion outage returns a plain error and appends none", async () => {
  const { db, deps, connection } = setup();
  const start = getMaxOutboxSeq(connection);
  assert.ok((await updateTask(deps, { taskId: "t1", field: "estimatedDurationMinutes", value: "30" })).ok);
  assert.deepEqual(
    tailOutboxSince(connection, start).map((h) => [h.topic, h.entityId]),
    [["tasks", "t1"]],
  );
  const mid = getMaxOutboxSeq(connection);
  db.setFailingWrites(true);
  const failed = await updateTask(deps, { taskId: "t1", field: "estimatedDurationMinutes", value: "40" });
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.error.message, "I couldn't reach Notion right now; nothing was changed.");
  assert.equal(tailOutboxSince(connection, mid).length, 0);
});

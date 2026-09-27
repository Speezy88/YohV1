/**
 * Task 6B fix round: `notion-adapter.ts`'s `updateTaskTitle` — the ONE
 * narrow write AD-12's closed write surface gains (2026-09-27, Spencer):
 * the title of an existing Task, trimmed, never blank, written to the
 * configured title property and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindNotionTaskWrites, updateTaskTitle } from "../src/adapters/notion-adapter.ts";
import { createFakeNotionTasksDb } from "./fakes/fake-notion-tasks-db.ts";

const CONFIG = { tasksDataSourceId: "tasks-ds" };

test("writes only the title property, trimmed", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "Calc set", minutes: 30 }] });
  const result = await updateTaskTitle(db.client, CONFIG, "t1", "  Calc problem set 4  ");
  assert.ok(result.ok);
  assert.deepEqual(db.updates, [{ pageId: "t1", properties: { Name: { title: [{ type: "text", text: { content: "Calc problem set 4" } }] } } }]);
  assert.deepEqual(db.rows()[0], { id: "t1", title: "Calc problem set 4", minutes: 30 });
});

test("uses the configured title property name (Spencer's real 'Task Name')", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "x" }] });
  const names = { title: "Task Name", estimatedDuration: "Estimated Duration", area: "Area", dueDate: "Due Date", status: "Status", energy: "Energy", project: "Project", priority: "Priority" };
  await updateTaskTitle(db.client, { ...CONFIG, taskPropertyNames: names }, "t1", "Renamed");
  assert.deepEqual(Object.keys(db.updates[0]!.properties), ["Task Name"]);
});

test("a blank title is refused and nothing is written", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "x" }] });
  const result = await updateTaskTitle(db.client, CONFIG, "t1", "   ");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(db.updates.length, 0);
});

test("a Notion failure is a Result failure, never a throw", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "x" }] });
  db.setFailingWrites(true);
  const result = await updateTaskTitle(db.client, CONFIG, "t1", "New");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
});

test("bindNotionTaskWrites exposes it through the same lazy binding", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "x" }] });
  const writes = bindNotionTaskWrites(() => ({ ok: true, value: { client: db.client, config: CONFIG } }));
  assert.ok((await writes.updateTaskTitle("t1", "Bound")).ok);
  assert.equal(db.rows()[0]!.title, "Bound");
});

/**
 * `notion-adapter.ts`'s `archiveTask`: moves one existing Task page to
 * Notion's Trash and writes no property.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveTask, bindNotionTaskWrites } from "../src/adapters/notion-adapter.ts";
import { createFakeNotionTasksDb } from "./fakes/fake-notion-tasks-db.ts";

const CONFIG = { tasksDataSourceId: "tasks-ds" };

test("moves only the named page to the trash and writes no property", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "Calc set" }, { id: "t2", title: "Lab report" }] });
  const result = await archiveTask(db.client, "t1");
  assert.ok(result.ok);
  assert.deepEqual(db.trashed, ["t1"]);
  assert.deepEqual(db.rows().map((r) => r.id), ["t2"]);
  assert.equal(db.updates.length, 0);
});

test("a blank id is refused and nothing is written", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "x" }] });
  const result = await archiveTask(db.client, "  ");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.deepEqual(db.trashed, []);
});

test("a Notion failure is a Result failure, never a throw", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "x" }] });
  db.setFailingWrites(true);
  const result = await archiveTask(db.client, "t1");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.equal(db.rows().length, 1);
});

test("bindNotionTaskWrites exposes it through the same lazy binding", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "x" }] });
  const writes = bindNotionTaskWrites(() => ({ ok: true, value: { client: db.client, config: CONFIG } }));
  assert.ok((await writes.archiveTask("t1")).ok);
  assert.deepEqual(db.trashed, ["t1"]);
});

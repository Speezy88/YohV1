/**
 * Tests for `src/app/create-task.ts` (Task 6B): a Task Spencer types himself
 * on the Tasks page is a DIRECT write (AD-3/AD-12 amended 2026-09-27) —
 * parsed by `core/quick-add.ts`, validated against the live schema at draft
 * time AND at write time, created in one step with no Proposal, and
 * announced to every open client with one outbox hint. Runs the REAL
 * notion-adapter functions against an in-memory Tasks data source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { getMaxOutboxSeq, initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { createTask, previewQuickAdd, type CreateTaskDeps } from "../src/app/create-task.ts";
import { createFakeNotionTasksDb, type FakeTasksDb } from "./fakes/fake-notion-tasks-db.ts";

const NOW = new Date("2026-09-27T15:00:00.000Z"); // Sunday

function setup(): { db: FakeTasksDb; connection: SqliteConnection; deps: CreateTaskDeps } {
  const db = createFakeNotionTasksDb();
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const deps: CreateTaskDeps = {
    getNotionCreatePageBinding: () => ({
      ok: true,
      value: { client: db.client, config: { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds", researchVaultDataSourceId: "vault-ds" } },
    }),
    now: () => NOW,
    timeZone: "UTC",
    connection,
  };
  return { db, connection, deps };
}

test("one typed line creates the Task directly, with every parsed field written to Notion", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "Lab report due fri 90m high #bio" });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Lab report", dueDate: "2026-10-02", minutes: 90, energy: "Deep", area: "Bio" }]);
  assert.equal(result.value.task.id, "created-1");
  assert.equal(result.value.task.title, "Lab report");
  assert.equal(result.value.task.dueDate, "2026-10-02");
  assert.equal(result.value.task.estimatedDurationMinutes, 90);
  assert.equal(result.value.task.energy, "high");
  assert.equal(result.value.task.area, "Bio");
  assert.equal(result.value.receipt, 'Added "Lab report" to Tasks.');
});

test("a title alone is enough — no other field is required", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "Call the dentist" });
  assert.ok(result.ok);
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Call the dentist" }]);
  assert.deepEqual(result.value.task.missing, ["estimatedDurationMinutes", "area", "dueDate", "energy"]);
});

test("a #tag with no close live Area option stays in the title and writes no Area", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "Lab #chem" });
  assert.ok(result.ok);
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Lab #chem" }]);
});

test("a blank line is a plain validation error and writes nothing", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "   " });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(result.error.message, "Type a title for the new Task first.");
  assert.equal(db.rows().length, 0);
});

test("a successful create appends one 'tasks' outbox hint so every open client refreshes", async () => {
  const { deps, connection } = setup();
  const before = getMaxOutboxSeq(connection);
  await createTask(deps, { text: "Call the dentist" });
  const hints = tailOutboxSince(connection, before);
  assert.deepEqual(
    hints.map((h) => [h.topic, h.entityId]),
    [["tasks", "created-1"]],
  );
});

test("a Notion outage is an honest error naming Notion, and no hint is sent", async () => {
  const { db, deps, connection } = setup();
  db.setFailingWrites(true);
  const before = getMaxOutboxSeq(connection);
  const result = await createTask(deps, { text: "Call the dentist" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.message, "I couldn't reach Notion right now; nothing was changed.");
  assert.equal(tailOutboxSince(connection, before).length, 0);
});

test("Notion not configured: a plain 'not set up' error, never an env-var name", async () => {
  const { deps } = setup();
  const result = await createTask(
    { ...deps, getNotionCreatePageBinding: () => ({ ok: false, error: { kind: "missing-field", message: "server: missing required environment variable NOTION_TOKEN" } }) },
    { text: "Call the dentist" },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.message, "I'm not set up to do that yet — my Notion connection isn't configured.");
});

test("previewQuickAdd shows what Enter would create, resolving #tags against the given live Area options", async () => {
  const { deps } = setup();
  const result = await previewQuickAdd(deps, { text: "Lab report due fri 90m high #bio #chem", areaOptions: ["AP Bio", "Math"] });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    title: "Lab report #chem",
    dueDate: "2026-10-02",
    estimatedDurationMinutes: 90,
    energy: "high",
    area: "AP Bio",
    unmatchedAreas: ["chem"],
  });
});

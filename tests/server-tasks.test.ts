/**
 * Tests for Task 6B's slice of `src/shell/server.ts`: the Tasks page routes
 * (`GET /api/tasks`, `POST /api/tasks`, `POST /api/tasks/parse`, `POST
 * /api/tasks/:id/field`) — pure transport over `app/tasks-view.ts`,
 * `app/create-task.ts` and `app/update-task.ts`. In-process via
 * `app.request(...)` against `:memory:` SQLite and the in-memory fake Tasks
 * data source; the real notion-adapter functions run underneath.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { getMaxOutboxSeq, initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { bindNotionTaskWrites, readNotionTasks, readTaskFieldOptions } from "../src/adapters/notion-adapter.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import { createFakeNotionTasksDb } from "./fakes/fake-notion-tasks-db.ts";

const NOW = new Date("2026-09-27T15:00:00.000Z");
const CONFIG = { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds" };

function setup(withTasks = true) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const db = createFakeNotionTasksDb({
    seed: [
      { id: "t1", title: "Calc problem set 4", dueDate: "2026-09-27", minutes: 60, area: "Math", energy: "medium", status: "Nothing" },
      { id: "t2", title: "College essay brainstorm", area: "School", status: "Nothing" },
    ],
  });
  const tasks: NonNullable<ServerDeps["tasks"]> = {
    timeZone: "UTC",
    now: () => NOW,
    readTasks: async () => (await readNotionTasks(db.client, CONFIG)).tasks,
    readFieldOptions: () => readTaskFieldOptions(db.client, CONFIG),
    getNotionCreatePageBinding: () => ({ ok: true, value: { client: db.client, config: { ...CONFIG, researchVaultDataSourceId: "vault-ds" } } }),
    ...bindNotionTaskWrites(() => ({ ok: true, value: { client: db.client, config: CONFIG } })),
  };
  const app = createApp({ connection, log: () => {}, ...(withTasks ? { tasks } : {}) });
  return { app, db, connection };
}

type Envelope = { ok: boolean; value?: Record<string, unknown>; error?: { kind: string; message: string } };

async function get(app: ReturnType<typeof createApp>, path: string): Promise<{ status: number; body: Envelope }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Envelope };
}

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown): Promise<{ status: number; body: Envelope }> {
  const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Envelope };
}

test("GET /api/tasks lists every Task grouped by Due, with the live options", async () => {
  const { app } = setup();
  const { status, body } = await get(app, "/api/tasks");
  assert.equal(status, 200);
  assert.ok(body.ok);
  const value = body.value as { groups: Array<{ key: string; tasks: Array<{ id: string }> }>; options: { area: string[] } };
  assert.deepEqual(
    value.groups.map((g) => [g.key, g.tasks.map((t) => t.id)]),
    [
      ["today", ["t1"]],
      ["no-date", ["t2"]],
    ],
  );
  assert.deepEqual(value.options.area, ["School", "Bio", "Math", "Errands", "Personal"]);
});

test("GET /api/tasks?groupBy=area&query=calc groups and filters server-side", async () => {
  const { app } = setup();
  const { body } = await get(app, "/api/tasks?groupBy=area&query=calc");
  assert.ok(body.ok);
  const value = body.value as { groupBy: string; groups: Array<{ label: string; tasks: Array<{ id: string }> }> };
  assert.equal(value.groupBy, "area");
  assert.deepEqual(
    value.groups.map((g) => [g.label, g.tasks.map((t) => t.id)]),
    [["Math", ["t1"]]],
  );
});

test("GET /api/tasks with an unknown groupBy is a 400 validation envelope", async () => {
  const { app } = setup();
  const { status, body } = await get(app, "/api/tasks?groupBy=color");
  assert.equal(status, 400);
  assert.equal(body.error?.kind, "validation");
});

// Real-use fixes plan, Task 2: the Chat header's "N tasks missing data"
// chip's own count route — reuses `app/tasks-view.ts`'s missing-data rule
// rather than the client re-deriving it from the full `GET /api/tasks` list.
test("GET /api/tasks/missing-count counts open Tasks missing a planning field ('t2' has no due date, time, or energy; 't1' is complete)", async () => {
  const { app } = setup();
  const { status, body } = await get(app, "/api/tasks/missing-count");
  assert.equal(status, 200);
  assert.ok(body.ok, JSON.stringify(body));
  assert.deepEqual(body.value, { count: 1 });
});

test("GET /api/tasks/missing-count without Notion configured reports 'not configured', same as GET /api/tasks", async () => {
  const { app } = setup(false);
  const { status, body } = await get(app, "/api/tasks/missing-count");
  assert.equal(body.ok, false);
  assert.ok(status >= 400);
});

test("POST /api/tasks creates the Task directly from one typed line and appends a tasks hint", async () => {
  const { app, db, connection } = setup();
  const before = getMaxOutboxSeq(connection);
  const { status, body } = await post(app, "/api/tasks", { text: "Test task due tomorrow 30m" });
  assert.equal(status, 200);
  assert.ok(body.ok, JSON.stringify(body));
  assert.equal((body.value as { receipt: string }).receipt, 'Added "Test task" to Tasks.');
  assert.deepEqual(db.rows().at(-1), { id: "created-1", title: "Test task", dueDate: "2026-09-28", minutes: 30 });
  assert.deepEqual(
    tailOutboxSince(connection, before).map((h) => h.topic),
    ["tasks"],
  );
});

test("POST /api/tasks with no text is a 400", async () => {
  const { app } = setup();
  const { status, body } = await post(app, "/api/tasks", {});
  assert.equal(status, 400);
  assert.equal(body.error?.kind, "validation");
});

test("POST /api/tasks/parse previews the chips without writing anything", async () => {
  const { app, db } = setup();
  const { status, body } = await post(app, "/api/tasks/parse", { text: "Lab report due fri 90m high #bio", areaOptions: ["Bio", "Math"] });
  assert.equal(status, 200);
  assert.deepEqual(body.value, { title: "Lab report", dueDate: "2026-10-02", estimatedDurationMinutes: 90, energy: "high", area: "Bio", unmatchedAreas: [] });
  assert.equal(db.rows().length, 2);
});

test("POST /api/tasks/:id/field writes one field through the select guard and returns a receipt", async () => {
  const { app, db } = setup();
  const ok = await post(app, "/api/tasks/t2/field", { field: "energy", value: "high" });
  assert.equal(ok.status, 200);
  assert.equal((ok.body.value as { receipt: string }).receipt, "Energy set to Deep.");
  assert.equal(db.rows().find((r) => r.id === "t2")?.energy, "Deep");
  const bad = await post(app, "/api/tasks/t2/field", { field: "estimatedDurationMinutes", value: "soon" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error?.message ?? "", /whole number of minutes/);
});

test("POST /api/tasks/:id/field refuses Status -> Completed (that is a check-off, AD-20) and writes nothing", async () => {
  const { app, db } = setup();
  const { status, body } = await post(app, "/api/tasks/t2/field", { field: "status", value: "completed" });
  assert.equal(status, 400);
  assert.match(body.error?.message ?? "", /Check the box/);
  assert.equal(db.updates.length, 0);
});

test("POST /api/tasks/:id/title renames the Task and returns a receipt; a blank title is a 400", async () => {
  const { app, db, connection } = setup();
  const before = getMaxOutboxSeq(connection);
  const ok = await post(app, "/api/tasks/t1/title", { title: " Calc set 5 " });
  assert.equal(ok.status, 200);
  assert.equal((ok.body.value as { receipt: string }).receipt, 'Renamed to "Calc set 5".');
  assert.equal(db.rows().find((r) => r.id === "t1")?.title, "Calc set 5");
  assert.deepEqual(tailOutboxSince(connection, before).map((h) => h.topic), ["tasks"]);
  const blank = await post(app, "/api/tasks/t1/title", { title: "   " });
  assert.equal(blank.status, 400);
  const malformed = await post(app, "/api/tasks/t1/title", {});
  assert.equal(malformed.status, 400);
});

test("POST /api/tasks/:id/field with a malformed body is a 400", async () => {
  const { app } = setup();
  const { status } = await post(app, "/api/tasks/t2/field", { field: 3 });
  assert.equal(status, 400);
});

test("without Notion configured, every Tasks route reports a clear unreachable error, never a crash", async () => {
  const { app } = setup(false);
  assert.equal((await get(app, "/api/tasks")).status, 503);
  assert.equal((await post(app, "/api/tasks", { text: "x" })).status, 503);
  assert.equal((await post(app, "/api/tasks/parse", { text: "x" })).status, 503);
  assert.equal((await post(app, "/api/tasks/t1/title", { title: "x" })).status, 503);
  const field = await post(app, "/api/tasks/t1/field", { field: "energy", value: "high" });
  assert.equal(field.status, 503);
  assert.equal(field.body.error?.message, "I'm not set up to do that yet — my Notion connection isn't configured.");
});

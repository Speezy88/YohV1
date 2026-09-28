/**
 * Tests for Story 9.2's slice of `src/shell/server.ts`: `POST
 * /api/sandbox/start|:taskId/save|:taskId/skip` — pure transport over
 * `app/sandbox-queue.ts` and `app/sandbox-submit.ts`. In-process via
 * `app.request(...)` against `:memory:` SQLite and the in-memory fake Tasks
 * data source; the real notion-adapter functions run underneath.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, getMaxOutboxSeq, listUnreadNotifications, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { bindNotionTaskWrites, readNotionTasks } from "../src/adapters/notion-adapter.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import { createFakeNotionTasksDb } from "./fakes/fake-notion-tasks-db.ts";

const NOW = new Date("2026-09-27T15:00:00.000Z");
const CONFIG = { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds" };

function setup(withSandbox = true) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const db = createFakeNotionTasksDb({
    seed: [
      { id: "t1", title: "Chem problem set", minutes: 45, area: "School" }, // missing dueDate only
      { id: "t2", title: "Fully complete", dueDate: "2026-09-28", minutes: 30, area: "Math", energy: "medium", status: "Nothing" },
    ],
  });
  const sandbox: NonNullable<ServerDeps["sandbox"]> = {
    store: createMemoryStore(connection),
    timeZone: "UTC",
    now: () => NOW,
    readTasks: async () => (await readNotionTasks(db.client, CONFIG)).tasks,
    ...bindNotionTaskWrites(() => ({ ok: true, value: { client: db.client, config: CONFIG } })),
  };
  const app = createApp({ connection, log: () => {}, ...(withSandbox ? { sandbox } : {}) });
  return { app, db, connection };
}

type Envelope = { ok: boolean; value?: Record<string, unknown>; error?: { kind: string; message: string } };

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown): Promise<{ status: number; body: Envelope }> {
  const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Envelope };
}

test("POST /api/sandbox/start returns the first (soonest-due) card", async () => {
  const { app } = setup();
  const { status, body } = await post(app, "/api/sandbox/start", {});
  assert.equal(status, 200);
  assert.ok(body.ok);
  assert.deepEqual(body.value?.["card"], {
    taskId: "t1",
    taskTitle: "Chem problem set",
    estimatedDurationMinutes: 45,
    area: "School",
    remaining: 0,
    options: { area: [], energy: [] },
  });
});

test("POST /api/sandbox/start with exclude omits that taskId", async () => {
  const { app } = setup();
  const { body } = await post(app, "/api/sandbox/start", { exclude: ["t1"] });
  assert.equal(body.value?.["card"], undefined);
});

test("POST /api/sandbox/:taskId/save writes the fields, returns a receipt and the next card, and appends a tasks outbox hint", async () => {
  const { app, db, connection } = setup();
  const before = getMaxOutboxSeq(connection);
  const { status, body } = await post(app, "/api/sandbox/t1/save", { dueDate: "2026-09-30", estimatedDurationMinutes: "45", exclude: [] });
  assert.equal(status, 200);
  assert.ok(body.ok, JSON.stringify(body));
  assert.match((body.value?.["receipt"] as string) ?? "", /Due Date/);
  assert.equal(body.value?.["next"], undefined, "t2 is already complete — the queue is empty once t1 is excluded");
  assert.equal(db.rows().find((r) => r.id === "t1")?.dueDate, "2026-09-30");
  assert.deepEqual(
    tailOutboxSince(connection, before).map((h) => h.topic),
    ["tasks"],
  );
});

test("POST /api/sandbox/:taskId/save with an unresolvable Area writes nothing and reports validation", async () => {
  const { app, db } = setup();
  const { status, body } = await post(app, "/api/sandbox/t1/save", {
    dueDate: "2026-09-30",
    estimatedDurationMinutes: "45",
    area: "Definitely Not A Real Area Name",
    exclude: [],
  });
  assert.equal(status, 400);
  assert.equal(body.error?.kind, "validation");
  assert.equal(db.rows().find((r) => r.id === "t1")?.dueDate, undefined, "Due Date must never be written once Area's write fails");
});

test("POST /api/sandbox/:taskId/skip writes nothing and returns the recomputed next card", async () => {
  const { app, db } = setup();
  const { status, body } = await post(app, "/api/sandbox/t1/skip", { exclude: [] });
  assert.equal(status, 200);
  assert.equal(body.value?.["next"], undefined);
  assert.deepEqual(db.updates, [], "skip must never write to Notion");
});

// Review Focus #3 — a source-scan test, this codebase's own established
// convention (mirrors tests/layering-rules.test.ts / the FR-29 isolation
// test in the Story 8.2 plan): skip's own route body never names
// submitSandboxCard or updateTaskField.
test("the /api/sandbox/:taskId/skip route body never calls submitSandboxCard or names updateTaskField (Review Focus #3)", () => {
  const source = readFileSync(new URL("../src/shell/server.ts", import.meta.url), "utf8");
  const start = source.indexOf('"/api/sandbox/:taskId/skip"');
  assert.ok(start >= 0, "the skip route must exist");
  const nextRouteStart = source.indexOf('.post(\n        "/api/sandbox', start + 1);
  const nextGetStart = source.indexOf(".get(", start + 1);
  const end = [nextRouteStart, nextGetStart].filter((i) => i > start).sort((a, b) => a - b)[0] ?? source.indexOf(".get(\"/api/research\"");
  const body = source.slice(start, end);
  assert.ok(!body.includes("submitSandboxCard"), "skip must never call the write path");
  assert.ok(!body.includes("updateTaskField"), "skip must never name the write function");
});

test("every sandbox route reports the shared 'not configured' envelope when deps.sandbox is absent", async () => {
  const { app } = setup(false);
  const start = await post(app, "/api/sandbox/start", {});
  assert.equal(start.status, 503);
  assert.equal(start.body.error?.kind, "unreachable");
  const save = await post(app, "/api/sandbox/t1/save", { dueDate: "2026-09-30", estimatedDurationMinutes: "45", exclude: [] });
  assert.equal(save.status, 503);
  const skip = await post(app, "/api/sandbox/t1/skip", { exclude: [] });
  assert.equal(skip.status, 503);
  const finish = await post(app, "/api/sandbox/finish", { outcomes: [] });
  assert.equal(finish.status, 503);
  assert.equal(finish.body.error?.kind, "unreachable");
});

// Story 9.3 (Task 3, E9): POST /api/sandbox/finish — the Finale's one route.
test("POST /api/sandbox/finish: every outcome ok:true reports savedCount and raises a sandbox-complete notification", async () => {
  const { app, connection } = setup();
  const { status, body } = await post(app, "/api/sandbox/finish", { outcomes: [{ taskId: "t1", taskTitle: "Call dentist", ok: true }] });
  assert.equal(status, 200);
  assert.deepEqual(body.value, { savedCount: 1, failedTitles: [] });
  assert.equal(listUnreadNotifications(connection)[0]?.kind, "sandbox-complete");
});

test("POST /api/sandbox/finish: a failed outcome reports failedTitles and raises sandbox-failed", async () => {
  const { app, connection } = setup();
  const { status, body } = await post(app, "/api/sandbox/finish", { outcomes: [{ taskId: "t1", taskTitle: "Chem problem set", ok: false }] });
  assert.equal(status, 200);
  assert.deepEqual(body.value, { savedCount: 0, failedTitles: ["Chem problem set"] });
  assert.equal(listUnreadNotifications(connection)[0]?.kind, "sandbox-failed");
});

test("POST /api/sandbox/finish: a non-array outcomes body is a 400 validation envelope", async () => {
  const { app } = setup();
  const { status, body } = await post(app, "/api/sandbox/finish", { outcomes: "nope" });
  assert.equal(status, 400);
  assert.equal(body.error?.kind, "validation");
});

// Fix round 1: a malformed element (missing/wrong-typed field) must also be
// a 400, not a "Couldn't save undefined." notification.
test("POST /api/sandbox/finish: a malformed outcome element (missing taskTitle) is a 400 validation envelope, and no notification is written", async () => {
  const { app, connection } = setup();
  const { status, body } = await post(app, "/api/sandbox/finish", { outcomes: [{ taskId: "t1", ok: false }] });
  assert.equal(status, 400);
  assert.equal(body.error?.kind, "validation");
  assert.equal(listUnreadNotifications(connection).length, 0);
});

test("POST /api/sandbox/finish: a wrong-typed 'ok' field (string, not boolean) is a 400 validation envelope", async () => {
  const { app, connection } = setup();
  const { status, body } = await post(app, "/api/sandbox/finish", { outcomes: [{ taskId: "t1", taskTitle: "Chem problem set", ok: "true" }] });
  assert.equal(status, 400);
  assert.equal(body.error?.kind, "validation");
  assert.equal(listUnreadNotifications(connection).length, 0);
});

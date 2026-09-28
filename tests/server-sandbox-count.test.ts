/**
 * Tests for `GET /api/sandbox/count` (Story 9.4, E9) — a thin transport
 * wrapper over Story 9.2's `sandboxQueue`. Real throwaway `:memory:` SQLite;
 * `readTasks` is an injected fake (no real Notion).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import type { NotionTaskWriteBindings } from "../src/adapters/notion-adapter.ts";
import type { Task } from "../src/types/domain.ts";

const NOW_ISO = "2026-09-27T13:00:00.000Z";

function makeTask(id: string, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    estimatedDurationMinutes: 30,
    area: "Work",
    dueDate: "2026-09-27",
    status: "not-started",
    energy: "medium",
    ...overrides,
  };
}

/** A Task missing BOTH Required fields — `dueDate` and `estimatedDurationMinutes` are simply absent, never `undefined` (exactOptionalPropertyTypes). */
function taskMissingBothFields(id: string, title: string): Task {
  return { id, title, createdAt: NOW_ISO, updatedAt: NOW_ISO, area: "Work", status: "not-started", energy: "medium" };
}

/** A Task missing only `estimatedDurationMinutes`. */
function taskMissingDuration(id: string, title: string): Task {
  return { id, title, createdAt: NOW_ISO, updatedAt: NOW_ISO, area: "Work", dueDate: "2026-09-27", status: "not-started", energy: "medium" };
}

/** A no-op stand-in for `NotionTaskWriteBindings["updateTaskField"]` — `/api/sandbox/count` never calls it, but `ServerDeps["sandbox"]` requires it (it's shared with `SandboxSubmitDeps`). */
const NOOP_UPDATE_TASK_FIELD: NotionTaskWriteBindings["updateTaskField"] = async () => ({ ok: true, value: undefined });

function baseDeps(connection: SqliteConnection, sandbox?: ServerDeps["sandbox"]): ServerDeps {
  initNotificationStoreSchema(connection.db);
  return { connection, ...(sandbox ? { sandbox } : {}) };
}

function makeSandboxDeps(connection: SqliteConnection, readTasks: () => Promise<readonly Task[]>): ServerDeps["sandbox"] {
  return {
    store: createMemoryStore(connection),
    readTasks,
    timeZone: "UTC",
    updateTaskField: NOOP_UPDATE_TASK_FIELD,
  };
}

test("GET /api/sandbox/count reports the sandboxQueue item count for a mixed complete/incomplete Task list", async (t) => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  t.after(() => connection.close());
  const deps = baseDeps(
    connection,
    makeSandboxDeps(connection, async () => [
      makeTask("t1", "Draft the memo"),
      taskMissingBothFields("t2", "Renew the passport"),
      taskMissingDuration("t3", "File taxes"),
    ]),
  );
  const app = createApp(deps);
  const res = await app.request("/api/sandbox/count");
  const body = (await res.json()) as { ok: true; value: { count: number } };
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.value.count, 2);
});

test("GET /api/sandbox/count reports 0 when every Task has both Required fields", async (t) => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  t.after(() => connection.close());
  const deps = baseDeps(connection, makeSandboxDeps(connection, async () => [makeTask("t1", "Draft the memo")]));
  const app = createApp(deps);
  const res = await app.request("/api/sandbox/count");
  const body = (await res.json()) as { ok: true; value: { count: number } };
  assert.equal(body.value.count, 0);
});

test("GET /api/sandbox/count reports a clear 'not configured' error when deps.sandbox is absent", async (t) => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  t.after(() => connection.close());
  const app = createApp(baseDeps(connection, undefined));
  const res = await app.request("/api/sandbox/count");
  const body = (await res.json()) as { ok: false; error: { message: string } };
  assert.equal(body.ok, false);
  assert.match(body.error.message, /not set up|not configured/i);
});

// Fix round 1 (controller ruling): the count route must never trigger a live
// Notion schema read — it only ever needs items.length.
test("GET /api/sandbox/count never calls readFieldOptions, even when the dep is configured", async (t) => {
  let calls = 0;
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  t.after(() => connection.close());
  const sandbox: NonNullable<ServerDeps["sandbox"]> = {
    store: createMemoryStore(connection),
    readTasks: async () => [taskMissingBothFields("t1", "Renew the passport")],
    timeZone: "UTC",
    updateTaskField: NOOP_UPDATE_TASK_FIELD,
    readFieldOptions: async () => {
      calls++;
      return { area: [], energy: [], status: [] };
    },
  };
  const app = createApp(baseDeps(connection, sandbox));
  const res = await app.request("/api/sandbox/count");
  const body = (await res.json()) as { ok: true; value: { count: number } };
  assert.equal(res.status, 200);
  assert.equal(body.value.count, 1);
  assert.equal(calls, 0, "readFieldOptions must never be called for a plain count");
});

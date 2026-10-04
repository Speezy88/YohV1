/**
 * Tests for `src/shell/server.ts` (Story 7.2; AD-15, AD-17, Consistency
 * Conventions; Story 7.3's notification routes). Hono's `app.request(...)`
 * drives the app in-process against an in-memory SQLite connection, and
 * `startServer`'s `serve()` call goes through an injected fake — this suite
 * never binds a real port or makes a network call. (`GET /api/events` is
 * covered in `tests/server-events.test.ts`.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hc } from "hono/client";
import type { LogEntry } from "../src/adapters/logger.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createNotification, initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryStore, getCurrentTimeBudget, putPlan } from "../src/adapters/memory-store.ts";
import { initCompletionLogSchema } from "../src/adapters/completion-log.ts";
import type { AppType, HealthResponse } from "../src/types/api.ts";
import { createApp, startServer, type ServeOptions, type ServerDeps } from "../src/shell/server.ts";

const READ_AT = "2026-09-25T12:00:00.000Z";

function tempApp(overrides: Partial<ServerDeps> = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db); // Story 7.10: Home's "completed" also reads the Completion Log
  const app = createApp({ connection, log: () => {}, clock: () => new Date(READ_AT), ...overrides });
  return { app, connection };
}

function fakeServe() {
  const calls: ServeOptions[] = [];
  let closed = 0;
  const serveFn = (options: ServeOptions) => {
    calls.push(options);
    return { close: () => void closed++ };
  };
  return { calls, serveFn, closedCount: () => closed };
}

function raise(connection: ReturnType<typeof tempApp>["connection"]): string {
  return createNotification(connection, {
    kind: "needs-data",
    title: "Missing fields",
    body: "3 Tasks need a Due Date",
    deepLink: "/tasks",
    createdAt: "2026-09-25T00:00:00.000Z",
  });
}

test("GET /api/health returns 200 {ok:true}", async () => {
  const { app, connection } = tempApp();
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await res.json(), { ok: true });
  connection.close();
});

test("every /api request logs one structured line with its duration (Consistency Conventions: Performance)", async () => {
  const entries: LogEntry[] = [];
  const ticks = [1_000, 1_012];
  const { app: logged, connection } = tempApp({ log: (e) => entries.push(e), now: () => ticks.shift() ?? 0 });

  await logged.request("/api/health");
  const missing = await logged.request("/api/nope");

  assert.equal(missing.status, 404);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    level: "info",
    event: "server.api-request",
    detail: { method: "GET", path: "/api/health", status: 200, durationMs: 12 },
  });
  assert.equal((entries[1]!.detail as { status: number }).status, 404);
  connection.close();
});

test("a handler that throws an Error is still logged, with status 500", async () => {
  const entries: LogEntry[] = [];
  const { app: logged, connection } = tempApp({ log: (e) => entries.push(e), now: () => 0 });
  logged.get("/api/boom", () => {
    throw new Error("boom");
  });
  const res = await logged.request("/api/boom");
  assert.equal(res.status, 500);
  // onError logs the throw itself; the request line still reports the 500.
  assert.deepEqual(entries.map((e) => e.event).sort(), ["server.api-request", "server.unhandled-error"]);
  assert.equal((entries.find((e) => e.event === "server.api-request")!.detail as { status: number }).status, 500);
  connection.close();
});

test("a handler that throws a non-Error value is still logged (try/finally), as a 500, and the throw propagates", async () => {
  const entries: LogEntry[] = [];
  const { app: logged, connection } = tempApp({ log: (e) => entries.push(e), now: () => 0 });
  logged.get("/api/boom", () => {
    throw "not an Error"; // Hono rethrows non-Error values past onError, straight through the middleware's next()
  });
  await assert.rejects(async () => logged.request("/api/boom"));
  assert.equal(entries.length, 1, "the request log line must not be skipped when next() rejects");
  assert.deepEqual(entries[0]!.detail, { method: "GET", path: "/api/boom", status: 500, durationMs: 0 });
  connection.close();
});

test("the default app's request log is single-line JSON (writeStructuredLog)", async () => {
  const lines: string[] = [];
  const { app: logged, connection } = tempApp({ log: (e) => lines.push(`${JSON.stringify(e)}\n`), now: () => 0 });
  await logged.request("/api/health");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.trimEnd().includes("\n"), false);
  assert.equal(JSON.parse(lines[0]!).event, "server.api-request");
  connection.close();
});

test("the typed Hono RPC client, bound to types/api.ts's AppType, reaches /api/health and /api/notifications (AD-17, Ruling R2)", async () => {
  const { app, connection } = tempApp();
  const id = raise(connection);
  const client = hc<AppType>("http://yoh.test", { headers: { "Content-Type": "application/json" }, fetch: (input: string | URL | Request, init?: RequestInit) => app.request(input, init) });
  const health: HealthResponse = await (await client.api.health.$get()).json();
  assert.deepEqual(health, { ok: true });

  const list = await (await client.api.notifications.$get()).json();
  assert.equal(list.ok, true);
  if (list.ok) assert.equal(list.value.notifications[0]!.id, id);

  const marked = await (await client.api.notifications[":id"].read.$post({ param: { id } })).json();
  assert.deepEqual(marked, { ok: true, value: { id, readAt: READ_AT } });

  // The route schema is real, not `any`: an undeclared route doesn't type-check.
  // @ts-expect-error — no /api/nope route exists on AppType.
  assert.equal(typeof client.api.nope, "function");
  connection.close();
});

// ---------------------------------------------------------------------------
// Story 7.3 — notification routes (transport over app/notifications.ts)
// ---------------------------------------------------------------------------

test("GET /api/notifications returns the serialized Result of the unread list", async () => {
  const { app, connection } = tempApp();
  const id = raise(connection);
  const res = await app.request("/api/notifications");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    value: {
      notifications: [
        {
          id,
          kind: "needs-data",
          title: "Missing fields",
          body: "3 Tasks need a Due Date",
          deepLink: "/tasks",
          createdAt: "2026-09-25T00:00:00.000Z",
        },
      ],
    },
  });
  connection.close();
});

test("POST /api/notifications/:id/read sets readAt via the server clock and the notification leaves the unread list", async () => {
  const { app, connection } = tempApp();
  const id = raise(connection);
  const res = await app.request(`/api/notifications/${id}/read`, { method: "POST", headers: { "Content-Type": "application/json" } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, value: { id, readAt: READ_AT } });
  assert.deepEqual(await (await app.request("/api/notifications")).json(), { ok: true, value: { notifications: [] } });
  connection.close();
});

// ---------------------------------------------------------------------------
// Story 8.7 — GET /api/commands (transport over app/commands.ts)
// ---------------------------------------------------------------------------

test("GET /api/commands returns the registry", async () => {
  const { app, connection } = tempApp();
  const res = await app.request("/api/commands");
  const body = (await res.json()) as { ok: true; value: { commands: { name: string }[] } };
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(
    body.value.commands.map((c) => c.name),
    ["/morning", "/night", "/plan", "/sandbox", "/remember", "/forget", "/research"],
  );
  connection.close();
});

test("POST /api/notifications/:id/read on an unknown id returns 400 with a validation error envelope", async () => {
  const { app, connection } = tempApp();
  const res = await app.request("/api/notifications/nope/read", { method: "POST", headers: { "Content-Type": "application/json" } });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { ok: boolean; error: { kind: string } };
  assert.equal(body.ok, false);
  assert.equal(body.error.kind, "validation");
  connection.close();
});

test("a store failure renders as 503 with an unreachable error envelope, never a thrown 500", async () => {
  const { app, connection } = tempApp();
  connection.close();
  const res = await app.request("/api/notifications");
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean; error: { kind: string; detail?: unknown } };
  assert.equal(body.ok, false);
  assert.equal(body.error.kind, "unreachable");
  assert.equal("detail" in body.error, false, "the raw adapter error (detail) never crosses the wire");
});

test("GET on the mark-read route is not allowed — reading must never change read state", async () => {
  const { app, connection } = tempApp();
  const id = raise(connection);
  const res = await app.request(`/api/notifications/${id}/read`);
  assert.equal(res.status, 404);
  assert.equal(((await (await app.request("/api/notifications")).json()) as { value: { notifications: unknown[] } }).value.notifications.length, 1);
  connection.close();
});

// ---------------------------------------------------------------------------
// GET /api/home (Story 7.8)
// ---------------------------------------------------------------------------

test("GET /api/home returns the home view when homeView deps are configured", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db); // Story 7.10: Home's "completed" also reads the Completion Log
  const app = createApp({
    connection,
    homeView: {
      store: createMemoryStore(connection),
      readCalendarEvents: async () => [],
      readTasks: async () => ({ tasks: [] }),
      timeZone: "UTC",
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    },
  });
  const res = await app.request("/api/home");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; value: { today: string } };
  assert.equal(body.ok, true);
  assert.equal(body.value.today, "2026-09-25");
  connection.close();
});

test("GET /api/home reflects today's stored Plan and calendar", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db); // Story 7.10: Home's "completed" also reads the Completion Log
  const store = createMemoryStore(connection);
  putPlan(store, {
    id: "plan-2026-09-25",
    date: "2026-09-25",
    blocks: [{ id: "b1", kind: "work", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", taskId: "t1", label: "Draft the memo" }],
    reasoning: "",
    version: 1,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
  });
  const app = createApp({
    connection,
    homeView: {
      store,
      readCalendarEvents: async () => [],
      readTasks: async () => ({ tasks: [] }),
      timeZone: "UTC",
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    },
  });
  const res = await app.request("/api/home");
  const body = (await res.json()) as { ok: boolean; value: { plan: { rows: Array<{ taskId: string }> } } };
  assert.equal(body.ok, true);
  assert.deepEqual(body.value.plan.rows.map((r) => r.taskId), ["t1"]);
  connection.close();
});

test("GET /api/home returns a clear error when homeView deps are not configured", async () => {
  const { app, connection } = tempApp();
  const res = await app.request("/api/home");
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean; error: { kind: string } };
  assert.equal(body.ok, false);
  assert.equal(body.error.kind, "unreachable");
  connection.close();
});

test("Task 6A: POST /api/time-budget declares today's Time Budget over the existing app/time-budget.ts function, reflected by a later GET /api/home", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  const store = createMemoryStore(connection);
  const app = createApp({
    connection,
    homeView: {
      store,
      readCalendarEvents: async () => [],
      readTasks: async () => ({ tasks: [] }),
      timeZone: "UTC",
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    },
  });
  const res = await app.request("/api/time-budget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalMinutes: 360 }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; value: { receipt: string } };
  assert.equal(body.ok, true);
  assert.match(body.value.receipt, /6h/);
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 360);

  const homeRes = await app.request("/api/home");
  const homeBody = (await homeRes.json()) as { ok: boolean; value: { timeBudget: { totalMinutes: number } | undefined } };
  assert.equal(homeBody.value.timeBudget?.totalMinutes, 360);
  connection.close();
});

test("POST /api/time-budget returns a clear error when homeView deps are not configured", async () => {
  const { app, connection } = tempApp();
  const res = await app.request("/api/time-budget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalMinutes: 360 }),
  });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean; error: { kind: string } };
  assert.equal(body.ok, false);
  assert.equal(body.error.kind, "unreachable");
  connection.close();
});

test("POST /api/time-budget rejects a malformed body with 400", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({
    connection,
    homeView: {
      store: createMemoryStore(connection),
      readCalendarEvents: async () => [],
      readTasks: async () => ({ tasks: [] }),
      timeZone: "UTC",
    },
  });
  const res = await app.request("/api/time-budget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  connection.close();
});

test("Fix round 1 (finding #1): GET /api/home degrades gracefully on a calendar-read failure — 200 ok:true, never a thrown 500 or a blanked view", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db); // Story 7.10: Home's "completed" also reads the Completion Log
  const app = createApp({
    connection,
    homeView: {
      store: createMemoryStore(connection),
      readCalendarEvents: async () => {
        throw new Error("calendar down");
      },
      readTasks: async () => ({ tasks: [] }),
      timeZone: "UTC",
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    },
  });
  const res = await app.request("/api/home");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; value: { today: string; calendar: { blocks: unknown[] } } };
  assert.equal(body.ok, true);
  assert.equal(body.value.today, "2026-09-25");
  assert.deepEqual(body.value.calendar.blocks, [], "falls back to an empty calendar rather than failing the whole request");
  connection.close();
});

test("Fix round 1 (finding #2): a home-view Calendar-read failure logs through the same structured logger every /api route uses", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db); // Story 7.10: Home's "completed" also reads the Completion Log
  const entries: LogEntry[] = [];
  const app = createApp({
    connection,
    log: (e) => entries.push(e),
    homeView: {
      store: createMemoryStore(connection),
      readCalendarEvents: async () => {
        throw new Error("calendar down");
      },
      readTasks: async () => ({ tasks: [] }),
      timeZone: "UTC",
    },
  });
  await app.request("/api/home");
  const errorEntry = entries.find((e) => e.event === "home-view.read-calendar-failed");
  assert.ok(errorEntry, "expected a home-view.read-calendar-failed log line");
  assert.equal(errorEntry!.level, "error");
  connection.close();
});

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

function tempConnection() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db); // Story 7.10: Home's "completed" also reads the Completion Log
  return connection;
}

test("startServer binds 127.0.0.1 (loopback only), never 0.0.0.0 or an unspecified host (AD-15)", () => {
  const fake = fakeServe();
  const connection = tempConnection();
  const handle = startServer(connection, {}, fake.serveFn);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]!.hostname, "127.0.0.1");
  assert.equal(typeof fake.calls[0]!.fetch, "function");
  handle.close();
  assert.equal(fake.closedCount(), 1);
  connection.close();
});

test("startServer's app serves the notification routes from the connection it was given", async () => {
  const fake = fakeServe();
  const connection = tempConnection();
  const id = raise(connection);
  startServer(connection, {}, fake.serveFn);
  const res = await fake.calls[0]!.fetch(new Request("http://127.0.0.1/api/notifications"));
  const body = (await res.json()) as { value: { notifications: Array<{ id: string }> } };
  assert.equal(body.value.notifications[0]!.id, id);
  connection.close();
});

test("startServer reads YOH_SERVER_PORT, defaulting to 8787", () => {
  const fake = fakeServe();
  const connection = tempConnection();
  startServer(connection, {}, fake.serveFn);
  startServer(connection, { YOH_SERVER_PORT: "9999" }, fake.serveFn);
  assert.equal(fake.calls[0]!.port, 8787);
  assert.equal(fake.calls[1]!.port, 9999);
  connection.close();
});

test("startServer refuses an invalid YOH_SERVER_PORT instead of binding somewhere unexpected", () => {
  const connection = tempConnection();
  for (const bad of ["", "abc", "0", "-1", "65536", "80.5", "8787x"]) {
    const fake = fakeServe();
    assert.throws(() => startServer(connection, { YOH_SERVER_PORT: bad }, fake.serveFn), /YOH_SERVER_PORT/, `port ${JSON.stringify(bad)}`);
    assert.equal(fake.calls.length, 0);
  }
  connection.close();
});

/** `shell/server.ts` and the files split out of it (`server-streams.ts`, `server-routes.ts`, `server-wiring.ts`), as one source text. */
function serverSources(): string {
  const shellDir = join(import.meta.dirname, "..", "src", "shell");
  const files = readdirSync(shellDir).filter((name) => /^server(-[a-z-]+)?\.ts$/.test(name));
  assert.ok(files.length >= 4, "expected server.ts and its split-out files");
  return files.map((name) => readFileSync(join(shellDir, name), "utf8")).join("\n");
}

test("server.ts schedules no ritual: it and its split-out files never import rituals/ or shell/ritual-cli.ts (AD-5, AD-15)", () => {
  const source = serverSources();
  // Static `from`, bare side-effect `import "…"`, and dynamic `import("…")`.
  const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);
  assert.ok(specifiers.length > 0);
  assert.deepEqual(
    specifiers.filter((s) => /(^|\/)rituals\/|ritual-cli/.test(s ?? "")),
    [],
  );
  assert.doesNotMatch(source, /0\.0\.0\.0/);
});

test("server.ts is transport only for notifications: it reaches the store's writes only through app/notifications.ts (AD-16)", () => {
  const source = serverSources();
  const imported = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']\.\.\/adapters\/notification-store\.ts["']/g)]
    .flatMap((m) => (m[1] ?? "").split(","))
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .filter(Boolean);
  assert.ok(imported.includes("tailOutboxSince"), "the SSE route tails the outbox through the store");
  // No create / mark-read / outbox-append from the shell: those go through app/.
  assert.deepEqual(
    imported.filter((name) => /^(createNotification|createNotificationInTx|appendOutboxInTx|markNotificationRead)$/.test(name)),
    [],
  );
  assert.match(source, /from\s*["']\.\.\/app\/notifications\.ts["']/);
});

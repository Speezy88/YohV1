/**
 * Tests for `src/shell/server.ts` (Story 7.2; AD-15, AD-17, Consistency
 * Conventions). Hono's `app.request(...)` drives the app in-process, and
 * `startServer`'s `serve()` call goes through an injected fake — this suite
 * never binds a real port or makes a network call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hc } from "hono/client";
import type { LogEntry } from "../src/adapters/logger.ts";
import type { AppType, HealthResponse } from "../src/types/api.ts";
import { app, createApp, startServer, type ServeOptions } from "../src/shell/server.ts";

function fakeServe() {
  const calls: ServeOptions[] = [];
  let closed = 0;
  const serveFn = (options: ServeOptions) => {
    calls.push(options);
    return { close: () => void closed++ };
  };
  return { calls, serveFn, closedCount: () => closed };
}

test("GET /api/health returns 200 {ok:true}", async () => {
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await res.json(), { ok: true });
});

test("every /api request logs one structured line with its duration (Consistency Conventions: Performance)", async () => {
  const entries: LogEntry[] = [];
  const ticks = [1_000, 1_012];
  const logged = createApp({ log: (e) => entries.push(e), now: () => ticks.shift() ?? 0 });

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
});

test("the default app's request log is single-line JSON (writeStructuredLog)", async () => {
  const lines: string[] = [];
  const logged = createApp({ log: (e) => lines.push(`${JSON.stringify(e)}\n`), now: () => 0 });
  await logged.request("/api/health");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.trimEnd().includes("\n"), false);
  assert.equal(JSON.parse(lines[0]!).event, "server.api-request");
});

test("the typed Hono RPC client, bound to types/api.ts's AppType, reaches /api/health (AD-17, Ruling R2)", async () => {
  const client = hc<AppType>("http://yoh.test", { fetch: (input: string | URL | Request, init?: RequestInit) => app.request(input, init) });
  const res = await client.api.health.$get();
  const body: HealthResponse = await res.json();
  assert.deepEqual(body, { ok: true });
  // The route schema is real, not `any`: an undeclared route doesn't type-check.
  // @ts-expect-error — no /api/nope route exists on AppType.
  assert.equal(typeof client.api.nope, "function");
});

test("startServer binds 127.0.0.1 (loopback only), never 0.0.0.0 or an unspecified host (AD-15)", () => {
  const fake = fakeServe();
  const handle = startServer({}, fake.serveFn);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]!.hostname, "127.0.0.1");
  assert.equal(typeof fake.calls[0]!.fetch, "function");
  handle.close();
  assert.equal(fake.closedCount(), 1);
});

test("startServer reads YOH_SERVER_PORT, defaulting to 8787", () => {
  const fake = fakeServe();
  startServer({}, fake.serveFn);
  startServer({ YOH_SERVER_PORT: "9999" }, fake.serveFn);
  assert.equal(fake.calls[0]!.port, 8787);
  assert.equal(fake.calls[1]!.port, 9999);
});

test("startServer refuses an invalid YOH_SERVER_PORT instead of binding somewhere unexpected", () => {
  for (const bad of ["", "abc", "0", "-1", "65536", "80.5", "8787x"]) {
    const fake = fakeServe();
    assert.throws(() => startServer({ YOH_SERVER_PORT: bad }, fake.serveFn), /YOH_SERVER_PORT/, `port ${JSON.stringify(bad)}`);
    assert.equal(fake.calls.length, 0);
  }
});

test("server.ts schedules no ritual: it never imports rituals/ or shell/ritual-cli.ts (AD-5, AD-15)", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "shell", "server.ts"), "utf8");
  // Static `from`, bare side-effect `import "…"`, and dynamic `import("…")`.
  const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);
  assert.ok(specifiers.length > 0);
  assert.deepEqual(
    specifiers.filter((s) => /(^|\/)rituals\/|ritual-cli/.test(s ?? "")),
    [],
  );
  assert.doesNotMatch(source, /0\.0\.0\.0/);
});

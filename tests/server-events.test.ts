/**
 * Tests for `GET /api/events` (Story 7.3, AD-18): the outbox tail / replay /
 * keep-alive loop. `runEventStream` is driven directly against a fake SSE
 * stream with an injected `sleep`, and the route is driven through
 * `app.request` and one real loopback socket with a millisecond poll
 * interval. Nothing here waits on the real ~2 s interval.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import {
  appendOutboxInTx,
  createNotification,
  initNotificationStoreSchema,
  OUTBOX_POLL_INTERVAL_MS,
} from "../src/adapters/notification-store.ts";
import { createApp, runEventStream, KEEP_ALIVE_COMMENT, type SseStreamLike } from "../src/shell/server.ts";

function tempStore(): SqliteConnection {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return connection;
}

function append(connection: SqliteConnection, ...entityIds: string[]) {
  connection.writeTx((tx) => {
    for (const entityId of entityIds) appendOutboxInTx(tx, { topic: "plan", entityId });
  });
}

function raise(connection: SqliteConnection): string {
  return createNotification(connection, { kind: "operational", title: "t", body: "b", deepLink: null, createdAt: "2026-09-25T00:00:00.000Z" });
}

/** Records every frame in order: `{hint, id}` for an event, `"comment"` for a keep-alive. */
function fakeStream() {
  const frames: Array<{ data: unknown; id: string | undefined } | "comment"> = [];
  const listeners: Array<() => void> = [];
  let aborted = false;
  const stream: SseStreamLike & { abort(): void } = {
    get aborted() {
      return aborted;
    },
    onAbort(listener) {
      listeners.push(listener);
    },
    abort() {
      if (aborted) return;
      aborted = true;
      for (const l of listeners) l();
    },
    async writeSSE(message) {
      frames.push({ data: JSON.parse(message.data), id: message.id });
    },
    async write(chunk) {
      assert.equal(chunk, KEEP_ALIVE_COMMENT);
      frames.push("comment");
    },
  };
  const hints = () => frames.filter((f) => f !== "comment");
  const comments = () => frames.filter((f) => f === "comment").length;
  return { stream, frames, hints, comments };
}

const instant = async () => {};

test("KEEP_ALIVE_COMMENT is an SSE comment line (starts with ':'), which EventSource ignores", () => {
  assert.match(KEEP_ALIVE_COMMENT, /^:[^\n]*\n\n$/);
});

test("each tick sends one hint per new outbox row (id = seq), then exactly one keep-alive comment", async () => {
  const connection = tempStore();
  const fake = fakeStream();
  // Rows appear after the stream starts, so a fresh stream sees them.
  let sleeps = 0;
  await runEventStream(fake.stream, connection, {
    maxTicks: 2,
    sleep: async () => {
      sleeps++;
      append(connection, "2026-09-25", "2026-09-26");
    },
  });
  assert.equal(sleeps, 1);
  assert.deepEqual(fake.frames, [
    "comment",
    { data: { seq: 1, topic: "plan", entityId: "2026-09-25" }, id: "1" },
    { data: { seq: 2, topic: "plan", entityId: "2026-09-26" }, id: "2" },
    "comment",
  ]);
  connection.close();
});

test("hints carry {seq, topic, entityId} only, never notification data (AD-18)", async () => {
  const connection = tempStore();
  const fake = fakeStream();
  let id = "";
  await runEventStream(fake.stream, connection, {
    maxTicks: 2,
    sleep: async () => {
      id = raise(connection);
    },
  });
  const [hint] = fake.hints();
  assert.deepEqual(hint, { data: { seq: 1, topic: "notification", entityId: id }, id: "1" });
  connection.close();
});

test("a fresh connection (no Last-Event-ID) starts at the current max seq — no replay of older history", async () => {
  const connection = tempStore();
  append(connection, "a", "b");
  const fake = fakeStream();
  await runEventStream(fake.stream, connection, { maxTicks: 1, sleep: instant });
  assert.deepEqual(fake.frames, ["comment"]);
  connection.close();
});

test("reconnect with Last-Event-ID replays every hint after that seq, in order", async () => {
  const connection = tempStore();
  append(connection, "a", "b", "c", "d");
  const fake = fakeStream();
  await runEventStream(fake.stream, connection, { lastEventId: "1", maxTicks: 1, sleep: instant });
  assert.deepEqual(
    fake.hints().map((h) => (h as { id: string }).id),
    ["2", "3", "4"],
  );
  connection.close();
});

test("Last-Event-ID 0 replays everything", async () => {
  const connection = tempStore();
  append(connection, "a", "b");
  const fake = fakeStream();
  await runEventStream(fake.stream, connection, { lastEventId: "0", maxTicks: 1, sleep: instant });
  assert.equal(fake.hints().length, 2);
  connection.close();
});

test("a malformed Last-Event-ID is treated as a fresh connection, not a stuck stream", async () => {
  for (const bad of ["abc", "-1", "1.5", "", " 2", "1e3", "99999999999999999999"]) {
    const connection = tempStore();
    append(connection, "a", "b");
    const fake = fakeStream();
    await runEventStream(fake.stream, connection, {
      lastEventId: bad,
      maxTicks: 2,
      sleep: async () => append(connection, "c"),
    });
    assert.deepEqual(
      fake.hints().map((h) => (h as { id: string }).id),
      ["3"],
      `Last-Event-ID ${JSON.stringify(bad)}`,
    );
    connection.close();
  }
});

test("a Last-Event-ID beyond the outbox's max seq is clamped, so later hints still arrive", async () => {
  const connection = tempStore();
  append(connection, "a");
  const fake = fakeStream();
  await runEventStream(fake.stream, connection, {
    lastEventId: "500",
    maxTicks: 2,
    sleep: async () => append(connection, "b"),
  });
  assert.deepEqual(
    fake.hints().map((h) => (h as { id: string }).id),
    ["2"],
  );
  connection.close();
});

test("sleeps pollIntervalMs between ticks (N ticks → N-1 sleeps), defaulting to OUTBOX_POLL_INTERVAL_MS", async () => {
  const connection = tempStore();
  const custom: number[] = [];
  const fake = fakeStream();
  await runEventStream(fake.stream, connection, { maxTicks: 3, pollIntervalMs: 123, sleep: async (ms) => void custom.push(ms) });
  assert.deepEqual(custom, [123, 123]);
  assert.equal(fake.comments(), 3, "one keep-alive per poll tick");

  const defaults: number[] = [];
  await runEventStream(fakeStream().stream, connection, { maxTicks: 2, sleep: async (ms) => void defaults.push(ms) });
  assert.deepEqual(defaults, [OUTBOX_POLL_INTERVAL_MS]);
  connection.close();
});

test("an unbounded stream ends when the client disconnects (stream aborted)", async () => {
  const connection = tempStore();
  const fake = fakeStream();
  let sleeps = 0;
  await runEventStream(fake.stream, connection, {
    sleep: async () => {
      if (++sleeps === 3) fake.stream.abort();
    },
  });
  assert.equal(sleeps, 3);
  assert.equal(fake.comments(), 3, "no tick runs after the abort");
  connection.close();
});

test("a stream already aborted before the first tick writes nothing", async () => {
  const connection = tempStore();
  const fake = fakeStream();
  fake.stream.abort();
  await runEventStream(fake.stream, connection, { lastEventId: "0", sleep: instant });
  assert.deepEqual(fake.frames, []);
  connection.close();
});

test("an abort during the default sleep wakes it at once — no waiting out the poll interval", { timeout: 2_000 }, async () => {
  const connection = tempStore();
  const fake = fakeStream();
  const started = performance.now();
  setTimeout(() => fake.stream.abort(), 20);
  await runEventStream(fake.stream, connection, { pollIntervalMs: 60_000 });
  assert.ok(performance.now() - started < 1_000);
  connection.close();
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: RegExp): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!pattern.test(text)) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`stream ended before ${pattern}; got ${JSON.stringify(text)}`);
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

function countingSleep() {
  let calls = 0;
  return {
    calls: () => calls,
    sleep: (ms: number) => {
      calls++;
      return new Promise<void>((resolve) => setTimeout(resolve, ms));
    },
  };
}

/**
 * Route tests hold a live stream open. On ANY exit, including a failed
 * assertion, cancel the client and close the connection; the server's next
 * outbox read then throws and its tail loop ends, so a regression fails the
 * test instead of hanging the test process.
 */
function cleanupAfter(t: { after(fn: () => unknown): void }, connection: SqliteConnection, cancel: () => unknown) {
  t.after(async () => {
    try {
      await cancel();
    } catch {
      // already cancelled
    }
    connection.close();
  });
}

test("GET /api/events is text/event-stream and delivers a new notification's hint", { timeout: 5_000 }, async (t) => {
  const connection = tempStore();
  const ticker = countingSleep();
  const app = createApp({ connection, log: () => {}, eventStream: { pollIntervalMs: 5, sleep: ticker.sleep } });

  const res = await app.request("/api/events");
  const reader = res.body!.getReader();
  cleanupAfter(t, connection, () => reader.cancel());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.equal(res.headers.get("cache-control"), "no-cache");

  await readUntil(reader, /^: keep-alive\n\n/);
  const id = raise(connection);
  const text = await readUntil(reader, /id: 1\n\n/);
  const frame = `data: ${JSON.stringify({ seq: 1, topic: "notification", entityId: id })}\nid: 1\n\n`;
  assert.ok(text.includes(frame), `expected frame ${JSON.stringify(frame)} in ${JSON.stringify(text)}`);

  await reader.cancel();
  const callsAtCancel = ticker.calls();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(ticker.calls() <= callsAtCancel + 1, "the tail loop stops once the client goes away");
});

test("GET /api/events honours the Last-Event-ID request header", { timeout: 5_000 }, async (t) => {
  const connection = tempStore();
  append(connection, "a", "b", "c");
  const app = createApp({ connection, log: () => {}, eventStream: { pollIntervalMs: 5 } });
  const res = await app.request("/api/events", { headers: { "Last-Event-ID": "1" } });
  const reader = res.body!.getReader();
  cleanupAfter(t, connection, () => reader.cancel());
  const text = await readUntil(reader, /id: 3\n/);
  assert.doesNotMatch(text, /id: 1\n/);
  assert.match(text, /id: 2\n[\s\S]*id: 3\n/);
});

test("over a real loopback socket, a client disconnect ends the server's tail loop", { timeout: 5_000 }, async (t) => {
  const connection = tempStore();
  const ticker = countingSleep();
  const app = createApp({ connection, log: () => {}, eventStream: { pollIntervalMs: 5, sleep: ticker.sleep } });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }) as import("node:http").Server;
  const controller = new AbortController();
  cleanupAfter(t, connection, async () => {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once("listening", () => resolve())));
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
  const reader = res.body!.getReader();
  await readUntil(reader, /: keep-alive\n\n/);
  const id = raise(connection);
  await readUntil(reader, new RegExp(id));
  controller.abort();

  // Wait for the server side to notice, then confirm the loop has stopped ticking.
  let previous = -1;
  for (let i = 0; i < 50 && previous !== ticker.calls(); i++) {
    previous = ticker.calls();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(ticker.calls(), previous, "the tail loop stopped after the socket closed");
});

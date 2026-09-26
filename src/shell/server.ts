/**
 * src/shell/server.ts
 *
 * Story 7.2, AD-15: the long-running, systemd-supervised Yoh server
 * (`deploy/yoh-server.service`, `Restart=always`). Transport only (AD-16):
 * it parses HTTP, calls one `app/` function per route, and renders the
 * `Result` as JSON — it never calls an adapter write function itself
 * (`tests/layering-rules.test.ts` enforces this).
 *
 * Reachability: listens on 127.0.0.1 ONLY. The one way in is
 * `tailscale serve` HTTPS on the host's MagicDNS name (`deploy/DEPLOY.md`);
 * never Funnel, a port-forward, or a public domain. Tailnet membership is
 * the authentication — there is no login screen, session cookie, or
 * password (FR-39).
 *
 * Schedules no ritual (AD-5, AD-15): the four cron one-shots (`morning`,
 * `night-prompt`, `night-escalate`, `self-check`) stay OS-scheduled via
 * `shell/ritual-cli.ts`, and this file never imports `rituals/` or
 * `ritual-cli.ts`.
 *
 * Routes are built as ONE chained expression so the app's type carries every
 * route's request/response types — that is what `AppType` needs for
 * `web/`'s typed Hono RPC client (Story 7.5, AD-17). Later stories add
 * routes by extending this chain (or `.route()`-ing a chained sub-app);
 * `types/api.ts` re-exports `AppType` type-only (Ruling R2) so `web/`
 * imports only from `types/`.
 *
 * Story 7.3 adds the process's shared `SqliteConnection` to `ServerDeps`
 * (opened once in `main`, AD-10), the notification routes (transport over
 * `app/notifications.ts`), and `GET /api/events`, the one SSE stream per
 * open client that tails `notification-store.ts`'s outbox (AD-18).
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { writeStructuredLog, type LogEntry } from "../adapters/logger.ts";
import { openSqliteConnection, type SqliteConnection } from "../adapters/sqlite.ts";
import {
  getMaxOutboxSeq,
  initNotificationStoreSchema,
  OUTBOX_POLL_INTERVAL_MS,
  tailOutboxSince,
} from "../adapters/notification-store.ts";
import { HEARTBEAT_INTERVAL_MS, initPlanStateStoreSchema, writeHeartbeat } from "../adapters/plan-state-store.ts";
import { listNotifications, markNotificationRead } from "../app/notifications.ts";
import type { ApiResult, EventHint, HealthResponse } from "../types/api.ts";
import type { YohErrorKind } from "../types/domain.ts";

// ============================================================================
// GET /api/events — outbox tail → SSE hints (AD-18)
// ============================================================================

/** The SSE comment sent on every poll tick so `tailscale serve` (or any intermediary) never sees an idle stream. EventSource ignores it. */
export const KEEP_ALIVE_COMMENT = ": keep-alive\n\n";

/**
 * The slice of Hono's `SSEStreamingApi` the tail loop uses, so tests can
 * drive it with a plain fake. Hono swallows write errors after the client
 * disconnects, so the loop must watch `aborted` rather than rely on a throw.
 */
export interface SseStreamLike {
  readonly aborted: boolean;
  onAbort(listener: () => void): void;
  writeSSE(message: { data: string; id?: string }): Promise<void>;
  write(chunk: string): Promise<unknown>;
}

export interface RunEventStreamOptions {
  /** The `Last-Event-ID` request header on reconnect. Absent or malformed → start fresh at the current max seq. */
  readonly lastEventId?: string | undefined;
  /** Defaults to `OUTBOX_POLL_INTERVAL_MS`. */
  readonly pollIntervalMs?: number;
  /** Bounds the loop (tests). Default: until the client disconnects. */
  readonly maxTicks?: number;
  /** Waits between ticks; must resolve early when `signal` aborts. Default: a `setTimeout` sleep that does. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Where the stream starts. A well-formed `Last-Event-ID` resumes after that
 * seq (clamped to the current max, so an id from a reset database can't
 * wedge the stream); anything else starts at the current max, so a first
 * connection never replays old history.
 */
function startSeq(connection: SqliteConnection, lastEventId: string | undefined): number {
  const maxSeq = getMaxOutboxSeq(connection);
  if (lastEventId === undefined || !/^\d{1,15}$/.test(lastEventId)) return maxSeq;
  return Math.min(Number(lastEventId), maxSeq);
}

/**
 * The loop behind `GET /api/events` (AD-18). Each poll tick sends one hint
 * per outbox row past the last seq sent — `{seq, topic, entityId}` only,
 * never data, with `id: seq` so EventSource reports it back as
 * `Last-Event-ID` on reconnect — then one keep-alive comment. The first tick
 * runs immediately (flushing headers through any proxy); later ticks follow
 * `pollIntervalMs` apart. Ends when the client disconnects.
 */
export async function runEventStream(
  stream: SseStreamLike,
  connection: SqliteConnection,
  options: RunEventStreamOptions = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? OUTBOX_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? abortableSleep;
  const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY;
  const disconnected = new AbortController();
  stream.onAbort(() => disconnected.abort());

  let sinceSeq = startSeq(connection, options.lastEventId);
  for (let tick = 0; tick < maxTicks && !stream.aborted; tick++) {
    if (tick > 0) {
      await sleep(pollIntervalMs, disconnected.signal);
      if (stream.aborted) break;
    }
    for (const row of tailOutboxSince(connection, sinceSeq)) {
      const hint: EventHint = { seq: row.seq, topic: row.topic, entityId: row.entityId };
      await stream.writeSSE({ data: JSON.stringify(hint), id: String(hint.seq) });
      sinceSeq = hint.seq;
    }
    await stream.write(KEEP_ALIVE_COMMENT);
  }
}

// ============================================================================
// Heartbeat writer (Story 7.4, AD-7) — the server side of the dead-man's
// switch `ritual-cli.ts morning` checks on start.
// ============================================================================

export interface HeartbeatWriterOptions {
  readonly intervalMs?: number;
  readonly now?: () => Date;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

export interface HeartbeatWriterHandle {
  stop(): void;
}

/**
 * Writes a heartbeat immediately, then on every `intervalMs` tick (AD-7).
 * `setIntervalFn`/`clearIntervalFn`/`now` are injectable, mirroring
 * `runEventStream`'s (Story 7.3) DI convention — a test never waits on a
 * real interval.
 */
export function startHeartbeatWriter(connection: SqliteConnection, options: HeartbeatWriterOptions = {}): HeartbeatWriterHandle {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  writeHeartbeat(connection, now().toISOString());
  const handle = setIntervalFn(() => writeHeartbeat(connection, now().toISOString()), intervalMs);

  return {
    stop(): void {
      clearIntervalFn(handle);
    },
  };
}

// ============================================================================
// The app
// ============================================================================

export interface ServerDeps {
  /** The process's one SQLite connection (AD-10), opened in `main`. */
  readonly connection: SqliteConnection;
  /** One structured log line (Consistency Conventions: single-line JSON to stderr). */
  readonly log?: (entry: LogEntry) => void;
  /** Monotonic-enough millisecond clock for per-request duration. */
  readonly now?: () => number;
  /** Wall clock for timestamps a route stamps (e.g. a notification's `readAt`). */
  readonly clock?: () => Date;
  /** Test seam for `GET /api/events`'s poll interval and sleep. */
  readonly eventStream?: Pick<RunEventStreamOptions, "pollIntervalMs" | "sleep">;
}

/** HTTP status for a serialized `Result` — the body is always the envelope; the status just makes logs and devtools honest. */
const ERROR_STATUS: Readonly<Record<YohErrorKind, ContentfulStatusCode>> = {
  "missing-field": 400,
  validation: 400,
  "stale-proposal": 409,
  conflict: 409,
  "rate-limited": 429,
  "auth-expired": 503,
  unreachable: 503,
};

function httpStatus(result: ApiResult<unknown>): ContentfulStatusCode {
  return result.ok ? 200 : ERROR_STATUS[result.error.kind];
}

/** Drops `detail` (a raw adapter error, possibly with internals) before the envelope crosses the wire. */
function wire<T>(result: ApiResult<T>): ApiResult<T> {
  return result.ok ? result : { ok: false, error: { kind: result.error.kind, message: result.error.message } };
}

export function createApp(deps: ServerDeps) {
  const log = deps.log ?? ((entry: LogEntry) => writeStructuredLog(entry));
  const now = deps.now ?? (() => performance.now());
  const notificationsDeps = { connection: deps.connection, now: deps.clock ?? (() => new Date()) };

  return (
    new Hono()
      // Story 7.5, AD-17: on every response, not just /api/* — so the built
      // web/ bundle, its static assets, and every API response alike can
      // never call a third party or load a third-party script/font. First
      // in the chain so it still applies to a 404 (no route matched).
      .use("*", async (c, next) => {
        await next();
        c.header("Content-Security-Policy", "default-src 'self'");
      })
      // Consistency Conventions (Performance): the server logs duration per API request.
      // For GET /api/events this is time-to-headers, not the stream's lifetime.
      .use("/api/*", async (c, next) => {
        // try/finally so a request whose handler throws still gets its line.
        // Hono routes a thrown Error to onError (next() resolves with a 500),
        // but rethrows a non-Error value straight through next().
        const startedAt = now();
        let threw = false;
        try {
          await next();
        } catch (err) {
          threw = true;
          throw err;
        } finally {
          log({
            level: "info",
            event: "server.api-request",
            detail: { method: c.req.method, path: c.req.path, status: threw ? 500 : c.res.status, durationMs: now() - startedAt },
          });
        }
      })
      // Liveness probe — the one route that is not an ApiResult envelope (see HealthResponse).
      .get("/api/health", (c) => c.json({ ok: true } satisfies HealthResponse))
      // AD-18: one hint stream per open client. `Last-Event-ID` is the
      // browser's OWN automatic resend on ITS OWN transient reconnect (same
      // `EventSource` object) — no client code needed for that case. Story
      // 7.7's client additionally falls back to a `?lastEventId=` query
      // parameter when it gives up on a dead `EventSource` and opens a
      // brand-new one (which has no memory of the header), so this route
      // reads the query string whenever the header is absent.
      .get("/api/events", (c) =>
        streamSSE(
          c,
          (stream) =>
            runEventStream(stream, deps.connection, {
              ...deps.eventStream,
              lastEventId: c.req.header("Last-Event-ID") ?? c.req.query("lastEventId"),
            }),
          async (err) => {
            // The client's EventSource reconnects with Last-Event-ID, so no hint is lost.
            log({ level: "error", event: "server.event-stream-failed", detail: { message: err.message } });
          },
        ),
      )
      .get("/api/notifications", async (c) => {
        const result = wire(await listNotifications(notificationsDeps, {}));
        return c.json(result, httpStatus(result));
      })
      .post("/api/notifications/:id/read", async (c) => {
        const result = wire(await markNotificationRead(notificationsDeps, { id: c.req.param("id") }));
        return c.json(result, httpStatus(result));
      })
      // Story 7.5, AD-15/AD-17: the built web/ SPA, mounted after every
      // /api/* route so nothing here can ever shadow the API.
      .use("/*", serveStatic({ root: "./web/dist" }))
  );
}

/** The server's route type. Imported by `web/` only through `types/api.ts`'s type-only re-export (Ruling R2). */
export type AppType = ReturnType<typeof createApp>;

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;

export interface ServeOptions {
  readonly fetch: (request: Request) => Response | Promise<Response>;
  readonly hostname: string;
  readonly port: number;
}

export interface ServerHandle {
  close(): unknown;
}

export type ServeFn = (options: ServeOptions) => ServerHandle;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`YOH_SERVER_PORT must be an integer 1-65535, got ${JSON.stringify(raw)}`);
  }
  return port;
}

/**
 * Binds the app to loopback only (AD-15), serving from `connection` (the
 * caller owns it and closes it). `serveFn` defaults to `@hono/node-server`'s
 * `serve`; tests inject a fake so no socket opens.
 */
export function startServer(
  connection: SqliteConnection,
  env: Readonly<Record<string, string | undefined>> = process.env,
  serveFn: ServeFn = (options) => serve({ ...options }),
): ServerHandle {
  const port = parsePort(env["YOH_SERVER_PORT"]);
  const app = createApp({ connection });
  return serveFn({ fetch: app.fetch, hostname: LOOPBACK_HOST, port });
}

if (import.meta.main) {
  // AD-10: one connection per process, to the same file the cron one-shots use.
  const connection = openSqliteConnection({ databasePath: process.env["MEMORY_DB_PATH"] || "./data/yoh-memory.db" });
  // AD-10: each owner creates its dedicated tables idempotently on startup.
  initNotificationStoreSchema(connection.db);
  initPlanStateStoreSchema(connection.db);
  // Story 7.4, AD-7: writes the heartbeat `ritual-cli.ts morning` checks on
  // start; stopped alongside the server on shutdown, below.
  const heartbeat = startHeartbeatWriter(connection);
  const handle = startServer(connection);
  writeStructuredLog({
    level: "info",
    event: "server.listening",
    detail: { hostname: LOOPBACK_HOST, port: parsePort(process.env["YOH_SERVER_PORT"]) },
  });
  // systemd stops the unit with SIGTERM. Stop accepting connections and let
  // in-flight requests drain; open SSE streams hold the loop open, so exit
  // after a short grace period to keep `systemctl stop/restart` prompt.
  // Clients reconnect with Last-Event-ID and miss nothing.
  const shutdown = (signal: string) => {
    writeStructuredLog({ level: "info", event: "server.stopping", detail: { signal } });
    heartbeat.stop();
    handle.close();
    setTimeout(() => {
      connection.close();
      process.exit(0);
    }, 3_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

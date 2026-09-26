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
 * Routes are built as ONE chained expression so `typeof app` carries every
 * route's request/response types — that is what `AppType` needs for
 * `web/`'s typed Hono RPC client (Story 7.5, AD-17). Later stories add
 * routes by extending this chain (or `.route()`-ing a chained sub-app);
 * `types/api.ts` re-exports `AppType` type-only (Ruling R2) so `web/`
 * imports only from `types/`.
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { writeStructuredLog, type LogEntry } from "../adapters/logger.ts";
import type { HealthResponse } from "../types/api.ts";

export interface ServerDeps {
  /** One structured log line (Consistency Conventions: single-line JSON to stderr). */
  readonly log: (entry: LogEntry) => void;
  /** Monotonic-enough millisecond clock for per-request duration. */
  readonly now: () => number;
}

const defaultDeps: ServerDeps = {
  log: (entry) => writeStructuredLog(entry),
  now: () => performance.now(),
};

export function createApp(deps: ServerDeps = defaultDeps) {
  return (
    new Hono()
      // Consistency Conventions (Performance): the server logs duration per API request.
      .use("/api/*", async (c, next) => {
        const startedAt = deps.now();
        await next();
        deps.log({
          level: "info",
          event: "server.api-request",
          detail: { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: deps.now() - startedAt },
        });
      })
      // Liveness probe — the one route that is not an ApiResult envelope (see HealthResponse).
      .get("/api/health", (c) => c.json({ ok: true } satisfies HealthResponse))
  );
}

export const app = createApp();

/** The server's route type. Imported by `web/` only through `types/api.ts`'s type-only re-export (Ruling R2). */
export type AppType = typeof app;

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
 * Binds the app to loopback only (AD-15). `serveFn` defaults to
 * `@hono/node-server`'s `serve`; tests inject a fake so no socket opens.
 */
export function startServer(
  env: Readonly<Record<string, string | undefined>> = process.env,
  serveFn: ServeFn = (options) => serve({ ...options }),
): ServerHandle {
  const port = parsePort(env["YOH_SERVER_PORT"]);
  return serveFn({ fetch: app.fetch, hostname: LOOPBACK_HOST, port });
}

if (import.meta.main) {
  const handle = startServer();
  writeStructuredLog({
    level: "info",
    event: "server.listening",
    detail: { hostname: LOOPBACK_HOST, port: parsePort(process.env["YOH_SERVER_PORT"]) },
  });
  // systemd stops the unit with SIGTERM. Stop accepting connections and let
  // in-flight requests drain; if something (e.g. a later story's SSE
  // stream) holds the loop open, exit anyway after a short grace period so
  // `systemctl stop/restart` stays prompt.
  const shutdown = (signal: string) => {
    writeStructuredLog({ level: "info", event: "server.stopping", detail: { signal } });
    handle.close();
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

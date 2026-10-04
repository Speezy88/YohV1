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
 * Schedules no ritual (AD-5, AD-15): the three cron one-shots (`morning`,
 * `night-prompt`, `night-escalate`) stay OS-scheduled via
 * `shell/ritual-cli.ts`, and this file never imports `rituals/` or
 * `ritual-cli.ts`.
 *
 * This file is the entry point: `startServer` and the process startup at
 * the bottom. The rest lives beside it and is re-exported here, so importers
 * keep using `shell/server.ts`: `server-routes.ts` (`ServerDeps`,
 * `createApp`), `server-streams.ts` (the SSE streams and background sweeps)
 * and `server-wiring.ts` (the real `build*Deps`). The paragraphs below
 * describe all four files.
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
 *
 * Story 7.10 adds the check-off routes (transport over `app/check-off.ts`)
 * and AD-20's commit sweep runner, `startCheckOffCommitSweep`: one sweep at
 * startup (records left overdue by a previous process), then one per
 * `CHECK_OFF_COMMIT_TICK_MS`. This file only constructs the Notion client
 * the sweep is given; the Status write itself is made inside `app/`.
 *
 * Story 8.5 adds `POST /api/chat` (AD-18, contract C5): one `chatTurn`
 * call per request, its `status`/`delta` events streamed on that request's
 * own SSE response and closed by exactly one `done`/`error` event
 * (`runChatStream`). The process holds ONE `ChatSession`, built in
 * `startServer` and shared by every chat route (contract C3).
 */
import { serve } from "@hono/node-server";
import { writeStructuredLog } from "../adapters/logger.ts";
import { openSqliteConnection, type SqliteConnection } from "../adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../adapters/notification-store.ts";
import { createChatStore, initChatStoreSchema } from "../adapters/chat-store.ts";
import { initSettingsStoreSchema } from "../adapters/settings-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../adapters/memory-item-store.ts";
import { createRatingStore, initRatingStoreSchema } from "../adapters/rating-store.ts";
import { initRoutineStoreSchema } from "../adapters/routine-store.ts";
import { initPlanStateStoreSchema } from "../adapters/plan-state-store.ts";
import { createMemoryStore, removeRetiredRecords } from "../adapters/memory-store.ts";
import { initCompletionLogSchema } from "../adapters/completion-log.ts";
import { initLlmUsageStoreSchema } from "../adapters/llm-usage-store.ts";
import { initJobStoreSchema } from "../adapters/job-store.ts";
import type { ChatSession } from "../app/chat-session.ts";
import { startHeartbeatWriter, startPlanCalendarSyncSweep, startCheckOffCommitSweep, startResearchJobRunner } from "./server-streams.ts";
import { createApp, type ServerDeps } from "./server-routes.ts";
import { loadNotionFeatureConfig, buildHomeViewDeps, buildCalendarDayDeps, buildTasksDeps, buildSandboxDeps, buildResearchDeps, buildCheckOffDeps, buildPlanDeps, buildPlanSyncDeps, buildChatDeps } from "./server-wiring.ts";

// Public names of the split-out files: importers (tests, the fixture server, `types/api.ts`) keep using `shell/server.ts`.
export {
  KEEP_ALIVE_COMMENT,
  runEventStream,
  startHeartbeatWriter,
  PLAN_CALENDAR_SYNC_INTERVAL_MS,
  startPlanCalendarSyncSweep,
  startCheckOffCommitSweep,
  startResearchJobRunner,
  runChatStream,
  type SseStreamLike,
  type RunEventStreamOptions,
  type HeartbeatWriterOptions,
  type HeartbeatWriterHandle,
  type PlanCalendarSyncSweepOptions,
  type PlanCalendarSyncSweepHandle,
  type CheckOffCommitSweepOptions,
  type CheckOffCommitSweepHandle,
  type ResearchJobRunnerOptions,
  type ResearchJobRunnerHandle,
  type ChatSseStreamLike,
  type ChatTurnFn,
} from "./server-streams.ts";
export {
  JSON_CONTENT_TYPE_REQUIRED_MESSAGE,
  createApp,
  type ServerDeps,
  type AppType,
} from "./server-routes.ts";

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
  /** Story 7.8's `homeView`, Story 7.10's `checkOff`, Story 8.5's `chat`, Task 6C's `research`, Task 4's `calendarDay`, and Story 9.2's `sandbox`, threaded through the same way `connection` already is. */
  features: Pick<ServerDeps, "homeView" | "calendarDay" | "checkOff" | "plan" | "planSync" | "chat" | "chatHistory" | "memoryItems" | "ratings" | "tasks" | "research" | "sandbox"> = {},
): ServerHandle {
  const port = parsePort(env["YOH_SERVER_PORT"]);
  // Contract C3: one ChatSession per server process, shared by every chat route.
  const chatSession: ChatSession = { recentMessages: [], lastSearchAnswer: undefined, researchOffered: new Set<string>() };
  const app = createApp({
    connection,
    chatSession,
    ...(features.homeView ? { homeView: features.homeView } : {}),
    ...(features.calendarDay ? { calendarDay: features.calendarDay } : {}),
    ...(features.checkOff ? { checkOff: features.checkOff } : {}),
    ...(features.plan ? { plan: features.plan } : {}),
    ...(features.planSync ? { planSync: features.planSync } : {}),
    ...(features.chat ? { chat: features.chat } : {}),
    ...(features.chatHistory ? { chatHistory: features.chatHistory } : {}),
    ...(features.memoryItems ? { memoryItems: features.memoryItems } : {}),
    ...(features.ratings ? { ratings: features.ratings } : {}),
    ...(features.tasks ? { tasks: features.tasks } : {}),
    ...(features.research ? { research: features.research } : {}),
    ...(features.sandbox ? { sandbox: features.sandbox } : {}),
  });
  return serveFn({ fetch: app.fetch, hostname: LOOPBACK_HOST, port });
}

if (import.meta.main) {
  // AD-10: one connection per process, to the same file the cron one-shots use.
  const connection = openSqliteConnection({ databasePath: process.env["MEMORY_DB_PATH"] || "./data/yoh-memory.db" });
  // AD-10: each owner creates its dedicated tables idempotently on startup.
  initNotificationStoreSchema(connection.db);
  initPlanStateStoreSchema(connection.db);
  initRoutineStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  initRatingStoreSchema(connection.db);
  initSettingsStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  initJobStoreSchema(connection.db);
  // Story 13.12 (Ruling E11): one-time, idempotent removal of the retired
  // periodic check-in's stored leftovers. Never fatal.
  try {
    const { removed } = removeRetiredRecords(createMemoryStore(connection));
    if (removed > 0) writeStructuredLog({ level: "info", event: "server.retired-cleanup", detail: { removed } });
  } catch (error) {
    writeStructuredLog({ level: "warn", event: "server.retired-cleanup", detail: { message: error instanceof Error ? error.message : String(error) } });
  }
  // Real-use fixes plan, Task 9: `server.ts` is the ONE shell that makes
  // real Claude calls (POST /api/chat's `buildChatDeps` in `server-wiring.ts`) —
  // `ritual-cli.ts` never calls Claude at all, so it needs no equivalent
  // init call.
  initLlmUsageStoreSchema(connection.db);
  // Story 7.4, AD-7: writes the heartbeat `ritual-cli.ts morning` checks on
  // start; stopped alongside the server on shutdown, below.
  const heartbeat = startHeartbeatWriter(connection);
  const notion = loadNotionFeatureConfig(connection, process.env);
  const homeView = notion ? buildHomeViewDeps(notion, process.env) : undefined;
  const calendarDay = notion ? buildCalendarDayDeps(notion, process.env) : undefined;
  const checkOff = notion ? buildCheckOffDeps(notion) : undefined;
  const chat = buildChatDeps(connection, notion, process.env);
  const tasks = notion ? buildTasksDeps(notion, process.env, chat?.llmClient) : undefined;
  const research = buildResearchDeps(notion, process.env);
  const sandbox = notion ? buildSandboxDeps(notion) : undefined;
  const plan = buildPlanDeps(chat);
  const planSync = buildPlanSyncDeps(chat);
  const handle = startServer(connection, process.env, undefined, {
    ...(plan ? { plan } : {}),
    ...(planSync ? { planSync } : {}),
    ...(homeView ? { homeView } : {}),
    ...(calendarDay ? { calendarDay } : {}),
    ...(checkOff ? { checkOff } : {}),
    ...(chat ? { chat } : {}),
    chatHistory: createChatStore(connection),
    memoryItems: createMemoryItemStore(connection),
    ratings: createRatingStore(connection),
    ...(tasks ? { tasks } : {}),
    ...(research ? { research } : {}),
    ...(sandbox ? { sandbox } : {}),
  });
  // Story 7.10, AD-20: the startup sweep commits anything left overdue by a
  // previous process, then the commit timer takes over.
  const checkOffSweep = checkOff ? startCheckOffCommitSweep({ ...checkOff, connection, now: () => new Date() }) : undefined;
  const planSyncSweep = planSync ? startPlanCalendarSyncSweep(planSync) : undefined;
  // Story 11.3 (E11-R9): recovery first, then one queued research job per tick. Needs search and the Notion vault.
  const researchRunner =
    chat?.webSearchAvailable && chat.getNotionCreatePageBinding().ok && chat.timeZone
      ? startResearchJobRunner({ connection, searchFn: chat.searchFn, getNotionCreatePageBinding: chat.getNotionCreatePageBinding, timeZone: chat.timeZone, now: () => new Date() })
      : undefined;
  writeStructuredLog({
    level: "info",
    event: "server.listening",
    detail: { hostname: LOOPBACK_HOST, port: parsePort(process.env["YOH_SERVER_PORT"]) },
  });
  // systemd stops the unit with SIGTERM. Stop accepting connections and let
  // in-flight requests drain; open SSE streams hold the loop open, so exit
  // after a short grace period to keep `systemctl stop/restart` prompt.
  // Clients reconnect with Last-Event-ID and miss nothing. A check-off still
  // inside its window when the process stops is committed by the next
  // process's startup sweep.
  const shutdown = (signal: string) => {
    writeStructuredLog({ level: "info", event: "server.stopping", detail: { signal } });
    heartbeat.stop();
    checkOffSweep?.stop();
    planSyncSweep?.stop();
    researchRunner?.stop();
    handle.close();
    setTimeout(() => {
      connection.close();
      process.exit(0);
    }, 3_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

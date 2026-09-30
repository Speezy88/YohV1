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
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { validator } from "hono/validator";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Client } from "@notionhq/client";
import { writeStructuredLog, type LogEntry } from "../adapters/logger.ts";
import { openSqliteConnection, type SqliteConnection } from "../adapters/sqlite.ts";
import {
  getMaxOutboxSeq,
  initNotificationStoreSchema,
  OUTBOX_POLL_INTERVAL_MS,
  tailOutboxSince,
} from "../adapters/notification-store.ts";
import { createChatStore, initChatStoreSchema, type ChatStore } from "../adapters/chat-store.ts";
import { initSettingsStoreSchema } from "../adapters/settings-store.ts";
import { chatExchange, type ChatTurnFn } from "../app/chat-exchange.ts";
import { todaysChatHistory } from "../app/chat-history.ts";
import { initRoutineStoreSchema } from "../adapters/routine-store.ts";
import { HEARTBEAT_INTERVAL_MS, initPlanStateStoreSchema, writeHeartbeat } from "../adapters/plan-state-store.ts";
import { createMemoryStore, type MemoryStore } from "../adapters/memory-store.ts";
import {
  initCompletionLogSchema,
  listCompletedTaskIdsOnDate,
  recordCompletion as completionLogRecordCompletion,
  type RecordCompletionInput,
} from "../adapters/completion-log.ts";
import { createTokenStore, loadGoogleOAuthConfigFromEnv, type TokenStore } from "../adapters/token-store.ts";
import {
  bindCalendarApply,
  createCalendarBroadClient,
  createCalendarReadClient,
  createCalendarWriteClient,
  parseExtraCalendarIds,
  proposeCalendarEdit as calendarProposeEdit,
  proposeNewCalendarEvent,
  readCalendarEvents,
  readDeletedYohPlanEventIds,
  readYohPlanEvents,
  resolveCalendarEditRoute as calendarResolveRoute,
  writeTodaysPlanToCalendar,
  type CalendarApplyBindingFn,
  type CalendarBroadClient,
  type CalendarWriteClient,
} from "../adapters/calendar-adapter.ts";
import { createPlanCalendarSnapshotStore } from "../adapters/plan-calendar-snapshot-store.ts";
import {
  bindNotionCreatePage,
  bindNotionTaskWrites,
  loadTaskPropertyNamesFromEnv,
  readNotionTasks,
  readResearchVault,
  readTaskFieldOptions,
  type NotionCreatePageBindingFn,
  type NotionTaskPropertyNames,
  type NotionTaskWriteBindingFn,
} from "../adapters/notion-adapter.ts";
import { createAnthropicMessagesClient, loadLlmAdapterConfigFromEnv, type AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import { initLlmUsageStoreSchema } from "../adapters/llm-usage-store.ts";
import { errorCopyForWire, GENERIC_SERVER_ERROR_MESSAGE } from "../core/error-copy.ts";
import { search as runSearch } from "../adapters/search-adapter.ts";
import { listNotifications, markNotificationRead } from "../app/notifications.ts";
import { listCommands } from "../app/commands.ts";
import { chatTurn, type ChatTurnDeps } from "../app/chat-turn.ts";
import type { ChatSession } from "../app/chat-session.ts";
import type { SearchFn } from "../app/web-search.ts";
import { getHomeView, type HomeViewDeps } from "../app/home-view.ts";
import { getCalendarDay, type CalendarDayDeps } from "../app/calendar-day.ts";
import { declareTimeBudget } from "../app/time-budget.ts";
import {
  CHECK_OFF_COMMIT_TICK_MS,
  checkOff,
  commitDueCheckOffs,
  holdCheckOff,
  releaseCheckOff,
  undoCheckOff,
  type CheckOffDeps,
} from "../app/check-off.ts";
import { surfaceOpenItems } from "../app/surface-open-items.ts";
import { answerOpenItem, type AnswerOpenItemDeps } from "../app/answer-open-item.ts";
import { approveReshuffleById, discardReshuffleById, requestReshuffleView } from "../app/decide-reshuffle.ts";
import type { ApproveReshuffleDeps } from "../app/approve-reshuffle.ts";
import { syncPlanFromCalendar, type SyncPlanFromCalendarDeps, type SyncPlanFromCalendarOutput } from "../app/sync-plan-from-calendar.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { parseReshuffleRequest } from "../core/reshuffle-preview.ts";
import { listTasks, type TasksViewDeps } from "../app/tasks-view.ts";
import { createTask, previewQuickAdd, type CreateTaskDeps } from "../app/create-task.ts";
import { renameTask, updateTask, type UpdateTaskDeps } from "../app/update-task.ts";
import { listResearch, type ResearchListDeps } from "../app/research-list.ts";
import { sandboxQueue, type SandboxQueueDeps } from "../app/sandbox-queue.ts";
import { finishSandboxSession, saveSandboxCardAndAdvance, type SandboxSubmitDeps } from "../app/sandbox-submit.ts";
import { firstCardView } from "../core/sandbox-card-view.ts";
import type {
  AnswerOpenItemRequest,
  ApiResult,
  PlanSyncResponse,
  CalendarDayRequest,
  ChatStreamEvent,
  ChatTurnRequest,
  ChatTurnResponse,
  CheckOffRequest,
  CreateTaskRequest,
  EventHint,
  HealthResponse,
  NeedsDataCountResponse,
  QuickAddPreviewRequest,
  RenameTaskRequest,
  SandboxFinishRequest,
  SandboxSaveRequest,
  SandboxSkipRequest,
  SandboxStartRequest,
  TasksGroupBy,
  TasksListRequest,
  TimeBudgetRequest,
  ReshuffleDecisionRequest,
  UpdateTaskFieldRequest,
} from "../types/api.ts";
import type { CalendarEvent, ChatTurn, EditableTaskField, ExternalId, IsoDate, Result, Task, TaskFieldOptions, YohError, YohErrorKind } from "../types/domain.ts";

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
// Yoh Plan calendar sync sweep — folds Spencer's edits on the Yoh Plan calendar
// back into today's Plan every 2 minutes, and on demand (`POST /api/plan/sync`).
// ============================================================================

export const PLAN_CALENDAR_SYNC_INTERVAL_MS = 2 * 60 * 1000;

export interface PlanCalendarSyncSweepOptions {
  readonly intervalMs?: number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
  readonly log?: (entry: LogEntry) => void;
}

type PlanSyncResult = Result<SyncPlanFromCalendarOutput, YohError>;

export interface PlanCalendarSyncSweepHandle {
  readonly startup: Promise<PlanSyncResult>;
  /** Runs one sync now, or joins the one already running; resolves to that run's Result. */
  runOnce(): Promise<PlanSyncResult>;
  stop(): void;
}

/** One lock per deps object, so the timer and `POST /api/plan/sync` never overlap. */
const planSyncRunners = new WeakMap<SyncPlanFromCalendarDeps, () => Promise<PlanSyncResult>>();

function getPlanSyncRunner(deps: SyncPlanFromCalendarDeps, log: (entry: LogEntry) => void): () => Promise<PlanSyncResult> {
  const existing = planSyncRunners.get(deps);
  if (existing) return existing;
  let inFlight: Promise<PlanSyncResult> | undefined;
  const runOnce = (): Promise<PlanSyncResult> => {
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<PlanSyncResult> => {
      try {
        const result = await syncPlanFromCalendar({ ...deps, log: deps.log ?? log }, {});
        if (!result.ok) {
          log({ level: "error", event: "server.plan-sync-failed", detail: { message: result.error.message } });
        } else if (result.value.status === "applied") {
          log({ level: "info", event: "server.plan-sync", detail: { ...result.value } });
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log({ level: "error", event: "server.plan-sync-failed", detail: { message } });
        return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err), detail: err } };
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };
  planSyncRunners.set(deps, runOnce);
  return runOnce;
}

export function startPlanCalendarSyncSweep(deps: SyncPlanFromCalendarDeps, options: PlanCalendarSyncSweepOptions = {}): PlanCalendarSyncSweepHandle {
  const intervalMs = options.intervalMs ?? PLAN_CALENDAR_SYNC_INTERVAL_MS;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const log = options.log ?? ((entry: LogEntry) => writeStructuredLog(entry));
  const runOnce = getPlanSyncRunner(deps, log);
  const startup = runOnce();
  const handle = setIntervalFn(() => void runOnce(), intervalMs);
  return {
    startup,
    runOnce,
    stop(): void {
      clearIntervalFn(handle);
    },
  };
}

// ============================================================================
// Check-off commit sweep (Story 7.10, AD-20) — commits due check-offs
// whether or not any browser tab is still open.
// ============================================================================

export interface CheckOffCommitSweepOptions {
  readonly intervalMs?: number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
  readonly log?: (entry: LogEntry) => void;
}

export interface CheckOffCommitSweepHandle {
  /** Settles once the startup sweep (records left overdue by a previous process) has run. */
  readonly startup: Promise<void>;
  /** Runs one sweep now — or joins the one already running, so sweeps never overlap. */
  runOnce(): Promise<void>;
  stop(): void;
}

/**
 * Sweeps immediately (the startup sweep), then on every `intervalMs` tick.
 * A tick that lands while a sweep is still running (a slow Notion write)
 * joins it rather than starting a second one. Logs one structured line per
 * sweep that did something, and every failure; an idle tick is silent.
 */
export function startCheckOffCommitSweep(deps: CheckOffDeps, options: CheckOffCommitSweepOptions = {}): CheckOffCommitSweepHandle {
  const intervalMs = options.intervalMs ?? CHECK_OFF_COMMIT_TICK_MS;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const log = options.log ?? ((entry: LogEntry) => writeStructuredLog(entry));

  let inFlight: Promise<void> | undefined;
  const runOnce = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const result = await commitDueCheckOffs({ ...deps, log }, {});
        if (!result.ok) {
          log({ level: "error", event: "server.check-off-sweep-failed", detail: { message: result.error.message } });
        } else if (result.value.committed + result.value.notionSynced + result.value.notionFailed > 0) {
          log({ level: "info", event: "server.check-off-sweep", detail: { ...result.value } });
        }
      } catch (err) {
        log({ level: "error", event: "server.check-off-sweep-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  const startup = runOnce();
  const handle = setIntervalFn(() => void runOnce(), intervalMs);
  return {
    startup,
    runOnce,
    stop(): void {
      clearIntervalFn(handle);
    },
  };
}

// ============================================================================
// POST /api/chat — a chat turn's reply on its own SSE response (Story 8.5,
// AD-18, contract C5)
// ============================================================================

/**
 * The slice of Hono's `SSEStreamingApi` the chat relay needs, so tests can
 * drive it with a plain fake. `aborted` is optional because Hono already
 * swallows write errors once the client is gone; reading it just stops the
 * relay from writing into a closed stream.
 */
export interface ChatSseStreamLike {
  readonly aborted?: boolean;
  writeSSE(message: { readonly event: string; readonly data: string }): Promise<void>;
}

/** `chatTurn`'s signature (contract C3), injectable as `ServerDeps.chat.runChatTurn` (controller ruling (c): the e2e fixture's seam). */
export type { ChatTurnFn };

/** The one event a `POST /api/chat` stream carries when the server has no chat dependencies (controller ruling (b)): an SSE stream, not a JSON body, so the client's one parser handles every outcome. */
const CHAT_NOT_CONFIGURED: ChatStreamEvent = {
  type: "error",
  error: { kind: "unreachable", message: "server: chat dependencies not configured" },
};

/**
 * `event: <type>` + `data: <json>` (contract C5). A terminal `error` drops
 * `detail`, the same rule `wire()` applies to JSON envelopes, and (review
 * fix) maps `message` through `errorCopyForWire` — the same transport-level
 * safety net `wire()` applies — so no stream event (a hardcoded "not
 * configured" constant, a bubbled-up adapter/rituals message that never
 * passed through `app/`'s own `errorCopy` calls, or anything else) can leak
 * raw adapter/module text to `ChatMessage.tsx`'s `errorText` caption.
 */
function sseMessage(event: ChatStreamEvent): { event: string; data: string } {
  const wireEvent: ChatStreamEvent =
    event.type === "error" ? { type: "error", error: { kind: event.error.kind, message: errorCopyForWire(event.error) } } : event;
  return { event: event.type, data: JSON.stringify(wireEvent) };
}

/**
 * Drives one `POST /api/chat` response. `chatTurn` pushes zero or more
 * `status`/`delta` events through `emit` while it runs and never emits a
 * terminal event itself (see `app/chat-turn.ts`), so this function alone
 * writes exactly one `done` or `error`, built from the settled `Result`. A
 * thrown error (a bug, not a `Result` failure) becomes that `error` event
 * too, so the stream never hangs and Hono's `streamSSE` never sees the
 * exception (it would otherwise write its own bare-string error event,
 * which isn't a `ChatStreamEvent`).
 *
 * Writes are chained, not fired independently: `emit` is synchronous and
 * `writeSSE` is async, so each write waits for the one before it and the
 * terminal event waits for all of them. A rejected write (a vanished
 * client) is swallowed; once `stream.aborted` is set, nothing more is
 * written. `chatTurn` itself still runs to completion (it takes no abort
 * signal), which keeps any write it already started intact.
 */
export async function runChatStream(
  stream: ChatSseStreamLike,
  deps: ChatTurnDeps,
  input: ChatTurnRequest,
  runChatTurn: ChatTurnFn = chatTurn,
): Promise<void> {
  let writes: Promise<void> = Promise.resolve();
  const send = (event: ChatStreamEvent): Promise<void> => {
    writes = writes.then(async () => {
      if (stream.aborted) return;
      try {
        await stream.writeSSE(sseMessage(event));
      } catch {
        // The client is gone; there is no one left to tell.
      }
    });
    return writes;
  };

  // `chatExchange` owns the whole exchange (stores both turns, emits `done`);
  // this function is transport only, plus the ONE `error` event when the
  // exchange fails before `done`.
  let failure: ChatStreamEvent | undefined;
  let doneSent = false;
  try {
    const result = await chatExchange(
      {
        ...deps,
        emit: (event) => {
          if (event.type === "done") doneSent = true;
          void send(event);
        }, isAborted: () => stream.aborted === true,
        runChatTurn,
      },
      input,
    );
    if (!result.ok) failure = { type: "error", error: result.error };
  } catch (err) {
    // Review fix: a genuinely unexpected thrown error (a bug, not a `Result`
    // failure `app/chat-turn.ts` already converted) — log the raw message
    // server-side (never dropped entirely) but never put it on the wire.
    // `sseMessage` would map this anyway (it isn't a plain, punctuated,
    // prefix-free sentence), but this is the ONE place that still knows the
    // real cause, so it's the one place that can log it.
    deps.log?.({ level: "error", event: "server.chat-stream-failed", detail: err instanceof Error ? err.message : String(err) });
    // The stream already ended in `done`; a second terminal event would contradict it.
    if (!doneSent) failure = { type: "error", error: { kind: "unreachable", message: GENERIC_SERVER_ERROR_MESSAGE } };
  }
  if (failure) await send(failure);
  await writes;
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
  /**
   * Story 7.8: `GET /api/home`'s dependencies. Optional so every prior
   * story's `createApp({connection})` call site keeps compiling unchanged
   * — absent (e.g. Notion/Google not yet configured), the route reports a
   * clear configuration error rather than crashing the whole server.
   */
  readonly homeView?: Omit<HomeViewDeps, "now" | "connection"> & { readonly now?: () => Date };
  /**
   * Real-use fixes plan, Task 4: `GET /api/calendar/day`'s dependencies —
   * optional for the same reason as `homeView` (absent, e.g. Notion/Google
   * not yet configured, the route reports a clear `unreachable` error
   * rather than crashing). A separate bucket from `homeView` (its own
   * `readCalendarEventsForDate`, not `homeView.readCalendarEvents`) since
   * it reads any date, not just today.
   */
  readonly calendarDay?: Omit<CalendarDayDeps, "now" | "log"> & { readonly now?: () => Date };
  /**
   * `POST /api/plan/reshuffle` (+ `/approve`, `/discard`)'s dependencies —
   * absent, the routes report a clear `unreachable` error.
   */
  readonly plan?: ApproveReshuffleDeps;
  /** `POST /api/plan/sync`'s dependencies (the Yoh Plan calendar sync) — absent, the route reports `unchanged`. */
  readonly planSync?: SyncPlanFromCalendarDeps;
  /**
   * Story 7.10: the check-off routes' dependencies (`connection` comes from
   * this object's own). Optional for the same reason as `homeView` —
   * absent, the routes report a clear `unreachable` error.
   */
  readonly checkOff?: Omit<CheckOffDeps, "connection" | "now" | "log"> & { readonly now?: () => Date };
  /**
   * Story 8.5, extended by Story 8.6 (Task 7, Preflight ruling P2): `POST
   * /api/chat`'s AND `GET /api/open-items`'s AND `POST
   * /api/open-items/answer`'s dependencies — one config object, since all
   * three routes are transport over ONE merged deps object built in
   * `createApp` (`chatTurnDeps` below), never `deps.chat` directly.
   * `chatTurn`'s own deps and `answerOpenItem`'s (`AnswerOpenItemDeps`,
   * which `surfaceOpenItems`'s is a structural subset of) overlap on
   * `store`/`session`/`llmClient`, so this is their intersection, minus:
   * `session` (one per process, `chatSession` below), `emit` (one per
   * request, `runChatStream`), and `today` (`AnswerSelfCheckDeps`'s field —
   * like `session`, computed fresh per read by `createApp`, via a getter, so
   * a long-running server never freezes "today" at startup). Absent (no
   * `CLAUDE_API_KEY`/`YOH_TIMEZONE`), every one of the three routes reports
   * its own clear `unreachable` error. `runChatTurn` is a test seam
   * (default: the real `chatTurn`), the same DI convention as
   * `eventStream.sleep`.
   */
  readonly chat?: Omit<ChatTurnDeps & AnswerOpenItemDeps, "session" | "emit" | "today"> & {
    readonly runChatTurn?: ChatTurnFn;
    /** The Yoh Plan calendar sync's two reads; `buildPlanSyncDeps` joins them with `reshuffle`. */
    readonly planSyncReads?: Pick<SyncPlanFromCalendarDeps, "readYohPlanEvents" | "readDeletedYohPlanEventIds" | "readPlanCalendarSnapshot" | "readPlanCalendarWriteState">;
  };
  /** Story 13.1: the server-owned chat store (history for the model, `GET /api/chat-history/today`). */
  readonly chatHistory?: ChatStore;
  /**
   * Story 8.5, contract C3: the ONE `ChatSession` every chat route in this
   * process shares (`startServer` builds it; Stories 8.6/8.7's routes reuse
   * it). Absent, `createApp` makes one for its own lifetime.
   */
  readonly chatSession?: ChatSession;
  /**
   * Task 6B: the Tasks page routes' dependencies — the live Notion read
   * (`readTasks`/`readFieldOptions`), the lazy create-page binding, and the
   * field-write binding spread in from `bindNotionTaskWrites` (this
   * file never names a write function, AD-16). Optional for the same
   * reason as `homeView`: absent, every Tasks route reports a clear
   * `unreachable` error.
   */
  readonly tasks?: Omit<TasksViewDeps, "now" | "log"> &
    Omit<CreateTaskDeps, "now" | "connection" | "log" | "timeZone"> &
    Omit<UpdateTaskDeps, "connection" | "log"> & { readonly now?: () => Date };
  /**
   * Task 6C: the Research Hub page's one route's dependencies — a live
   * Notion read of the Research Vault (`readResearchVault`, bound). Optional
   * for the same reason as `homeView`/`tasks`: absent, `GET /api/research`
   * reports a clear `unreachable` error.
   */
  readonly research?: Omit<ResearchListDeps, "log">;
  /**
   * Story 9.2: the `/sandbox` card flow's dependencies — the live Notion
   * read + field-write binding, on the SAME Notion client/store `tasks`
   * already uses. Optional for the same reason as `tasks`/`research`:
   * absent, every sandbox route reports a clear `unreachable` error.
   */
  readonly sandbox?: Omit<SandboxQueueDeps, "now" | "log"> &
    Omit<SandboxSubmitDeps, "connection" | "now" | "log"> & { readonly now?: () => Date };
}

/** A failure envelope typed without `ApiResult<never>`'s impossible `{ok: true}` arm, so the RPC client's response type stays exact. */
type ApiFailure = Extract<ApiResult<never>, { ok: false }>;

/** `GET /api/calendar/day`'s own `date` query shape check — a plain `YYYY-MM-DD` string shape, not a full calendar-validity check (the same small, deliberate duplication `core/time-budget.ts`'s/`adapters/calendar-adapter.ts`'s own `ISO_DATE_RE` already represent elsewhere in this codebase). */
const ISO_DATE_ONLY_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Review fix: these two constants are handed straight to `c.json(...)` at
// their call sites below, never through `wire()` — so each maps its own
// `message` through `errorCopyForWire` right here, once, at module load,
// rather than leaking "server: ... not configured" verbatim.
const PLAN_NOT_CONFIGURED: ApiFailure = {
  ok: false,
  error: { kind: "unreachable", message: errorCopyForWire({ kind: "unreachable", message: "server: plan dependencies not configured" }) },
};

const CHAT_HISTORY_NOT_CONFIGURED: ApiFailure = {
  ok: false,
  error: { kind: "unreachable", message: errorCopyForWire({ kind: "unreachable", message: "server: chat history not configured" }) },
};

function validateReshuffleDecision(value: unknown, c: Context): ReshuffleDecisionRequest | Response {
  const proposalId = (value as { proposalId?: unknown } | null)?.proposalId;
  if (typeof proposalId !== "string" || proposalId.length === 0) {
    const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "plan/reshuffle: missing proposalId" } };
    return c.json(invalid, httpStatus(invalid));
  }
  return { proposalId };
}

const CHECK_OFF_NOT_CONFIGURED: ApiFailure = {
  ok: false,
  error: { kind: "unreachable", message: errorCopyForWire({ kind: "unreachable", message: "server: check-off dependencies not configured" }) },
};

/** Story 8.6 (Task 7): `GET /api/open-items`/`POST /api/open-items/answer`'s "not configured" failure — reuses the exact same `deps.chat` absence `POST /api/chat` already reports (Preflight ruling P2: all three routes share one deps object). */
const OPEN_ITEMS_NOT_CONFIGURED: ApiFailure = {
  ok: false,
  error: { kind: "unreachable", message: errorCopyForWire({ kind: "unreachable", message: "server: chat dependencies not configured" }) },
};

/** Task 6B/Story 9.2 (Task 10 hygiene): the Tasks page and /sandbox routes' shared "not configured" failure (Notion isn't set up). */
const NOTION_NOT_CONFIGURED: ApiFailure = {
  ok: false,
  error: { kind: "unreachable", message: "I'm not set up to do that yet — my Notion connection isn't configured." },
};

/** Task 6C: `GET /api/research`'s "not configured" failure (Notion, or its Research Vault data source id, isn't set up). */
const RESEARCH_NOT_CONFIGURED: ApiFailure = {
  ok: false,
  error: { kind: "unreachable", message: "I'm not set up to do that yet — my Notion connection isn't configured." },
};

const TASKS_GROUP_BY: ReadonlySet<string> = new Set<TasksGroupBy>(["due", "area", "status", "priority"]);
/** Task 7 binding ruling: widened past `PlanningFieldNames` to `EditableTaskField` — the ONLY route this affects is the inline-edit field write. */
const EDITABLE_TASK_FIELD_NAMES: ReadonlySet<string> = new Set<EditableTaskField>(["estimatedDurationMinutes", "area", "dueDate", "status", "energy", "priority"]);

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

/**
 * Drops `detail` (a raw adapter error, possibly with internals) before the
 * envelope crosses the wire, and (review fix) maps `message` through
 * `errorCopyForWire` — the transport-level safety net that catches
 * whatever an `app/*.ts` call forgot to map, a hardcoded "not configured"
 * constant, or a raw `ConflictError`/adapter throw a `rituals/*.ts` catch
 * site converted without going through `core/error-copy.ts` itself. An
 * already-mapped, service-specific message (the overwhelmingly common
 * case, since `app/*.ts` now calls `errorCopy` itself per the real-use
 * fixes plan) passes through unchanged.
 */
function wire<T>(result: ApiResult<T>): ApiResult<T> {
  return result.ok ? result : { ok: false, error: { kind: result.error.kind, message: errorCopyForWire(result.error) } };
}

/**
 * The LOCAL calendar date of `instant` in `timeZone` — the same computation
 * `rituals/ritual-shared.ts`'s `localIsoDate` makes, duplicated here rather
 * than imported: `server.ts` never imports `rituals/` at all (AD-5, AD-15 —
 * `tests/server.test.ts`'s own structural rule), the identical small,
 * deliberate duplication that helper's own doc comment already documents
 * between `core/time-budget.ts` and `core/derived-priority.ts`. Story 8.6
 * (Task 7): `AnswerSelfCheckDeps.today` must be Spencer's CURRENT local
 * calendar day, computed fresh on every read (see `chatDeps`'s `today`
 * getter in `createApp`), never the server process's UTC start time.
 */
function currentIsoDate(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function createApp(deps: ServerDeps) {
  const log = deps.log ?? ((entry: LogEntry) => writeStructuredLog(entry));
  const now = deps.now ?? (() => performance.now());
  const notificationsDeps = { connection: deps.connection, now: deps.clock ?? (() => new Date()) };
  const checkOffDeps: CheckOffDeps | undefined = deps.checkOff
    ? { ...deps.checkOff, connection: deps.connection, now: deps.checkOff.now ?? (() => new Date()), log }
    : undefined;
  const chatSession: ChatSession = deps.chatSession ?? { recentMessages: [], lastSearchAnswer: undefined };
  // Task 6B: one merged deps object serves all three Tasks-page app/
  // functions (each reads only its own fields). Spread, never re-keyed, so
  // the write binding's name never appears in this file (AD-16).
  const tasksDeps: (TasksViewDeps & CreateTaskDeps & UpdateTaskDeps) | undefined = deps.tasks
    ? { ...deps.tasks, now: deps.tasks.now ?? (() => new Date()), connection: deps.connection, log }
    : undefined;
  // Task 6C: the Research Hub page's one deps object — just `deps.research`
  // plus the shared logger, the same "spread, default `log` in" convention
  // `tasksDeps` above uses.
  const researchDeps: ResearchListDeps | undefined = deps.research ? { ...deps.research, log } : undefined;
  // Story 9.2: one merged deps object serves sandboxQueue AND
  // submitSandboxCard — each reads only its own fields, mirroring
  // tasksDeps's own spread-and-default-now convention.
  const sandboxDeps: (SandboxQueueDeps & SandboxSubmitDeps) | undefined = deps.sandbox
    ? { ...deps.sandbox, now: deps.sandbox.now ?? (() => new Date()), connection: deps.connection, log }
    : undefined;
  // Preflight ruling P2: the ONE merged deps object `/api/chat`,
  // `/api/open-items`, and `/api/open-items/answer` ALL call into `app/`
  // with — never `deps.chat` directly. `runChatTurn` (a test seam, never a
  // real dependency `chatTurn`/`surfaceOpenItems`/`answerOpenItem` read) is
  // stripped out here so it never reaches any of the three (pinned by
  // `tests/server-chat.test.ts`'s "never the runChatTurn seam itself" case).
  // `today` is a live getter, not a value captured once at startup — the
  // process may run for days, and `AnswerSelfCheckDeps.today` must always be
  // Spencer's CURRENT local calendar day (mirrors `session` immediately
  // below: both are per-read state `createApp` supplies, never something
  // `deps.chat`'s own config carries).
  let chatDeps: (Omit<ChatTurnDeps, "emit"> & AnswerOpenItemDeps) | undefined;
  if (deps.chat) {
    const { runChatTurn: _runChatTurn, ...rest } = deps.chat;
    chatDeps = {
      ...rest,
      ...(deps.chatHistory ? { chatHistory: deps.chatHistory } : {}),
      session: chatSession,
      get today(): IsoDate {
        return currentIsoDate(new Date(), rest.timeZone);
      },
    };
  }

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
      // Story 8.7 (C5): the one server-provided command registry the Web
      // Command Palette reads — pure transport over `app/commands.ts`'s
      // `listCommands`, no configuration needed.
      .get("/api/commands", async (c) => {
        const result = wire(await listCommands({}, {}));
        return c.json(result, httpStatus(result));
      })
      .post("/api/notifications/:id/read", async (c) => {
        const result = wire(await markNotificationRead(notificationsDeps, { id: c.req.param("id") }));
        return c.json(result, httpStatus(result));
      })
      // Story 7.8: today's Plan checklist + Calendar Day View, computed
      // server-side (AD-17). `deps.homeView` is absent until Notion/Google
      // are configured (see `buildHomeViewDeps` below) — reported as a
      // clear `unreachable` error rather than a 500.
      .get("/api/home", async (c) => {
        if (!deps.homeView) {
          const result: ApiResult<never> = { ok: false, error: { kind: "unreachable", message: "server: home-view dependencies not configured" } };
          return c.json(result, httpStatus(result));
        }
        // Fix round 1 (finding #2): a Calendar/Notion read failure inside
        // getHomeView logs through the SAME structured logger every other
        // route already uses (`log`, bound above), not a separate/ad-hoc one.
        const result = wire(
          await getHomeView({ ...deps.homeView, connection: deps.connection, now: deps.homeView.now ?? (() => new Date()), log }, {}),
        );
        return c.json(result, httpStatus(result));
      })
      // Real-use fixes plan, Task 4 ("pick any day in Month to see its
      // calendar"): a read-only per-date sibling of `GET /api/home`'s
      // Calendar Day View — same route shape (wire()/httpStatus(),
      // `deps.calendarDay` absent -> a clear `unreachable` error), just for
      // ANY date, not just today. `date` is validated here (a 400
      // validation envelope for a missing/malformed value) before ever
      // reaching `app/calendar-day.ts`.
      .get(
        "/api/calendar/day",
        validator("query", (value, c) => {
          const date = typeof value["date"] === "string" ? value["date"] : undefined;
          if (date === undefined || !ISO_DATE_ONLY_SHAPE_RE.test(date)) {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "calendar/day: missing or invalid date" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { date } satisfies CalendarDayRequest;
        }),
        async (c) => {
          if (!deps.calendarDay) {
            const result: ApiResult<never> = { ok: false, error: { kind: "unreachable", message: "server: calendar-day dependencies not configured" } };
            return c.json(result, httpStatus(result));
          }
          const result = wire(
            await getCalendarDay({ ...deps.calendarDay, now: deps.calendarDay.now ?? (() => new Date()), log }, c.req.valid("query")),
          );
          return c.json(result, httpStatus(result));
        },
      )
      // Reshuffle: request a preview of the re-fitted day, then approve or
      // discard it. Each route validates in the shell and calls ONE app fn.
      .post(
        "/api/plan/reshuffle",
        validator("json", (value, c) => {
          const request = parseReshuffleRequest(value);
          if (request === undefined) {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "plan/reshuffle: missing or invalid request" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return request;
        }),
        async (c) => {
          if (!deps.plan) return c.json(PLAN_NOT_CONFIGURED, httpStatus(PLAN_NOT_CONFIGURED));
          const result = wire(await requestReshuffleView(deps.plan, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      // The Yoh Plan calendar sync, on demand (tab focus). Shares the sweep's lock.
      .post("/api/plan/sync", async (c) => {
        if (!deps.planSync) {
          const idle: ApiResult<PlanSyncResponse> = { ok: true, value: { status: "unchanged" } };
          return c.json(idle, httpStatus(idle));
        }
        const result = wire(await getPlanSyncRunner(deps.planSync, log)());
        return c.json(result, httpStatus(result));
      })
      .post("/api/plan/reshuffle/approve", validator("json", validateReshuffleDecision), async (c) => {
        if (!deps.plan) return c.json(PLAN_NOT_CONFIGURED, httpStatus(PLAN_NOT_CONFIGURED));
        const result = wire(await approveReshuffleById(deps.plan, c.req.valid("json")));
        return c.json(result, httpStatus(result));
      })
      .post("/api/plan/reshuffle/discard", validator("json", validateReshuffleDecision), async (c) => {
        if (!deps.plan) return c.json(PLAN_NOT_CONFIGURED, httpStatus(PLAN_NOT_CONFIGURED));
        const result = wire(await discardReshuffleById(deps.plan, c.req.valid("json")));
        return c.json(result, httpStatus(result));
      })
      // Task 6A: Home's Time Budget widget, click-to-edit in place, over
      // the existing `app/time-budget.ts` `declareTimeBudget` — the same
      // store/timeZone `GET /api/home` already uses (`deps.homeView`), so
      // this reports the same clear `unreachable` error when Notion/Google
      // aren't configured, rather than a new deps bucket of its own.
      .post(
        "/api/time-budget",
        validator("json", (value, c) => {
          const totalMinutes = (value as { totalMinutes?: unknown } | null)?.totalMinutes;
          if (typeof totalMinutes !== "number") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "time-budget: missing totalMinutes" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { totalMinutes } satisfies TimeBudgetRequest;
        }),
        async (c) => {
          if (!deps.homeView) {
            const result: ApiResult<never> = { ok: false, error: { kind: "unreachable", message: "server: home-view dependencies not configured" } };
            return c.json(result, httpStatus(result));
          }
          const result = wire(
            await declareTimeBudget(
              { store: deps.homeView.store, timeZone: deps.homeView.timeZone, now: deps.homeView.now ?? (() => new Date()) },
              c.req.valid("json"),
            ),
          );
          return c.json(result, httpStatus(result));
        },
      )
      // Story 7.10, AD-20: check-off with undo. The body carries only the
      // Task id (Ruling R7); everything else is looked up server-side.
      .post(
        "/api/check-off",
        validator("json", (value, c) => {
          const taskId = (value as { taskId?: unknown } | null)?.taskId;
          if (typeof taskId !== "string" || taskId.trim() === "") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "check-off: missing taskId" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { taskId } satisfies CheckOffRequest;
        }),
        async (c) => {
          if (!checkOffDeps) return c.json(CHECK_OFF_NOT_CONFIGURED, httpStatus(CHECK_OFF_NOT_CONFIGURED));
          const result = wire(await checkOff(checkOffDeps, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post("/api/check-off/:id/undo", async (c) => {
        if (!checkOffDeps) return c.json(CHECK_OFF_NOT_CONFIGURED, httpStatus(CHECK_OFF_NOT_CONFIGURED));
        const result = wire(await undoCheckOff(checkOffDeps, { id: c.req.param("id") }));
        return c.json(result, httpStatus(result));
      })
      .post("/api/check-off/:id/hold", async (c) => {
        if (!checkOffDeps) return c.json(CHECK_OFF_NOT_CONFIGURED, httpStatus(CHECK_OFF_NOT_CONFIGURED));
        const result = wire(await holdCheckOff(checkOffDeps, { id: c.req.param("id") }));
        return c.json(result, httpStatus(result));
      })
      .post("/api/check-off/:id/release", async (c) => {
        if (!checkOffDeps) return c.json(CHECK_OFF_NOT_CONFIGURED, httpStatus(CHECK_OFF_NOT_CONFIGURED));
        const result = wire(await releaseCheckOff(checkOffDeps, { id: c.req.param("id") }));
        return c.json(result, httpStatus(result));
      })
      // Task 6B (FR-43): the Tasks page. Pure transport over
      // `app/tasks-view.ts` (the grouped list), `app/create-task.ts` (the
      // quick-add row's direct write and its live preview), and
      // `app/update-task.ts` (an inline cell edit, FR-24's direct write).
      .get(
        "/api/tasks",
        validator("query", (value, c) => {
          const groupBy = typeof value["groupBy"] === "string" ? value["groupBy"] : undefined;
          const query = typeof value["query"] === "string" ? value["query"] : undefined;
          if (groupBy !== undefined && !TASKS_GROUP_BY.has(groupBy)) {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "tasks: unknown groupBy" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { ...(groupBy !== undefined ? { groupBy: groupBy as TasksGroupBy } : {}), ...(query !== undefined ? { query } : {}) } satisfies TasksListRequest;
        }),
        async (c) => {
          if (!tasksDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const result = wire(await listTasks(tasksDeps, c.req.valid("query")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/tasks",
        validator("json", (value, c) => {
          const text = (value as { text?: unknown } | null)?.text;
          if (typeof text !== "string") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "tasks: missing text" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { text } satisfies CreateTaskRequest;
        }),
        async (c) => {
          if (!tasksDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const result = wire(await createTask(tasksDeps, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/tasks/parse",
        validator("json", (value, c) => {
          const body = value as { text?: unknown; areaOptions?: unknown; priorityOptions?: unknown } | null;
          const areaOptions = body?.areaOptions;
          const priorityOptions = body?.priorityOptions;
          const isStringArray = (v: unknown): v is string[] => v === undefined || (Array.isArray(v) && v.every((o) => typeof o === "string"));
          if (typeof body?.text !== "string" || !isStringArray(areaOptions) || !isStringArray(priorityOptions)) {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "tasks/parse: missing text" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return {
            text: body.text,
            ...(areaOptions !== undefined ? { areaOptions } : {}),
            ...(priorityOptions !== undefined ? { priorityOptions } : {}),
          } satisfies QuickAddPreviewRequest;
        }),
        async (c) => {
          if (!tasksDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const result = wire(await previewQuickAdd(tasksDeps, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/tasks/:id/field",
        validator("json", (value, c) => {
          const body = value as { field?: unknown; value?: unknown } | null;
          if (typeof body?.field !== "string" || !EDITABLE_TASK_FIELD_NAMES.has(body.field) || typeof body.value !== "string") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "tasks/field: missing field/value" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { field: body.field as EditableTaskField, value: body.value } satisfies UpdateTaskFieldRequest;
        }),
        async (c) => {
          if (!tasksDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const result = wire(await updateTask(tasksDeps, { taskId: c.req.param("id"), ...c.req.valid("json") }));
          return c.json(result, httpStatus(result));
        },
      )
      // Task 6B fix round (AD-12 amended 2026-09-27): an inline rename.
      .post(
        "/api/tasks/:id/title",
        validator("json", (value, c) => {
          const title = (value as { title?: unknown } | null)?.title;
          if (typeof title !== "string") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "tasks/title: missing title" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { title } satisfies RenameTaskRequest;
        }),
        async (c) => {
          if (!tasksDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const result = wire(await renameTask(tasksDeps, { taskId: c.req.param("id"), ...c.req.valid("json") }));
          return c.json(result, httpStatus(result));
        },
      )
      // Story 9.2 (AD-11, E5/E9): /sandbox's card flow. Pure transport over
      // app/sandbox-queue.ts / app/sandbox-submit.ts — no route computes a
      // count or a validation rule itself (AD-17).
      .post(
        "/api/sandbox/start",
        validator("json", (value, c) => {
          const exclude = (value as { exclude?: unknown } | null)?.exclude;
          if (exclude !== undefined && !(Array.isArray(exclude) && exclude.every((x) => typeof x === "string"))) {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "sandbox/start: exclude must be a string array" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { ...(exclude !== undefined ? { exclude: exclude as string[] } : {}) } satisfies SandboxStartRequest;
        }),
        async (c) => {
          if (!sandboxDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const result = wire(await sandboxQueue(sandboxDeps, { ...c.req.valid("json"), withOptions: true }));
          if (!result.ok) return c.json(result, httpStatus(result));
          return c.json({ ok: true, value: { card: firstCardView(result.value.items, result.value.options) } }, 200);
        },
      )
      .post(
        "/api/sandbox/:taskId/save",
        validator("json", (value, c) => {
          const body = value as { dueDate?: unknown; estimatedDurationMinutes?: unknown; area?: unknown; energy?: unknown; exclude?: unknown } | null;
          const excludeOk = Array.isArray(body?.exclude) && body.exclude.every((x) => typeof x === "string");
          if (typeof body?.dueDate !== "string" || typeof body?.estimatedDurationMinutes !== "string" || !excludeOk) {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "sandbox/save: missing dueDate/estimatedDurationMinutes/exclude" } };
            return c.json(invalid, httpStatus(invalid));
          }
          if (body.area !== undefined && typeof body.area !== "string") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "sandbox/save: area must be a string" } };
            return c.json(invalid, httpStatus(invalid));
          }
          if (body.energy !== undefined && typeof body.energy !== "string") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "sandbox/save: energy must be a string" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return {
            dueDate: body.dueDate,
            estimatedDurationMinutes: body.estimatedDurationMinutes,
            ...(body.area !== undefined ? { area: body.area } : {}),
            ...(body.energy !== undefined ? { energy: body.energy } : {}),
            exclude: body.exclude as string[],
          } satisfies SandboxSaveRequest;
        }),
        async (c) => {
          if (!sandboxDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const taskId = c.req.param("taskId");
          const body = c.req.valid("json");
          const result = wire(
            await saveSandboxCardAndAdvance(sandboxDeps, {
              taskId,
              dueDate: body.dueDate,
              estimatedDurationMinutes: body.estimatedDurationMinutes,
              ...(body.area !== undefined ? { area: body.area } : {}),
              ...(body.energy !== undefined ? { energy: body.energy } : {}),
              exclude: body.exclude,
            }),
          );
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/sandbox/:taskId/skip",
        validator("json", (value, c) => {
          const exclude = (value as { exclude?: unknown } | null)?.exclude;
          if (!(Array.isArray(exclude) && exclude.every((x) => typeof x === "string"))) {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "sandbox/skip: exclude must be a string array" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { exclude } satisfies SandboxSkipRequest;
        }),
        async (c) => {
          if (!sandboxDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const taskId = c.req.param("taskId");
          const body = c.req.valid("json");
          const next = wire(await sandboxQueue(sandboxDeps, { exclude: [...body.exclude, taskId], withOptions: true }));
          if (!next.ok) return c.json(next, httpStatus(next));
          return c.json({ ok: true, value: { next: firstCardView(next.value.items, next.value.options) } }, 200);
        },
      )
      // Story 9.4 (E9, UX-DR42): the ONE computed source for the Needs-Data
      // Indicator and the needs-data notification's count alike (AD-11) —
      // a thin transport wrapper over Story 9.2's sandboxQueue, same "not
      // configured" convention every other Notion-backed route already
      // uses. No new app/*.ts file: this is exactly `/api/commands`'s own
      // "call straight through" shape.
      .get("/api/sandbox/count", async (c) => {
        if (!sandboxDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
        const queueResult = wire(await sandboxQueue(sandboxDeps, {}));
        const result: ApiResult<NeedsDataCountResponse> = queueResult.ok
          ? { ok: true, value: { count: queueResult.value.items.length } }
          : queueResult;
        return c.json(result, httpStatus(result));
      })
      // Story 9.3 (Task 3, E9): the Finale's one route — settles the
      // session's already-completed writes into a proof-of-action
      // notification (app/sandbox-submit.ts's finishSandboxSession).
      .post(
        "/api/sandbox/finish",
        validator("json", (value, c) => {
          const outcomes = (value as { outcomes?: unknown } | null)?.outcomes;
          const elementsOk =
            Array.isArray(outcomes) &&
            outcomes.every(
              (o) =>
                typeof o === "object" &&
                o !== null &&
                typeof (o as { taskId?: unknown }).taskId === "string" &&
                typeof (o as { taskTitle?: unknown }).taskTitle === "string" &&
                typeof (o as { ok?: unknown }).ok === "boolean",
            );
          if (!elementsOk) {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "sandbox/finish: outcomes must be an array of {taskId, taskTitle, ok}" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { outcomes } satisfies SandboxFinishRequest;
        }),
        async (c) => {
          if (!sandboxDeps) return c.json(NOTION_NOT_CONFIGURED, httpStatus(NOTION_NOT_CONFIGURED));
          const result = wire(await finishSandboxSession(sandboxDeps, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      // Task 6C (FR-43, UX-DR43): the Research Hub page's one route — pure
      // transport over `app/research-list.ts`'s `listResearch` (a live
      // Notion read of the Research Vault, most recent first, server-
      // limited). `deps.research` is absent until Notion +
      // NOTION_RESEARCH_VAULT_DATA_SOURCE_ID are configured
      // (`buildResearchDeps` below), reported as a clear `unreachable`
      // error rather than a 500.
      .get("/api/research", async (c) => {
        if (!researchDeps) return c.json(RESEARCH_NOT_CONFIGURED, httpStatus(RESEARCH_NOT_CONFIGURED));
        const result = wire(await listResearch(researchDeps, {}));
        return c.json(result, httpStatus(result));
      })
      // Story 8.5, AD-18/C5: one chat turn, its reply streamed on this
      // request's own SSE response (separate from GET /api/events). Always
      // ends in exactly one `done` or `error` event (`runChatStream`). A
      // malformed body is a plain 400 envelope: there's no turn to stream.
      .post(
        "/api/chat",
        validator("json", (value, c) => {
          const body = value as { message?: unknown } | null;
          if (typeof body?.message !== "string" || body.message.trim() === "") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "chat: missing message" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { message: body.message } satisfies ChatTurnRequest;
        }),
        (c) => {
          const input = c.req.valid("json");
          if (!chatDeps) {
            return streamSSE(c, async (stream) => {
              await stream.writeSSE(sseMessage(CHAT_NOT_CONFIGURED));
            });
          }
          return streamSSE(
            c,
            (stream) => runChatStream(stream, chatDeps, input, deps.chat?.runChatTurn),
            async (err) => {
              log({ level: "error", event: "server.chat-stream-failed", detail: { message: err.message } });
            },
          );
        },
      )
      // Story 13.1: today's stored chat turns; works without `chat` deps.
      .get("/api/chat-history/today", async (c) => {
        const timeZone = deps.chat?.timeZone ?? process.env["YOH_TIMEZONE"];
        if (!deps.chatHistory || !timeZone) return c.json(CHAT_HISTORY_NOT_CONFIGURED, httpStatus(CHAT_HISTORY_NOT_CONFIGURED));
        const result = wire(await todaysChatHistory({ chatHistory: deps.chatHistory, timeZone, now: () => new Date() }, {}));
        return c.json(result, httpStatus(result));
      })
      // Story 8.6 (Task 7), AD-16: pure transport over `app/surface-
      // open-items.ts`'s `surfaceOpenItems` — every open interaction
      // request/Proposal, each with its current pending question already
      // resolved, including one a ritual raised while only the CLI existed
      // (Task 1's outbox append makes that visible here without any change
      // to this route at all). Reuses the SAME `chatDeps` `/api/chat` does
      // (Preflight ruling P2), so FR-25's suggestions stay consistent
      // across `/api/chat` and this route.
      .get("/api/open-items", async (c) => {
        if (!chatDeps) return c.json(OPEN_ITEMS_NOT_CONFIGURED, httpStatus(OPEN_ITEMS_NOT_CONFIGURED));
        const result = wire(await surfaceOpenItems(chatDeps, {}));
        return c.json(result, httpStatus(result));
      })
      // Story 8.6 (Task 7), AD-3/AD-16: pure transport over `app/answer-
      // open-item.ts`'s `answerOpenItem` — the SAME entry point a chip pick
      // and a typed "Other" line both call (a Structured Question's pick is
      // recorded as an ordinary turn; the write itself always goes through
      // this one function, whichever surface answered).
      .post(
        "/api/open-items/answer",
        validator("json", (value, c) => {
          const body = value as Partial<AnswerOpenItemRequest> | null;
          if (typeof body?.requestId !== "string" || typeof body?.questionId !== "string" || typeof body?.answer !== "string") {
            const invalid: ApiFailure = {
              ok: false,
              error: { kind: "validation", message: "open-items/answer: missing requestId/questionId/answer" },
            };
            return c.json(invalid, httpStatus(invalid));
          }
          return body as AnswerOpenItemRequest;
        }),
        async (c) => {
          if (!chatDeps) return c.json(OPEN_ITEMS_NOT_CONFIGURED, httpStatus(OPEN_ITEMS_NOT_CONFIGURED));
          const result = wire(await answerOpenItem(chatDeps, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
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
  /** Story 7.8's `homeView`, Story 7.10's `checkOff`, Story 8.5's `chat`, Task 6C's `research`, Task 4's `calendarDay`, and Story 9.2's `sandbox`, threaded through the same way `connection` already is. */
  features: Pick<ServerDeps, "homeView" | "calendarDay" | "checkOff" | "plan" | "planSync" | "chat" | "chatHistory" | "tasks" | "research" | "sandbox"> = {},
): ServerHandle {
  const port = parsePort(env["YOH_SERVER_PORT"]);
  // Contract C3: one ChatSession per server process, shared by every chat route.
  const chatSession: ChatSession = { recentMessages: [], lastSearchAnswer: undefined };
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
    ...(features.tasks ? { tasks: features.tasks } : {}),
    ...(features.research ? { research: features.research } : {}),
    ...(features.sandbox ? { sandbox: features.sandbox } : {}),
  });
  return serveFn({ fetch: app.fetch, hostname: LOOPBACK_HOST, port });
}

/**
 * The Notion + host-timezone configuration Home (Story 7.8) and check-off
 * (Story 7.10) both need — loaded once so the two share ONE Notion client
 * and ONE memory store. Mirrors `shell/ritual-cli.ts`'s
 * `createMorningRitualDeps` construction (same env vars, same client
 * constructor) — the Notion/Calendar clients are otherwise built only
 * inside `rituals/`'s one-shot deps builders, never shared as an importable
 * helper (AD-1 keeps `rituals/` and `shell/server.ts` from depending on each
 * other), so this is its own small copy, not a refactor of that one.
 *
 * Returns `undefined` — logging why, once, at startup — rather than
 * throwing: unlike `ritual-cli.ts` (a one-shot CLI where a thrown config
 * error is the whole run failing anyway), this runs inside the long-lived
 * server's own startup — a misconfigured feature must degrade its routes to
 * a clear `unreachable` error, never take down `/api/health`, the
 * notification routes, or the built web app with it.
 */
interface NotionFeatureConfig {
  readonly timeZone: string;
  readonly store: MemoryStore;
  readonly notionClient: Client;
  readonly tasksDataSourceId: string;
  readonly projectsDataSourceId: string;
  readonly taskPropertyNames: NotionTaskPropertyNames;
}

function loadNotionFeatureConfig(connection: SqliteConnection, env: Readonly<Record<string, string | undefined>>): NotionFeatureConfig | undefined {
  const timeZone = env["YOH_TIMEZONE"];
  const notionToken = env["NOTION_TOKEN"];
  const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
  const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
  if (!timeZone || !notionToken || !tasksDataSourceId || !projectsDataSourceId) {
    writeStructuredLog({
      level: "warn",
      event: "server.home-view-not-configured",
      detail: {
        message:
          "missing required environment variable(s) YOH_TIMEZONE / NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID / NOTION_PROJECTS_DATA_SOURCE_ID — GET /api/home and the check-off routes will report an error until set",
      },
    });
    return undefined;
  }
  return {
    timeZone,
    store: createMemoryStore(connection),
    notionClient: new Client({ auth: notionToken, ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}) }),
    tasksDataSourceId,
    projectsDataSourceId,
    taskPropertyNames: loadTaskPropertyNamesFromEnv(env),
  };
}

function readTasksWith(notion: NotionFeatureConfig) {
  return async () =>
    await readNotionTasks(notion.notionClient, {
      tasksDataSourceId: notion.tasksDataSourceId,
      projectsDataSourceId: notion.projectsDataSourceId,
      taskPropertyNames: notion.taskPropertyNames,
    });
}

/**
 * Story 7.8: `GET /api/home`'s real dependencies. The whole Google client
 * construction is wrapped: `loadGoogleOAuthConfigFromEnv` throws on a
 * missing `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI`, which must degrade
 * Home only, never the rest of the server.
 */
function buildHomeViewDeps(notion: NotionFeatureConfig, env: Readonly<Record<string, string | undefined>>): ServerDeps["homeView"] {
  try {
    const tokenStore = createTokenStore(loadGoogleOAuthConfigFromEnv(env));
    const calendarClient = createCalendarReadClient(tokenStore.getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]);
    return {
      store: notion.store,
      readCalendarEvents: () =>
        readCalendarEvents(calendarClient, {
          timeZone: notion.timeZone,
          extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
          yohPlanCalendarId: tokenStore.getCalendarId(),
          log: writeStructuredLog,
        }),
      readTasks: readTasksWith(notion),
      timeZone: notion.timeZone,
    };
  } catch (err) {
    writeStructuredLog({
      level: "warn",
      event: "server.home-view-not-configured",
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    return undefined;
  }
}

/**
 * Real-use fixes plan, Task 4: `GET /api/calendar/day`'s real
 * dependencies — same lazy Google client construction/degrade-only-this-
 * feature convention as `buildHomeViewDeps` just above, bound to a per-date
 * read (`readCalendarEvents`'s own `date` field) instead of "today only." A
 * separate `TokenStore`/read client instance from `buildHomeViewDeps`'s own
 * (and from `buildChatDeps`'s `readCalendarEventsForDate`, below) — the
 * same duplication precedent those two already establish, since each
 * optional feature bucket is independently guarded against Google OAuth not
 * being configured.
 */
function buildCalendarDayDeps(notion: NotionFeatureConfig, env: Readonly<Record<string, string | undefined>>): ServerDeps["calendarDay"] {
  try {
    const tokenStore = createTokenStore(loadGoogleOAuthConfigFromEnv(env));
    const calendarClient = createCalendarReadClient(tokenStore.getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]);
    return {
      store: notion.store,
      timeZone: notion.timeZone,
      readCalendarEventsForDate: (date) =>
        readCalendarEvents(calendarClient, {
          timeZone: notion.timeZone,
          date,
          extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
          yohPlanCalendarId: tokenStore.getCalendarId(),
          log: writeStructuredLog,
        }),
    };
  } catch (err) {
    writeStructuredLog({
      level: "warn",
      event: "server.calendar-day-not-configured",
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    return undefined;
  }
}

/**
 * Story 7.10: the check-off routes' and commit sweep's real dependencies.
 * Needs no Google configuration. The Notion client goes to `app/check-off.ts`
 * as a dependency; the Status write itself is made there (AD-16).
 */
/**
 * Task 6B: the Tasks page routes' real dependencies, on the SAME Notion
 * client Home and check-off already share. The create-page binding and the
 * field-write binding are both built here from that one client; the writes
 * themselves happen inside `app/create-task.ts`/`app/update-task.ts`
 * (AD-16), the field write reached only through the adapter's own
 * `bindNotionTaskWrites` spread. The create-page config type also carries a
 * Research Vault id; only the Tasks target is ever used from this page.
 */
function buildTasksDeps(
  notion: NotionFeatureConfig,
  env: Readonly<Record<string, string | undefined>>,
  /** Polish 4 Task 1: the quick-add Haiku fallback's Claude client — the SAME instance `buildChatDeps` already built for `/api/chat`, never a second `Anthropic` client. Absent (no `CLAUDE_API_KEY`/`YOH_TIMEZONE`): the fallback is simply skipped. */
  llmClient?: AnthropicMessagesClient,
): ServerDeps["tasks"] {
  const config = {
    tasksDataSourceId: notion.tasksDataSourceId,
    projectsDataSourceId: notion.projectsDataSourceId,
    taskPropertyNames: notion.taskPropertyNames,
  };
  const readTasks = readTasksWith(notion);
  return {
    timeZone: notion.timeZone,
    readTasks: async () => (await readTasks()).tasks,
    readFieldOptions: () => readTaskFieldOptions(notion.notionClient, config),
    getNotionCreatePageBinding: () => ({
      ok: true,
      value: { client: notion.notionClient, config: { ...config, researchVaultDataSourceId: env["NOTION_RESEARCH_VAULT_DATA_SOURCE_ID"] ?? "" } },
    }),
    ...(llmClient ? { llmClient } : {}),
    ...bindNotionTaskWrites(() => ({ ok: true, value: { client: notion.notionClient, config } })),
  };
}

/** Story 9.2: /sandbox's real dependencies — the same shared Notion client Home/Tasks/check-off already use. */
function buildSandboxDeps(notion: NotionFeatureConfig): ServerDeps["sandbox"] {
  const config = { tasksDataSourceId: notion.tasksDataSourceId, projectsDataSourceId: notion.projectsDataSourceId, taskPropertyNames: notion.taskPropertyNames };
  return {
    store: notion.store,
    timeZone: notion.timeZone,
    readTasks: async () => (await readTasksWith(notion)()).tasks,
    // Task 5 (polish-5): the SAME live-schema read `buildTasksDeps` above
    // binds for the Tasks page's own inline selects — the Sandbox Card's
    // Area/Energy fields render as `<select>`s from this.
    readFieldOptions: () => readTaskFieldOptions(notion.notionClient, config),
    ...bindNotionTaskWrites(() => ({ ok: true, value: { client: notion.notionClient, config } })),
  };
}

/**
 * Task 6C: the Research Hub page route's real dependencies — the SAME
 * shared Notion client Home/Tasks/check-off already use, plus its own
 * `NOTION_RESEARCH_VAULT_DATA_SOURCE_ID` (the one extra env var this page
 * needs beyond `NotionFeatureConfig`'s core four). Absent either — no
 * `notion` (core Notion unconfigured) or no Research Vault id — the page
 * reports a clear `unreachable` error rather than a 500 (same convention as
 * `buildHomeViewDeps`/`buildTasksDeps`).
 */
function buildResearchDeps(notion: NotionFeatureConfig | undefined, env: Readonly<Record<string, string | undefined>>): ServerDeps["research"] {
  const researchVaultDataSourceId = env["NOTION_RESEARCH_VAULT_DATA_SOURCE_ID"];
  if (!notion || !researchVaultDataSourceId) return undefined;
  return { readResearchVault: () => readResearchVault(notion.notionClient, { researchVaultDataSourceId }) };
}

function buildCheckOffDeps(notion: NotionFeatureConfig): ServerDeps["checkOff"] {
  const readTasks = readTasksWith(notion);
  return {
    store: notion.store,
    timeZone: notion.timeZone,
    notionClient: notion.notionClient,
    notionStatusConfig: { tasksDataSourceId: notion.tasksDataSourceId, taskPropertyNames: notion.taskPropertyNames },
    lookupTask: async (taskId) => (await readTasks()).tasks.find((t) => t.id === taskId),
  };
}

/**
 * Story 8.5: `POST /api/chat`'s real dependencies — the same wiring
 * `shell/chat-cli.ts`'s `main()` used to build for its own `chatTurn` call
 * (since retired, Story 8.9), mirrored here for the server process. Only
 * `YOH_TIMEZONE` and
 * `CLAUDE_API_KEY` are required up front (general chat, Time Budget, and
 * Plan-view need nothing else); every Notion, search, and Calendar
 * dependency is constructed lazily on first use and reports its own missing
 * configuration then, so a server without Notion or Google still chats.
 * Missing either required value returns `undefined` (logged once), and the
 * route streams its not-configured `error` event.
 */
/** `POST /api/plan/reshuffle*`'s deps: the reshuffle binding `buildChatDeps` already built, so both entry points share one set. */
function buildPlanDeps(chat: ServerDeps["chat"]): ServerDeps["plan"] {
  if (!chat?.reshuffle) return undefined;
  return { ...chat.reshuffle, store: chat.store };
}

/** `POST /api/plan/sync` and the sweep's deps: the reshuffle binding plus the two Yoh Plan calendar reads `buildChatDeps` built. */
function buildPlanSyncDeps(chat: ServerDeps["chat"]): ServerDeps["planSync"] {
  if (!chat?.reshuffle || !chat.planSyncReads) return undefined;
  return { ...chat.reshuffle, store: chat.store, ...chat.planSyncReads };
}

function buildChatDeps(
  connection: SqliteConnection,
  notion: NotionFeatureConfig | undefined,
  env: Readonly<Record<string, string | undefined>>,
): ServerDeps["chat"] {
  const notConfigured = (message: string): undefined => {
    writeStructuredLog({ level: "warn", event: "server.chat-not-configured", detail: { message: `${message} — POST /api/chat will report an error until set` } });
    return undefined;
  };
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) return notConfigured("missing required environment variable YOH_TIMEZONE");
  let llmClient: AnthropicMessagesClient;
  try {
    llmClient = createAnthropicMessagesClient(loadLlmAdapterConfigFromEnv(env));
  } catch (err) {
    return notConfigured(err instanceof Error ? err.message : String(err));
  }

  const notionClientFromEnv = (notionToken: string): Client =>
    new Client({ auth: notionToken, ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}) });

  const readTasks = async (): Promise<readonly Task[]> => {
    if (!notion) {
      throw new Error(
        "server: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID / NOTION_PROJECTS_DATA_SOURCE_ID — needed to read your Tasks",
      );
    }
    return (await readTasksWith(notion)()).tasks;
  };

  const getNotionCreatePageBinding: NotionCreatePageBindingFn = () => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
    const researchVaultDataSourceId = env["NOTION_RESEARCH_VAULT_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId || !projectsDataSourceId || !researchVaultDataSourceId) {
      return {
        ok: false,
        error: { kind: "missing-field", message: "server: missing required Notion environment variable(s) — needed to create or file a Notion item" },
      };
    }
    return {
      ok: true,
      value: {
        client: notion?.notionClient ?? notionClientFromEnv(notionToken),
        config: { tasksDataSourceId, projectsDataSourceId, researchVaultDataSourceId, taskPropertyNames: loadTaskPropertyNamesFromEnv(env) },
      },
    };
  };

  const perplexityApiKey = env["PERPLEXITY_API_KEY"];
  const searchFn: SearchFn = async (query) => {
    if (!perplexityApiKey) {
      return { ok: false, error: { kind: "missing-field", message: "server: missing required environment variable PERPLEXITY_API_KEY — needed to search" } };
    }
    return runSearch({ apiKey: perplexityApiKey }, query);
  };

  // Story 8.6 (Task 7): same lazy-construction convention as every Notion
  // binding above — a session that never answers an open item's Task-field
  // question must not be unable to chat at all just because Notion isn't
  // configured. `bindNotionTaskWrites` (`notion-adapter.ts`) is the ONLY
  // caller of the two Notion Task-write functions this binds (AD-16) — this
  // file never names either directly, mirroring `chat-cli.ts`'s own
  // `getNotionTaskWriteBinding` before it was retired (Story 8.9).
  const getNotionTaskWriteBinding: NotionTaskWriteBindingFn = () => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId) {
      return {
        ok: false,
        error: {
          kind: "missing-field",
          message: "server: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID — needed to record this answer in Notion",
        },
      };
    }
    return { ok: true, value: { client: notion?.notionClient ?? notionClientFromEnv(notionToken), config: { tasksDataSourceId } } };
  };

  // Polish 4 Task 3 (Spencer: an Area answer typed in chat wrote "college
  // apps" free text instead of matching the live "College Apps" option):
  // `AnswerDataCompletenessDeps.readFieldOptions`, the same live-schema read
  // `buildTasksDeps` already binds for the Tasks page's own inline selects —
  // a fresh read every call (never cached), since the live option list can
  // change while the process runs. Throws when Notion isn't fully
  // configured; `answer-data-completeness.ts`'s own `liveAreaOptions` treats
  // any throw as "no live options to check against," so a chat session
  // still lets Spencer answer even when Notion is unreachable.
  const readFieldOptions = (): Promise<TaskFieldOptions> => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId) {
      throw new Error("server: missing required Notion environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID — needed to read the live Area/Energy/Status options");
    }
    return readTaskFieldOptions(notion?.notionClient ?? notionClientFromEnv(notionToken), {
      tasksDataSourceId,
      taskPropertyNames: loadTaskPropertyNamesFromEnv(env),
    });
  };

  // Story 8.6 (Task 7): `completion-log.ts`'s `recordCompletion`, pre-bound
  // to the shared `SqliteConnection` — the server's own equivalent of
  // `chat-cli.ts`'s `recordCompletion` closure, before it was retired
  // (Story 8.9). `initCompletionLogSchema`
  // already runs unconditionally at server startup (below), so this needs
  // no lazy guard of its own.
  const recordCompletion = (input: RecordCompletionInput): void => completionLogRecordCompletion(connection, input);
  // Reuses `readTasks` above (the same live Notion read Mid-Day Re-Flow
  // already uses) — Story 7.9's Ruling R7 close-out completion-snapshot
  // lookup, mirrored from `chat-cli.ts`'s `main()` (since retired, Story
  // 8.9).
  const lookupTask = async (taskId: ExternalId): Promise<Task | undefined> => (await readTasks()).find((t) => t.id === taskId);

  // Google OAuth is constructed once, on the first Calendar request. The
  // narrow read client lists today's events; the broad one routes and
  // proposes an edit (AD-13).
  let cachedTokenStore: TokenStore | undefined;
  const getTokenStore = (): TokenStore => {
    cachedTokenStore ??= createTokenStore(loadGoogleOAuthConfigFromEnv(env));
    return cachedTokenStore;
  };
  const getCalendarBroadClient = (): CalendarBroadClient =>
    createCalendarBroadClient(getTokenStore().getBroadOAuth2Client() as unknown as Parameters<typeof createCalendarBroadClient>[0]);
  const readCalendarEventsFn = async (): Promise<readonly CalendarEvent[]> =>
    readCalendarEvents(createCalendarReadClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]), {
      timeZone,
      extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
      yohPlanCalendarId: getTokenStore().getCalendarId(),
      log: writeStructuredLog,
    });
  // Real-use fixes plan, Task 5 ("what's happening tomorrow"): the same
  // read-only client/binding as `readCalendarEventsFn` above, just with the
  // target date threaded through to `readCalendarEvents`'s own `date`
  // field — `app/day-view.ts`'s `dayView` is the sole caller.
  const readCalendarEventsForDate = async (date: IsoDate): Promise<readonly CalendarEvent[]> =>
    readCalendarEvents(createCalendarReadClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]), {
      timeZone,
      date,
      extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
      yohPlanCalendarId: getTokenStore().getCalendarId(),
      log: writeStructuredLog,
    });
  // Real-use fixes plan, Task 1 ("plan my day on demand"): `/plan`'s own
  // Calendar-write seam (`app/plan-day.ts`'s `PlanDayDeps.writeCalendarPlan`)
  // — same lazy-construction convention as `getCalendarBroadClient` above,
  // built from the SAME cached `getTokenStore()` rather than a second,
  // independently-refreshing token store. Deliberately not a re-run of
  // `shell/ritual-cli/morning-deps.ts`'s `createMorningRitualDeps` wholesale
  // — this file already builds its own lazily-guarded Notion client and
  // `TokenStore` for `/api/chat`'s other capabilities (see
  // `loadNotionFeatureConfig`/`buildHomeViewDeps` above for the identical
  // reasoning on the Notion/Calendar READ side), and re-running that
  // builder here would stand up a SECOND, independent Notion client and a
  // SECOND, independently-refreshing Google `TokenStore` in the same
  // process — a worse outcome than the few lines of adapter-binding code
  // this avoids duplicating.
  let cachedCalendarWriteClient: CalendarWriteClient | undefined;
  const getCalendarWriteClient = (): CalendarWriteClient => {
    cachedCalendarWriteClient ??= createCalendarWriteClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarWriteClient>[0]);
    return cachedCalendarWriteClient;
  };
  // Story 8.6 (Task 7): same lazy-construction convention as every binding
  // above — a session that never confirms a Calendar-edit Proposal must not
  // be unable to chat at all just because Google OAuth isn't configured.
  // `bindCalendarApply` (`calendar-adapter.ts`) is the ONLY caller of the
  // Calendar apply-edit write this binds (AD-16) — mirrors `chat-cli.ts`'s
  // own `getCalendarApplyBinding` before it was retired (Story 8.9).
  const getCalendarApplyBinding: CalendarApplyBindingFn = () => {
    try {
      return { ok: true, value: getCalendarBroadClient() };
    } catch (err) {
      return {
        ok: false,
        error: { kind: "missing-field", message: `server: could not apply that calendar change — ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  };

  const store = notion?.store ?? createMemoryStore(connection);

  return {
    store,
    timeZone,
    now: () => new Date(),
    llmClient,
    // Real-use fixes plan, Task 9: every `llm-adapter.ts` call site this
    // process makes (`app/chat-turn.ts`, `app/general-question.ts`,
    // `app/create-item.ts`, `app/calendar-edit.ts`,
    // `app/surface-open-items.ts`) threads its own trailing `connection`
    // argument from this one field, so real usage gets recorded — the
    // schema is created idempotently above, at startup.
    connection,
    readTasks,
    // Story 8.7 (FR-41): the same completion-log.ts binding
    // ritual-cli.ts's createNightPromptRitualDeps already uses — /night's
    // exclusion rule.
    getCompletedTaskIdsToday: () => listCompletedTaskIdsOnDate(connection, currentIsoDate(new Date(), timeZone), timeZone),
    getNotionCreatePageBinding,
    searchFn,
    // Review fix (real-use fixes plan, Task 5 fix, FR-42): the single
    // source of truth for whether web search is actually configured right
    // now — threaded through `ChatTurnDeps` (via `WebSearchDeps`) into both
    // `app/web-search.ts`'s `searchWeb` (never attempts a search when
    // false) and, via `app/chat-turn.ts`'s final `answerQuestion` call,
    // `core/tone.ts`'s capability text (never claims search when false).
    webSearchAvailable: Boolean(perplexityApiKey),
    readCalendarEventsFn,
    readCalendarEventsForDate,
    resolveCalendarEditRouteFn: (calendarId, eventId) => calendarResolveRoute(getCalendarBroadClient(), calendarId, eventId),
    proposeCalendarEditFn: (calendarId, eventId, change) => calendarProposeEdit(getCalendarBroadClient(), calendarId, eventId, change),
    proposeNewCalendarEventFn: proposeNewCalendarEvent,
    // Real-use fixes plan, Task 1: `/plan`'s (`app/plan-day.ts`) own
    // Yoh-Plan Calendar write, the same seam the 6am cron's
    // `createMorningRitualDeps` binds, minus the push (`planDay` hardcodes
    // that to a no-op itself, so it isn't threaded through `ChatTurnDeps` at
    // all — see that file's own doc comment). `bumpLevels` is deliberately
    // NOT built here: it's pure computation over `store` with no credential
    // of its own, so `plan-day.ts` computes it itself, freshly, on every
    // `/plan` — see that file's own doc comment for why (this object is
    // built once at server startup, but a long-running process can see
    // fresh `SlipHistory` rows written hours later, e.g. via `/night`).
    writeCalendarPlan: (blocks) => writeTodaysPlanToCalendar(getCalendarWriteClient(), getTokenStore(), blocks, { timeZone, snapshot: createPlanCalendarSnapshotStore(connection) }),
    log: (entry) => writeStructuredLog(entry),
    planSyncReads: {
      readYohPlanEvents: async () => {
        const calendarId = getTokenStore().getCalendarId();
        if (!calendarId) return undefined;
        return readYohPlanEvents(createCalendarReadClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]), calendarId, { timeZone, now: new Date() });
      },
      readDeletedYohPlanEventIds: async () => {
        const calendarId = getTokenStore().getCalendarId();
        if (!calendarId) return [];
        return readDeletedYohPlanEventIds(createCalendarReadClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]), calendarId, { timeZone, now: new Date() });
      },
      readPlanCalendarSnapshot: (date) => createPlanCalendarSnapshotStore(connection).list(date),
      readPlanCalendarWriteState: (date) => createPlanCalendarSnapshotStore(connection).writeState(date),
    },
    // Reshuffle approval (chat "Approve" answers via `answerOpenItem`) — the
    // same narrow Yoh-Plan-calendar writer `/plan` uses, never the broad client.
    reshuffle: {
      connection,
      timeZone,
      now: () => new Date(),
      readTasks,
      readCalendarEvents: readCalendarEventsFn,
      writeCalendarPlan: (blocks) => writeTodaysPlanToCalendar(getCalendarWriteClient(), getTokenStore(), blocks, { timeZone, snapshot: createPlanCalendarSnapshotStore(connection) }),
    },
    // Story 8.6 (Task 7): `AnswerOpenItemDeps`'s own fields — spread in via
    // each write function's adapter-owned binder (never named directly
    // here, AD-16), so `GET /api/open-items`/`POST /api/open-items/answer`
    // (transport over `surfaceOpenItems`/`answerOpenItem`) and a confirmed
    // Proposal's `"field-value"`/`"notion-page-draft"`/`"calendar-edit"`
    // kinds (`confirmProposal`, dispatched from `answerOpenItem`) all work
    // identically to `chat-cli.ts`'s own equivalent wiring, before it was
    // retired (Story 8.9).
    ...bindNotionTaskWrites(getNotionTaskWriteBinding),
    ...bindNotionCreatePage(getNotionCreatePageBinding),
    ...bindCalendarApply(getCalendarApplyBinding),
    readFieldOptions,
    recordCompletion,
    lookupTask,
    random: Math.random,
  };
}

if (import.meta.main) {
  // AD-10: one connection per process, to the same file the cron one-shots use.
  const connection = openSqliteConnection({ databasePath: process.env["MEMORY_DB_PATH"] || "./data/yoh-memory.db" });
  // AD-10: each owner creates its dedicated tables idempotently on startup.
  initNotificationStoreSchema(connection.db);
  initPlanStateStoreSchema(connection.db);
  initRoutineStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  initSettingsStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  // Real-use fixes plan, Task 9: `server.ts` is the ONE shell that makes
  // real Claude calls (POST /api/chat's `buildChatDeps` below) —
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
    ...(tasks ? { tasks } : {}),
    ...(research ? { research } : {}),
    ...(sandbox ? { sandbox } : {}),
  });
  // Story 7.10, AD-20: the startup sweep commits anything left overdue by a
  // previous process, then the commit timer takes over.
  const checkOffSweep = checkOff ? startCheckOffCommitSweep({ ...checkOff, connection, now: () => new Date() }) : undefined;
  const planSyncSweep = planSync ? startPlanCalendarSyncSweep(planSync) : undefined;
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
    handle.close();
    setTimeout(() => {
      connection.close();
      process.exit(0);
    }, 3_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

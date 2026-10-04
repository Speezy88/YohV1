/**
 * src/shell/server-streams.ts
 *
 * The server's long-lived loops, split out of `server.ts` (a pure move):
 * `GET /api/events`'s outbox tail (`runEventStream`), the heartbeat writer,
 * the Plan calendar sync sweep, the check-off commit sweep, the research job
 * runner, and `POST /api/chat`'s SSE stream (`runChatStream`). `server.ts`
 * re-exports the public names, so importers keep using `shell/server.ts`.
 */
import { writeStructuredLog, type LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { getMaxOutboxSeq, OUTBOX_POLL_INTERVAL_MS, tailOutboxSince } from "../adapters/notification-store.ts";
import { chatExchange, type ChatExchangeDeps, type ChatTurnFn } from "../app/chat-exchange.ts";
import { HEARTBEAT_INTERVAL_MS, writeHeartbeat } from "../adapters/plan-state-store.ts";
import { errorCopyForWire, GENERIC_SERVER_ERROR_MESSAGE } from "../core/error-copy.ts";
import { chatTurn, type ChatTurnDeps } from "../app/chat-turn.ts";
import { failInterruptedResearchJobs, runNextResearchJob, RESEARCH_JOB_POLL_INTERVAL_MS, type RunResearchJobDeps } from "../app/run-research-job.ts";
import { CHECK_OFF_COMMIT_TICK_MS, commitDueCheckOffs, type CheckOffDeps } from "../app/check-off.ts";
import { syncPlanFromCalendar, PLAN_SYNC_MISSING_UNCONFIRMED_EVENT, type SyncPlanFromCalendarDeps, type SyncPlanFromCalendarOutput } from "../app/sync-plan-from-calendar.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import type { ChatStreamEvent, ChatTurnRequest, EventHint } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

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

export function getPlanSyncRunner(deps: SyncPlanFromCalendarDeps, log: (entry: LogEntry) => void): () => Promise<PlanSyncResult> {
  const existing = planSyncRunners.get(deps);
  if (existing) return existing;
  let inFlight: Promise<PlanSyncResult> | undefined;
  // The missing-event warning is true on every sync while the event stays missing; log it once per distinct state.
  let lastMissing: string | undefined;
  const runOnce = (): Promise<PlanSyncResult> => {
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<PlanSyncResult> => {
      try {
        let missing: string | undefined;
        const syncLog = (entry: LogEntry): void => {
          if (entry.event === PLAN_SYNC_MISSING_UNCONFIRMED_EVENT) {
            missing = JSON.stringify(entry.detail);
            if (missing === lastMissing) return;
          }
          (deps.log ?? log)(entry);
        };
        const result = await syncPlanFromCalendar({ ...deps, log: syncLog }, {});
        if (result.ok) lastMissing = missing;
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
// Research job runner (Story 11.3, E11-R9) — runs queued /research jobs one at a
// time in the background. All job logic is in `app/run-research-job.ts`.
// ============================================================================

export interface ResearchJobRunnerOptions {
  readonly intervalMs?: number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
  readonly log?: (entry: LogEntry) => void;
}

export interface ResearchJobRunnerHandle {
  /** Settles once startup recovery (jobs a previous process left `running`) has run; it precedes the first tick. */
  readonly startup: Promise<void>;
  /** Runs one tick now, or joins the one already running, so ticks never overlap. */
  runOnce(): Promise<void>;
  stop(): void;
}

/** Recovers interrupted jobs first, then ticks every `intervalMs`: one job per tick. Idle ticks are silent. */
export function startResearchJobRunner(deps: RunResearchJobDeps, options: ResearchJobRunnerOptions = {}): ResearchJobRunnerHandle {
  const intervalMs = options.intervalMs ?? RESEARCH_JOB_POLL_INTERVAL_MS;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const log = options.log ?? ((entry: LogEntry) => writeStructuredLog(entry));
  const runDeps: RunResearchJobDeps = { ...deps, log };

  const startup = (async () => {
    try {
      const result = await failInterruptedResearchJobs(runDeps, {});
      if (!result.ok) log({ level: "error", event: "server.research-recovery-failed", detail: { message: result.error.message } });
      else if (result.value.failed > 0) log({ level: "info", event: "server.research-recovery", detail: { ...result.value } });
    } catch (err) {
      log({ level: "error", event: "server.research-recovery-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
    }
  })();

  let inFlight: Promise<void> | undefined;
  const runOnce = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await startup;
        const result = await runNextResearchJob(runDeps, {});
        if (!result.ok) log({ level: "error", event: "server.research-job-failed", detail: { message: result.error.message } });
        else if (result.value.ran) log({ level: "info", event: "server.research-job", detail: { outcome: result.value.outcome } });
      } catch (err) {
        log({ level: "error", event: "server.research-job-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

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
export const CHAT_NOT_CONFIGURED: ChatStreamEvent = {
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
export function sseMessage(event: ChatStreamEvent): { event: string; data: string } {
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
  deps: ChatTurnDeps & Pick<ChatExchangeDeps, "ratings" | "ratingDraw">,
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

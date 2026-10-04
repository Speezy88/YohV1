/**
 * src/shell/server-routes.ts
 *
 * `ServerDeps` and `createApp`: every HTTP route, split out of `server.ts`
 * (a pure move). Transport only (AD-16): validate input, call ONE `app/`
 * function, return `c.json(wire(result), httpStatus(result))`. Routes stay
 * ONE chained expression so `AppType` carries every route's types (AD-17).
 * `server.ts` re-exports the public names, so importers keep using
 * `shell/server.ts`.
 */
import { offerPattern } from "../app/pattern-offer.ts";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { validator } from "hono/validator";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { serveStatic } from "@hono/node-server/serve-static";
import { writeStructuredLog, type LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { ChatStore } from "../adapters/chat-store.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import type { ChatExchangeDeps, ChatTurnFn } from "../app/chat-exchange.ts";
import { rate } from "../app/rate.ts";
import type { RatingStore } from "../adapters/rating-store.ts";
import { clearChatHistory, deleteChatConversation, getChatConversation, listChatHistory, todaysChatHistory } from "../app/chat-history.ts";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { bindCalendarApply } from "../adapters/calendar-adapter.ts";
import { bindNotionCreatePage } from "../adapters/notion-adapter.ts";
import { errorCopyForWire, GENERIC_SERVER_ERROR_MESSAGE } from "../core/error-copy.ts";
import { listNotifications, markNotificationRead } from "../app/notifications.ts";
import { listCommands } from "../app/commands.ts";
import type { ChatTurnDeps } from "../app/chat-turn.ts";
import type { ChatSession } from "../app/chat-session.ts";
import { getHomeView, type HomeViewDeps } from "../app/home-view.ts";
import { getCalendarDay, type CalendarDayDeps } from "../app/calendar-day.ts";
import { declareTimeBudget } from "../app/time-budget.ts";
import { checkOff, holdCheckOff, releaseCheckOff, undoCheckOff, type CheckOffDeps } from "../app/check-off.ts";
import { deleteMemoryItem, editMemoryItem, moveMemoryItem, recordSortFeedback, reviewMemoryItem, setMemoryExpiry } from "../app/memory-edit.ts";
import { revertPlanningSetting } from "../app/settings-revert.ts";
import { undoMemoryReceipt } from "../app/memory-undo.ts";
import { viewMemory } from "../app/memory-view.ts";
import { searchMemory } from "../app/memory-search.ts";
import { importMemory } from "../app/import-memory.ts";
import { parseMemoryImport } from "../core/memory-import.ts";
import { surfaceOpenItems } from "../app/surface-open-items.ts";
import { answerOpenItem, type AnswerOpenItemDeps } from "../app/answer-open-item.ts";
import { approveReshuffleById, discardReshuffleById, requestReshuffleView } from "../app/decide-reshuffle.ts";
import type { ApproveReshuffleDeps } from "../app/approve-reshuffle.ts";
import type { SyncPlanFromCalendarDeps } from "../app/sync-plan-from-calendar.ts";
import { parseReshuffleRequest } from "../core/reshuffle-preview.ts";
import { listTasks, type TasksViewDeps } from "../app/tasks-view.ts";
import { createTask, previewQuickAdd, type CreateTaskDeps } from "../app/create-task.ts";
import { deleteTask, renameTask, updateTask, type UpdateTaskDeps } from "../app/update-task.ts";
import { planDayForChangeSet } from "../app/plan-day.ts";
import { refitPlan } from "../app/refit-plan.ts";
import type { ApplyChangeSetDeps } from "../app/apply-change-set.ts";
import { getDesk, recordActivity, type DeskDeps } from "../app/desk.ts";
import { getResearchDocument, listResearch, type ResearchListDeps } from "../app/research-list.ts";
import { sandboxQueue, type SandboxQueueDeps } from "../app/sandbox-queue.ts";
import { finishSandboxSession, saveSandboxCardAndAdvance, type SandboxSubmitDeps } from "../app/sandbox-submit.ts";
import { firstCardView } from "../core/sandbox-card-view.ts";
import type {
  AnswerOpenItemRequest,
  RatingRequest,
  UndoMemoryRequest,
  EditMemoryRequest,
  MoveMemoryRequest,
  SetMemoryExpiryRequest,
  SortFeedbackRequest,
  DeleteMemoryRequest,
  ReviewMemoryRequest,
  RevertSettingRequest,
  ApiResult,
  PlanSyncResponse,
  CalendarDayRequest,
  ChatTurnRequest,
  CheckOffRequest,
  CreateTaskRequest,
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
import type { EditableTaskField, IsoDate, YohError, YohErrorKind } from "../types/domain.ts";
import { runEventStream, getPlanSyncRunner, CHAT_NOT_CONFIGURED, sseMessage, runChatStream, type RunEventStreamOptions } from "./server-streams.ts";

// ============================================================================
// The app
// ============================================================================

export interface ServerDeps {
  /** Rulings E12-R3/R14: records the days Spencer clicked or typed (`POST /api/activity`). Absent, nothing is recorded. */
  readonly desk?: DeskDeps;
  /** The process's one SQLite connection (AD-10), opened at startup in `server.ts`. */
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
   * request, `runChatStream`). Absent (no
   * `CLAUDE_API_KEY`/`YOH_TIMEZONE`), every one of the three routes reports
   * its own clear `unreachable` error. `runChatTurn` is a test seam
   * (default: the real `chatTurn`), the same DI convention as
   * `eventStream.sleep`.
   */
  readonly chat?: Omit<ChatTurnDeps & AnswerOpenItemDeps, "session" | "emit"> & {
    /** The change-set write bindings, spread from the adapters' binders by `buildChatDeps`. */
    readonly changeSetWrites?: ChatChangeSetWrites;
    readonly runChatTurn?: ChatTurnFn;
    /** Story 13.11 test seam: the [0,1) rating draw (the e2e fixture forces it). */
    readonly ratingDraw?: () => number;
    /** The Yoh Plan calendar sync's two reads; `buildPlanSyncDeps` joins them with `reshuffle`. */
    readonly planSyncReads?: Pick<SyncPlanFromCalendarDeps, "readYohPlanEvents" | "readDeletedYohPlanEventIds" | "readPlanCalendarSnapshot" | "readPlanCalendarWriteState">;
  };
  /** Story 13.1: the server-owned chat store (history for the model, `GET /api/chat-history/today`). */
  readonly chatHistory?: ChatStore;
  /** Story 13.4: the memory item store (commands, receipts, Undo). */
  readonly memoryItems?: MemoryItemStore;
  /** Story 13.11: the rating schedule/answers store (`POST /api/rating`, the `rating` chat event). */
  readonly ratings?: RatingStore;
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

/** Story 13.9: the Memory page routes' deps; nothing here needs the `chat` block (its Task read only adds entity checks). */
function memoryPageDeps(deps: ServerDeps, memoryItems: MemoryItemStore) {
  return {
    memoryItems,
    ...(deps.chatHistory ? { chatHistory: deps.chatHistory } : {}),
    connection: deps.connection,
    store: deps.chat?.store ?? createMemoryStore(deps.connection),
    ...(deps.chat?.readTasks ? { readTasks: deps.chat.readTasks } : {}),
    now: () => new Date(),
    timeZone: deps.chat?.timeZone ?? process.env["YOH_TIMEZONE"] ?? "UTC",
  };
}

/** Validates a memory-write body: a JSON object whose named fields have the given shapes; 400 envelope otherwise. */
function validateMemoryBody<T>(route: string, check: (body: Record<string, unknown>) => string | undefined) {
  return (value: unknown, c: Context): T | Response => {
    const body = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
    const problem = body ? check(body) : "expected a JSON object";
    if (problem) {
      const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: `${route}: ${problem}` } };
      return c.json(invalid, httpStatus(invalid));
    }
    return body as unknown as T;
  };
}
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v !== "";
const itemIdProblem = (b: Record<string, unknown>): string | undefined => (isNonEmptyString(b["itemId"]) ? undefined : "missing itemId");

const MEMORY_NOT_CONFIGURED: ApiFailure = {
  ok: false,
  error: { kind: "unreachable", message: errorCopyForWire({ kind: "unreachable", message: "server: memory not configured" }) },
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

/** Epic 12: `GET /api/desk`'s "not configured" failure (the server was started without the Desk's deps). */
const DESK_NOT_CONFIGURED: ApiFailure = {
  ok: false,
  error: { kind: "unreachable", message: "I can't show your Desk right now — it isn't set up on this server." },
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

/** The reply to a non-GET `/api/*` request that is not sent as JSON (see the guard in `createApp`). */
export const JSON_CONTENT_TYPE_REQUIRED_MESSAGE = "Send this request with Content-Type: application/json.";
const MALFORMED_BODY_MESSAGE = "That request body isn't valid JSON.";
const INVALID_REQUEST_MESSAGE = "That request isn't valid.";

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
 * than imported: the server never imports `rituals/` at all (AD-5, AD-15 —
 * `tests/server.test.ts`'s own structural rule), the identical small,
 * deliberate duplication that helper's own doc comment already documents
 * between `core/time-budget.ts` and `core/derived-priority.ts`. Callers must pass Spencer's CURRENT local calendar day, computed fresh on
 * every read, never the server process's UTC start time.
 */
export function currentIsoDate(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The write bindings a change set needs that `bindNotionCreatePage` and `bindCalendarApply` provide. */
type ChatChangeSetWrites = ReturnType<typeof bindNotionCreatePage> & ReturnType<typeof bindCalendarApply>;

const NOTION_NOT_SET_UP = (what: string) => async (): Promise<{ ok: false; error: YohError }> => ({
  ok: false,
  error: { kind: "missing-field", message: `Notion isn't set up, so I can't ${what}.` },
});
const CALENDAR_NOT_SET_UP: { ok: false; error: YohError } = {
  ok: false,
  error: { kind: "missing-field", message: "Google Calendar isn't set up, so I can't change it." },
};
const PAGE_NOT_SET_UP: { ok: false; error: YohError } = {
  ok: false,
  error: { kind: "missing-field", message: "Notion isn't set up, so I can't create Tasks." },
};

/**
 * The chat tool loop's bound dependencies (Epic 14): `agentSearchMemory` for
 * its memory tool and `changeSet` for a confirmed change set. Each closure
 * only binds deps and calls one app function; the write paths are the same
 * ones the single-change routes use. Built in `createApp` because the Tasks,
 * check-off and chat deps live in different `build*Deps` functions.
 */
function withChatToolLoopDeps<T extends Omit<ChatTurnDeps, "emit"> & AnswerOpenItemDeps & { readonly changeSetWrites?: ChatChangeSetWrites }>(
  chatDeps: T,
  memorySearchDeps: ReturnType<typeof memoryPageDeps> | undefined,
  checkOffDeps: CheckOffDeps | undefined,
  tasksDeps: UpdateTaskDeps | undefined,
): T {
  const planDeps = {
    store: chatDeps.store,
    session: chatDeps.session,
    llmClient: chatDeps.llmClient,
    timeZone: chatDeps.timeZone,
    now: chatDeps.now,
    readTasks: chatDeps.readTasks,
    readCalendarEvents: chatDeps.readCalendarEventsFn,
    ...(chatDeps.writeCalendarPlan ? { writeCalendarPlan: chatDeps.writeCalendarPlan } : {}),
    ...(chatDeps.log ? { log: chatDeps.log } : {}),
  };
  const { reshuffle } = chatDeps;
  // The page-create and calendar writes: taken from the chat deps when present (directly, or via `changeSetWrites` from `buildChatDeps`), else the same binders report "not set up". Keys come from the binders, so this file never names a write.
  const unconfigured: ChatChangeSetWrites = { ...bindNotionCreatePage(() => PAGE_NOT_SET_UP), ...bindCalendarApply(() => CALENDAR_NOT_SET_UP) };
  const direct = chatDeps as unknown as Record<string, unknown>;
  const viaBuilder = (chatDeps.changeSetWrites ?? {}) as Record<string, unknown>;
  const writes = Object.fromEntries(Object.entries(unconfigured).map(([key, fallback]) => [key, direct[key] ?? viaBuilder[key] ?? fallback])) as ChatChangeSetWrites;
  const changeSet: ApplyChangeSetDeps = {
    timeZone: chatDeps.timeZone,
    now: chatDeps.now,
    ...writes,
    editTaskField: tasksDeps ? (taskId, field, value) => updateTask(tasksDeps, { taskId, field, value }) : NOTION_NOT_SET_UP("change Tasks"),
    renameTask: tasksDeps ? (taskId, title) => renameTask(tasksDeps, { taskId, title }) : NOTION_NOT_SET_UP("change Tasks"),
    completeTask: checkOffDeps ? (taskId) => checkOff(checkOffDeps, { taskId }) : NOTION_NOT_SET_UP("mark Tasks done"),
    deleteTask: tasksDeps ? (taskId) => deleteTask(tasksDeps, { taskId }) : NOTION_NOT_SET_UP("delete Tasks"),
    planDay: () => planDayForChangeSet(planDeps, {}),
    refitPlan: reshuffle
      ? (request) => refitPlan({ ...reshuffle, store: chatDeps.store }, request ? { request } : {})
      : async () => ({ ok: false, error: { kind: "missing-field", message: "I can't re-fit the Plan right now." } }),
  };
  return {
    ...chatDeps,
    ...(memorySearchDeps
      ? {
          agentSearchMemory: async (query: string) => {
            const found = await searchMemory(memorySearchDeps, { query });
            if (!found.ok) return found;
            const lines = [
              ...found.value.items.map((i) => `- ${i.text}`),
              ...found.value.turns.map((t) => `- (${t.date}, ${t.role}) ${t.snippet}`),
            ];
            return { ok: true as const, value: { text: lines.length > 0 ? lines.join("\n") : "Nothing in memory matches that." } };
          },
        }
      : {}),
    changeSet,
  };
}

export function createApp(deps: ServerDeps) {
  const log = deps.log ?? ((entry: LogEntry) => writeStructuredLog(entry));
  const now = deps.now ?? (() => performance.now());
  const notificationsDeps = { connection: deps.connection, now: deps.clock ?? (() => new Date()) };
  const checkOffDeps: CheckOffDeps | undefined = deps.checkOff
    ? { ...deps.checkOff, connection: deps.connection, now: deps.checkOff.now ?? (() => new Date()), log }
    : undefined;
  const chatSession: ChatSession = deps.chatSession ?? { recentMessages: [], lastSearchAnswer: undefined, researchOffered: new Set<string>() };
  // Task 6B: one merged deps object serves all three Tasks-page app/
  // functions (each reads only its own fields). Spread, never re-keyed, so
  // the write binding's name never appears in this file (AD-16).
  const tasksDeps: (TasksViewDeps & CreateTaskDeps & UpdateTaskDeps) | undefined = deps.tasks
    ? { ...deps.tasks, now: deps.tasks.now ?? (() => new Date()), connection: deps.connection, log }
    : undefined;
  // Task 6C: the Research Hub page's one deps object — just `deps.research`
  // plus the shared logger, the same "spread, default `log` in" convention
  // `tasksDeps` above uses.
  const deskDeps: DeskDeps | undefined = deps.desk;
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
  let chatDeps: (Omit<ChatTurnDeps, "emit"> & AnswerOpenItemDeps & Pick<ChatExchangeDeps, "ratings" | "ratingDraw">) | undefined;
  if (deps.chat) {
    const { runChatTurn: _runChatTurn, ...rest } = deps.chat;
    chatDeps = {
      ...rest,
      ...(deps.chatHistory ? { chatHistory: deps.chatHistory } : {}),
      ...(deps.memoryItems ? { memoryItems: deps.memoryItems } : {}),
      // Rule-change and pattern Yes answers write settings + memory in one transaction.
      connection: (rest as { connection?: SqliteConnection }).connection ?? deps.connection,
      now: rest.now ?? deps.clock ?? (() => new Date()),
      ...(deps.ratings ? { ratings: deps.ratings } : {}),
      session: chatSession,
    };
    chatDeps = withChatToolLoopDeps(chatDeps, deps.memoryItems ? memoryPageDeps(deps, deps.memoryItems) : undefined, checkOffDeps, tasksDeps);
  }

  return (
    new Hono()
      // A thrown error or malformed JSON still answers with the Result envelope, never Hono's plain-text default.
      .onError((err, c) => {
        if (err instanceof HTTPException && err.status === 400) {
          const message = /json/i.test(err.message) ? MALFORMED_BODY_MESSAGE : INVALID_REQUEST_MESSAGE;
          return c.json({ ok: false, error: { kind: "validation", message } } satisfies ApiResult<never>, 400);
        }
        log({ level: "error", event: "server.unhandled-error", detail: { method: c.req.method, path: c.req.path, message: err.message } });
        return c.json({ ok: false, error: { kind: "unreachable", message: GENERIC_SERVER_ERROR_MESSAGE } } satisfies ApiResult<never>, 500);
      })
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
      // Cross-origin POST guard: a browser can send a text/plain or body-less POST to another origin without a
      // preflight, but not application/json (or text/markdown), and this server answers no preflight.
      .use("/api/*", async (c, next) => {
        if (c.req.method === "GET" || c.req.method === "HEAD") return next();
        const contentType = (c.req.header("content-type") ?? "").toLowerCase();
        const allowed = c.req.path === "/api/memory/import" ? "text/markdown" : "application/json";
        // The import route answers a wrong type with its own message.
        if (contentType.startsWith(allowed) || c.req.path === "/api/memory/import") return next();
        return c.json({ ok: false, error: { kind: "validation", message: JSON_CONTENT_TYPE_REQUIRED_MESSAGE } } satisfies ApiResult<never>, 400);
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
      // are configured (see `buildHomeViewDeps` in `server-wiring.ts`) — reported as a
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
      // Epic 12: the Desk page's one read, computed from Yoh's own records (no Notion).
      // Ruling E12-R14: the web pings this on a real click or key; no other request marks a day. No outbox row.
      .post("/api/activity", async (c) => {
        if (!deskDeps) return c.json(DESK_NOT_CONFIGURED, httpStatus(DESK_NOT_CONFIGURED));
        const result = wire(await recordActivity(deskDeps, {}));
        return c.json(result, httpStatus(result));
      })
      .get("/api/desk", async (c) => {
        if (!deskDeps) return c.json(DESK_NOT_CONFIGURED, httpStatus(DESK_NOT_CONFIGURED));
        const result = wire(await getDesk({ ...deskDeps, log }, {}));
        return c.json(result, httpStatus(result));
      })
      // Task 6C (FR-43, UX-DR43): the Research Hub page's one route — pure
      // transport over `app/research-list.ts`'s `listResearch` (a live
      // Notion read of the Research Vault, most recent first, server-
      // limited). `deps.research` is absent until Notion +
      // NOTION_RESEARCH_VAULT_DATA_SOURCE_ID are configured
      // (`buildResearchDeps` in `server-wiring.ts`), reported as a clear `unreachable`
      // error rather than a 500.
      .get("/api/research", async (c) => {
        if (!researchDeps) return c.json(RESEARCH_NOT_CONFIGURED, httpStatus(RESEARCH_NOT_CONFIGURED));
        const result = wire(await listResearch(researchDeps, { pages: c.req.query("pages") }));
        return c.json(result, httpStatus(result));
      })
      // Story 11.2 (E11-R2): one Research Vault document by id (the most
      // recent when `id` is missing or unknown; `{}` for an empty vault).
      .get("/api/research/document", async (c) => {
        if (!researchDeps) return c.json(RESEARCH_NOT_CONFIGURED, httpStatus(RESEARCH_NOT_CONFIGURED));
        const result = wire(await getResearchDocument(researchDeps, { id: c.req.query("id") }));
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
      // Story 13.9: chat history list, one transcript, delete, clear; none need `chat` deps.
      // `/today` above must stay registered before the `:conversationId` route.
      .get("/api/chat-history", async (c) => {
        if (!deps.chatHistory) return c.json(CHAT_HISTORY_NOT_CONFIGURED, httpStatus(CHAT_HISTORY_NOT_CONFIGURED));
        const result = wire(await listChatHistory({ chatHistory: deps.chatHistory }, {}));
        return c.json(result, httpStatus(result));
      })
      .get("/api/chat-history/:conversationId", async (c) => {
        if (!deps.chatHistory) return c.json(CHAT_HISTORY_NOT_CONFIGURED, httpStatus(CHAT_HISTORY_NOT_CONFIGURED));
        const result = wire(
          await getChatConversation(
            { chatHistory: deps.chatHistory, ...(deps.memoryItems ? { memoryItems: deps.memoryItems } : {}) },
            { conversationId: c.req.param("conversationId") },
          ),
        );
        return c.json(result, httpStatus(result));
      })
      .post(
        "/api/chat-history/delete",
        validator("json", (value, c) => {
          const conversationId = (value as { conversationId?: unknown } | null)?.conversationId;
          if (typeof conversationId !== "string" || conversationId === "") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "chat-history/delete: missing conversationId" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { conversationId };
        }),
        async (c) => {
          if (!deps.chatHistory) return c.json(CHAT_HISTORY_NOT_CONFIGURED, httpStatus(CHAT_HISTORY_NOT_CONFIGURED));
          const result = wire(await deleteChatConversation({ chatHistory: deps.chatHistory }, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post("/api/chat-history/clear", async (c) => {
        if (!deps.chatHistory) return c.json(CHAT_HISTORY_NOT_CONFIGURED, httpStatus(CHAT_HISTORY_NOT_CONFIGURED));
        const result = wire(await clearChatHistory({ chatHistory: deps.chatHistory }, {}));
        return c.json(result, httpStatus(result));
      })
      // Story 13.9: the Memory Rail's data and one keyword search; neither needs `chat` deps.
      .get("/api/memory", async (c) => {
        if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
        const result = wire(await viewMemory(memoryPageDeps(deps, deps.memoryItems), {}));
        return c.json(result, httpStatus(result));
      })
      .get("/api/memory/search", async (c) => {
        if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
        const result = wire(await searchMemory(memoryPageDeps(deps, deps.memoryItems), { query: c.req.query("q") ?? "" }));
        return c.json(result, httpStatus(result));
      })
      // Claude export import: the body is the reviewed candidates file; `?dryRun=1` reports without writing.
      .post("/api/memory/import", async (c) => {
        if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
        const refuse = (message: string) => {
          const invalid: ApiFailure = { ok: false, error: { kind: "validation", message } };
          return c.json(invalid, httpStatus(invalid));
        };
        // text/plain can be POSTed cross-origin without a preflight; text/markdown cannot, and this server answers no preflight.
        if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("text/markdown")) return refuse("Send the candidates file with Content-Type: text/markdown.");
        const dryRunParam = c.req.query("dryRun");
        if (dryRunParam !== undefined && !["", "0", "false", "1", "true"].includes(dryRunParam)) return refuse("dryRun must be 1 or true.");
        const parsed = parseMemoryImport(await c.req.text());
        if (parsed.problems.length > 0) {
          const shown = parsed.problems.slice(0, 5).map((p) => `Line ${p.line}: ${p.reason}`).join("; ");
          const more = parsed.problems.length > 5 ? `; and ${parsed.problems.length - 5} more` : "";
          return refuse(`The file could not be read. ${shown}${more}.`);
        }
        const result = wire(
          await importMemory(
            { memoryItems: deps.memoryItems, now: () => new Date(), timeZone: deps.chat?.timeZone ?? process.env["YOH_TIMEZONE"] ?? "UTC" },
            { candidates: parsed.candidates, dryRun: dryRunParam === "1" || dryRunParam === "true" },
          ),
        );
        return c.json(result, httpStatus(result));
      })
      // Story 13.13: the day's one pending Pattern question (records `lastOfferedOn`); needs no `chat` deps.
      .get("/api/memory/pattern-offer", async (c) => {
        if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
        const result = wire(await offerPattern(memoryPageDeps(deps, deps.memoryItems), {}));
        return c.json(result, httpStatus(result));
      })
      // Story 13.4: Undo for a Remembered Receipt; refused after Spencer's next message.
      .post(
        "/api/memory/undo",
        validator("json", (value, c) => {
          const receiptId = (value as { receiptId?: unknown } | null)?.receiptId;
          if (typeof receiptId !== "string" || receiptId === "") {
            const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: "memory/undo: missing receiptId" } };
            return c.json(invalid, httpStatus(invalid));
          }
          return { receiptId } as UndoMemoryRequest;
        }),
        async (c) => {
          if (!deps.memoryItems || !deps.chatHistory) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
          const result = wire(await undoMemoryReceipt({ memoryItems: deps.memoryItems, chatHistory: deps.chatHistory, ...(deps.chat?.store ? { store: deps.chat.store } : {}) }, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      // Story 13.11: a rating pick or dismissal; a score-1 note files to Feedback and returns its receipt.
      .post(
        "/api/rating",
        validator("json", validateMemoryBody<RatingRequest>("rating", (b) =>
          !isNonEmptyString(b["promptId"]) ? "missing promptId"
          : b["score"] !== undefined && b["score"] !== 1 && b["score"] !== 2 && b["score"] !== 3 ? "bad score"
          : b["dismissed"] !== undefined && b["dismissed"] !== true ? "bad dismissed"
          : b["note"] !== undefined && typeof b["note"] !== "string" ? "bad note"
          : undefined)),
        async (c) => {
          if (!deps.ratings) return c.json(CHAT_HISTORY_NOT_CONFIGURED, httpStatus(CHAT_HISTORY_NOT_CONFIGURED));
          const { runChatTurn: _r, ...chatRest } = deps.chat ?? ({} as NonNullable<ServerDeps["chat"]>);
          const result = wire(
            await rate(
              {
                ...(deps.chat ? chatRest : {}),
                ...(deps.memoryItems ? { memoryItems: deps.memoryItems } : {}),
                ...(deps.chatHistory ? { chatHistory: deps.chatHistory } : {}),
                ratings: deps.ratings,
                connection: deps.connection,
                store: deps.chat?.store ?? createMemoryStore(deps.connection),
                now: () => new Date(),
                timeZone: deps.chat?.timeZone ?? process.env["YOH_TIMEZONE"] ?? "UTC",
              },
              c.req.valid("json"),
            ),
          );
          return c.json(result, httpStatus(result));
        },
      )
      // Story 13.10: the Memory page's direct writes. Each validates its body, then calls ONE app function.
      .post(
        "/api/memory/edit",
        validator("json", validateMemoryBody<EditMemoryRequest>("memory/edit", (b) =>
          itemIdProblem(b) ?? (typeof b["text"] !== "string" ? "missing text" : b["mergeWithId"] !== undefined && typeof b["mergeWithId"] !== "string" ? "bad mergeWithId" : b["allowDuplicate"] !== undefined && typeof b["allowDuplicate"] !== "boolean" ? "bad allowDuplicate" : undefined))),
        async (c) => {
          if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
          const result = wire(await editMemoryItem(memoryPageDeps(deps, deps.memoryItems), c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/memory/move",
        validator("json", validateMemoryBody<MoveMemoryRequest>("memory/move", (b) => itemIdProblem(b) ?? (isNonEmptyString(b["folder"]) ? undefined : "missing folder"))),
        async (c) => {
          if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
          const result = wire(await moveMemoryItem(memoryPageDeps(deps, deps.memoryItems), c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/memory/sort-feedback",
        validator("json", validateMemoryBody<SortFeedbackRequest>("memory/sort-feedback", (b) =>
          itemIdProblem(b) ?? (b["verdict"] !== "right" && b["verdict"] !== "wrong" ? "verdict must be right or wrong" : typeof b["reason"] !== "string" ? "missing reason" : b["belongsIn"] !== undefined && typeof b["belongsIn"] !== "string" ? "bad belongsIn" : undefined))),
        async (c) => {
          if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
          const result = wire(await recordSortFeedback(memoryPageDeps(deps, deps.memoryItems), c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/memory/expiry",
        validator("json", validateMemoryBody<SetMemoryExpiryRequest>("memory/expiry", (b) => itemIdProblem(b) ?? (b["expiresOn"] === null || typeof b["expiresOn"] === "string" ? undefined : "expiresOn must be a date or null"))),
        async (c) => {
          if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
          const result = wire(await setMemoryExpiry(memoryPageDeps(deps, deps.memoryItems), c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/memory/delete",
        validator("json", validateMemoryBody<DeleteMemoryRequest>("memory/delete", itemIdProblem)),
        async (c) => {
          if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
          const result = wire(await deleteMemoryItem(memoryPageDeps(deps, deps.memoryItems), c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/memory/review",
        validator("json", validateMemoryBody<ReviewMemoryRequest>("memory/review", (b) =>
          itemIdProblem(b) ?? (b["action"] !== "renew" && b["action"] !== "keep" ? "action must be renew or keep" : b["expiresOn"] !== undefined && typeof b["expiresOn"] !== "string" ? "bad expiresOn" : undefined))),
        async (c) => {
          if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
          const result = wire(await reviewMemoryItem(memoryPageDeps(deps, deps.memoryItems), c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
      .post(
        "/api/settings/revert",
        validator("json", validateMemoryBody<RevertSettingRequest>("settings/revert", (b) =>
          isNonEmptyString(b["key"]) ? (b["area"] !== undefined && typeof b["area"] !== "string" ? "bad area" : undefined) : "missing key")),
        async (c) => {
          const result = wire(await revertPlanningSetting({ connection: deps.connection }, c.req.valid("json")));
          return c.json(result, httpStatus(result));
        },
      )
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

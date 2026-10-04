/**
 * src/types/api.ts
 *
 * The locked browser-server wire contract (AD-9, AD-17, AD-18). Authored and
 * committed before any `app/`, `shell/server.ts`, or `web/` file that uses
 * it (Story 7.2).
 *
 * LOCK RULE: later stories may ADD new shapes here (request/response DTOs
 * for a route, `ChatMessage`, ...) but never redeclare, widen, or shadow a
 * shape already exported. No other file declares a local copy of a wire
 * shape — extend this file instead. `tests/api-types.smoke.test.ts` pins
 * the closed-ness of each shape below with `@ts-expect-error` checks.
 *
 * `domain.ts` stays the home for shared business shapes (`YohError`,
 * `Result`, `Plan`, `Task`, ...). This file is the SERIALIZED wire shape of
 * the `/api/*` surface. `web/` may `import type` from here (AD-17) and from
 * nothing else in `src/` except other `types/` files.
 */
import type { ChatTurn, EditableTaskField, Energy, IsoDate, IsoDateTime, MemoryFolder, MemoryLoadClass, PlanningFieldNames, Proposal, RefiningFieldNames, Result, RuleSettingKey, TaskFieldOption, TaskFieldOptions, TaskStatus, YohError } from "./domain.ts";

// ============================================================================
// Serialized Result envelope
// ============================================================================

/**
 * The wire shape every `/api/<noun>[/<verb>]` route returns (Consistency
 * Conventions): `{ok: true, value} | {ok: false, error: YohError}`. Defined
 * as `domain.ts`'s own `Result<T, YohError>` rather than a parallel
 * declaration, so the in-process and serialized envelopes cannot drift.
 * The one exception is the liveness probe, `GET /api/health`
 * (`HealthResponse` below).
 */
export type ApiResult<T> = Result<T, YohError>;

/**
 * `GET /api/health`'s body: exactly `{ok: true}` (Story 7.2 AC). A liveness
 * probe only — it carries no value and never reports `ok: false`; if the
 * server can't answer, the request simply fails.
 */
export interface HealthResponse {
  readonly ok: true;
}

// ============================================================================
// Live delivery — event hint (AD-18)
// ============================================================================

/**
 * One outbox hint pushed over `GET /api/events`'s SSE stream (Story 7.3).
 * SSE carries hints, never data: on receipt the client re-fetches through
 * the ordinary API. `seq` is the outbox's monotonic sequence number and
 * doubles as the SSE event id for `Last-Event-ID` replay on reconnect.
 */
export interface EventHint {
  readonly seq: number;
  readonly topic: string;
  readonly entityId: string;
}

// ============================================================================
// In-app notifications (AD-18, FR-49)
// ============================================================================

/**
 * The CLOSED set of in-app notification kinds (AD-18). FR-49's "never a
 * proactive check-in" is enforced by this union being closed: a progress
 * or check-in notification is not a constructible value.
 */
export type NotificationKind =
  | "research-ready"
  | "research-failed"
  | "sandbox-complete"
  | "sandbox-failed"
  | "needs-data"
  | "reshuffle-apply-failed"
  | "plan-calendar-synced"
  | "operational";

/**
 * A durable in-app notification record, AD-18's
 * `{id, kind, title, body, deepLink, createdAt, readAt?}`.
 * `notification-store.ts` (Story 7.3) is the only file that creates or
 * writes one; this is its wire/read shape.
 *
 * `deepLink` is a REQUIRED key with a nullable value (controller Ruling
 * R11), matching AD-18's field set exactly. An `operational` notification
 * is message-only (epics Story 7.7) and carries `deepLink: null`; every
 * other kind carries its target path (each consumer story names it). "No
 * deep link" is always `null`, never an absent key or `undefined`.
 */
export interface NotificationRecord {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly deepLink: string | null;
  /** ISO-8601 UTC. */
  readonly createdAt: string;
  /** ISO-8601 UTC; absent while unread. */
  readonly readAt?: string;
}

/** `GET /api/notifications`'s value (Story 7.3): every unread notification, oldest first. */
export interface NotificationList {
  readonly notifications: readonly NotificationRecord[];
}

/** `POST /api/notifications/:id/read`'s input (Story 7.3); `id` comes from the path. */
export interface MarkNotificationReadRequest {
  readonly id: string;
}

/**
 * `POST /api/notifications/:id/read`'s value (Story 7.3). Idempotent: an
 * already-read notification returns its original `readAt`.
 */
export interface MarkNotificationReadResponse {
  readonly id: string;
  /** ISO-8601 UTC. */
  readonly readAt: string;
}

// ============================================================================
// Home view (Story 7.8) — today's Plan checklist + Calendar Day View,
// computed server-side (AD-17). New shapes only — nothing above is touched.
// ============================================================================

/** One row of Home's Plan checklist — a `"work"` PlanBlock, in the stored Plan's own order. */
export interface HomePlanRow {
  readonly blockId: string;
  readonly taskId: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  /** The Task's CURRENT completion status (a live Notion read), never the Plan's own generation-time snapshot. */
  readonly completed: boolean;
  /** `true` once `end` has already passed "now" (server-computed, AD-17) — the client renders this read-only. */
  readonly past: boolean;
  /** Story 9.1 (additive, C2-style: added, never widened): mirrors the stored Plan block's own `PlanBlock.missingRefining`, passed through by `app/home-view.ts` untouched. Absent when nothing is missing. */
  readonly missingRefining?: readonly RefiningFieldNames[];
  /** `true` when Spencer fixed this Task's time by hand (a pin). Absent otherwise. */
  readonly pinned?: true;
}

/**
 * One block of Home's Calendar Day View. `"work"`/`"break"` are Yoh-owned
 * (from the stored Plan); `"fixed"` is a live-read primary-calendar event
 * Yoh did not create (never a stored Plan's own `"calendar-anchor"`
 * snapshot — see `app/home-view.ts`'s doc comment for why).
 */
export interface HomeCalendarBlock {
  readonly id: string;
  readonly kind: "work" | "break" | "fixed" | "routine";
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly completed: boolean;
  readonly past: boolean;
  /** The Task a `"work"` block is for; absent on breaks and fixed events. */
  readonly taskId?: string;
  /** `true` when the block sits at a time Spencer fixed by hand. Absent otherwise. */
  readonly pinned?: true;
}

/**
 * Task 6A (real-use fixes + UI refresh, 2026-09-27): today's Time Budget as
 * Home's widget needs it — the declared budget plus how much of it the
 * Plan actually uses and how much is done so far. `undefined` when Spencer
 * has never declared a Time Budget at all (Home then shows the default and
 * "Set today's budget").
 */
export interface HomeTimeBudget {
  readonly totalMinutes: number;
  /** Sum of the stored Plan's own "work" block durations (minutes) — 0 with no Plan yet today. */
  readonly plannedMinutes: number;
  /** Sum of completed "work" block durations (minutes) so far today. */
  readonly doneMinutes: number;
  /** True when this budget was declared on an earlier day and hasn't been changed since (`core/time-budget.ts`'s `resolveTodayTimeBudget`). */
  readonly carriedForward: boolean;
}

/** One block of a reshuffle preview: a Home calendar block plus whether the reshuffle moves (or newly places) it. */
export interface ReshufflePreviewBlock extends HomeCalendarBlock {
  readonly moved: boolean;
}

/** The open, unexpired reshuffle preview as Home shows it (`HomeViewResponse.reshuffle`) and `POST /api/plan/reshuffle` returns it. */
export interface ReshufflePreviewView {
  readonly proposalId: string;
  /** The open interaction request that carries the Approve / Discard question. */
  readonly requestId: string;
  readonly date: string;
  readonly summary: string;
  /** The full proposed day: Yoh-owned blocks (with `moved`) plus the live fixed events. */
  readonly blocks: readonly ReshufflePreviewBlock[];
  readonly deferredTaskIds: readonly string[];
  readonly needsDataTaskIds: readonly string[];
  readonly unplacedRoutineLabels: readonly string[];
  readonly rejectedReason?: string;
  /** ISO timestamp after which the preview is treated as absent. */
  readonly expiresAt: string;
}

export interface HomeViewResponse {
  /** The host-timezone date this response is "today" for (Consistency Conventions: never the browser's date) — also what the client's Feb-19 confetti check reads, never `new Date()`. */
  readonly today: string;
  /** `undefined` when no Plan has been generated yet today. */
  readonly plan: { readonly rows: readonly HomePlanRow[] } | undefined;
  readonly calendar: { readonly blocks: readonly HomeCalendarBlock[] };
  /** `undefined` when Spencer has never declared a Time Budget (Task 6A). */
  readonly timeBudget: HomeTimeBudget | undefined;
  /**
   * Fix round (2026-09-27): the IANA zone id (e.g. "America/Los_Angeles")
   * `today`/every block's completion math is computed in — the client
   * positions and formats Calendar Day View blocks and Plan row times in
   * THIS zone, never the browser's own (AD-17). `today` stays a plain date
   * string (unaffected); this is for wall-clock positioning within the day.
   */
  readonly timeZone: string;
  /** The open, unexpired reshuffle preview for today, if any. */
  readonly reshuffle?: ReshufflePreviewView;
}

/** `POST /api/plan/reshuffle`'s value (body is a `ReshuffleRequest`). */
export interface ReshuffleResponse {
  readonly preview: ReshufflePreviewView;
  readonly question: OpenItemQuestion;
}

/** `POST /api/plan/reshuffle/approve` and `/discard`'s body. */
export interface ReshuffleDecisionRequest {
  readonly proposalId: string;
}

/** `POST /api/plan/reshuffle/approve`'s value: applied, or the Plan/calendar moved on and a fresh preview was made. */
export type ReshuffleApproveResponse =
  | { readonly status: "applied"; readonly calendarFailedBlockIds: readonly string[] }
  | { readonly status: "recomputed"; readonly preview: ReshufflePreviewView; readonly question: OpenItemQuestion };

/** `POST /api/plan/sync`'s value: what the Yoh Plan calendar sync did. */
export interface PlanSyncResponse {
  readonly status: "no-plan" | "unchanged" | "applied" | "skipped-conflict";
  readonly calendarFailedBlockIds?: readonly string[];
}

/** `POST /api/plan/reshuffle/discard`'s value. */
export interface ReshuffleDiscardResponse {
  readonly discarded: true;
}

/** `POST /api/time-budget`'s body (Task 6A): click-to-edit on Home's Time Budget widget, over the existing `app/time-budget.ts` `declareTimeBudget`. */
export interface TimeBudgetRequest {
  readonly totalMinutes: number;
}

/** `GET /api/calendar/day`'s query (real-use fixes plan, Task 4): "pick any day in Month to see its calendar" — `date` is a plain `YYYY-MM-DD` string, validated at the route (a malformed value is a 400 validation envelope, never reaches `app/calendar-day.ts`). */
export interface CalendarDayRequest {
  readonly date: string;
}

/** `GET /api/calendar/day`'s value — the same `HomeCalendarBlock[]` shape `HomeViewResponse.calendar.blocks` already carries, for any date rather than just today. */
export interface CalendarDayResponse {
  readonly date: string;
  readonly blocks: readonly HomeCalendarBlock[];
  /** The host timezone (AD-17) this date's blocks are computed in — same value as `HomeViewResponse.timeZone`, repeated here so a per-date fetch never needs today's `/api/home` response just to know it. */
  readonly timeZone: string;
}

/** `POST /api/time-budget`'s value (Task 6A) — `declareTimeBudget`'s own `DeclareTimeBudgetOutput`, mirrored here per the wire-shapes convention (C2). */
export interface TimeBudgetResponse {
  readonly receipt: string;
}

// ============================================================================
// Check-off with undo (Story 7.10, AD-20) — new shapes only.
// ============================================================================

/**
 * `POST /api/check-off`'s body. Only the Task id: `area`/`dueDate`/
 * `estimatedMinutes` are snapshotted server-side from a live Task read at
 * commit (Ruling R7), never sent by the client.
 */
export interface CheckOffRequest {
  readonly taskId: string;
}

/** The path-param input of `POST /api/check-off/:id/{undo,hold,release}`. */
export interface CheckOffIdRequest {
  readonly id: string;
}

/**
 * A pending check-off as the client sees it — the value of
 * `POST /api/check-off` and of `/hold` and `/release`. The client never
 * hard-codes the undo window (AD-20): it shows the Undo Toast for
 * `commitAt - asOf` from when this response arrives, both being server
 * timestamps, so a skewed browser clock can't shorten or stretch it.
 */
export interface PendingCheckOffResponse {
  readonly id: string;
  readonly taskId: string;
  /** ISO-8601 UTC — when the server will commit (the undo window's end, shifted by any released hold). */
  readonly commitAt: string;
  /** ISO-8601 UTC — the server's clock when this response was produced. */
  readonly asOf: string;
  /** `true` while a hover/focus hold is pausing the window. */
  readonly held: boolean;
}

/** `POST /api/check-off/:id/undo`'s value: the pending record is gone; nothing reached the Completion Log or Notion. */
export interface UndoCheckOffResponse {
  readonly id: string;
}

// ============================================================================
// Open interaction requests as resumable turns (Story 8.1) — new shapes only.
// ============================================================================

/** One selectable choice for an `OpenItemQuestion` — `[]` on the question itself means free text only. */
export interface OpenItemOption {
  readonly label: string;
  readonly value: string;
}

/** The ONE currently-pending question for an open interaction request — deterministic `questionId`, so an answer can be checked for staleness (the conflict rule, C4). */
export interface OpenItemQuestion {
  readonly requestId: string;
  readonly questionId: string;
  readonly text: string;
  readonly options: readonly OpenItemOption[];
  readonly allowsFreeText: boolean;
  /** Present when this question confirms a Proposal (e.g. an FR-25 suggestion) — echoed back verbatim in `AnswerOpenItemRequest.proposal`. */
  readonly proposal?: Proposal<unknown>;
}

/** One open interaction request, with its current pending question already resolved. */
export interface OpenItem {
  readonly requestId: string;
  readonly requestKind: string;
  readonly promptText: string;
  readonly question: OpenItemQuestion;
}

/** `GET /api/open-items`'s value (Task 7): every open request, each with its current question. */
export interface OpenItemsResponse {
  readonly items: readonly OpenItem[];
}

/** `POST /api/open-items/answer`'s body (Task 7). */
export interface AnswerOpenItemRequest {
  readonly requestId: string;
  readonly questionId: string;
  readonly answer: string;
  readonly proposal?: Proposal<unknown>;
}

/** `POST /api/open-items/answer`'s value. */
export interface AnswerOpenItemResponse {
  readonly message?: string;
  readonly receipts: readonly string[];
  readonly next: OpenItemQuestion | "done";
  /** A pattern Yes: what was filed (not persisted; no Undo, Revert lives on the Memory page). */
  readonly receipt?: RememberedReceipt;
}

// ============================================================================
// Proposal confirmation (Story 8.2, AD-3, AD-16) — new shape only.
// ============================================================================

/**
 * `app/confirm-proposal.ts`'s `confirmProposal`'s value: the single result
 * shape for every Proposal kind (`time-budget-change`, `field-value`,
 * `notion-page-draft`, `calendar-edit`). `applied: false` covers both an
 * explicit decline and "nothing to apply" — there is no distinct third
 * state, since either way nothing was written, and the caller (a typed
 * "yes"/"no", a future Chat confirm control, a future Structured Question
 * option) is the same regardless of surface (FR-48).
 */
export interface ConfirmProposalResponse {
  readonly applied: boolean;
  readonly receipts: readonly string[];
  /** A reshuffle approval that found the Plan or calendar had moved on: the fresh preview's confirm question. */
  readonly question?: OpenItemQuestion;
  /** Copy that replaces the generic reply (a rule-change answer). */
  readonly message?: string;
  /** A pattern Yes: what was filed (not persisted; no Undo). */
  readonly receipt?: RememberedReceipt;
}

// ============================================================================
// Chat turn routing (Story 8.3, AD-16) — new shapes only.
// ============================================================================

/**
 * `app/chat-turn.ts`'s `chatTurn`'s input: the current message plus the
 * caller-held running transcript. For `web/src/lib/chatStore.ts` (Story
 * 8.9: originally `shell/chat-cli.ts`'s own `withConversationHistory`
 * wrapper) this `history` already ends with `{role: "user", content:
 * message}` — appended before `send()` even calls the server, since the
 * Web App shows Spencer's own turn optimistically — `chatTurn` doesn't
 * re-append it. `message` is used only for deterministic-command
 * recognition and Tone/model
 * routing, never appended a second time.
 */
export interface ChatTurnRequest {
  readonly message: string;
}

/** `chatTurn`'s value: one reply, ready for any surface to render. */
export interface ChatTurnResponse {
  /** Yoh's full reply text — markdown allowed, never ANSI. May be `""`. */
  readonly reply: string;
  readonly receipts: readonly string[];
  /** A follow-up Structured Question (e.g. a new proposal to confirm) — unused before Task 5/8. */
  readonly question?: OpenItemQuestion;
  /** `/sandbox`'s first card (Story 9.2) — a fifth kind of follow-up alongside `question`, never both on the same turn. */
  readonly sandboxCard?: SandboxCardView;
  /** Server-internal (Story 13.4): a memory command's post-`done` work. `chatExchange` strips it before `done`. */
  readonly memory?: MemoryTurnDirective;
  /** Server-internal (Story 13.5): the turn returned before any LLM classification step. `chatExchange` strips it before `done`. */
  readonly handledDeterministically?: boolean;
  /** Story 13.11: a plan change, re-fit, researched answer, `/morning` or `/night`. Stays on the wire. */
  readonly substantive?: boolean;
}

/** What `chatTurn` asks `chatExchange` to do after `done` for a memory command (E2: `chatTurn` never files). */
export type MemoryTurnDirective =
  | { readonly kind: "remember"; readonly text: string }
  | { readonly kind: "forgot"; readonly receipt: RememberedReceipt; readonly chainIds: readonly string[] };

/** `POST /api/memory/edit` request (Story 13.10). `mergeWithId` accepts a prior duplicate offer; `allowDuplicate` saves separately. */
export interface EditMemoryRequest {
  readonly itemId: string;
  readonly text: string;
  readonly mergeWithId?: string;
  readonly allowDuplicate?: boolean;
}

/** `POST /api/memory/edit` value. "duplicate" writes nothing; the client offers "Merge with '{other}'?". */
export type EditMemoryResponse =
  | { readonly status: "saved"; readonly itemId: string }
  | { readonly status: "merged"; readonly itemId: string }
  | { readonly status: "duplicate"; readonly other: { readonly id: string; readonly text: string; readonly folder: MemoryFolder } };

/** `POST /api/memory/move` request. */
export interface MoveMemoryRequest {
  readonly itemId: string;
  readonly folder: MemoryFolder;
}

/** `POST /api/memory/expiry` request; `null` clears the expiry. */
export interface SetMemoryExpiryRequest {
  readonly itemId: string;
  readonly expiresOn: IsoDate | null;
}

/** `POST /api/memory/delete` request. */
export interface DeleteMemoryRequest {
  readonly itemId: string;
}

/** `POST /api/memory/review` request; `expiresOn` applies to renewing an expired item. */
export interface ReviewMemoryRequest {
  readonly itemId: string;
  readonly action: "renew" | "keep";
  readonly expiresOn?: IsoDate;
}

/** `POST /api/memory/sort-feedback` request: is the item in the right folder, and why. `belongsIn` only with "wrong". */
export interface SortFeedbackRequest {
  readonly itemId: string;
  readonly verdict: "right" | "wrong";
  readonly reason: string;
  readonly belongsIn?: MemoryFolder;
}

/** `POST /api/memory/{move,expiry,delete,review,sort-feedback}` value (`itemId` is the new version's id where one exists). */
export interface MemoryWriteResponse {
  readonly itemId?: string;
}

/** `POST /api/settings/revert` request. */
export interface RevertSettingRequest {
  readonly key: RuleSettingKey;
  readonly area?: string;
}

/** `POST /api/settings/revert` value, e.g. "Reverted to 3:15 PM.". */
export interface RevertSettingResponse {
  readonly message: string;
}

/** `POST /api/rating` request (Story 13.11): exactly one of `score` or `dismissed`; `note` only with score 1. */
export interface RatingRequest {
  readonly promptId: string;
  readonly score?: 1 | 2 | 3;
  readonly dismissed?: true;
  readonly note?: string;
}

/** `POST /api/rating` value: a receipt when a note was filed to Feedback (empty `items` = filing failed). */
export interface RatingResponse {
  readonly receipt?: RememberedReceipt;
}

/** `POST /api/memory/undo` request. */
export interface UndoMemoryRequest {
  readonly receiptId: string;
}

/** `POST /api/memory/undo` value. */
export interface UndoMemoryResponse {
  readonly receiptId: string;
  readonly message: string;
}

/**
 * One event a streaming `chatTurn` caller (a future server, Task 6) may
 * receive over `deps.emit`. `chatTurn` itself only ever emits `"status"` and
 * `"delta"` — never `"done"`/`"error"` (Controller ruling): the caller that
 * owns the stream's single terminal event builds it from `chatTurn`'s
 * returned `Result` after the last delta, not from an event `chatTurn` itself
 * constructs.
 */
export type ChatStreamEvent =
  | { readonly type: "status"; readonly text: string }
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done"; readonly response: ChatTurnResponse }
  | { readonly type: "error"; readonly error: YohError }
  | { readonly type: "remembered"; readonly receipt: RememberedReceipt }
  | { readonly type: "proposal"; readonly question: OpenItemQuestion }
  | { readonly type: "rating"; readonly promptId: string };

/** The receipt Yoh shows after it remembers or forgets something (Epic 13). */
export interface RememberedReceipt {
  readonly receiptId: string;
  readonly kind: "remembered" | "forgot";
  readonly items: readonly {
    readonly id: string;
    readonly text: string;
    readonly folder: MemoryFolder;
    readonly scope?: string;
    readonly expiresOn?: IsoDate;
  }[];
}

/** One stored chat turn as `GET /api/chat-history/today` returns it. */
export interface ChatHistoryTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  truncated: boolean;
  createdAt: IsoDateTime;
}

/** `GET /api/chat-history/today`'s value. */
export interface ChatHistoryTodayResponse {
  readonly conversationId?: string;
  readonly date: IsoDate;
  readonly turns: readonly ChatHistoryTurn[];
}

// ---- Memory page (Story 13.9) ----------------------------------------------

export interface ChatConversationSummary {
  readonly id: string;
  readonly date: IsoDate;
  readonly turnCount: number;
  readonly firstLine: string;
}
/** `GET /api/chat-history`'s value, newest first. */
export interface ChatHistoryListResponse {
  readonly conversations: readonly ChatConversationSummary[];
}
/** `GET /api/chat-history/:conversationId`'s value (read-only transcript). */
export interface ChatConversationView {
  readonly id: string;
  readonly date: IsoDate;
  readonly turns: readonly (ChatHistoryTurn & { readonly receipt?: RememberedReceipt })[];
}

export interface MemoryItemView {
  readonly id: string;
  readonly folder: MemoryFolder;
  readonly text: string;
  readonly origin: "stated" | "inferred";
  /** "history" items ("Keep as history") are listed but never loaded. */
  readonly status: "current" | "history";
  readonly scope?: string;
  readonly expiresOn?: IsoDate;
  /** `ruleChange === "declined"`. */
  readonly declined: boolean;
  /** `ruleChange === "pending"`. */
  readonly pendingChange: boolean;
  readonly createdAt: IsoDateTime;
  readonly confirmedAt: IsoDateTime;
  /** `confirmedAt`'s calendar day in the host time zone (what the page shows). */
  readonly confirmedOn: IsoDate;
  readonly loaded: boolean;
  /** The "Not loaded" badge shows iff this is set. */
  readonly notLoadedReason?: string;
  /** Absent when the item has no source turn; "deleted" when the turn is gone. */
  readonly source?: { readonly conversationId: string; readonly turnId: string; readonly date: IsoDate } | "deleted";
  readonly earlierVersions: readonly { readonly id: string; readonly text: string; readonly confirmedAt: IsoDateTime; readonly confirmedOn: IsoDate }[];
  /** Spencer's verdict on this item's current folder; absent once the item has moved since. */
  readonly sortFeedback?: { readonly verdict: "right" | "wrong"; readonly reason: string; readonly belongsIn?: MemoryFolder };
}

/** `count` is the number of current items; all eight folders, PRD order. */
export interface MemoryFolderView {
  readonly folder: MemoryFolder;
  readonly label: string;
  readonly loadClass: MemoryLoadClass;
  readonly count: number;
  readonly items: readonly MemoryItemView[];
}

export interface NeedsReviewItemView extends MemoryItemView {
  readonly reason: string;
  /** True iff the reason is expired or unused. */
  readonly canRenew: boolean;
}

export interface ChangedSettingView {
  readonly key: RuleSettingKey;
  readonly area?: string;
  readonly label: string;
  readonly value: string;
  /** The built-in default, formatted. */
  readonly was: string;
  readonly changedAt: IsoDateTime;
  /** `changedAt`'s calendar day in the host time zone. */
  readonly changedOn: IsoDate;
}

/** `GET /api/memory`'s value: everything the Memory Rail shows. */
export interface MemoryViewResponse {
  readonly folders: readonly MemoryFolderView[];
  readonly needsReview: readonly NeedsReviewItemView[];
  readonly changedSettings: readonly ChangedSettingView[];
  readonly pendingPatterns: readonly OpenItemQuestion[];
}

/** `GET /api/memory/search?q=`'s value. */
export interface MemorySearchResponse {
  readonly query: string;
  readonly items: readonly MemoryItemView[];
  readonly turns: readonly {
    readonly turnId: string;
    readonly conversationId: string;
    readonly date: IsoDate;
    readonly role: "user" | "assistant";
    readonly snippet: string;
  }[];
}

// ============================================================================
// Tasks page (Task 6B, FR-43) — new shapes only.
// ============================================================================

/** How the Tasks list is grouped: by Due bucket (default), Area, Status, or Priority (Task 7). */
export type TasksGroupBy = "due" | "area" | "status" | "priority";

/** `GET /api/tasks`'s query: `groupBy` defaults to `"due"`; `query` filters by title or Area (case-insensitive). */
export interface TasksListRequest {
  readonly groupBy?: TasksGroupBy;
  readonly query?: string;
}

/** One Task row on the Tasks page. `missing` lists the planning fields Notion has no value for (the row's "Add …" badges). */
export interface TaskListItem {
  readonly id: string;
  readonly title: string;
  readonly dueDate?: IsoDate;
  readonly estimatedDurationMinutes?: number;
  readonly area?: string;
  readonly energy?: Energy;
  readonly status?: TaskStatus;
  /** Task 7: the live Priority select value verbatim (e.g. "🔴 High") — never part of `missing` (Priority is not a Data-Completeness Gate field). */
  readonly priority?: string;
  readonly missing: readonly PlanningFieldNames[];
  /** Due before today (host TZ) and not completed — server-computed, so the client never reads its own clock. */
  readonly overdue: boolean;
}

/** One group of rows. `tone` is presentation only: `"danger"` for Overdue, `"accent"` for Today, `"neutral"` otherwise. */
export interface TaskGroup {
  readonly key: string;
  readonly label: string;
  readonly tone: "danger" | "accent" | "neutral";
  readonly tasks: readonly TaskListItem[];
}

/** `GET /api/tasks`'s value. Empty groups are omitted. */
export interface TasksViewResponse {
  /** The host-timezone date this list's buckets were computed for (never the browser's date). */
  readonly today: IsoDate;
  readonly groupBy: TasksGroupBy;
  readonly query: string;
  /** Every Task in Notion, before `query` filtering. */
  readonly total: number;
  readonly groups: readonly TaskGroup[];
  /** Live Notion options for the inline selects. */
  readonly options: TaskFieldOptions;
}

/** `POST /api/tasks`'s body: the quick-add line exactly as typed. The server parses it (`core/quick-add.ts`). */
export interface CreateTaskRequest {
  readonly text: string;
}

/** `POST /api/tasks`'s value: the created Task (a direct write, AD-12 amended 2026-09-27) and its one-line receipt. */
export interface CreateTaskResponse {
  readonly task: TaskListItem;
  readonly receipt: string;
}

/** `POST /api/tasks/parse`'s body: the quick-add line so far, plus the live Area options the page already holds (so a `#tag` preview needs no Notion call). */
export interface QuickAddPreviewRequest {
  readonly text: string;
  readonly areaOptions?: readonly string[];
  /** Task 7: the live Priority options the page already holds, so "p1"/"high priority" preview without a Notion call. */
  readonly priorityOptions?: readonly string[];
}

/** `POST /api/tasks/parse`'s value: what the quick-add line would create, shown as chips before Enter. */
export interface QuickAddPreviewResponse {
  readonly title: string;
  readonly dueDate?: IsoDate;
  readonly estimatedDurationMinutes?: number;
  readonly energy?: Energy;
  readonly area?: string;
  /** Polish 4 Task 1: only ever `"not-started"`/`"in-progress"` — the deterministic parser never reads "done"/"completed" off a quick-add line (quick-add must never set Completed). */
  readonly status?: TaskStatus;
  /** Task 7: the live Priority option matched, verbatim (e.g. "🔴 High"). */
  readonly priority?: string;
  /** `#tag` bodies that matched no live Area option — they stay in the title. */
  readonly unmatchedAreas: readonly string[];
}

/** `POST /api/tasks/:id/field`'s body. `value` is raw text, parsed by `core/planning-field-value.ts` server-side. */
export interface UpdateTaskFieldRequest {
  readonly field: EditableTaskField;
  readonly value: string;
}

/** `POST /api/tasks/:id/field`'s value. */
export interface UpdateTaskFieldResponse {
  readonly receipt: string;
}

/** `POST /api/tasks/:id/title`'s body (Task 6B fix round, AD-12 amended 2026-09-27): the new title, trimmed server-side. */
export interface RenameTaskRequest {
  readonly title: string;
}

/** `POST /api/tasks/:id/title`'s value. */
export interface RenameTaskResponse {
  readonly receipt: string;
}

// ============================================================================
// Research Hub (Task 6C, FR-43) — new shapes only.
// ============================================================================

/** One row on the Research Hub page's list — read-only, links straight to its own Notion page. */
export interface ResearchListItem {
  readonly id: string;
  readonly title: string;
  /** Absent when the Research Vault row has no Date set. */
  readonly date?: IsoDate;
  readonly sourceCount: number;
  readonly url: string;
}

/** `GET /api/research`'s value: the most recent Research Vault items, newest first, server-limited (AD-17). */
export interface ResearchListResponse {
  readonly items: readonly ResearchListItem[];
}

// ============================================================================
// Server route type (Ruling R2, AD-17)
// ============================================================================

// ============================================================================
// Command Palette / /morning / /night (Story 8.7) — new shapes only.
// ============================================================================

/** One entry in the server-provided command registry (`src/app/commands.ts`'s `COMMANDS`) — the Web Command Palette (`GET /api/commands`) and `chatTurn`'s slash-dispatch both read from it (UX-DR38, FR-42). */
export interface CommandDescriptor {
  readonly name: string;
  readonly description: string;
  readonly example: string;
}

/** `GET /api/commands`'s value. */
export interface CommandList {
  readonly commands: readonly CommandDescriptor[];
}

/** `/morning`'s read-only view (`app/morning-view.ts`'s `morningView`): today's already-stored Plan (never regenerated), split into its rendered block-list text and its reasoning line, plus every open item. `plan: undefined` means no Plan has been generated yet today. */
export interface MorningViewResponse {
  readonly today: string;
  readonly plan: { readonly text: string; readonly reasoning: string } | undefined;
  readonly openItems: readonly OpenItem[];
  /** Story 13.13: today's one pending Pattern question, when `offerPattern` returned one. */
  readonly patternQuestion?: OpenItemQuestion;
}

/** `GET /api/memory/pattern-offer`'s value: at most one pending Pattern question per day (Story 13.13). */
export interface PatternOfferResponse {
  readonly question?: OpenItemQuestion;
}

// ============================================================================
// /sandbox card flow (Story 9.2) — new shapes only.
// ============================================================================

/**
 * Task 5 (polish-5): the Sandbox Card's live Area/Energy option lists — read
 * from the same `readTaskFieldOptions` source `GET /api/tasks` uses. An
 * empty array means "no live options were read" (the read failed, isn't
 * configured, or — for `area` only — Area is a free-text property on this
 * workspace); the card then falls back to today's free-text input for that
 * field, same as `TaskRow.tsx`'s own live-options-vs-free-text convention.
 */
export interface SandboxCardOptions {
  readonly area: readonly string[];
  readonly energy: readonly TaskFieldOption<Energy>[];
}

/** One Sandbox Card as the client renders it — the queue's first item, plus how many remain AFTER it. */
export interface SandboxCardView {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly dueDate?: IsoDate;
  readonly estimatedDurationMinutes?: number;
  readonly area?: string;
  readonly energy?: Energy;
  readonly remaining: number;
  /** Task 5 (polish-5): always present, even when both lists are empty — the card decides text-vs-select from the lists' own length, never from this field's presence. */
  readonly options: SandboxCardOptions;
}

export interface SandboxStartRequest {
  readonly exclude?: readonly string[];
}

/** `card: undefined` means the queue is empty. */
export interface SandboxStartResponse {
  readonly card: SandboxCardView | undefined;
}

export interface SandboxSaveRequest {
  readonly dueDate: string;
  readonly estimatedDurationMinutes: string;
  readonly area?: string;
  readonly energy?: string;
  /** This session's already-handled taskIds, NOT including this card. */
  readonly exclude: readonly string[];
}

export interface SandboxSaveResponse {
  readonly receipt: string;
  readonly next: SandboxCardView | undefined;
}

export interface SandboxSkipRequest {
  readonly exclude: readonly string[];
}

export interface SandboxSkipResponse {
  readonly next: SandboxCardView | undefined;
}

// Task 3 (Story 9.3): the Finale's one route shape.
export interface SandboxOutcome {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly ok: boolean;
}
export interface SandboxFinishRequest {
  readonly outcomes: readonly SandboxOutcome[];
}
export interface SandboxFinishResponse {
  readonly savedCount: number;
  readonly failedTitles: readonly string[];
}

/** Story 9.4 (E9, UX-DR42): `GET /api/sandbox/count`'s response — the ONE computed source shared by the Needs-Data Indicator and the needs-data notification's count (AD-11). */
export interface NeedsDataCountResponse {
  readonly count: number;
}

/**
 * The server's Hono route type, re-exported TYPE-ONLY so `web/`'s typed
 * Hono RPC client (Story 7.5) is compiler-checked end to end while `web/`
 * imports only `import type` from `types/`. This is the one permitted
 * `types/` → `shell/` edge; `tests/layering-rules.test.ts` rejects any
 * other. It is erased at runtime (`verbatimModuleSyntax`).
 */
export type { AppType } from "../shell/server.ts";

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
import type { ChatTurn, EditableTaskField, Energy, IsoDate, PlanningFieldNames, Proposal, Result, TaskFieldOptions, TaskStatus, YohError } from "./domain.ts";

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
}

/**
 * One block of Home's Calendar Day View. `"work"`/`"break"` are Yoh-owned
 * (from the stored Plan); `"fixed"` is a live-read primary-calendar event
 * Yoh did not create (never a stored Plan's own `"calendar-anchor"`
 * snapshot — see `app/home-view.ts`'s doc comment for why).
 */
export interface HomeCalendarBlock {
  readonly id: string;
  readonly kind: "work" | "break" | "fixed";
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly completed: boolean;
  readonly past: boolean;
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
  readonly history: readonly ChatTurn[];
}

/** `chatTurn`'s value: one reply, ready for any surface to render. */
export interface ChatTurnResponse {
  /** Yoh's full reply text — markdown allowed, never ANSI. May be `""`. */
  readonly reply: string;
  readonly receipts: readonly string[];
  /** A follow-up Structured Question (e.g. a new proposal to confirm) — unused before Task 5/8. */
  readonly question?: OpenItemQuestion;
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
  | { readonly type: "error"; readonly error: YohError };

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

/** `GET /api/tasks/missing-count`'s value (real-use fixes plan, Task 2): the Chat header chip's count — open (not Completed) Tasks with at least one missing planning field, the SAME rule `TaskListItem.missing` uses. */
export interface TasksMissingCountResponse {
  readonly count: number;
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
}

/**
 * The server's Hono route type, re-exported TYPE-ONLY so `web/`'s typed
 * Hono RPC client (Story 7.5) is compiler-checked end to end while `web/`
 * imports only `import type` from `types/`. This is the one permitted
 * `types/` → `shell/` edge; `tests/layering-rules.test.ts` rejects any
 * other. It is erased at runtime (`verbatimModuleSyntax`).
 */
export type { AppType } from "../shell/server.ts";

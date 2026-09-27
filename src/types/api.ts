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
import type { Proposal, Result, YohError } from "./domain.ts";

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

export interface HomeViewResponse {
  /** The host-timezone date this response is "today" for (Consistency Conventions: never the browser's date) — also what the client's Feb-19 confetti check reads, never `new Date()`. */
  readonly today: string;
  /** `undefined` when no Plan has been generated yet today. */
  readonly plan: { readonly rows: readonly HomePlanRow[] } | undefined;
  readonly calendar: { readonly blocks: readonly HomeCalendarBlock[] };
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
// Server route type (Ruling R2, AD-17)
// ============================================================================

/**
 * The server's Hono route type, re-exported TYPE-ONLY so `web/`'s typed
 * Hono RPC client (Story 7.5) is compiler-checked end to end while `web/`
 * imports only `import type` from `types/`. This is the one permitted
 * `types/` → `shell/` edge; `tests/layering-rules.test.ts` rejects any
 * other. It is erased at runtime (`verbatimModuleSyntax`).
 */
export type { AppType } from "../shell/server.ts";

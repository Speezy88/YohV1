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
import type { Result, YohError } from "./domain.ts";

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

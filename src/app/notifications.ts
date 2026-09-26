/**
 * src/app/notifications.ts
 *
 * Story 7.3 (AD-16, AD-18, FR-49): reading and acknowledging in-app
 * notifications. The first real `app/` use-case file; both exports are
 * `(deps, input) => Promise<Result<Output, YohError>>`, checked by
 * `tests/layering-rules.test.ts`. `shell/server.ts` only parses the request,
 * calls one of these, and renders the `Result`.
 *
 * `notification-store.ts` may throw on I/O failure (AD-8); this layer turns
 * that into an `unreachable` `Result` so a shell never sees a throw.
 */
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { listUnreadNotifications, markNotificationRead as storeMarkRead } from "../adapters/notification-store.ts";
import type { MarkNotificationReadRequest, MarkNotificationReadResponse, NotificationList } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface NotificationsDeps {
  readonly connection: SqliteConnection;
  /** Wall clock for `readAt`. */
  readonly now: () => Date;
}

function unreachable(what: string, err: unknown): { ok: false; error: YohError } {
  return {
    ok: false,
    error: {
      kind: "unreachable",
      message: `notifications: ${what}: ${err instanceof Error ? err.message : String(err)}`,
      detail: err,
    },
  };
}

/** Every unread notification, oldest first. */
export async function listNotifications(
  deps: NotificationsDeps,
  _input: Record<string, never>,
): Promise<Result<NotificationList, YohError>> {
  try {
    return { ok: true, value: { notifications: listUnreadNotifications(deps.connection) } };
  } catch (err) {
    return unreachable("could not read notifications", err);
  }
}

/** Sets `readAt` (idempotent). An unknown id is a `validation` error. */
export async function markNotificationRead(
  deps: NotificationsDeps,
  input: MarkNotificationReadRequest,
): Promise<Result<MarkNotificationReadResponse, YohError>> {
  try {
    const outcome = storeMarkRead(deps.connection, input.id, deps.now().toISOString());
    if (outcome.status === "not-found") {
      return { ok: false, error: { kind: "validation", message: `notifications: no notification with id ${input.id}` } };
    }
    return { ok: true, value: { id: input.id, readAt: outcome.readAt } };
  } catch (err) {
    return unreachable(`could not mark ${input.id} read`, err);
  }
}

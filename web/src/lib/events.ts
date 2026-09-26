/**
 * web/src/lib/events.ts
 *
 * Story 7.7, AD-18: the one `GET /api/events` client. The browser's native
 * `EventSource` already resends `Last-Event-ID` on ITS OWN transient
 * reconnect (same object, connection drops and comes back) — nothing to do
 * for that case. This file handles the case AD-18 doesn't cover for free: a
 * connection that never recovers. After `UNREACHABLE_AFTER_MS` with no
 * open/message, it gives up on that `EventSource`, tells the caller
 * (`onUnreachable`, `notifications.ts` raises the local notification), and
 * later opens a FRESH `EventSource` — which has no memory of
 * `Last-Event-ID` (there is no way to set a custom header on it) — so this
 * file appends the last `seq` it saw as `?lastEventId=` instead, and
 * `shell/server.ts`'s route reads that as a fallback to the header.
 */
export interface EventHint {
  readonly seq: number;
  readonly topic: string;
  readonly entityId: string;
}

export interface EventStreamHandlers {
  onHint(hint: EventHint): void;
  onUnreachable(): void;
  onReachable(): void;
}

export const UNREACHABLE_AFTER_MS = 15_000;
export const RECONNECT_BACKOFF_MS = 5_000;

/**
 * Starts the one `EventSource` connection and keeps it (or its
 * successors) alive for the life of the caller. Returns a `stop` function
 * that closes the current connection and cancels any pending timer —
 * called once, on unmount.
 */
export function connectEventStream(handlers: EventStreamHandlers): () => void {
  let lastSeq = 0;
  let source: EventSource | undefined;
  let unreachableTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function armUnreachableTimer(): void {
    clearTimeout(unreachableTimer);
    unreachableTimer = setTimeout(() => {
      handlers.onUnreachable();
      source?.close();
      reconnectTimer = setTimeout(open, RECONNECT_BACKOFF_MS);
    }, UNREACHABLE_AFTER_MS);
  }

  function open(): void {
    if (stopped) return;
    const url = lastSeq > 0 ? `/api/events?lastEventId=${lastSeq}` : "/api/events";
    source = new EventSource(url);
    armUnreachableTimer();

    source.onopen = () => {
      armUnreachableTimer();
      handlers.onReachable();
    };
    source.onmessage = (event: MessageEvent<string>) => {
      armUnreachableTimer();
      const hint = JSON.parse(event.data) as EventHint;
      lastSeq = hint.seq;
      handlers.onHint(hint);
    };
    source.onerror = () => {
      // The browser retries this SAME object on its own (sending its own
      // Last-Event-ID automatically) unless armUnreachableTimer's deadline
      // passes first — no action needed here beyond letting that timer run.
    };
  }

  open();

  return () => {
    stopped = true;
    clearTimeout(unreachableTimer);
    clearTimeout(reconnectTimer);
    source?.close();
  };
}

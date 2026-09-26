/**
 * web/src/lib/notifications.ts
 *
 * Story 7.7: the notification list `NotificationOverlay` renders — a
 * `useSyncExternalStore` store (same convention as `readiness.ts`, Story
 * 7.6). Story 7.8 refactored this to subscribe to `eventBus.ts`'s shared
 * `onHint`/`onUnreachable` instead of calling `events.ts`'s
 * `connectEventStream` directly — Home is now the SSE stream's second real
 * consumer, and AD-18 allows only one `EventSource` per client. A
 * `topic: "notification"` hint re-fetches `GET /api/notifications`; every
 * other topic is ignored here (Story 7.8's Home listens for `topic: "plan"`
 * on its own). Also accepts one purely client-side synthetic record for
 * "host unreachable" —
 * never sent to or read from the server, marked `kind: "operational"` (a
 * real closed-union member, AD-18) with `deepLink: null` (the LOCKED wire
 * type's required-but-nullable field, never an absent key).
 *
 * The store never caps itself at "3 visible" — every unread record (real
 * or synthetic) stays until explicitly dismissed. Capping to the newest
 * three is `NotificationOverlay`'s render-time concern, so a failure
 * notification bumped out of the visible window by newer arrivals is only
 * temporarily out of view, never silently discarded ("a failure is never
 * auto-dismissed unseen").
 */
import { useSyncExternalStore } from "react";
import { onHint, onUnreachable } from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import type { NotificationRecord } from "../../../src/types/api.ts";

let records: NotificationRecord[] = [];
/** Ids of local synthetic records (never sent to or read from the server). */
const localIds = new Set<string>();
/**
 * Ids optimistically marked read/dismissed this session. `upsertMany`
 * excludes them even if a stale in-flight `GET /api/notifications` (started
 * before the dismiss, resolving after it) still lists one — otherwise that
 * race would resurrect a record the user already dismissed. Cleared only if
 * the mark-read write turns out to have failed (the revert path below).
 */
const dismissedIds = new Set<string>();
/** Dedupes the synthetic "unreachable" record so a prolonged outage doesn't stack a fresh one on every ~15s retry. */
let unreachablePending = false;
let localIdCounter = 0;

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

function sortRecords(list: readonly NotificationRecord[]): NotificationRecord[] {
  return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function snapshot(): readonly NotificationRecord[] {
  return records;
}

function upsertMany(fresh: readonly NotificationRecord[]): void {
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const r of fresh) {
    if (dismissedIds.has(r.id)) continue;
    byId.set(r.id, r);
  }
  records = sortRecords([...byId.values()]);
  notify();
}

async function refetch(): Promise<void> {
  try {
    const res = await apiClient.api.notifications.$get();
    const result = await res.json();
    if (result.ok) upsertMany(result.value.notifications);
    else console.error(`notifications: refetch failed: ${result.error.message}`);
  } catch (err) {
    // A failed refetch here is not itself "the host is unreachable" (that
    // signal comes from events.ts's own dedicated timeout) — just logged so
    // it's visible in devtools rather than silently swallowed.
    console.error("notifications: refetch request failed", err);
  }
}

function addLocalUnreachable(): void {
  if (unreachablePending) return;
  unreachablePending = true;
  const id = `local-unreachable-${Date.now()}-${localIdCounter++}`;
  localIds.add(id);
  const record: NotificationRecord = {
    id,
    kind: "operational",
    title: "Yoh server unreachable",
    body: "The connection to Yoh dropped and couldn't reconnect. Retrying in the background.",
    deepLink: null,
    createdAt: new Date().toISOString(),
  };
  records = sortRecords([record, ...records]);
  notify();
}

export function useNotifications(): readonly NotificationRecord[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    snapshot,
  );
}

/**
 * Marks a server-backed record read via the API, or just removes a local
 * synthetic one — either way it leaves the visible stack immediately
 * (the visible acknowledgment, UX-DR48). A server-backed dismiss that fails
 * (rejected request, or an `{ok: false}` envelope) puts the record back so
 * the failure is visible too, rather than silently succeeding on the
 * client while the server never marked it read.
 */
export function dismissNotification(id: string): void {
  const record = records.find((r) => r.id === id);
  if (!record) return;

  records = records.filter((r) => r.id !== id);
  if (localIds.has(id)) {
    localIds.delete(id);
    unreachablePending = false;
    notify();
    return;
  }

  dismissedIds.add(id);
  notify();

  void apiClient.api.notifications[":id"].read
    .$post({ param: { id } })
    .then((res) => res.json())
    .then((result) => {
      if (!result.ok) {
        console.error(`notifications: mark-read failed for ${id}: ${result.error.message}`);
        revert(record);
      }
    })
    .catch((err) => {
      console.error(`notifications: mark-read request failed for ${id}`, err);
      revert(record);
    });
}

function revert(record: NotificationRecord): void {
  dismissedIds.delete(record.id);
  records = sortRecords([record, ...records]);
  notify();
}

/**
 * Starts this store's subscription to the shared event bus (`eventBus.ts`,
 * Story 7.8). Call once, near the app root (`PageShell`); returns a stop
 * function.
 */
export function startNotificationStream(): () => void {
  void refetch(); // pick up anything already unread on first load
  const offHint = onHint((hint) => {
    if (hint.topic === "notification") void refetch();
  });
  // A reconnect never dismisses the synthetic "unreachable" card on its own
  // — it stays until Spencer clicks or closes it (AC: "a failure is never
  // auto-dismissed unseen"), so this store never subscribes to onReachable.
  const offUnreachable = onUnreachable(addLocalUnreachable);
  return () => {
    offHint();
    offUnreachable();
  };
}

/** Test-only: clears all module-level singleton state between tests. Never called from production code. */
export function __resetNotificationsForTests(): void {
  records = [];
  localIds.clear();
  dismissedIds.clear();
  unreachablePending = false;
  localIdCounter = 0;
}

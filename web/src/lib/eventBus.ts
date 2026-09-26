/**
 * web/src/lib/eventBus.ts
 *
 * Story 7.8, AD-18: ONE `connectEventStream` connection ("one SSE stream
 * per client"), multiplexed to as many topic-filtered subscribers as the
 * app needs. Story 7.7's `notifications.ts` was the first, direct caller of
 * `connectEventStream` — refactored to subscribe to this bus instead, now
 * that Home (this story) is the second real consumer and a second direct
 * `EventSource` would violate AD-18.
 */
import { connectEventStream, type EventHint } from "./events.ts";

export type EventBusHint = EventHint;
type HintListener = (hint: EventBusHint) => void;
type StatusListener = () => void;

const hintListeners = new Set<HintListener>();
const unreachableListeners = new Set<StatusListener>();
const reachableListeners = new Set<StatusListener>();
let activeConnections = 0;
let stopUnderlying: (() => void) | undefined;

/**
 * Idempotent — the underlying `EventSource` opens once no matter how many
 * callers start the bus (`PageShell` starts it once for the app's
 * lifetime); it closes only once every caller has stopped.
 */
export function startEventBus(): () => void {
  activeConnections++;
  if (!stopUnderlying) {
    stopUnderlying = connectEventStream({
      onHint: (hint) => hintListeners.forEach((l) => l(hint)),
      onUnreachable: () => unreachableListeners.forEach((l) => l()),
      onReachable: () => reachableListeners.forEach((l) => l()),
    });
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    activeConnections--;
    if (activeConnections <= 0) {
      stopUnderlying?.();
      stopUnderlying = undefined;
    }
  };
}

export function onHint(listener: HintListener): () => void {
  hintListeners.add(listener);
  return () => hintListeners.delete(listener);
}
export function onUnreachable(listener: StatusListener): () => void {
  unreachableListeners.add(listener);
  return () => unreachableListeners.delete(listener);
}
export function onReachable(listener: StatusListener): () => void {
  reachableListeners.add(listener);
  return () => reachableListeners.delete(listener);
}

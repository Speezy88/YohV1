/**
 * web/src/lib/eventBus.test.ts
 *
 * Story 7.8, AD-18: proves the bus opens exactly one `connectEventStream`
 * connection no matter how many subscribers start it, and broadcasts hints
 * and reachability changes to every registered listener.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as eventsModule from "./events.ts";
import { onHint, onReachable, onUnreachable, startEventBus } from "./eventBus.ts";

describe("eventBus", () => {
  let handlers: eventsModule.EventStreamHandlers;

  beforeEach(() => {
    vi.spyOn(eventsModule, "connectEventStream").mockImplementation((h) => {
      handlers = h;
      return vi.fn();
    });
  });

  it("opens exactly one connectEventStream call even with multiple subscribers", () => {
    const stop1 = startEventBus();
    const stop2 = startEventBus();
    expect(eventsModule.connectEventStream).toHaveBeenCalledTimes(1);
    stop1();
    stop2();
  });

  it("closes the underlying connection only once every caller has stopped", () => {
    const underlyingStop = vi.fn();
    (eventsModule.connectEventStream as ReturnType<typeof vi.fn>).mockImplementation((h: eventsModule.EventStreamHandlers) => {
      handlers = h;
      return underlyingStop;
    });
    const stop1 = startEventBus();
    const stop2 = startEventBus();
    stop1();
    expect(underlyingStop).not.toHaveBeenCalled();
    stop2();
    expect(underlyingStop).toHaveBeenCalledTimes(1);
  });

  it("a stopped-then-restarted bus opens a fresh underlying connection", () => {
    const stop1 = startEventBus();
    stop1();
    startEventBus();
    expect(eventsModule.connectEventStream).toHaveBeenCalledTimes(2);
  });

  it("broadcasts a hint to every registered onHint listener", () => {
    const stop = startEventBus();
    const a = vi.fn();
    const b = vi.fn();
    const offA = onHint(a);
    const offB = onHint(b);
    handlers.onHint({ seq: 1, topic: "plan", entityId: "x" });
    expect(a).toHaveBeenCalledWith({ seq: 1, topic: "plan", entityId: "x" });
    expect(b).toHaveBeenCalledWith({ seq: 1, topic: "plan", entityId: "x" });
    offA();
    offB();
    stop();
  });

  it("onHint's unsubscribe stops that one listener without affecting others", () => {
    const stop = startEventBus();
    const a = vi.fn();
    const b = vi.fn();
    const offA = onHint(a);
    const offB = onHint(b);
    offA();
    handlers.onHint({ seq: 1, topic: "plan", entityId: "x" });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    offB();
    stop();
  });

  it("onUnreachable/onReachable listeners fire from the one underlying connection", () => {
    const stop = startEventBus();
    const unreachable = vi.fn();
    const reachable = vi.fn();
    const offUnreachable = onUnreachable(unreachable);
    const offReachable = onReachable(reachable);
    handlers.onUnreachable();
    handlers.onReachable();
    expect(unreachable).toHaveBeenCalledTimes(1);
    expect(reachable).toHaveBeenCalledTimes(1);
    offUnreachable();
    offReachable();
    stop();
  });
});

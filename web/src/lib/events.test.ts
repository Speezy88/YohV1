/**
 * web/src/lib/events.test.ts
 *
 * Story 7.7: `connectEventStream` — the one `EventSource` wrapper for
 * `GET /api/events` (AD-18). jsdom has no real SSE transport, so a minimal
 * fake `EventSource` drives the handlers directly. Fake timers throughout —
 * no real multi-second wait.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectEventStream, RECONNECT_BACKOFF_MS, UNREACHABLE_AFTER_MS } from "./events.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  emitOpen(): void {
    this.onopen?.();
  }
  emitError(): void {
    this.onerror?.();
  }
  emitMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("connectEventStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens /api/events with no lastEventId on first connect", () => {
    connectEventStream({ onHint: () => {}, onUnreachable: () => {}, onReachable: () => {} });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events");
  });

  it("calls onReachable on open and onHint with the parsed hint on message", () => {
    const onHint = vi.fn();
    const onReachable = vi.fn();
    connectEventStream({ onHint, onUnreachable: () => {}, onReachable });
    const es = FakeEventSource.instances[0]!;

    es.emitOpen();
    expect(onReachable).toHaveBeenCalledTimes(1);

    es.emitMessage({ seq: 5, topic: "plan", entityId: "2026-09-25" });
    expect(onHint).toHaveBeenCalledExactlyOnceWith({ seq: 5, topic: "plan", entityId: "2026-09-25" });
  });

  it("after UNREACHABLE_AFTER_MS with no open/message, calls onUnreachable, closes the dead source, and reopens with the last seen seq", () => {
    const onUnreachable = vi.fn();
    connectEventStream({ onHint: () => {}, onUnreachable, onReachable: () => {} });
    const first = FakeEventSource.instances[0]!;
    first.emitMessage({ seq: 7, topic: "plan", entityId: "x" });

    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS);
    expect(onUnreachable).toHaveBeenCalledTimes(1);
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1); // not yet reopened — waits out the backoff first

    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toBe("/api/events?lastEventId=7");
  });

  it("an open but quiet connection is healthy — minutes with no message never fire onUnreachable", () => {
    const onUnreachable = vi.fn();
    connectEventStream({ onHint: () => {}, onUnreachable, onReachable: () => {} });
    FakeEventSource.instances[0]!.emitOpen();
    vi.advanceTimersByTime(10 * 60_000);
    expect(onUnreachable).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("an error on an open connection that doesn't reopen within UNREACHABLE_AFTER_MS fires onUnreachable once", () => {
    const onUnreachable = vi.fn();
    connectEventStream({ onHint: () => {}, onUnreachable, onReachable: () => {} });
    const es = FakeEventSource.instances[0]!;
    es.emitOpen();
    es.emitError();
    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS / 2);
    es.emitError(); // the browser's own retry failing again must not push the deadline back
    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS / 2);
    expect(onUnreachable).toHaveBeenCalledTimes(1);
    expect(es.closed).toBe(true);
  });

  it("an error followed by the browser's own reconnect within the deadline never fires onUnreachable", () => {
    const onUnreachable = vi.fn();
    connectEventStream({ onHint: () => {}, onUnreachable, onReachable: () => {} });
    const es = FakeEventSource.instances[0]!;
    es.emitOpen();
    es.emitError();
    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS - 1_000);
    es.emitOpen();
    vi.advanceTimersByTime(10 * 60_000);
    expect(onUnreachable).not.toHaveBeenCalled();
  });

  it("onopen also resets the unreachable timer (the browser's own reconnect, no message yet)", () => {
    const onUnreachable = vi.fn();
    connectEventStream({ onHint: () => {}, onUnreachable, onReachable: () => {} });
    const es = FakeEventSource.instances[0]!;
    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS - 1_000);
    es.emitOpen();
    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS - 1_000);
    expect(onUnreachable).not.toHaveBeenCalled();
  });

  it("a second hard-drop cycle reopens with the MOST RECENT seq, not the first cycle's", () => {
    connectEventStream({ onHint: () => {}, onUnreachable: () => {}, onReachable: () => {} });
    FakeEventSource.instances[0]!.emitMessage({ seq: 1, topic: "plan", entityId: "a" });
    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS + RECONNECT_BACKOFF_MS);
    FakeEventSource.instances[1]!.emitMessage({ seq: 2, topic: "plan", entityId: "b" });
    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS + RECONNECT_BACKOFF_MS);
    expect(FakeEventSource.instances).toHaveLength(3);
    expect(FakeEventSource.instances[2]!.url).toBe("/api/events?lastEventId=2");
  });

  it("the returned stop function closes the stream and cancels pending timers — never reconnects after stop()", () => {
    const onUnreachable = vi.fn();
    const stop = connectEventStream({ onHint: () => {}, onUnreachable, onReachable: () => {} });
    stop();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    vi.advanceTimersByTime(UNREACHABLE_AFTER_MS + RECONNECT_BACKOFF_MS + 60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(onUnreachable).not.toHaveBeenCalled();
  });
});

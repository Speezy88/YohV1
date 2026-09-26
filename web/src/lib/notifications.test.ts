/**
 * web/src/lib/notifications.test.ts
 *
 * Story 7.7: the `useSyncExternalStore` notification store — a
 * `topic: "notification"` hint re-fetches `GET /api/notifications`; every
 * other topic is ignored (Story 7.8's Home owns `topic: "plan"`). Also
 * covers the purely client-side synthetic "server unreachable" record.
 *
 * Story 7.8: this store now subscribes to `eventBus.ts`'s shared
 * `onHint`/`onUnreachable` rather than calling `events.ts`'s
 * `connectEventStream` directly (AD-18: one SSE stream per client, and Home
 * is now the second real consumer) — this file mocks `eventBus.ts`
 * accordingly, driving the store's handlers through the mocked
 * `onHint`/`onUnreachable` registration functions instead of a captured
 * `EventStreamHandlers` object.
 *
 * `deepLink` is a REQUIRED key with a nullable value on `NotificationRecord`
 * (`types/api.ts`, controller Ruling R11) — every fixture below sets it
 * explicitly (never omitted), and the synthetic unreachable record is
 * asserted `toBeNull()`, not `toBeUndefined()`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { __resetNotificationsForTests, dismissNotification, startNotificationStream, useNotifications } from "./notifications.ts";
import type { NotificationRecord } from "../../../src/types/api.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: {
    api: {
      notifications: {
        $get: vi.fn(),
        ":id": { read: { $post: vi.fn() } },
      },
    },
  },
}));

function record(overrides: Partial<NotificationRecord> & Pick<NotificationRecord, "id" | "createdAt">): NotificationRecord {
  return { kind: "operational", title: "t", body: "b", deepLink: null, ...overrides };
}

describe("notification store", () => {
  let hintCb: (hint: eventBus.EventBusHint) => void;
  let unreachableCb: () => void;
  let stop: () => void;

  const hintHandlers = {
    onHint: (hint: eventBus.EventBusHint) => hintCb(hint),
    onUnreachable: () => unreachableCb(),
  };

  beforeEach(() => {
    __resetNotificationsForTests();
    vi.spyOn(eventBus, "onHint").mockImplementation((cb) => {
      hintCb = cb;
      return () => {};
    });
    vi.spyOn(eventBus, "onUnreachable").mockImplementation((cb) => {
      unreachableCb = cb;
      return () => {};
    });
    (apiClient.api.notifications.$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { notifications: [] } }),
    });
    (apiClient.api.notifications[":id"].read.$post as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { id: "n1", readAt: "2026-01-01T00:00:01.000Z" } }),
    });
  });

  it("a topic:'notification' hint triggers a re-fetch and the new record appears", async () => {
    (apiClient.api.notifications.$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { notifications: [record({ id: "n1", createdAt: "2026-01-01T00:00:00.000Z" })] } }),
    });
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onHint({ seq: 1, topic: "notification", entityId: "n1" }));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]!.id).toBe("n1");
    stop();
  });

  it("a hint for a different topic (e.g. 'plan') does not trigger a notifications re-fetch", async () => {
    stop = startNotificationStream();
    const getCallsAfterMount = (apiClient.api.notifications.$get as ReturnType<typeof vi.fn>).mock.calls.length;
    renderHook(() => useNotifications());
    act(() => hintHandlers.onHint({ seq: 1, topic: "plan", entityId: "2026-09-25" }));
    expect((apiClient.api.notifications.$get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(getCallsAfterMount);
    stop();
  });

  it("onUnreachable adds a local synthetic operational record with deepLink: null (never undefined)", () => {
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onUnreachable());
    expect(result.current[0]!.kind).toBe("operational");
    expect(result.current[0]!.title).toMatch(/unreachable/i);
    expect(result.current[0]!.deepLink).toBeNull();
    stop();
  });

  it("onUnreachable does not stack a second synthetic record while one is still showing (no spam during a prolonged outage)", () => {
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onUnreachable());
    act(() => hintHandlers.onUnreachable());
    expect(result.current.filter((n) => n.title.match(/unreachable/i))).toHaveLength(1);
    stop();
  });

  it("dismissing the synthetic record clears the dedupe guard — a later outage raises a new one", () => {
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onUnreachable());
    act(() => dismissNotification(result.current[0]!.id));
    act(() => hintHandlers.onUnreachable());
    expect(result.current.filter((n) => n.title.match(/unreachable/i))).toHaveLength(1);
    stop();
  });

  it("never subscribes to onReachable — a failure is never auto-dismissed unseen, so reconnecting has nothing to react to here", () => {
    const onReachableSpy = vi.spyOn(eventBus, "onReachable");
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onUnreachable());
    expect(onReachableSpy).not.toHaveBeenCalled();
    expect(result.current).toHaveLength(1);
    stop();
  });

  it("dismissNotification on a local synthetic record just removes it (no server call)", () => {
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onUnreachable());
    const id = result.current[0]!.id;
    act(() => dismissNotification(id));
    expect(result.current).toHaveLength(0);
    expect(apiClient.api.notifications[":id"].read.$post).not.toHaveBeenCalled();
    stop();
  });

  it("dismissNotification on a server record marks it read via apiClient and removes it", async () => {
    (apiClient.api.notifications.$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { notifications: [record({ id: "n1", createdAt: "2026-01-01T00:00:00.000Z" })] } }),
    });
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onHint({ seq: 1, topic: "notification", entityId: "n1" }));
    await waitFor(() => expect(result.current).toHaveLength(1));
    await act(async () => dismissNotification("n1"));
    expect(apiClient.api.notifications[":id"].read.$post).toHaveBeenCalledWith({ param: { id: "n1" } });
    expect(result.current).toHaveLength(0);
    stop();
  });

  it("a failed mark-read (ok: false) puts the record back — a write failure is visible, not silent (UX-DR48)", async () => {
    (apiClient.api.notifications.$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { notifications: [record({ id: "n1", createdAt: "2026-01-01T00:00:00.000Z" })] } }),
    });
    (apiClient.api.notifications[":id"].read.$post as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: false, error: { kind: "unreachable", message: "db down" } }),
    });
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onHint({ seq: 1, topic: "notification", entityId: "n1" }));
    await waitFor(() => expect(result.current).toHaveLength(1));
    await act(async () => dismissNotification("n1"));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]!.id).toBe("n1");
    stop();
  });

  it("a rejected mark-read request (network failure) also puts the record back", async () => {
    (apiClient.api.notifications.$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { notifications: [record({ id: "n1", createdAt: "2026-01-01T00:00:00.000Z" })] } }),
    });
    (apiClient.api.notifications[":id"].read.$post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onHint({ seq: 1, topic: "notification", entityId: "n1" }));
    await waitFor(() => expect(result.current).toHaveLength(1));
    await act(async () => dismissNotification("n1"));
    await waitFor(() => expect(result.current).toHaveLength(1));
    stop();
  });

  it("a stale in-flight refetch does not resurrect a record already dismissed", async () => {
    let resolveGet!: (value: unknown) => void;
    (apiClient.api.notifications.$get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => ({ ok: true, value: { notifications: [record({ id: "n1", createdAt: "2026-01-01T00:00:00.000Z" })] } }) })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onHint({ seq: 1, topic: "notification", entityId: "n1" }));
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => hintHandlers.onHint({ seq: 2, topic: "notification", entityId: "n1" })); // second refetch starts, in flight
    await act(async () => dismissNotification("n1")); // dismissed before that in-flight GET resolves
    expect(result.current).toHaveLength(0);

    await act(async () => {
      resolveGet({ json: async () => ({ ok: true, value: { notifications: [record({ id: "n1", createdAt: "2026-01-01T00:00:00.000Z" })] } }) });
    });
    expect(result.current).toHaveLength(0); // still dismissed — the stale GET must not resurrect it
    stop();
  });

  it("newest-first ordering across both server records and a synthetic one, with nothing ever silently dropped from the store", async () => {
    (apiClient.api.notifications.$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({
        ok: true,
        value: {
          notifications: [
            record({ id: "n1", createdAt: "2026-01-01T00:00:00.000Z" }),
            record({ id: "n2", createdAt: "2026-01-01T00:00:01.000Z" }),
            record({ id: "n3", createdAt: "2026-01-01T00:00:02.000Z" }),
            record({ id: "n4", createdAt: "2026-01-01T00:00:03.000Z" }),
          ],
        },
      }),
    });
    stop = startNotificationStream();
    const { result } = renderHook(() => useNotifications());
    act(() => hintHandlers.onHint({ seq: 1, topic: "notification", entityId: "n4" }));
    await waitFor(() => expect(result.current).toHaveLength(4));
    // Every unread record is kept (never capped in the store — capping to
    // "3 visible" is NotificationOverlay's render-time concern, so a
    // failure notification bumped past position 3 by newer arrivals is
    // never silently discarded, only temporarily out of view).
    expect(result.current.map((n) => n.id)).toEqual(["n4", "n3", "n2", "n1"]);
    stop();
  });
});

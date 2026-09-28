/**
 * web/src/lib/sandbox.test.ts — Story 9.2: the `/sandbox` session's own
 * client-held bookkeeping. `exclude` accumulates both saved and skipped
 * taskIds this session (Review Focus #4); a validation rejection re-prompts
 * on the same card and writes nothing to the session state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  startSandbox,
  saveCard,
  skipCard,
  finishSandbox,
  useSandboxSession,
  __resetSandboxForTests,
  __setSandboxOutcomesForTests,
  SANDBOX_FINALE_MIN_DURATION_MS,
} from "./sandbox.ts";
import { __resetChatStoreForTests, useChatStore } from "./chatStore.ts";
import * as sandboxClientModule from "./sandboxClient.ts";
import * as chatStoreModule from "./chatStore.ts";
import * as sandboxSoundModule from "./sandboxSound.ts";
import type { SandboxCardView } from "../../../src/types/api.ts";

const CARD_1: SandboxCardView = { taskId: "t1", taskTitle: "Chem problem set", estimatedDurationMinutes: 45, remaining: 1 };
const CARD_2: SandboxCardView = { taskId: "t2", taskTitle: "History essay", dueDate: "2026-10-01", remaining: 0 };

beforeEach(() => {
  __resetChatStoreForTests();
  __resetSandboxForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("startSandbox", () => {
  it("seeds the session with the given card, empty exclude/outcomes, and appends a pending sandbox-card entry", () => {
    const { result: session } = renderHook(() => useSandboxSession());
    const { result: store } = renderHook(() => useChatStore());
    act(() => startSandbox(CARD_1));
    expect(session.current).toEqual({ card: CARD_1, exclude: [], outcomes: [] });
    expect(store.current.entries.at(-1)).toMatchObject({ kind: "sandbox-card", view: CARD_1, status: "pending" });
  });
});

describe("saveCard", () => {
  it("on success: settles the entry 'saved' with the receipt, advances to next, accumulates exclude and outcomes", async () => {
    vi.spyOn(sandboxClientModule, "requestSandboxSave").mockResolvedValue({
      ok: true,
      value: { receipt: "Due Date, Estimated Duration saved.", next: CARD_2 },
    });
    const { result: session } = renderHook(() => useSandboxSession());
    const { result: store } = renderHook(() => useChatStore());
    act(() => startSandbox(CARD_1));
    await act(() => saveCard({ dueDate: "2026-09-30", estimatedDurationMinutes: "45" }));
    expect(session.current.card).toEqual(CARD_2);
    // Review Focus #4 — exclude accumulates the SAVED taskId too, not just skips.
    expect(session.current.exclude).toEqual(["t1"]);
    expect(session.current.outcomes).toEqual([{ taskId: "t1", taskTitle: "Chem problem set", ok: true }]);
    const settled = store.current.entries.find((e) => e.kind === "sandbox-card" && e.view.taskId === "t1");
    expect(settled).toMatchObject({ status: "saved", receipt: "Due Date, Estimated Duration saved." });
    expect(store.current.entries.filter((e) => e.kind === "sandbox-card")).toHaveLength(2);
  });

  it("on a validation rejection: the card's entry stays 'pending' (re-prompt, FR-38) — it does NOT advance or add an outcome", async () => {
    vi.spyOn(sandboxClientModule, "requestSandboxSave").mockResolvedValue({ ok: false, message: "no existing Area option matches" });
    const { result: session } = renderHook(() => useSandboxSession());
    act(() => startSandbox(CARD_1));
    await act(() => saveCard({ dueDate: "2026-09-30", estimatedDurationMinutes: "45", area: "Nope" }));
    expect(session.current.card).toEqual(CARD_1);
    expect(session.current.exclude).toEqual([]);
    expect(session.current.outcomes).toEqual([]);
  });

  it("saveCard is a no-op with no active card", async () => {
    const spy = vi.spyOn(sandboxClientModule, "requestSandboxSave");
    await act(() => saveCard({ dueDate: "2026-09-30", estimatedDurationMinutes: "45" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("when the response carries no next card, finishSandbox is called and the session ends", async () => {
    vi.spyOn(sandboxClientModule, "requestSandboxSave").mockResolvedValue({
      ok: true,
      value: { receipt: "Due Date, Estimated Duration saved.", next: undefined },
    });
    const { result: session } = renderHook(() => useSandboxSession());
    act(() => startSandbox(CARD_2));
    await act(() => saveCard({ dueDate: "2026-10-01", estimatedDurationMinutes: "20" }));
    expect(session.current.card).toEqual(undefined);
  });
});

describe("skipCard", () => {
  it("settles the entry 'skipped', advances to next, accumulates exclude but adds NO outcome", async () => {
    vi.spyOn(sandboxClientModule, "requestSandboxSkip").mockResolvedValue({ ok: true, value: { next: CARD_2 } });
    const { result: session } = renderHook(() => useSandboxSession());
    const { result: store } = renderHook(() => useChatStore());
    act(() => startSandbox(CARD_1));
    await act(() => skipCard());
    expect(session.current.card).toEqual(CARD_2);
    expect(session.current.exclude).toEqual(["t1"]);
    expect(session.current.outcomes).toEqual([]);
    const settled = store.current.entries.find((e) => e.kind === "sandbox-card" && e.view.taskId === "t1");
    expect(settled).toMatchObject({ status: "skipped" });
  });
});

describe("failed save tracking (fix round 1: how a failure reaches outcomes at all)", () => {
  it("a failed save, then a skip on the SAME card, records an ok:false outcome for it", async () => {
    vi.spyOn(sandboxClientModule, "requestSandboxSave").mockResolvedValue({ ok: false, message: "no existing Area option matches" });
    vi.spyOn(sandboxClientModule, "requestSandboxSkip").mockResolvedValue({ ok: true, value: { next: CARD_2 } });
    const { result: session } = renderHook(() => useSandboxSession());
    act(() => startSandbox(CARD_1));
    await act(() => saveCard({ dueDate: "2026-09-30", estimatedDurationMinutes: "45", area: "Nope" }));
    await act(() => skipCard());
    expect(session.current.outcomes).toEqual([{ taskId: "t1", taskTitle: "Chem problem set", ok: false }]);
  });

  it("a failed save, then a successful save on the SAME card (a retry), records only the ok:true outcome", async () => {
    vi.spyOn(sandboxClientModule, "requestSandboxSave")
      .mockResolvedValueOnce({ ok: false, message: "no existing Area option matches" })
      .mockResolvedValueOnce({ ok: true, value: { receipt: "Due Date, Estimated Duration saved.", next: CARD_2 } });
    const { result: session } = renderHook(() => useSandboxSession());
    act(() => startSandbox(CARD_1));
    await act(() => saveCard({ dueDate: "2026-09-30", estimatedDurationMinutes: "45", area: "Nope" }));
    await act(() => saveCard({ dueDate: "2026-09-30", estimatedDurationMinutes: "45" }));
    expect(session.current.outcomes).toEqual([{ taskId: "t1", taskTitle: "Chem problem set", ok: true }]);
  });

  it("a failure-only session (skip after a failed save empties the queue) still calls requestSandboxFinish with the ok:false outcome", async () => {
    vi.spyOn(sandboxClientModule, "requestSandboxSave").mockResolvedValue({ ok: false, message: "no existing Area option matches" });
    vi.spyOn(sandboxClientModule, "requestSandboxSkip").mockResolvedValue({ ok: true, value: { next: undefined } });
    const finish = vi
      .spyOn(sandboxClientModule, "requestSandboxFinish")
      .mockResolvedValue({ ok: true, value: { savedCount: 0, failedTitles: ["Chem problem set"] } });
    act(() => startSandbox(CARD_1));
    await act(() => saveCard({ dueDate: "2026-09-30", estimatedDurationMinutes: "45", area: "Nope" }));
    await act(() => skipCard());
    expect(finish).toHaveBeenCalledWith([{ taskId: "t1", taskTitle: "Chem problem set", ok: false }]);
  });
});

describe("finishSandbox", () => {
  it("Review Focus #2: with zero outcomes (all-skip), calls NO finish request, appends NO finale entry, and resets the session", async () => {
    const request = vi.spyOn(sandboxClientModule, "requestSandboxFinish");
    const append = vi.spyOn(chatStoreModule, "appendStreamEntry");
    const { result: session } = renderHook(() => useSandboxSession());
    act(() => startSandbox(CARD_1));
    __setSandboxOutcomesForTests([]);
    await act(() => finishSandbox());
    expect(request).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "sandbox-finale" }));
    expect(session.current).toEqual({ card: undefined, exclude: [], outcomes: [] });
  });

  it("appends a pending sandbox-finale entry, then resolves it with the server's savedCount/failedTitles", async () => {
    vi.spyOn(sandboxClientModule, "requestSandboxFinish").mockResolvedValue({ ok: true, value: { savedCount: 2, failedTitles: [] } });
    const update = vi.spyOn(chatStoreModule, "updateStreamEntry");
    __setSandboxOutcomesForTests([
      { taskId: "t1", taskTitle: "Call dentist", ok: true },
      { taskId: "t2", taskTitle: "File taxes", ok: true },
    ]);
    await act(() => finishSandbox());
    expect(update).toHaveBeenCalledWith(expect.any(String), { status: "done", savedCount: 2, failedTitles: [] });
  });

  it("plays the chime when savedCount >= 1", async () => {
    const chime = vi.spyOn(sandboxSoundModule, "playSandboxCompleteChime").mockImplementation(() => {});
    vi.spyOn(sandboxClientModule, "requestSandboxFinish").mockResolvedValue({ ok: true, value: { savedCount: 1, failedTitles: [] } });
    __setSandboxOutcomesForTests([{ taskId: "t1", taskTitle: "Call dentist", ok: true }]);
    await act(() => finishSandbox());
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it("does NOT play the chime when savedCount is 0 (all failed, but the server DID respond)", async () => {
    const chime = vi.spyOn(sandboxSoundModule, "playSandboxCompleteChime").mockImplementation(() => {});
    vi.spyOn(sandboxClientModule, "requestSandboxFinish").mockResolvedValue({ ok: true, value: { savedCount: 0, failedTitles: ["Chem problem set"] } });
    __setSandboxOutcomesForTests([{ taskId: "t1", taskTitle: "Chem problem set", ok: false }]);
    await act(() => finishSandbox());
    expect(chime).not.toHaveBeenCalled();
  });

  it("fix round 1 / AD-17: when requestSandboxFinish itself fails, settles the entry with summaryFailed:true (no client-computed savedCount/failedTitles) and never plays the chime", async () => {
    const chime = vi.spyOn(sandboxSoundModule, "playSandboxCompleteChime").mockImplementation(() => {});
    vi.spyOn(sandboxClientModule, "requestSandboxFinish").mockResolvedValue({ ok: false, message: "network down" });
    const update = vi.spyOn(chatStoreModule, "updateStreamEntry");
    __setSandboxOutcomesForTests([{ taskId: "t1", taskTitle: "Call dentist", ok: true }]);
    await act(() => finishSandbox());
    expect(update).toHaveBeenCalledWith(expect.any(String), { status: "done", summaryFailed: true });
    expect(chime).not.toHaveBeenCalled();
  });

  // Review Focus #3: waits only for the REMAINING time, never a flat extra delay on top of a slow response.
  it("holds the pending state for at least SANDBOX_FINALE_MIN_DURATION_MS total, but never longer than necessary when the response is already slow", async () => {
    vi.useFakeTimers();
    let resolveRequest!: (v: { ok: true; value: { savedCount: number; failedTitles: string[] } }) => void;
    vi.spyOn(sandboxClientModule, "requestSandboxFinish").mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)));
    __setSandboxOutcomesForTests([{ taskId: "t1", taskTitle: "Call dentist", ok: true }]);

    const done = finishSandbox();
    // Slower than the minimum: the server takes longer than SANDBOX_FINALE_MIN_DURATION_MS to answer.
    await vi.advanceTimersByTimeAsync(SANDBOX_FINALE_MIN_DURATION_MS + 500);
    resolveRequest({ ok: true, value: { savedCount: 1, failedTitles: [] } });
    await vi.advanceTimersByTimeAsync(0);
    await done; // resolves promptly — no extra flat delay stacked on top of the already-slow response
  });
});

/**
 * web/src/lib/sandbox.test.ts — Story 9.2: the `/sandbox` session's own
 * client-held bookkeeping. `exclude` accumulates both saved and skipped
 * taskIds this session (Review Focus #4); a validation rejection re-prompts
 * on the same card and writes nothing to the session state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { startSandbox, saveCard, skipCard, finishSandbox, useSandboxSession, __resetSandboxForTests } from "./sandbox.ts";
import { __resetChatStoreForTests, useChatStore } from "./chatStore.ts";
import * as sandboxClientModule from "./sandboxClient.ts";
import type { SandboxCardView } from "../../../src/types/api.ts";

const CARD_1: SandboxCardView = { taskId: "t1", taskTitle: "Chem problem set", estimatedDurationMinutes: 45, remaining: 1 };
const CARD_2: SandboxCardView = { taskId: "t2", taskTitle: "History essay", dueDate: "2026-10-01", remaining: 0 };

beforeEach(() => {
  __resetChatStoreForTests();
  __resetSandboxForTests();
});
afterEach(() => vi.restoreAllMocks());

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

describe("finishSandbox (Story 9.2 scope: a quiet reset — Story 9.3 replaces this body)", () => {
  it("resets the session to empty", async () => {
    const { result: session } = renderHook(() => useSandboxSession());
    act(() => startSandbox(CARD_1));
    await act(() => finishSandbox());
    expect(session.current).toEqual({ card: undefined, exclude: [], outcomes: [] });
  });
});

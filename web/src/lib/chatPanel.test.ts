import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { openChatPanel, closeChatPanel, restoreChatPanelFocus, openChatWithCommand, useChatPanel, __resetChatPanelForTests } from "./chatPanel.ts";
import * as chatStoreModule from "./chatStore.ts";
import * as chatStreamModule from "./chatStream.ts";
import type { ChatStreamEvent, ChatTurnRequest } from "../../../src/types/api.ts";

afterEach(() => {
  __resetChatPanelForTests();
  chatStoreModule.__resetChatStoreForTests();
  vi.restoreAllMocks();
});

describe("openChatWithCommand", () => {
  it("opens the panel; with no command, nothing is sent", () => {
    const send = vi.spyOn(chatStoreModule, "send").mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatPanel());
    expect(result.current.open).toBe(false);
    act(() => openChatWithCommand());
    expect(result.current.open).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("opens the panel AND sends the given command as if typed (E8: 'chat:/sandbox')", () => {
    const send = vi.spyOn(chatStoreModule, "send").mockResolvedValue(undefined);
    const { result } = renderHook(() => useChatPanel());
    act(() => openChatWithCommand("/sandbox"));
    expect(result.current.open).toBe(true);
    expect(send).toHaveBeenCalledWith("/sandbox");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

/** A `streamChat` stand-in the test drives by hand, tracking every call by index so a queued command's own later `send()` call can be driven independently of the turn already in flight. */
function controllableStream() {
  const calls: Array<{ resolve: () => void; onEvent(e: ChatStreamEvent): void }> = [];
  const requests: ChatTurnRequest[] = [];
  const spy = vi.spyOn(chatStreamModule, "streamChat").mockImplementation((request, handlers) => {
    requests.push(request);
    return new Promise<void>((resolve) => {
      calls.push({ resolve, onEvent: handlers.onEvent });
    });
  });
  return {
    spy,
    requests,
    emit: (index: number, e: ChatStreamEvent) => act(() => calls[index]!.onEvent(e)),
    finish: async (index: number) => act(async () => calls[index]!.resolve()),
  };
}

// Task 7 (polish-5): `openChatWithCommand` during an in-flight turn must
// queue the command (one slot, latest wins) instead of `send()`'s own
// silent no-op, and send it as soon as `sending` flips back to false.
describe("queued command during a turn", () => {
  it("a command requested while a turn is in flight is queued and sent once that turn resolves — never dropped silently", async () => {
    const stream = controllableStream();
    act(() => void chatStoreModule.send("in flight"));
    expect(stream.requests).toHaveLength(1);

    act(() => openChatWithCommand("/queued"));
    // Not sent yet — still queued behind the in-flight turn.
    expect(stream.requests).toHaveLength(1);

    stream.emit(0, { type: "done", response: { reply: "ok", receipts: [] } });
    expect(stream.requests).toHaveLength(2);
    expect(stream.requests[1]).toMatchObject({ message: "/queued" });

    await stream.finish(0);
    await stream.finish(1);
  });

  it("a second queued command replaces the first — only the latest is sent", async () => {
    const stream = controllableStream();
    act(() => void chatStoreModule.send("in flight"));
    act(() => openChatWithCommand("/first"));
    act(() => openChatWithCommand("/second"));

    stream.emit(0, { type: "done", response: { reply: "ok", receipts: [] } });
    expect(stream.requests).toHaveLength(2);
    expect(stream.requests[1]).toMatchObject({ message: "/second" });
    expect(stream.requests.some((r) => r.message === "/first")).toBe(false);

    await stream.finish(0);
    await stream.finish(1);
  });

  it("opening with no command while a turn is in flight does not queue anything", async () => {
    const stream = controllableStream();
    act(() => void chatStoreModule.send("in flight"));
    act(() => openChatWithCommand());

    stream.emit(0, { type: "done", response: { reply: "ok", receipts: [] } });
    expect(stream.requests).toHaveLength(1);

    await stream.finish(0);
  });
});

describe("focus return (S1, polish-6 review)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    __resetChatPanelForTests();
  });

  it("opening again while open does not replace the recorded opener", () => {
    const pill = document.createElement("button");
    const chip = document.createElement("button");
    document.body.append(pill, chip);
    pill.focus();
    openChatPanel();
    chip.focus();
    openChatWithCommand();
    closeChatPanel();
    restoreChatPanelFocus();
    expect(pill).toHaveFocus();
  });

  it("falls back to the Ask Meeseek pill when the opener is gone at close", () => {
    const pill = document.createElement("button");
    pill.setAttribute("data-testid", "ask-yoh-pill");
    const link = document.createElement("button");
    document.body.append(pill, link);
    link.focus();
    openChatPanel();
    link.remove();
    closeChatPanel();
    restoreChatPanelFocus();
    expect(pill).toHaveFocus();
  });
});

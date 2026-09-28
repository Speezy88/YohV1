import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { openChatWithCommand, useChatPanel, __resetChatPanelForTests } from "./chatPanel.ts";
import * as chatStoreModule from "./chatStore.ts";

afterEach(() => {
  __resetChatPanelForTests();
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

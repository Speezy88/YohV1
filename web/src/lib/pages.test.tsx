/**
 * Polish 6 (P6-R12): the current page lives in `location.hash`. The initial
 * page comes from the hash (unknown or empty → Home), user navigation pushes
 * a history entry, and `popstate` moves the page. No router.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePageNavigation } from "./pages.ts";
import { __resetChatPanelForTests, isChatPanelOpen, openChatPanel } from "./chatPanel.ts";

function setHash(hash: string): void {
  history.replaceState(null, "", hash === "" ? "/" : `/#${hash}`);
}

describe("usePageNavigation and the URL hash", () => {
  beforeEach(() => {
    setHash("");
  });

  it("starts on the page named by the hash", () => {
    setHash("research");
    const { result } = renderHook(() => usePageNavigation());
    expect(result.current.index).toBe(3);
  });

  it("starts on Home for an empty hash and normalises it to #home", () => {
    const { result } = renderHook(() => usePageNavigation());
    expect(result.current.index).toBe(0);
    expect(location.hash).toBe("#home");
  });

  it("starts on Home for an unknown hash", () => {
    setHash("nope");
    const { result } = renderHook(() => usePageNavigation());
    expect(result.current.index).toBe(0);
    expect(location.hash).toBe("#home");
  });

  it("normalising the initial hash replaces the entry rather than adding one", () => {
    const before = history.length;
    renderHook(() => usePageNavigation());
    expect(history.length).toBe(before);
  });

  it("goTo, next and prev push the new page id onto history", () => {
    const { result } = renderHook(() => usePageNavigation());
    const before = history.length;
    act(() => result.current.goTo(2));
    expect(location.hash).toBe("#desk");
    expect(history.length).toBe(before + 1);
    act(() => result.current.next());
    expect(location.hash).toBe("#research");
    act(() => result.current.prev());
    expect(location.hash).toBe("#desk");
    expect(result.current.index).toBe(2);
  });

  it("does not push a duplicate entry when the page does not change", () => {
    const { result } = renderHook(() => usePageNavigation());
    const before = history.length;
    act(() => result.current.prev()); // already at the first page
    act(() => result.current.goTo(0));
    expect(history.length).toBe(before);
  });

  it("popstate moves to the page in the hash", () => {
    const { result } = renderHook(() => usePageNavigation());
    act(() => result.current.goTo(1));
    act(() => {
      setHash("memory");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.index).toBe(4);
  });

  it("popstate to an unknown hash goes Home", () => {
    const { result } = renderHook(() => usePageNavigation());
    act(() => result.current.goTo(3));
    act(() => {
      setHash("bogus");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.index).toBe(0);
    expect(location.hash).toBe("#home");
  });

  it("history.back returns to the previous page", async () => {
    const { result } = renderHook(() => usePageNavigation());
    act(() => result.current.goTo(1));
    act(() => result.current.goTo(2));
    await act(async () => {
      history.back();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.index).toBe(1);
  });

  it("Back with the Chat panel open closes the panel and leaves the page where it was", async () => {
    __resetChatPanelForTests();
    const { result } = renderHook(() => usePageNavigation());
    act(() => result.current.goTo(1));
    act(() => result.current.goTo(2));
    act(() => openChatPanel());
    await act(async () => {
      history.back();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(isChatPanelOpen()).toBe(false);
    expect(result.current.index).toBe(2);
    expect(location.hash).toBe("#desk");
    __resetChatPanelForTests();
  });
});

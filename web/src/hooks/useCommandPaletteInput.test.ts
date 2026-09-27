/**
 * web/src/hooks/useCommandPaletteInput.test.ts — Story 8.8 review fix.
 *
 * The shared "/" Command Palette wiring `ChatInput.tsx` and `ChatBubble.tsx`
 * both mount under their own text field: showPalette derivation, dismiss on
 * Esc / re-offer on typing, the combobox `aria-activedescendant` value, and
 * the `commandPaletteProps` bundle (`onRun` clears the draft and calls the
 * caller's own `afterRun`, `onClose` dismisses, `onHighlightedOptionChange`
 * updates the reported descendant).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCommandPaletteInput } from "./useCommandPaletteInput.ts";
import * as chatStore from "../lib/chatStore.ts";

describe("useCommandPaletteInput", () => {
  beforeEach(() => {
    vi.spyOn(chatStore, "send").mockResolvedValue(undefined);
    vi.spyOn(chatStore, "setDraft").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("showPalette is false when the draft doesn't start with '/'", () => {
    const { result } = renderHook(() => useCommandPaletteInput("hello"));
    expect(result.current.showPalette).toBe(false);
    expect(result.current.activeDescendant).toBeUndefined();
  });

  it("showPalette is true when the draft starts with '/'", () => {
    const { result } = renderHook(() => useCommandPaletteInput("/"));
    expect(result.current.showPalette).toBe(true);
  });

  it("commandPaletteProps.onClose dismisses the palette until the next handleChange call", () => {
    const { result, rerender } = renderHook(({ draft }) => useCommandPaletteInput(draft), { initialProps: { draft: "/mor" } });
    expect(result.current.showPalette).toBe(true);

    act(() => result.current.commandPaletteProps.onClose());
    rerender({ draft: "/mor" });
    expect(result.current.showPalette).toBe(false);

    // Typing further (handleChange) always re-offers it, even mid-word.
    act(() => result.current.handleChange("/morn"));
    rerender({ draft: "/morn" });
    expect(result.current.showPalette).toBe(true);
  });

  it("handleChange calls chatStore's setDraft with the new value", () => {
    const { result } = renderHook(() => useCommandPaletteInput("/"));
    act(() => result.current.handleChange("/night"));
    expect(chatStore.setDraft).toHaveBeenCalledWith("/night");
  });

  it("commandPaletteProps.onRun sends the picked command, clears the draft, and calls afterRun", () => {
    const afterRun = vi.fn();
    const { result } = renderHook(() => useCommandPaletteInput("/", afterRun));
    act(() => result.current.commandPaletteProps.onRun("/morning"));
    expect(chatStore.send).toHaveBeenCalledWith("/morning");
    expect(chatStore.setDraft).toHaveBeenCalledWith("");
    expect(afterRun).toHaveBeenCalledTimes(1);
  });

  it("commandPaletteProps.onRun works with no afterRun given (ChatInput.tsx's case)", () => {
    const { result } = renderHook(() => useCommandPaletteInput("/"));
    expect(() => act(() => result.current.commandPaletteProps.onRun("/night"))).not.toThrow();
    expect(chatStore.send).toHaveBeenCalledWith("/night");
  });

  it("activeDescendant mirrors the last id reported via commandPaletteProps.onHighlightedOptionChange, only while shown", () => {
    const { result, rerender } = renderHook(({ draft }) => useCommandPaletteInput(draft), { initialProps: { draft: "/" } });
    act(() => result.current.commandPaletteProps.onHighlightedOptionChange("command-option-morning"));
    rerender({ draft: "/" });
    expect(result.current.activeDescendant).toBe("command-option-morning");

    // Closing the palette clears activeDescendant, even though the reported id is still remembered internally.
    act(() => result.current.commandPaletteProps.onClose());
    rerender({ draft: "/" });
    expect(result.current.activeDescendant).toBeUndefined();
  });
});

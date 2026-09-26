import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyStoredThemeOnLoad, getStoredTheme, setStoredTheme } from "./theme.ts";

describe("theme storage", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("getStoredTheme returns undefined when nothing is stored", () => {
    expect(getStoredTheme()).toBeUndefined();
  });

  it("setStoredTheme persists and getStoredTheme reads it back", () => {
    setStoredTheme("dark");
    expect(getStoredTheme()).toBe("dark");
  });

  it("applyStoredThemeOnLoad sets documentElement's data-theme from storage", () => {
    setStoredTheme("dark");
    applyStoredThemeOnLoad();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applyStoredThemeOnLoad leaves data-theme unset when nothing is stored (OS default governs)", () => {
    applyStoredThemeOnLoad();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("a throwing localStorage never breaks getStoredTheme/setStoredTheme/applyStoredThemeOnLoad", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => getStoredTheme()).not.toThrow();
    expect(getStoredTheme()).toBeUndefined();
    spy.mockRestore();
  });

  it("a throwing localStorage.setItem never breaks setStoredTheme (still applies data-theme)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setStoredTheme("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    spy.mockRestore();
  });
});

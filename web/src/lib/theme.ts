/**
 * web/src/lib/theme.ts
 *
 * Story 7.5, UX-DR27: per-device theme preference in localStorage, wrapped
 * so a blocked/unavailable store never breaks the page. Absent = "follow
 * the OS" (tokens.css's `color-scheme: light dark` on `:root` governs);
 * present = an explicit override via `[data-theme]`.
 */
const STORAGE_KEY = "yoh-theme";
export type Theme = "light" | "dark";

export function getStoredTheme(): Theme | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Blocked storage (private window, quota) — the page still works; the
    // choice just doesn't persist across a reload this session.
  }
  document.documentElement.dataset.theme = theme;
}

/** Called once, on load, before first paint if possible — applies a stored override; otherwise leaves `[data-theme]` unset so the OS default (tokens.css media/color-scheme) governs. */
export function applyStoredThemeOnLoad(): void {
  const stored = getStoredTheme();
  if (stored) document.documentElement.dataset.theme = stored;
}

/** The theme actually in effect right now, for the toggle to flip — reads the explicit override if set, else the OS's current preference. */
export function effectiveTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

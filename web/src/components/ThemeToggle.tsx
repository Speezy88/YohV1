// web/src/components/ThemeToggle.tsx — Story 7.5, DESIGN.md `theme-toggle`.
// UX-DR27's sanctioned exception to FR-46's no-redundant-buttons rule: no
// slash command sets the theme, so a persistent control is warranted.
//
// Task 6A (2026-09-27, "Corner chrome lives in the nav sidebar"): the
// Theme Toggle moves from a fixed top-right corner circle into the bottom
// of `Sidebar.tsx`, styled per the approved mockup as a full-width raised
// pill with a sun/moon glyph plus a "Dark mode"/"Light mode" label —
// rendered with the shared Icon convention (UX-DR47), never emoji.
import { useState } from "react";
import { effectiveTheme, setStoredTheme, type Theme } from "../lib/theme.ts";
import { Icon } from "./icons/Icon.tsx";
import { CONTROL_DISABLED, CONTROL_TRANSITION, FOCUS_RING } from "../lib/controlStyles.ts";

/** 24x24 viewBox, round caps — DESIGN.md's "Sun glyph in light mode". */
const SUN_PATH =
  "M12 6.5v-3M12 20.5v-3M6.5 12h-3M20.5 12h-3M8.3 8.3 6.2 6.2M17.8 17.8l-2.1-2.1M8.3 15.7l-2.1 2.1M17.8 6.2l-2.1 2.1M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z";
/** DESIGN.md's "moon glyph in dark [mode]". */
const MOON_PATH = "M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z";

export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => effectiveTheme());

  const flip = (): void => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStoredTheme(next);
    setTheme(next);
  };

  // Fix round (2026-09-27 review): the visible label names the ACTION
  // (what clicking does), matching the aria-label and the mockup — "Dark
  // mode" while the CURRENT theme is light (click to enter dark mode), not
  // "Dark mode" while already dark (which would describe current state,
  // the opposite of what was shipped first).
  // The accessible name is the visible text (WCAG 2.5.3 Label in Name).
  const modeText = theme === "dark" ? "Light mode" : "Dark mode";
  const label = modeText;

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={label}
      className={`flex h-12 items-center gap-3 rounded-full border-[length:var(--rim-width)] border-rim-interactive px-4.5 font-body text-small font-medium text-ink-secondary shadow-extruded-sm hover:text-ink-primary hover:shadow-extruded-md active:shadow-inset ${FOCUS_RING} ${CONTROL_TRANSITION} ${CONTROL_DISABLED}`}
    >
      {/* DESIGN.md specifies ink-primary for this one glyph; the shared Icon
          convention's neutral/active coloring (ink-secondary/accent-solid)
          is for the general icon set, not this specific control. */}
      <Icon path={theme === "dark" ? MOON_PATH : SUN_PATH} label={label} strokeClassName="stroke-ink-primary" />
      {modeText}
    </button>
  );
}

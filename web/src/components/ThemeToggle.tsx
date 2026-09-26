// web/src/components/ThemeToggle.tsx — Story 7.5, DESIGN.md `theme-toggle`.
// UX-DR27's sanctioned exception to FR-46's no-redundant-buttons rule: no
// slash command sets the theme, so a persistent corner control is warranted.
// DESIGN.md `theme-toggle`: 30px circle, 1px accent-solid border, sun/moon
// glyph stroked in ink-primary — rendered with the shared Icon convention
// (UX-DR47), never emoji.
import { useState } from "react";
import { effectiveTheme, setStoredTheme, type Theme } from "../lib/theme.ts";
import { Icon } from "./icons/Icon.tsx";

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

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={label}
      className="flex size-[30px] items-center justify-center rounded-full border border-accent-solid bg-surface-raised text-ink-primary shadow-extruded-sm"
    >
      {/* DESIGN.md specifies ink-primary for this one glyph; the shared Icon
          convention's neutral/active coloring (ink-secondary/accent-solid)
          is for the general icon set, not this specific corner control. */}
      <Icon path={theme === "dark" ? MOON_PATH : SUN_PATH} label={label} strokeClassName="stroke-ink-primary" />
    </button>
  );
}

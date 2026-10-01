/**
 * web/src/lib/controlStyles.ts — Polish 6 (P6-R1..R5). Shared interaction-state
 * class strings for buttons and clickable rows. Components compose these into
 * `className`; each string is defined once here.
 */

/** The 2px accent outline, offset 2px, on every interactive element. */
export const FOCUS_RING =
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";

/** Paint-only transition (never `all`, never layout), driven by the motion tokens. */
export const CONTROL_TRANSITION =
  "transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-(--duration-control) ease-(--ease-control)";

/** Disabled everywhere: half opacity, not-allowed cursor. */
export const CONTROL_DISABLED = "disabled:opacity-50 disabled:cursor-not-allowed";

/** Control sizes: 36 / 44 / 48px tall. */
export const CONTROL_SM = "h-9 px-3 text-small";
export const CONTROL_MD = "h-11 px-4 text-body";
export const CONTROL_LG = "h-12 px-5 text-body";

const BASE = `${FOCUS_RING} ${CONTROL_TRANSITION} ${CONTROL_DISABLED}`;

/** Accent-gradient fill; hover brightens, press dims. */
export const BUTTON_PRIMARY = `inline-flex items-center justify-center gap-2 rounded-sm bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end font-body font-bold text-on-accent-solid hover:brightness-105 active:brightness-95 ${BASE}`;

/** Rimmed, extruded; hover steps the shadow up, press insets. */
export const BUTTON_SECONDARY = `inline-flex items-center justify-center gap-2 rounded-sm border-[length:var(--rim-width)] border-rim-interactive bg-surface-base font-body font-medium text-ink-secondary shadow-extruded-sm hover:text-ink-primary hover:shadow-extruded-md active:shadow-inset ${BASE}`;

/** Text-only button; hover underlines. `ink-accent`, not `accent-solid`: accent-solid text fails 4.5:1 (DESIGN.md, Undo Toast note). */
export const BUTTON_TEXT = `inline-flex items-center justify-center rounded-xs font-body font-medium text-ink-accent hover:underline ${BASE}`;

/** Square, rimmed, extruded icon button; pair with a CONTROL_* height and a matching width. */
export const ICON_BUTTON = `inline-flex items-center justify-center rounded-md border-[length:var(--rim-width)] border-rim-interactive bg-surface-base text-ink-secondary shadow-extruded-sm hover:text-ink-primary hover:shadow-extruded-md active:shadow-inset ${BASE}`;

/** Clickable flat row: hover tints to the sunken surface. */
export const ROW_HOVER_FLAT = `hover:bg-surface-sunken ${FOCUS_RING} ${CONTROL_TRANSITION}`;

/** Clickable raised row: hover steps the shadow up. */
export const ROW_HOVER_RAISED = `hover:shadow-extruded-md ${FOCUS_RING} ${CONTROL_TRANSITION}`;

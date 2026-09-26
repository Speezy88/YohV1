/**
 * web/src/components/icons/Icon.tsx
 *
 * Story 7.5, DESIGN.md `icon` / UX-DR47: 1.8px stroke, round caps, neutral
 * `ink-secondary` / active `accent-solid`, always with a `label` (an
 * accessible name — never the only signal of state; a caller pairs this
 * with visible text wherever the icon alone would carry meaning).
 */
export interface IconProps {
  /** One or more SVG path `d` attributes, viewBox 0 0 24 24. */
  readonly path: string;
  /** The accessible name — required, never omitted (UX-DR47). */
  readonly label: string;
  readonly active?: boolean;
  /**
   * Overrides the neutral/active stroke tone (a `stroke-*` Tailwind utility
   * naming a design token, e.g. `"stroke-ink-primary"`) for the rare
   * DESIGN.md component with its own stroke color, such as the Theme
   * Toggle's ink-primary glyph. Most callers omit this and get the
   * standard neutral `ink-secondary` / active `accent-solid` convention.
   */
  readonly strokeClassName?: string;
  readonly className?: string;
}

export function Icon({ path, label, active = false, strokeClassName, className = "" }: IconProps): React.JSX.Element {
  const tone = strokeClassName ?? (active ? "stroke-accent-solid" : "stroke-ink-secondary");
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      className={`${tone} ${className}`}
    >
      {/* No `stroke` attribute here: SVG's `stroke` property is inherited,
          so the path picks up whichever `stroke-*` Tailwind utility class
          is on the wrapping <svg> above (neutral ink-secondary / active
          accent-solid) — no hard-coded color (FR-46). */}
      <path d={path} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

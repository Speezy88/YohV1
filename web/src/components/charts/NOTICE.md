# Bklit UI heatmap chart (copied in)

- Source: `https://ui.bklit.com/r/heatmap-chart.json` and its registry dependencies (`chart-context`, `chart-animation`, `chart-utils`, `chart-tooltip`, `utils`, `shimmering-text`), fetched 2026-10-04.
- License: MIT (Bklit UI).
- Copied without the shadcn CLI. `web/components.json` is hand-written so a later `shadcn add` knows the layout.

## Left out (never imported by the Desk heatmap)

The legend files (`heatmap-legend*.tsx`; the Desk draws its own five-label legend), `heatmap-x-axis.tsx`, `heatmap-y-axis.tsx`, `heatmap-chart-loading.tsx`, `generate-heatmap-skeleton-data.ts`, `index.ts` barrels, and the line-chart files (background, reveal clip, y-axis ticks, tooltip content/dot/indicator/date ticker, decimation, and similar).

## Local changes (each is marked `// Yoh:` in the code)

- `heatmap-cells.tsx`: cells are `role="img"` with an accessible name (`cellLabel` prop), one roving tab stop (today's cell, or the last focused), arrow keys / Home / End (`heatmap-focus.ts`), tooltip on focus, Escape hides it, blur hides it, a focus ring drawn as a stroke from `--color-accent-solid` and `--focus-ring-width`; level 0 gets a `--color-rim-structural` stroke; hover transition duration reads `--duration-control`; tooltip data carries `completed`.
- `heatmap-chart.tsx`: the `<svg>` is a labelled `role="group"` (new `ariaLabel` prop), no longer `aria-hidden`.
- `heatmap-context.tsx`: `HeatmapBin` and `HeatmapTooltipData` gain an optional `completed`.
- `heatmap-tooltip.tsx`: `formatDate`, `formatWeekday` props; `formatLabel` receives `completed`.
- `tooltip/tooltip-box.tsx`: `z-(--z-popover)` instead of a bare numeric z-index; token-backed radius and shadow (`rounded-md`, `shadow-extruded-md`), no backdrop blur; fade duration reads `--duration-control`.
- `heatmap-animation.ts`: enter duration default is 0; new `readCssDurationMs` reads a `tokens.css` duration.
- `heatmap-colors.ts`, `pattern-preset.tsx`: the hard-coded `#e879f9` became `var(--color-accent-solid)`; the pattern-stroke mix uses `--color-surface-base` instead of `white`.
- `chart-loading-label.tsx`, `shimmering-text.tsx`: ink tokens instead of `--muted-foreground` / `--foreground`.
- New file `heatmap/heatmap-focus.ts`: the pure keyboard movement.
- `web/src/tokens.css`: heatmap level colors, tooltip colors, the `--chart-*` names the copied files read, `--duration-heatmap-enter`.

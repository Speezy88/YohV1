/**
 * web/src/components/DeskHeatmap.tsx — Epic 12 Task 5: the Desk page's
 * 26-week usage heatmap, drawn with Bklit UI's heatmap chart (copied into
 * `components/charts/`, patched for keyboard focus, labels and tokens). It
 * reads `GET /api/desk`'s `heatmap.weeks` (the page's own `useDesk` data);
 * the grid scrolls sideways inside its own region, to the newest week.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { formatHeatmapDay, formatHeatmapWeekday, heatmapCellLabel, heatmapCountLine, toHeatmapColumns } from "../lib/deskHeatmap.ts";
import { HeatmapCells } from "./charts/heatmap/heatmap-cells.tsx";
import { HeatmapChart } from "./charts/heatmap/heatmap-chart.tsx";
import { readCssDurationMs, readCssPx } from "./charts/heatmap/heatmap-animation.ts";
import type { HeatmapBin } from "./charts/heatmap/heatmap-context.tsx";
import type { HeatmapLevelColors } from "./charts/heatmap/heatmap-colors.ts";
import { HeatmapTooltip } from "./charts/heatmap/heatmap-tooltip.tsx";
import type { DeskHeatmapDay } from "../../../src/types/api.ts";

const LEVEL_COLORS: HeatmapLevelColors = [
  "var(--color-heatmap-level-0)",
  "var(--color-heatmap-level-1)",
  "var(--color-heatmap-level-2)",
  "var(--color-heatmap-level-3)",
  "var(--color-heatmap-level-4)",
];
// Full class names, so Tailwind finds them.
const LEGEND: readonly { readonly label: string; readonly swatch: string }[] = [
  { label: "None", swatch: "bg-heatmap-level-0 border border-rim-structural" },
  { label: "Opened", swatch: "bg-heatmap-level-1 border border-rim-structural" },
  { label: "1–2", swatch: "bg-heatmap-level-2 border border-rim-structural" },
  { label: "3–4", swatch: "bg-heatmap-level-3 border border-rim-structural" },
  { label: "5+", swatch: "bg-heatmap-level-4 border border-rim-structural" },
];
const CELL_SIZE = 18;
const CELL_GAP = 4;

export interface DeskHeatmapProps {
  readonly weeks: readonly (readonly DeskHeatmapDay[])[];
}

export function DeskHeatmap({ weeks }: DeskHeatmapProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const data = useMemo(() => toHeatmapColumns(weeks), [weeks]);
  const cornerRadius = useMemo(() => readCssPx("--radius-xs"), []);
  // Room around the grid for the focus ring, which is drawn outside its cell: without it the svg clips the ring on the outer rows and columns.
  const margin = useMemo(() => {
    const m = Math.ceil(readCssPx("--focus-ring-width")) + 1;
    return { top: m, right: m, bottom: m, left: m };
  }, []);
  const regionRef = useRef<HTMLDivElement>(null);
  const enter = useMemo(() => {
    const ms = readCssDurationMs("--duration-heatmap-enter");
    return { ms, transition: { type: "tween" as const, duration: ms / 1000, ease: "easeOut" as const } };
  }, []);

  // Start at the newest week (the right edge).
  useLayoutEffect(() => {
    const el = regionRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data.length]);

  const cellLabel = (bin: HeatmapBin): string => heatmapCellLabel(bin.date, bin.count, bin.completed ?? 0);

  return (
    <>
      <div
        ref={regionRef}
        role="region"
        aria-label="Activity heatmap, scrollable"
        data-wheel-nav="off"
        data-animate={String(!reducedMotion)}
        className="overflow-x-auto pb-2"
      >
        <HeatmapChart
          data={data}
          ariaLabel="Activity, last 26 weeks"
          layout="fluid"
          binSize={CELL_SIZE}
          gap={CELL_GAP}
          margin={margin}
          levelColors={LEVEL_COLORS}
          animate={!reducedMotion}
          animationDuration={enter.ms}
          enterTransition={enter.transition}
          className="w-max"
        >
          <HeatmapCells cornerRadius={cornerRadius} cellLabel={cellLabel} hideGhostCells={false} inactiveOpacity={reducedMotion ? 1 : undefined} />
          <HeatmapTooltip
            instant={reducedMotion}
            formatDate={formatHeatmapDay}
            formatWeekday={formatHeatmapWeekday}
            formatLabel={(count, _date, completed) => heatmapCountLine(count, completed ?? 0)}
          />
        </HeatmapChart>
      </div>
      <div role="group" aria-labelledby="desk-heatmap-legend" className="flex flex-wrap items-center gap-x-4 gap-y-2 font-body text-small text-ink-secondary">
        <span id="desk-heatmap-legend">Tasks completed</span>
        <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0">
          {LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`inline-block size-3 rounded-xs ${l.swatch}`} />
              {l.label}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

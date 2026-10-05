"use client";

import { Group } from "@visx/group";
import { HeatmapRect } from "@visx/heatmap";
import {
  animate,
  type MotionValue,
  motion,
  type Transition,
  useMotionValue,
} from "motion/react";
import {
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChartStatus } from "../chart-phase";
import { transitionWithDelay } from "../motion-utils";
import {
  computeHeatmapEnterFadeDelayMs,
  HEATMAP_DEFAULT_ENTER_EASE,
  HEATMAP_LOADING_BASE_CELL_OPACITY,
  HEATMAP_LOADING_CONCEAL_MS,
  heatmapLoadingCellParticipates,
  readCssCubicBezier,
  readCssDurationMs,
  readCssPx,
  resolveHeatmapEnterFadeDurationSec,
} from "./heatmap-animation";
import { heatmapLevelCellFillOpacity } from "./heatmap-colors";
import {
  type HeatmapBin,
  type HeatmapColumn,
  useHeatmap,
  useHeatmapInteraction,
} from "./heatmap-context";
import { moveHeatmapFocus } from "./heatmap-focus";
import {
  getHeatmapContributionLevel,
  isHeatmapGhostBin,
  isHeatmapHoverEffectEnabled,
  resolveHeatmapDisplayRange,
  resolveHeatmapHoverStyle,
  resolveHeatmapRowOpacity,
} from "./heatmap-utils";

const HEATMAP_INACTIVE_OPACITY = 0.3;
/** Smooth tween for inactive opacity + scale on hover. */
// Yoh: the duration and ease are the --duration-control / --ease-control tokens (were 0.22 and a literal ease).
function inactiveTransition() {
  return {
    duration: readCssDurationMs("--duration-control") / 1000,
    ease: readCssCubicBezier("--ease-control"),
  };
}
const HEATMAP_CONCEAL_TRANSITION = {
  duration: HEATMAP_LOADING_CONCEAL_MS / 1000,
  ease: HEATMAP_DEFAULT_ENTER_EASE,
};

function computeHeatmapCellFaded(
  isCellHovering: boolean,
  isLevelHovering: boolean,
  hoveredCell: { column: number; row: number } | null,
  hoveredLegendLevel: number | null,
  cell: { column: number; row: number },
  count: number
): { isHighlighted: boolean; isDimmed: boolean } {
  if (isCellHovering && hoveredCell) {
    const isHighlighted =
      hoveredCell.column === cell.column && hoveredCell.row === cell.row;
    return { isHighlighted, isDimmed: !isHighlighted };
  }
  if (isLevelHovering && hoveredLegendLevel !== null) {
    const isHighlighted =
      getHeatmapContributionLevel(count) === hoveredLegendLevel;
    return { isHighlighted, isDimmed: !isHighlighted };
  }
  return { isHighlighted: false, isDimmed: false };
}

interface SyncCellLayerParams {
  animateCells: boolean;
  chartStatus: ChartStatus;
  dataOpacity: MotionValue<number>;
  isAwaitingLoadingConceal: boolean;
  isExitingToLoading: boolean;
  isLoadingResting: boolean;
  isReadyResting: boolean;
  isRevealActive: boolean;
  participates: boolean;
  pulseOpacity: MotionValue<number>;
  readyDataOpacity: number;
  shimmerOpacity: MotionValue<number>;
  showLoadingCellsLayer: boolean;
  showShimmerPulse: boolean;
  staggeredTransition: Transition;
}

function syncHeatmapCellLayerOpacities(params: SyncCellLayerParams) {
  const {
    animateCells,
    chartStatus,
    dataOpacity,
    isAwaitingLoadingConceal,
    isExitingToLoading,
    isLoadingResting,
    isReadyResting,
    isRevealActive,
    participates,
    pulseOpacity,
    readyDataOpacity,
    shimmerOpacity,
    showLoadingCellsLayer,
    showShimmerPulse,
    staggeredTransition,
  } = params;

  if (!animateCells) {
    if (isReadyResting) {
      dataOpacity.set(readyDataOpacity);
      shimmerOpacity.set(0);
      pulseOpacity.set(0);
    } else if (chartStatus === "loading") {
      dataOpacity.set(0);
      pulseOpacity.set(0);
      shimmerOpacity.set(
        participates && showLoadingCellsLayer
          ? 0
          : HEATMAP_LOADING_BASE_CELL_OPACITY
      );
    }
    return;
  }

  if (isLoadingResting) {
    animate(dataOpacity, 0, { duration: 0 });
    if (!showShimmerPulse) {
      animate(shimmerOpacity, HEATMAP_LOADING_BASE_CELL_OPACITY, {
        duration: 0,
      });
    }
    return;
  }

  if (isRevealActive) {
    pulseOpacity.set(0);
    shimmerOpacity.set(0);
    animate(dataOpacity, readyDataOpacity, staggeredTransition);
    return;
  }

  if (isAwaitingLoadingConceal || isExitingToLoading) {
    animate(dataOpacity, 0, HEATMAP_CONCEAL_TRANSITION);
    animate(shimmerOpacity, 0, { duration: 0 });
    return;
  }

  if (isReadyResting) {
    animate(dataOpacity, readyDataOpacity, inactiveTransition());
    animate(shimmerOpacity, 0, { duration: 0 });
    pulseOpacity.set(0);
  }
}

export interface HeatmapCellsProps {
  /** Corner radius for each cell. Default: 2 */
  cornerRadius?: number;
  /** Override the default GitHub-style green color scale. */
  colorScale?: (count: number | null | undefined) => string;
  /** Opacity for inactive cells while hovering. Default: 0.3 */
  inactiveOpacity?: number;
  /** Scale for inactive cells while hovering. Default: 1 */
  inactiveScale?: number;
  /** Scale for the highlighted cell while hovering. Default: 1 */
  activeScale?: number;
  /** Per-row opacity multiplier (display row index). Default: 1 */
  rowOpacity?: number | readonly number[];
  /** Pointer hover + dimming. Default: true */
  interactive?: boolean;
  /** Hide out-of-range bins (GitHub-style ghost cells). Default: true */
  hideGhostCells?: boolean;
  /**
   * Yoh: accessible name of each cell (cells are `role="img"`). When set,
   * cells are keyboard-operable: one roving tab stop, arrows / Home / End,
   * tooltip on focus, Escape hides it.
   */
  cellLabel?: (bin: HeatmapBin) => string;
}

interface HeatmapCellRectProps {
  cell: {
    column: number;
    row: number;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    opacity?: number;
  };
  bin: HeatmapBin;
  cornerRadius: number;
  interactive: boolean;
  inactiveOpacity: number;
  inactiveScale: number;
  activeScale: number;
  rowOpacity: number | readonly number[] | undefined;
  hoverState: { isHighlighted: boolean; isDimmed: boolean };
  onEnter: (
    column: number,
    row: number,
    bin: HeatmapBin,
    x: number,
    y: number
  ) => void;
  onLeave: () => void;
  // Yoh: keyboard focus, roving tab stop and labels.
  label?: string;
  tabIndexValue?: 0 | -1;
  isFocused: boolean;
  onBlurCell: () => void;
  onFocusCell: (
    column: number,
    row: number,
    bin: HeatmapBin,
    x: number,
    y: number
  ) => void;
  onKeyDownCell: (
    event: KeyboardEvent<SVGRectElement>,
    column: number,
    row: number
  ) => void;
  registerCell: (column: number, row: number, el: SVGRectElement | null) => void;
}

const HeatmapMotionCell = memo(function HeatmapMotionCell({
  cell,
  bin,
  cornerRadius,
  fillScale,
  interactive,
  inactiveOpacity,
  inactiveScale,
  activeScale,
  rowOpacity,
  hoverState,
  onEnter,
  onLeave,
  label,
  tabIndexValue,
  isFocused,
  onBlurCell,
  onFocusCell,
  onKeyDownCell,
  registerCell,
}: HeatmapCellRectProps & {
  fillScale: (count: number | null | undefined) => string;
}) {
  const {
    chartStatus,
    chartPhase,
    isLoaded,
    revealMode,
    revealEpoch,
    animationDuration,
    enterTransition,
    enterStaggerScale,
    animateCells,
    showLoadingCells: showLoadingCellsLayer,
    loadingCellMaxOpacity,
    loadingCellRandomness,
    levelStyles,
  } = useHeatmap();

  const level = getHeatmapContributionLevel(bin.count ?? 0);
  const levelStyle = levelStyles[level] ?? levelStyles[0];
  const targetFill = fillScale(bin.count);
  const emptyFill = fillScale(0);
  const patternFillOpacity = heatmapLevelCellFillOpacity(levelStyle);
  const dataOpacity = useMotionValue(0);
  /** Orchestration layer: conceal, static loading base. */
  const shimmerOpacity = useMotionValue(0);
  /** Pulse loop only — kept separate so stagger tweens don't break re-entry. */
  const pulseOpacity = useMotionValue(0);
  const wasShimmerPulsingRef = useRef(false);

  const isLoadingResting =
    chartStatus === "loading" && chartPhase === "loading";
  const isAwaitingLoadingConceal =
    chartStatus === "loading" && chartPhase === "ready";
  const isExitingToLoading = chartPhase === "exitingReady";
  const isRevealActive =
    chartPhase === "revealing" &&
    !isLoaded &&
    (revealMode === "fromLoading" || revealMode === "enter");
  const isReadyResting =
    chartStatus === "ready" && chartPhase === "ready" && isLoaded;

  const participates = useMemo(
    () =>
      heatmapLoadingCellParticipates(
        cell.column,
        cell.row,
        loadingCellRandomness
      ),
    [cell.column, cell.row, loadingCellRandomness]
  );

  const showShimmerPulse =
    animateCells && showLoadingCellsLayer && participates && isLoadingResting;

  const fadeDurationSec = resolveHeatmapEnterFadeDurationSec(
    enterTransition,
    animationDuration
  );
  const delayMs = computeHeatmapEnterFadeDelayMs({
    column: cell.column,
    row: cell.row,
    revealEpoch,
    animationDurationMs: animationDuration,
    enterStaggerScale,
    fadeDurationSec,
  });
  const staggeredTransition = transitionWithDelay(
    enterTransition,
    delayMs / 1000
  );

  const readyHoverStyle = resolveHeatmapHoverStyle(
    hoverState.isHighlighted,
    hoverState.isDimmed,
    { inactiveOpacity, inactiveScale, activeScale }
  );
  const rowOpacityMultiplier = resolveHeatmapRowOpacity(cell.row, rowOpacity);
  const readyDataOpacity = readyHoverStyle.opacity;
  const readyScale = isReadyResting ? readyHoverStyle.scale : 1;
  const transformOrigin = `${cell.x + cell.width / 2}px ${cell.y + cell.height / 2}px`;

  useEffect(() => {
    if (!showShimmerPulse) {
      wasShimmerPulsingRef.current = false;
      pulseOpacity.set(0);
      return;
    }

    const isFreshLoadingPulse =
      isLoadingResting && !wasShimmerPulsingRef.current;
    wasShimmerPulsingRef.current = true;

    if (isFreshLoadingPulse) {
      pulseOpacity.set(0);
    }

    let cancelled = false;
    let current: ReturnType<typeof animate> | undefined;

    const pulse = async () => {
      while (!cancelled) {
        const target = Math.random() * loadingCellMaxOpacity;
        const duration = 0.35 + Math.random() * 0.85;
        current = animate(pulseOpacity, target, {
          duration,
          ease: [0.45, 0, 0.55, 1],
        });

        try {
          await current;
        } catch {
          break;
        }

        if (cancelled) {
          break;
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 80 + Math.random() * 420);
        });
      }
    };

    pulse().catch(() => undefined);

    return () => {
      cancelled = true;
      current?.stop();
    };
  }, [isLoadingResting, loadingCellMaxOpacity, pulseOpacity, showShimmerPulse]);

  useEffect(() => {
    syncHeatmapCellLayerOpacities({
      animateCells,
      chartStatus,
      dataOpacity,
      isAwaitingLoadingConceal,
      isExitingToLoading,
      isLoadingResting,
      isReadyResting,
      isRevealActive,
      participates,
      pulseOpacity,
      readyDataOpacity,
      shimmerOpacity,
      showLoadingCellsLayer,
      showShimmerPulse,
      staggeredTransition,
    });
  }, [
    animateCells,
    chartStatus,
    dataOpacity,
    isAwaitingLoadingConceal,
    isExitingToLoading,
    isLoadingResting,
    isReadyResting,
    isRevealActive,
    participates,
    pulseOpacity,
    readyDataOpacity,
    shimmerOpacity,
    showLoadingCellsLayer,
    showShimmerPulse,
    staggeredTransition,
  ]);

  // Yoh: half the ring width plus half the 1px rim: the ring's inner edge meets the rim's outer edge.
  const ringOffset = useMemo(() => readCssPx("--focus-ring-width") / 2 + 0.5, []);

  const cellProps = {
    className: "visx-heatmap-rect",
    height: cell.height,
    rx: cornerRadius,
    ry: cornerRadius,
    width: cell.width,
    x: cell.x,
    y: cell.y,
  };

  return (
    <motion.g
      animate={{ scale: readyScale }}
      style={{ transformOrigin }}
      transition={inactiveTransition()}
    >
      <motion.rect
        {...cellProps}
        fill={targetFill}
        fillOpacity={
          (cell.opacity ?? 1) * patternFillOpacity * rowOpacityMultiplier
        }
        onPointerEnter={() =>
          onEnter(cell.column, cell.row, bin, cell.x, cell.y)
        }
        onPointerLeave={onLeave}
        // Yoh: role, name, roving tab stop, keys and focus ring.
        {...(label === undefined
          ? {}
          : {
              "aria-label": label,
              onBlur: onBlurCell,
              onFocus: () => onFocusCell(cell.column, cell.row, bin, cell.x, cell.y),
              onKeyDown: (event: KeyboardEvent<SVGRectElement>) =>
                onKeyDownCell(event, cell.column, cell.row),
              ref: (el: SVGRectElement | null) =>
                registerCell(cell.column, cell.row, el),
              role: "img",
              tabIndex: tabIndexValue,
            })}
        // Yoh: every cell has a rim (--color-rim-structural), so its edge
        // reads against the card at any level; the focus ring is the
        // separate rect below, outside the cell.
        stroke="var(--color-rim-structural)"
        style={{
          cursor: interactive ? "pointer" : undefined,
          opacity: dataOpacity,
          outline: "none",
        }}
        strokeWidth={1}
      />
      {isFocused ? (
        // Yoh: the focus ring, drawn outside the cell (past the rim's outer
        // half) so it sits on the card, never on the cell's fill.
        <rect
          className="visx-heatmap-focus-ring"
          data-heatmap-focus-ring=""
          fill="none"
          height={cell.height + 2 * ringOffset}
          pointerEvents="none"
          rx={cornerRadius + ringOffset}
          ry={cornerRadius + ringOffset}
          stroke="var(--color-accent-solid)"
          strokeWidth="var(--focus-ring-width)"
          width={cell.width + 2 * ringOffset}
          x={cell.x - ringOffset}
          y={cell.y - ringOffset}
        />
      ) : null}
      <motion.rect
        {...cellProps}
        fill={emptyFill}
        pointerEvents="none"
        style={{
          opacity: showShimmerPulse ? pulseOpacity : shimmerOpacity,
        }}
      />
    </motion.g>
  );
});

export const HeatmapCells = memo(function HeatmapCells({
  cornerRadius = 2,
  colorScale: colorScaleProp,
  inactiveOpacity = HEATMAP_INACTIVE_OPACITY,
  inactiveScale = 1,
  activeScale = 1,
  rowOpacity,
  interactive = true,
  hideGhostCells = true,
  cellLabel,
}: HeatmapCellsProps) {
  const {
    data,
    binWidth,
    binHeight,
    gap,
    margin,
    xScale,
    yScale,
    chartStatus,
    colorScale: contextColorScale,
    fillScale: contextFillScale,
  } = useHeatmap();
  const colorScale = colorScaleProp ?? contextColorScale;
  const fillScale = contextFillScale;
  const cellsInteractive = interactive && chartStatus !== "loading";
  const {
    hoveredCell,
    hoveredLegendLevel,
    setHoveredCell,
    setHoveredLegendLevel,
    setTooltipData,
  } = useHeatmapInteraction();

  const handleCellEnter = useCallback(
    (column: number, row: number, bin: HeatmapBin, x: number, y: number) => {
      if (!cellsInteractive) {
        return;
      }

      setHoveredLegendLevel(null);
      setHoveredCell({ column, row });
      setTooltipData({
        column,
        row,
        count: bin.count,
        completed: bin.completed, // Yoh
        date: bin.date,
        x: margin.left + x + binWidth / 2,
        y: margin.top + y + binHeight / 2,
      });
    },
    [
      binHeight,
      binWidth,
      cellsInteractive,
      margin.left,
      margin.top,
      setHoveredCell,
      setHoveredLegendLevel,
      setTooltipData,
    ]
  );

  // Yoh: the focused cell's coordinates, so its tooltip can be shown again
  // (pointer leaves) or refreshed (data changes) while it holds focus.
  const focusedArgs = useRef<{
    column: number;
    row: number;
    x: number;
    y: number;
  } | null>(null);
  const enterRef = useRef(handleCellEnter);
  enterRef.current = handleCellEnter;

  const handleCellLeave = useCallback(() => {
    if (!cellsInteractive) {
      return;
    }

    const held = focusedArgs.current;
    const heldBin = held ? data[held.column]?.bins[held.row] : undefined;
    if (held && heldBin) {
      // A cell holds keyboard focus: its tooltip stays.
      enterRef.current(held.column, held.row, heldBin, held.x, held.y);
      return;
    }
    setHoveredCell(null);
    setTooltipData(null);
  }, [cellsInteractive, data, setHoveredCell, setTooltipData]);

  // Yoh: after the data changes, the focused cell's tooltip shows the current count.
  useEffect(() => {
    const held = focusedArgs.current;
    const heldBin = held ? data[held.column]?.bins[held.row] : undefined;
    if (held && heldBin) {
      enterRef.current(held.column, held.row, heldBin, held.x, held.y);
    }
  }, [data]);

  // Yoh: roving focus. `focusedCell` is the last focused cell (the one tab
  // stop); until then it is today's cell, the last day of the last column.
  const [focusedCell, setFocusedCell] = useState<{
    column: number;
    row: number;
  } | null>(null);
  const [ringCell, setRingCell] = useState<{
    column: number;
    row: number;
  } | null>(null);
  const cellElements = useRef(new Map<string, SVGRectElement>());
  const tabStop = useMemo(() => {
    if (focusedCell && data[focusedCell.column]?.bins[focusedCell.row]) {
      return focusedCell;
    }
    const lastColumn = data.length - 1;
    const lastRow = (data[lastColumn]?.bins.length ?? 1) - 1;
    return lastColumn >= 0 ? { column: lastColumn, row: lastRow } : null;
  }, [data, focusedCell]);

  const registerCell = useCallback(
    (column: number, row: number, el: SVGRectElement | null) => {
      const key = `${column}-${row}`;
      if (el) {
        cellElements.current.set(key, el);
      } else {
        cellElements.current.delete(key);
      }
    },
    []
  );

  const handleCellFocus = useCallback(
    (column: number, row: number, bin: HeatmapBin, x: number, y: number) => {
      setFocusedCell({ column, row });
      setRingCell({ column, row });
      focusedArgs.current = { column, row, x, y };
      handleCellEnter(column, row, bin, x, y);
      cellElements.current
        .get(`${column}-${row}`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    },
    [handleCellEnter]
  );

  const handleCellBlur = useCallback(() => {
    setRingCell(null);
    focusedArgs.current = null;
    handleCellLeave();
  }, [handleCellLeave]);

  const handleCellKeyDown = useCallback(
    (event: KeyboardEvent<SVGRectElement>, column: number, row: number) => {
      if (event.key === "Escape") {
        focusedArgs.current = null;
        setHoveredCell(null);
        setTooltipData(null);
        return;
      }
      const next = moveHeatmapFocus(data, { column, row }, event.key);
      if (!next) {
        return;
      }
      event.preventDefault();
      if (next.column !== column || next.row !== row) {
        cellElements.current.get(`${next.column}-${next.row}`)?.focus();
      }
    },
    [data, setHoveredCell, setTooltipData]
  );

  const inactiveEnabled = isHeatmapHoverEffectEnabled({
    inactiveOpacity,
    inactiveScale,
    activeScale,
  });
  const isCellHovering =
    cellsInteractive && hoveredCell !== null && inactiveEnabled;
  const isLevelHovering =
    cellsInteractive && hoveredLegendLevel !== null && inactiveEnabled;

  const displayRange = useMemo(
    () => (hideGhostCells ? resolveHeatmapDisplayRange(data) : null),
    [data, hideGhostCells]
  );

  return (
    <HeatmapRect<HeatmapColumn, HeatmapBin>
      binHeight={binHeight}
      bins={(column) => column.bins}
      binWidth={binWidth}
      colorScale={(count) =>
        colorScale(typeof count === "number" ? count : count?.valueOf())
      }
      count={(bin) => bin.count}
      data={data}
      gap={gap}
      xScale={xScale}
      yScale={yScale}
    >
      {(cells) => (
        <Group className="visx-heatmap-rects">
          {cells.flatMap((column) =>
            column.map((cell) => {
              const bin = data[cell.column]?.bins[cell.row];
              if (!bin) {
                return null;
              }

              if (displayRange && isHeatmapGhostBin(bin, displayRange)) {
                return null;
              }

              const hoverState = computeHeatmapCellFaded(
                isCellHovering,
                isLevelHovering,
                hoveredCell,
                hoveredLegendLevel,
                cell,
                bin.count
              );

              return (
                <HeatmapMotionCell
                  activeScale={activeScale}
                  bin={bin}
                  cell={cell}
                  cornerRadius={cornerRadius}
                  fillScale={fillScale}
                  hoverState={hoverState}
                  inactiveOpacity={inactiveOpacity}
                  inactiveScale={inactiveScale}
                  interactive={cellsInteractive}
                  key={`heatmap-cell-${cell.column}-${cell.row}`}
                  isFocused={
                    ringCell?.column === cell.column && ringCell.row === cell.row
                  }
                  label={cellLabel?.(bin)}
                  onEnter={handleCellEnter}
                  onFocusCell={handleCellFocus}
                  onKeyDownCell={handleCellKeyDown}
                  onBlurCell={handleCellBlur}
                  onLeave={handleCellLeave}
                  registerCell={registerCell}
                  rowOpacity={rowOpacity}
                  tabIndexValue={
                    tabStop?.column === cell.column && tabStop.row === cell.row
                      ? 0
                      : -1
                  }
                />
              );
            })
          )}
        </Group>
      )}
    </HeatmapRect>
  );
});

HeatmapCells.displayName = "HeatmapCells";

export default HeatmapCells;

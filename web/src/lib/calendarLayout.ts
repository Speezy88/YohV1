/**
 * web/src/lib/calendarLayout.ts
 *
 * Polish-1 ("side-by-side calendar events"): `CalendarDayView.tsx` used to
 * position every block with `left: CONTENT_LEFT_PX, right: 8px` — full lane
 * width, always — so two overlapping events drew directly on top of each
 * other (the live-app bug). This is the Google-Calendar-style fix: a pure,
 * framework-free "sweep + first-fit column" layout that assigns each
 * overlapping interval a `column` index and its cluster's `columnCount`, so
 * `CalendarDayView.tsx` can split the lane width evenly among them instead.
 *
 * Pure and DOM-free by design — `CalendarDayView.tsx` is the sole caller,
 * already holding each block's start/end as HOST-timezone pixel offsets
 * (`isoOffsetPx`) by the time this runs, so this only ever sees plain
 * numeric intervals, never a Date or a timezone.
 */

export interface LayoutInterval {
  readonly id: string;
  /** Start, in the same numeric unit as `end` (pixels, in `CalendarDayView.tsx`'s case) — never a Date/ISO string. */
  readonly start: number;
  readonly end: number;
}

export interface ColumnPlacement {
  /** This interval's own column, 0-indexed, within its overlap cluster. */
  readonly column: number;
  /** The cluster's total column count — every interval in the same cluster gets the SAME `columnCount`, even ones that don't directly overlap each other (only transitively, through a third interval), matching Google Calendar's own behavior. */
  readonly columnCount: number;
}

/**
 * Assigns each interval a column index and its cluster's total column
 * count, so overlapping intervals divide their width evenly (`column` /
 * `columnCount`) instead of drawing on top of one another.
 *
 * Two touching-but-not-overlapping intervals (one ends exactly when the
 * next starts) are NOT considered overlapping — each gets its own
 * `columnCount: 1`, full width, per this task's own brief ("never drawn on
 * top of each other" — a shared edge isn't an overlap).
 *
 * Classic sweep-line "first-fit column" algorithm: sort by start (then end,
 * for a stable tie-break), and place each interval in the first column
 * whose most-recently-placed interval already ended at or before this one's
 * start; open a new column if none is free. A cluster closes out — flushing
 * every interval placed so far with the FINAL column count reached — the
 * moment an interval starts at or after every open column's current end,
 * i.e. a genuine gap with nothing still "in the air". This means two
 * intervals that never directly overlap each other can still end up in the
 * same cluster (and so share a `columnCount`) if a THIRD interval overlaps
 * both — the same transitive-cluster behavior Google Calendar's own layout
 * has.
 */
export function layoutOverlappingIntervals(intervals: readonly LayoutInterval[]): ReadonlyMap<string, ColumnPlacement> {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const placements = new Map<string, number>();
  const result = new Map<string, ColumnPlacement>();

  let columnEnds: number[] = [];
  let cluster: LayoutInterval[] = [];
  let clusterMaxEnd = -Infinity;

  const flushCluster = (): void => {
    const columnCount = columnEnds.length;
    for (const item of cluster) {
      result.set(item.id, { column: placements.get(item.id)!, columnCount });
    }
    cluster = [];
    columnEnds = [];
    clusterMaxEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterMaxEnd) {
      flushCluster();
    }

    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.end);
    } else {
      columnEnds[column] = item.end;
    }

    placements.set(item.id, column);
    cluster.push(item);
    clusterMaxEnd = Math.max(clusterMaxEnd, item.end);
  }
  if (cluster.length > 0) flushCluster();

  return result;
}

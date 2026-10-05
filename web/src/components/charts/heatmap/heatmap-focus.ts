// Yoh: added file (not from Bklit). Pure keyboard movement over a week-column
// grid: up/down move by day, left/right by week, Home/End jump to the first
// and last day. Focus never lands on a missing cell: a short column clamps
// the row to its last day, and a move off the grid stays put.
export interface HeatmapFocusCell {
  readonly column: number;
  readonly row: number;
}

export function moveHeatmapFocus(
  data: readonly { readonly bins: readonly unknown[] }[],
  from: HeatmapFocusCell,
  key: string
): HeatmapFocusCell | null {
  const lastColumn = data.length - 1;
  if (lastColumn < 0) {
    return null;
  }
  const lastRowOf = (column: number): number =>
    Math.max((data[column]?.bins.length ?? 1) - 1, 0);
  switch (key) {
    case "ArrowUp":
      return { column: from.column, row: Math.max(from.row - 1, 0) };
    case "ArrowDown":
      return {
        column: from.column,
        row: Math.min(from.row + 1, lastRowOf(from.column)),
      };
    case "ArrowLeft":
      return from.column <= 0
        ? from
        : {
            column: from.column - 1,
            row: Math.min(from.row, lastRowOf(from.column - 1)),
          };
    case "ArrowRight":
      return from.column >= lastColumn
        ? from
        : {
            column: from.column + 1,
            row: Math.min(from.row, lastRowOf(from.column + 1)),
          };
    case "Home":
      return { column: 0, row: 0 };
    case "End":
      return { column: lastColumn, row: lastRowOf(lastColumn) };
    default:
      return null;
  }
}

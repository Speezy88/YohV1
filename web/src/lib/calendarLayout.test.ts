/**
 * web/src/lib/calendarLayout.test.ts — polish-1 "side-by-side calendar
 * events": pure unit tests for the column-assignment algorithm, independent
 * of pixel positioning, timezone formatting, or React rendering (those are
 * covered separately in `CalendarDayView.test.tsx`).
 */
import { describe, it, expect } from "vitest";
import { layoutOverlappingIntervals } from "./calendarLayout.ts";

describe("layoutOverlappingIntervals", () => {
  it("a single interval gets its own full-width column", () => {
    const result = layoutOverlappingIntervals([{ id: "a", start: 0, end: 10 }]);
    expect(result.get("a")).toEqual({ column: 0, columnCount: 1 });
  });

  it("two non-overlapping intervals each get their own full-width column", () => {
    const result = layoutOverlappingIntervals([
      { id: "a", start: 0, end: 10 },
      { id: "b", start: 20, end: 30 },
    ]);
    expect(result.get("a")).toEqual({ column: 0, columnCount: 1 });
    expect(result.get("b")).toEqual({ column: 0, columnCount: 1 });
  });

  it("two touching (not overlapping) intervals — one ends exactly when the next starts — are NOT treated as overlapping", () => {
    const result = layoutOverlappingIntervals([
      { id: "a", start: 0, end: 10 },
      { id: "b", start: 10, end: 20 },
    ]);
    expect(result.get("a")).toEqual({ column: 0, columnCount: 1 });
    expect(result.get("b")).toEqual({ column: 0, columnCount: 1 });
  });

  it("two overlapping intervals split into two columns", () => {
    const result = layoutOverlappingIntervals([
      { id: "a", start: 0, end: 10 },
      { id: "b", start: 5, end: 15 },
    ]);
    expect(result.get("a")).toEqual({ column: 0, columnCount: 2 });
    expect(result.get("b")).toEqual({ column: 1, columnCount: 2 });
  });

  it("three mutually overlapping intervals split into three columns", () => {
    const result = layoutOverlappingIntervals([
      { id: "a", start: 0, end: 10 },
      { id: "b", start: 2, end: 12 },
      { id: "c", start: 4, end: 14 },
    ]);
    expect(result.get("a")).toEqual({ column: 0, columnCount: 3 });
    expect(result.get("b")).toEqual({ column: 1, columnCount: 3 });
    expect(result.get("c")).toEqual({ column: 2, columnCount: 3 });
  });

  it("input order doesn't matter — the same overlap set produces the same columnCount regardless of array order", () => {
    const forward = layoutOverlappingIntervals([
      { id: "a", start: 0, end: 10 },
      { id: "b", start: 2, end: 12 },
      { id: "c", start: 4, end: 14 },
    ]);
    const reversed = layoutOverlappingIntervals([
      { id: "c", start: 4, end: 14 },
      { id: "b", start: 2, end: 12 },
      { id: "a", start: 0, end: 10 },
    ]);
    expect(forward.get("a")!.columnCount).toBe(3);
    expect(reversed.get("a")!.columnCount).toBe(3);
    expect(reversed.get("b")!.columnCount).toBe(3);
    expect(reversed.get("c")!.columnCount).toBe(3);
  });

  it("a column frees up once its occupant ends, so a THIRD interval starting after the first ends reuses column 0 rather than opening a third column", () => {
    // a: 0-10 (col 0), b: 5-15 (col 1, overlaps a), c: 10-20 (a already ended by 10, so c reuses col 0)
    const result = layoutOverlappingIntervals([
      { id: "a", start: 0, end: 10 },
      { id: "b", start: 5, end: 15 },
      { id: "c", start: 10, end: 20 },
    ]);
    expect(result.get("a")).toEqual({ column: 0, columnCount: 2 });
    expect(result.get("b")).toEqual({ column: 1, columnCount: 2 });
    expect(result.get("c")).toEqual({ column: 0, columnCount: 2 });
  });

  it("two separate overlap clusters, with a genuine gap between them, get independent columnCounts", () => {
    const result = layoutOverlappingIntervals([
      { id: "a", start: 0, end: 10 },
      { id: "b", start: 2, end: 12 },
      { id: "c", start: 4, end: 14 }, // cluster 1: a/b/c mutually overlap -> 3 columns
      { id: "d", start: 100, end: 110 },
      { id: "e", start: 105, end: 115 }, // cluster 2: d/e overlap -> 2 columns, independent of cluster 1
    ]);
    expect(result.get("a")!.columnCount).toBe(3);
    expect(result.get("b")!.columnCount).toBe(3);
    expect(result.get("c")!.columnCount).toBe(3);
    expect(result.get("d")).toEqual({ column: 0, columnCount: 2 });
    expect(result.get("e")).toEqual({ column: 1, columnCount: 2 });
  });

  it("a transitive overlap (a overlaps c, b overlaps c, but a and b don't overlap each other) still shares one cluster/columnCount, like Google Calendar", () => {
    const result = layoutOverlappingIntervals([
      { id: "a", start: 0, end: 10 },
      { id: "c", start: 5, end: 25 },
      { id: "b", start: 20, end: 30 },
    ]);
    // a and b never overlap directly, but both overlap c, so all three share one cluster.
    expect(result.get("a")!.columnCount).toBe(2);
    expect(result.get("b")!.columnCount).toBe(2);
    expect(result.get("c")!.columnCount).toBe(2);
  });

  it("an empty input returns an empty map", () => {
    expect(layoutOverlappingIntervals([]).size).toBe(0);
  });
});

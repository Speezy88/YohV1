import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import type { ReactNode } from "react";
import { movedStartIso, snapDragMinutes, useBlockDrag } from "./useBlockDrag.ts";

describe("snapDragMinutes", () => {
  it("snaps a vertical offset to 5-minute steps over the hour height", () => {
    expect(snapDragMinutes(72, 72)).toBe(60);
    expect(snapDragMinutes(-72, 72)).toBe(-60);
    // 20px at 72px/hour = 16.7 min -> 15
    expect(snapDragMinutes(20, 72)).toBe(15);
    // 2px = 1.7 min -> 0
    expect(snapDragMinutes(2, 72)).toBe(0);
  });
});

describe("movedStartIso", () => {
  it("adds the snapped offset to the block's own start", () => {
    expect(movedStartIso("2026-09-29T14:00:00.000Z", 72, 72)).toBe("2026-09-29T15:00:00.000Z");
    expect(movedStartIso("2026-09-29T14:00:00.000Z", -36, 72)).toBe("2026-09-29T13:30:00.000Z");
  });
});

describe("useBlockDrag", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <DragDropProvider>{children}</DragDropProvider>;

  it("returns a ref and is not dragging at rest", () => {
    const { result } = renderHook(() => useBlockDrag({ id: "v1-work-0", disabled: false }), { wrapper });
    expect(typeof result.current.ref).toBe("function");
    expect(result.current.isDragging).toBe(false);
  });
});

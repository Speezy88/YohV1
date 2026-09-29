/**
 * web/src/hooks/useBlockDrag.ts
 *
 * Epic 10 T8b: the ONE drag hook for Home's calendar. A work or routine
 * block is a `@dnd-kit/react` draggable; releasing it turns the vertical
 * offset into a new start time, snapped to 5 minutes, which the caller sends
 * as a `move-block` reshuffle request (R6: drag = pin). Pointer and keyboard
 * sensors are both configured (`blockDragSensors`) so a drag is operable
 * without a pointer (WCAG 2.5.7).
 */
import { useDraggable, KeyboardSensor, PointerSensor } from "@dnd-kit/react";

export const DRAG_SNAP_MINUTES = 5;

/** A vertical offset in pixels, as whole minutes snapped to `DRAG_SNAP_MINUTES`. */
export function snapDragMinutes(deltaPx: number, hourHeightPx: number): number {
  const minutes = (deltaPx / hourHeightPx) * 60;
  const snapped = Math.round(minutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
  return snapped === 0 ? 0 : snapped;
}

/** The block's start moved by the snapped offset, as an ISO instant. */
export function movedStartIso(startIso: string, deltaPx: number, hourHeightPx: number): string {
  return new Date(Date.parse(startIso) + snapDragMinutes(deltaPx, hourHeightPx) * 60_000).toISOString();
}

/** Sensors for the calendar's `DragDropProvider`: pointer (its default activation constraints keep a plain click a click) and keyboard (one arrow press = one snap step). */
export function blockDragSensors(hourHeightPx: number) {
  return [
    PointerSensor,
    KeyboardSensor.configure({ offset: { x: 0, y: (hourHeightPx * DRAG_SNAP_MINUTES) / 60 } }),
  ];
}

export interface UseBlockDragInput {
  readonly id: string;
  /** True for blocks that can't move: breaks, fixed events, past or completed blocks, or any block while a preview is open. */
  readonly disabled: boolean;
}

export function useBlockDrag({ id, disabled }: UseBlockDragInput): { readonly ref: (element: Element | null) => void; readonly isDragging: boolean } {
  const { ref, isDragging } = useDraggable({ id, disabled });
  return { ref, isDragging };
}

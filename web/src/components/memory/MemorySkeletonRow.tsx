/**
 * web/src/components/memory/MemorySkeletonRow.tsx — Polish 6 (Task 11). The one
 * Memory skeleton row (a list-row-sized block; pass `className` to size it as a
 * rail row instead), plus the Memory surfaces' shared copy and write-note class.
 * Pulses unless the user prefers reduced motion.
 */
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";

/** Shown wherever a Memory surface cannot load (the one definition). */
export const MEMORY_LOAD_ERROR = "Couldn't load memory right now.";

/** The inline write-error note: used with `role="alert"` (same as MemoryItemRow / NeedsReviewPane). */
export const MEMORY_WRITE_NOTE_CLASS = "m-0 font-body text-small font-bold text-ink-danger";

export function MemorySkeletonRow({ className = "h-[74px] rounded-lg" }: { readonly className?: string }): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  return <div data-testid="memory-skeleton" className={`bg-surface-sunken ${className} ${reducedMotion ? "" : "animate-pulse"}`} />;
}

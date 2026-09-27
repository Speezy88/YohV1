/**
 * web/src/components/ThinkingIndicator.tsx
 *
 * Story 8.5, DESIGN.md `thinking-indicator`, UX-DR37: a dot-matrix loader
 * plus live status text ("Thinking…", "Searching the web…"). It stands in
 * for a Yoh turn that has no text yet (`ChatMessage.tsx`), so it appears the
 * moment a turn is sent, before any response. The status text is a polite
 * live region (`role="status"`, as in `UndoToast.tsx`), announcing each
 * change without interrupting.
 *
 * OQ17: under full motion the text is `ink-primary` with the shimmer as a
 * translucent overlay sweep (`.thinking-shimmer` in `tokens.css`), so its
 * contrast never depends on the sweep's phase. Under reduced motion it's
 * static `ink-secondary` with no overlay, and the dots hold still.
 */
import { useReducedMotion } from "../hooks/useReducedMotion.ts";

export interface ThinkingIndicatorProps {
  readonly statusText: string;
}

export function ThinkingIndicator({ statusText }: ThinkingIndicatorProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <div data-testid="thinking-indicator" className="flex items-center gap-2 font-body text-body">
      <span aria-hidden="true" className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            data-testid="thinking-dot"
            className={`size-1.5 rounded-full bg-ink-secondary ${reducedMotion ? "opacity-60" : "thinking-dot"}`}
          />
        ))}
      </span>
      <span role="status" aria-live="polite">
        <span className={reducedMotion ? "text-ink-secondary" : "thinking-shimmer text-ink-primary"}>{statusText}</span>
      </span>
    </div>
  );
}

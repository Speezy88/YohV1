/**
 * web/src/hooks/useReducedMotion.ts
 *
 * Story 7.5, UX-DR49/Consistency Conventions' Web UI row: the ONE flag
 * every animation in `web/` reads. No component queries
 * `matchMedia("(prefers-reduced-motion: reduce)")` directly.
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** The plain, non-hook read — the one `matchMedia` call site every caller (hook or not) goes through. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * web/src/lib/navigationContext.tsx
 *
 * Story 7.7: exposes `PageShell`'s own `PageNavigation` (Story 7.6,
 * `usePageNavigation`) to a descendant that needs to navigate
 * programmatically — currently only `NotificationOverlay`'s deep-link
 * click. `PageShell` is the sole provider; requirement #3 ("deep links must
 * navigate within the app... keep the change minimal") is why this is a
 * plain context around the existing navigation API rather than a new
 * router or a second source of page-index truth.
 */
import { createContext, useContext } from "react";
import type { PageNavigation } from "./pages.ts";

export const PageNavigationContext = createContext<PageNavigation | undefined>(undefined);

/** Throws if rendered outside `PageShell`'s provider — never a silent no-op. */
export function usePageNavigationContext(): PageNavigation {
  const ctx = useContext(PageNavigationContext);
  if (!ctx) throw new Error("usePageNavigationContext: must be rendered within PageShell's PageNavigationContext.Provider");
  return ctx;
}

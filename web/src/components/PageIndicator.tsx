// web/src/components/PageIndicator.tsx — DESIGN.md `nav-sidebar` amendment
// (Task 6A, 2026-09-27): "page-indicator is retired with swipe navigation;
// replaced by nav-sidebar + arrow-button." The clickable dot row is gone —
// the sidebar's own links and up/down arrow buttons (`Sidebar.tsx`) now own
// navigation — but the accessible "Tasks, page 2 of 5" announcement on
// every page change is still useful, so it survives here as a
// visually-hidden `aria-live` region, mounted inside the sidebar.
import { PAGES } from "../lib/pages.ts";

export interface PageIndicatorProps {
  readonly index: number;
}

export function PageIndicator({ index }: PageIndicatorProps): React.JSX.Element {
  const current = PAGES[index]!;
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {current.label}, page {index + 1} of {PAGES.length}
    </span>
  );
}

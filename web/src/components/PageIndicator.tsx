// web/src/components/PageIndicator.tsx — DESIGN.md `page-indicator`,
// EXPERIENCE.md Component Patterns. `[ASSUMPTION: resolves UX OQ1]` bottom-
// center, unlabeled dots, each carrying its own accessible name. Dot sizing
// matches DESIGN.md exactly: 6px circle at ink-primary/35%, active dot a
// 16x6 rounded-xs 135deg accent-gradient pill.
import { PAGES } from "../lib/pages.ts";

export interface PageIndicatorProps {
  readonly index: number;
  goTo(index: number): void;
}

export function PageIndicator({ index, goTo }: PageIndicatorProps): React.JSX.Element {
  const current = PAGES[index]!;
  return (
    <nav aria-label="Pages" className="fixed inset-x-0 bottom-4 flex justify-center gap-2">
      {PAGES.map((page, i) => (
        <button
          key={page.id}
          type="button"
          onClick={() => goTo(i)}
          aria-label={page.label}
          {...(i === index ? { "aria-current": "page" as const } : {})}
          className={
            i === index
              ? "h-1.5 w-4 rounded-xs bg-gradient-to-r from-accent-gradient-start to-accent-gradient-end"
              : "size-1.5 rounded-full bg-ink-primary/35"
          }
        />
      ))}
      <span className="sr-only" aria-live="polite">
        {current.label}, page {index + 1} of {PAGES.length}
      </span>
    </nav>
  );
}

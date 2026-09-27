/**
 * web/src/components/Sidebar.tsx — Task 6A, DESIGN.md `nav-sidebar`, the
 * approved mockup's left column (Main/Tasks.dc.html).
 *
 * The Yoh wordmark, then a link per `PAGES` (icon + label, the active item
 * in the Sky→Azure gradient pill), then the on-screen up/down arrow
 * buttons (Spencer's IA decision: "the vertical stack navigation … with
 * up/down arrow buttons"), then the Theme Toggle at the bottom. Every link
 * and arrow is a plain `<button>` (client-side page switches, never a real
 * navigation), so Tab order and Enter/Space activation come for free. The
 * arrows disable, rather than wrap, at either end of the stack — arrow-key
 * navigation (`PageShell.tsx`) already "silently no-ops instead of
 * wrapping," so the on-screen control matches.
 *
 * `PageIndicator` (retired as a floating dot row, Task 6A) now lives here
 * purely as the visually-hidden `aria-live` page announcer.
 */
import { usePageNavigationContext } from "../lib/navigationContext.tsx";
import { PAGES } from "../lib/pages.ts";
import { PageIndicator } from "./PageIndicator.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { YohMark } from "./YohMark.tsx";

const PAGE_ICON_PATHS: Record<(typeof PAGES)[number]["id"], string> = {
  home: "M3 11l9-7 9 7 M5 10v10h14V10",
  tasks: "M9 6h11 M9 12h11 M9 18h11 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2",
  desk: "M3 4h18v12H3z M8 20h8 M12 16v4",
  research: "M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M20 20l-4.5-4.5",
};

const UP_ARROW_PATH = "M6 15l6-6 6 6";
const DOWN_ARROW_PATH = "M6 9l6 6 6-6";

/**
 * A purely decorative glyph (`aria-hidden`) whose stroke color comes from
 * `currentColor` — i.e. from the SAME token-driven `text-*` utility class
 * already on the wrapping button (`text-ink-secondary`/`text-on-accent-solid`
 * above), never a hard-coded color of its own. Used here rather than the
 * shared `Icon` component because every caller below already has its own
 * real accessible name (the nav label text, or the button's own
 * `aria-label`) — `Icon` requires a non-empty label of its own, which would
 * double-announce the same name to assistive tech.
 */
function DecorativeGlyph({ path }: { readonly path: string }): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" className="shrink-0">
      <path d={path} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar(): React.JSX.Element {
  const nav = usePageNavigationContext();
  const atFirst = nav.index === 0;
  const atLast = nav.index === PAGES.length - 1;

  return (
    <nav aria-label="Pages" className="flex h-full w-[248px] shrink-0 flex-col gap-2.5 p-8">
      <div className="flex items-center gap-3 px-2.5 pb-7">
        <YohMark className="size-10 rounded-lg shadow-extruded-sm" />
        <span className="font-wordmark text-[26px] font-extrabold tracking-tight text-ink-primary">Yoh</span>
      </div>

      {PAGES.map((page, i) => {
        const active = i === nav.index;
        return (
          <button
            key={page.id}
            type="button"
            onClick={() => nav.goTo(i)}
            aria-current={active ? "page" : undefined}
            className={
              "flex h-[54px] items-center gap-3.5 whitespace-nowrap rounded-lg px-4 font-body text-body font-medium " +
              (active
                ? "bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end font-bold text-on-accent-solid shadow-extruded-sm"
                : "text-ink-secondary hover:text-ink-primary")
            }
          >
            <DecorativeGlyph path={PAGE_ICON_PATHS[page.id]} />
            {page.label}
          </button>
        );
      })}

      <div className="flex gap-2.5 px-2 pt-4">
        <button
          type="button"
          onClick={nav.prev}
          disabled={atFirst}
          aria-label="Previous page"
          className="flex h-11 flex-1 items-center justify-center rounded-md border-[length:var(--rim-width)] border-rim-interactive bg-surface-base text-ink-secondary shadow-extruded-sm disabled:opacity-40 enabled:hover:text-accent-solid"
        >
          <DecorativeGlyph path={UP_ARROW_PATH} />
        </button>
        <button
          type="button"
          onClick={nav.next}
          disabled={atLast}
          aria-label="Next page"
          className="flex h-11 flex-1 items-center justify-center rounded-md border-[length:var(--rim-width)] border-rim-interactive bg-surface-base text-ink-secondary shadow-extruded-sm disabled:opacity-40 enabled:hover:text-accent-solid"
        >
          <DecorativeGlyph path={DOWN_ARROW_PATH} />
        </button>
      </div>

      <div className="grow" />
      <ThemeToggle />
      <PageIndicator index={nav.index} />
    </nav>
  );
}

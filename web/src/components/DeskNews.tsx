/**
 * web/src/components/DeskNews.tsx — Ruling E12-R22: the Business and AI news
 * widget. Each row is the title as a link (new tab, `noopener noreferrer`)
 * and `{source} · {date}` in the host zone. Titles are rendered as text only.
 * `stale` keeps the rows and swaps the caption for the unavailable line.
 */
import { DeskWidget, DeskWidgetSkeleton } from "./DeskWidget.tsx";
import { formatFeedDateTime, unavailableCaption } from "../lib/deskFeedFormat.ts";
import type { DeskFeedsState } from "../lib/deskFeeds.ts";

const CAPTION = "m-0 font-body text-small text-ink-secondary";
const TITLE = "Business and AI news";
const WIDE = "sm:col-span-2 lg:col-span-3";
const LINK =
  "font-body text-body font-bold text-ink-primary underline underline-offset-2 " +
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";

export function DeskNews({ state, reducedMotion }: { readonly state: DeskFeedsState; readonly reducedMotion: boolean }): React.JSX.Element {
  if (state.status === "loading") return <DeskWidgetSkeleton reducedMotion={reducedMotion} className={WIDE} />;
  if (state.status === "error") {
    return (
      <DeskWidget title={TITLE} className={WIDE}>
        <p className={CAPTION}>Unavailable</p>
      </DeskWidget>
    );
  }
  const { timeZone, news } = state.value;
  const items = news.status === "unavailable" ? undefined : news.value?.items;
  return (
    <DeskWidget title={TITLE} className={WIDE}>
      {items && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => (
            <li key={item.url} className="flex min-w-0 flex-col">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className={`${LINK} break-words`}>
                {item.title}
              </a>
              <span className={CAPTION}>
                {item.source} · {formatFeedDateTime(item.publishedAt, timeZone)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(news.status !== "ok" || items === undefined) && <p className={CAPTION}>{unavailableCaption(news.fetchedAt, timeZone)}</p>}
    </DeskWidget>
  );
}

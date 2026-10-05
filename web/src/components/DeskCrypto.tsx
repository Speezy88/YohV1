/**
 * web/src/components/DeskCrypto.tsx — Ruling E12-R22: the Crypto widget. One row
 * per coin (symbol, price, signed change), then a caption. `stale` keeps the
 * values and swaps the caption for the unavailable line; `unavailable` shows
 * only that line. A change is always signed in text, never by color alone.
 */
import { DeskWidget, DeskWidgetSkeleton } from "./DeskWidget.tsx";
import { formatChangePercent, formatFeedStamp, formatUsdPrice, unavailableCaption } from "../lib/deskFeedFormat.ts";
import type { DeskFeedsState } from "../lib/deskFeeds.ts";

const CAPTION = "m-0 font-body text-small text-ink-secondary";

export function DeskCrypto({ state, reducedMotion }: { readonly state: DeskFeedsState; readonly reducedMotion: boolean }): React.JSX.Element {
  if (state.status === "loading") return <DeskWidgetSkeleton reducedMotion={reducedMotion} />;
  if (state.status === "error") {
    return (
      <DeskWidget title="Crypto">
        <p className={CAPTION}>Unavailable</p>
      </DeskWidget>
    );
  }
  const { timeZone, crypto } = state.value;
  const tickers = crypto.status === "unavailable" ? undefined : crypto.value?.tickers;
  return (
    <DeskWidget title="Crypto">
      {tickers && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {tickers.map((t) => (
            <li key={t.symbol} className="flex items-baseline justify-between gap-3 font-body text-body tabular-nums text-ink-primary">
              <span className="font-bold">{t.symbol}</span>
              <span className="flex items-baseline gap-3">
                <span>{formatUsdPrice(t.priceUsd)}</span>
                <span className="min-w-[4.5ch] text-right text-ink-secondary">{formatChangePercent(t.changePercent)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={CAPTION}>
        {crypto.status === "ok" && crypto.fetchedAt
          ? `Kraken · change since 00:00 UTC · updated ${formatFeedStamp(crypto.fetchedAt, timeZone)}`
          : unavailableCaption(crypto.fetchedAt, timeZone)}
      </p>
    </DeskWidget>
  );
}

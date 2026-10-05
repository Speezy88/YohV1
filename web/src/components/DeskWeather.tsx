/**
 * web/src/components/DeskWeather.tsx — Ruling E12-R22: the Weather widget
 * (Seattle, from the National Weather Service). `stale` keeps the values and
 * swaps the caption for the unavailable line; `unavailable` shows only that line.
 */
import { DeskWidget, DeskWidgetSkeleton } from "./DeskWidget.tsx";
import { formatFeedStamp, unavailableCaption } from "../lib/deskFeedFormat.ts";
import type { DeskFeedsState } from "../lib/deskFeeds.ts";

const CAPTION = "m-0 font-body text-small text-ink-secondary";
const TITLE = "Weather · Seattle, WA";

export function DeskWeather({ state, reducedMotion }: { readonly state: DeskFeedsState; readonly reducedMotion: boolean }): React.JSX.Element {
  if (state.status === "loading") return <DeskWidgetSkeleton reducedMotion={reducedMotion} />;
  if (state.status === "error") {
    return (
      <DeskWidget title={TITLE}>
        <p className={CAPTION}>Unavailable</p>
      </DeskWidget>
    );
  }
  const { timeZone, weather } = state.value;
  const value = weather.status === "unavailable" ? undefined : weather.value;
  return (
    <DeskWidget title={TITLE}>
      {value && (
        <>
          <p className="m-0 font-body text-display font-bold tabular-nums text-ink-primary">{value.temperatureF}°F</p>
          <p className="m-0 font-body text-body text-ink-primary">{value.conditions}</p>
          {value.next && (
            <p className="m-0 font-body text-body text-ink-secondary">
              {value.next.name}: {value.next.temperatureF}°F, {value.next.summary}
            </p>
          )}
        </>
      )}
      <p className={CAPTION}>
        {weather.status === "ok" && weather.fetchedAt ? `National Weather Service · updated ${formatFeedStamp(weather.fetchedAt, timeZone)}` : unavailableCaption(weather.fetchedAt, timeZone)}
      </p>
    </DeskWidget>
  );
}

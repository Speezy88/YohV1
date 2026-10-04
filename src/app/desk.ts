/**
 * src/app/desk.ts
 *
 * Ruling E12-R3: the Desk page's records. `recordActivity` stamps today (in
 * the host timezone) as a day Yoh was opened, and returns that date and zone.
 * Ruling E12-R14: only `POST /api/activity`, sent on a real click or key, calls
 * it; polling and streams never do. Idempotent.
 */
import type { LogEntry } from "../adapters/logger.ts";
import {
  completedToday,
  heatmapWeeks,
  hoursWithYoh,
  minutesToday,
  monthlySpend,
  onTimeRate,
  streakOf,
  type DeskCompletionRow,
  type DeskUsageRow,
} from "../core/desk-metrics.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { localIsoDate } from "../core/local-time.ts";
import type { ActivityResponse, DeskResponse } from "../types/api.ts";
import type { IsoDate, Result, YohError } from "../types/domain.ts";

export interface DeskRecordDeps {
  readonly now: () => Date;
  readonly timeZone: string;
  /** Writes one activity day (`recordActivityDay`, bound). May throw. */
  readonly recordActivityDay: (date: IsoDate) => void;
}

/** `getDesk`'s reads: each may throw (converted to a failure Result). */
export interface DeskReadDeps {
  readonly now: () => Date;
  readonly timeZone: string;
  readonly listCompletions: () => readonly DeskCompletionRow[];
  readonly listActivityDays: () => readonly IsoDate[];
  readonly listPlanDates: () => readonly IsoDate[];
  readonly listCloseOutDates: () => readonly IsoDate[];
  readonly listUsage: () => readonly DeskUsageRow[];
  readonly log: (entry: LogEntry) => void;
}

/** The server's one Desk deps object: the activity-day write plus the page's reads. */
export type DeskDeps = DeskRecordDeps & Omit<DeskReadDeps, "log">;

/** Epic 12: everything the Desk page shows, computed from Yoh's own records. */
export async function getDesk(deps: DeskReadDeps, _input: Record<string, never>): Promise<Result<DeskResponse, YohError>> {
  try {
    const now = deps.now();
    const tz = deps.timeZone;
    const today = localIsoDate(now, tz);
    const completions = deps.listCompletions();
    const spend = monthlySpend(deps.listUsage(), now, tz);
    if (spend.unpricedCalls > 0) {
      deps.log({ level: "warn", event: "desk.unpriced-usage", detail: { unpricedCalls: spend.unpricedCalls } });
    }
    return {
      ok: true,
      value: {
        today,
        completedToday: completedToday(completions, today, tz),
        minutesToday: minutesToday(completions, today, tz),
        hoursWithYoh: hoursWithYoh(completions),
        onTime: onTimeRate(completions, tz),
        streak: streakOf(deps.listPlanDates(), deps.listCloseOutDates(), today),
        heatmap: { weeks: heatmapWeeks(completions, deps.listActivityDays(), today, tz) },
        spend,
      },
    };
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err) } };
  }
}

export async function recordActivity(deps: DeskRecordDeps, _input: Record<string, never>): Promise<Result<ActivityResponse, YohError>> {
  try {
    const date = localIsoDate(deps.now(), deps.timeZone);
    deps.recordActivityDay(date);
    return { ok: true, value: { date, timeZone: deps.timeZone } };
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err) } };
  }
}

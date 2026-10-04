/**
 * src/app/desk.ts
 *
 * Ruling E12-R3: the Desk page's records. `recordActivity` stamps today (in
 * the host timezone) as a day Yoh was opened. Idempotent; the caller decides
 * how often to call it.
 */
import { errorCopyForThrown } from "../core/error-copy.ts";
import { localIsoDate } from "../core/local-time.ts";
import type { IsoDate, Result, YohError } from "../types/domain.ts";

export interface DeskDeps {
  readonly now: () => Date;
  readonly timeZone: string;
  /** Writes one activity day (`recordActivityDay`, bound). May throw. */
  readonly recordActivityDay: (date: IsoDate) => void;
}

export async function recordActivity(deps: DeskDeps, _input: Record<string, never>): Promise<Result<{ date: IsoDate }, YohError>> {
  try {
    const date = localIsoDate(deps.now(), deps.timeZone);
    deps.recordActivityDay(date);
    return { ok: true, value: { date } };
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err) } };
  }
}

/**
 * src/adapters/calendar-adapter.ts
 *
 * Owns Yoh's read surface onto Spencer's primary Google Calendar (Story 1.4
 * / FR-1) — every event scheduled for "today", used to build a Plan's fixed
 * `calendar-anchor` PlanBlocks around Spencer's real commitments. Per AD-4,
 * Task 12 (Story 1.12) later adds a "Yoh Plan" secondary-calendar WRITE
 * surface to this same file, using a separately-scoped auth client; this
 * task is read-only against the primary calendar and builds no write
 * capability, not even scaffolding — `CalendarReadClient` below has no
 * insert/update/delete method at all, so a later write function is added
 * alongside `readCalendarEvents` (its own client type,
 * e.g. `CalendarWriteClient`) rather than requiring this file to be
 * restructured.
 *
 * Per AD-10 of the Architecture Spine, this file receives an
 * already-authenticated `OAuth2Client` (constructed and held solely by
 * `token-store.ts`) as a parameter and must NEVER import
 * token-store's own Google auth-client dependency itself — enforced by the
 * repo scan in `tests/token-store.test.ts`, which also runs against this
 * file and checks for that dependency's exact package name anywhere in a
 * file's source text, including inside a type-only import or a comment.
 * Because even naming that package in a docstring would trip that scan,
 * `createCalendarReadClient`'s `authClient` parameter is instead typed via
 * `@googleapis/calendar`'s own re-exported `GlobalOptions["auth"]` union
 * (`GoogleAuth | OAuth2Client | BaseExternalAccountClient | string`) — the
 * real `OAuth2Client` instance `token-store.ts` hands out satisfies this
 * union structurally, without this file ever importing or naming
 * token-store's auth-client package.
 *
 * Per AD-8, `adapters/*.ts` files may throw on I/O failure rather than
 * returning `Result` themselves — `rituals/*.ts` (a later task) is the only
 * layer allowed to catch and convert a throw into a `Result` failure. This
 * file lets `@googleapis/calendar`'s own SDK/network errors propagate
 * unchanged; nothing here catches them.
 *
 * No caching layer exists anywhere in this file: every call to
 * `readCalendarEvents` re-queries the Calendar API live via the injected
 * client's `events.list`, so an event added or changed on the primary
 * calendar since the last call is reflected on the very next call, with no
 * manual re-sync step (Story 1.4's acceptance criteria).
 *
 * Documented assumptions (no live Google account is available in this
 * environment to confirm against a real calendar — see the Task 4 brief's
 * "Before You Begin"; these are reasonable-default readings of the real
 * `@googleapis/calendar` v16 TypeScript types in
 * `node_modules/@googleapis/calendar`, checked live, not guessed blindly):
 *  - `Params$Resource$Events$List.timeMin`/`timeMax` are RFC3339 strings.
 *    "Today" must be Spencer's own local calendar day, not the UTC one —
 *    "returns every one of today's events" (Story 1.4's acceptance
 *    criteria) would otherwise silently drop a late-evening event or
 *    include a next-day early-morning one for any timezone offset from UTC
 *    (essentially everywhere Spencer might actually be). `timeZone` is
 *    therefore a REQUIRED IANA zone name on `CalendarAdapterConfig` — never
 *    defaulted to `"UTC"` here, since a silent default would just
 *    reproduce the same bug for any caller that forgets to set it; the
 *    real production value is Spencer's own timezone, sourced by whichever
 *    later task wires this up (`rituals/*.ts` or `shell/*.ts`). The local
 *    calendar day's start/end are computed as UTC instants via
 *    `Intl.DateTimeFormat`'s `timeZone` option, deriving the zone's actual
 *    UTC offset *at the relevant instant* (`zoneOffsetMinutesAt`, below) and
 *    iterating that lookup to a fixed point (`startOfLocalDayUtc`, below) —
 *    a single un-verified offset guess is wrong for a zone whose DST
 *    transition falls exactly at local midnight (confirmed against
 *    `America/Santiago`'s fall-back, tested below), so the offset used to
 *    produce each candidate instant is re-checked against the offset
 *    actually observed there, correct regardless of what local time-of-day
 *    a zone's transition occurs at.
 *  - `singleEvents: true, orderBy: "startTime"` is passed so a recurring
 *    event is expanded into today's actual instance(s) rather than
 *    returning the (unexpanded) recurring series definition once.
 *  - An event's `start`/`end` (`Schema$EventDateTime`) is converted to
 *    `IsoDateTime` from whichever of `dateTime` (a timed event) or `date` (an
 *    all-day event, "yyyy-mm-dd") is present, `date` treated as UTC midnight
 *    of that calendar date. An event missing both is a malformed API
 *    response, not an expected case for a real event, and is treated as a
 *    thrown failure per AD-8, not silently mapped to a guessed value.
 */
import { calendar, type calendar_v3, type GlobalOptions } from "@googleapis/calendar";
import type { CalendarEvent, IsoDateTime } from "../types/domain.ts";

// ============================================================================
// Injectable client
// ============================================================================

/**
 * The minimal, read-only slice of `@googleapis/calendar`'s
 * `calendar_v3.Calendar` this file needs — just `events.list`. Deliberately
 * does NOT reuse `calendar_v3.Calendar["events"]["list"]`'s own type
 * directly (that method is overloaded with stream/callback variants this
 * file never uses); instead this declares the one call shape actually used,
 * typed off the real `Params$Resource$Events$List` / `Schema$Events`
 * schemas so a mismatch with the SDK's actual types fails to compile. A
 * real `calendar_v3.Calendar` instance (built by `createCalendarReadClient`
 * below) satisfies this structurally; tests supply a fake/mock instead — no
 * live Google account is available in this environment (AD-10's
 * implementer note).
 *
 * Having no `insert`/`update`/`delete`/`patch` member on this type at all is
 * itself the enforcement mechanism for Story 1.4's "no insert/update/delete
 * call is made against \[the primary calendar\]" acceptance criterion:
 * `readCalendarEvents` below cannot call a write method it was never given.
 */
export interface CalendarReadClient {
  readonly events: {
    readonly list: (
      params: calendar_v3.Params$Resource$Events$List,
    ) => Promise<{ readonly data: calendar_v3.Schema$Events }>;
  };
}

// ============================================================================
// Config
// ============================================================================

/** Config `readCalendarEvents` accepts. */
export interface CalendarAdapterConfig {
  /**
   * Spencer's IANA timezone (e.g. `"America/New_York"`), used to compute
   * "today"'s local calendar-day boundaries (see module docstring).
   * REQUIRED and deliberately not defaulted to `"UTC"` — a silent UTC
   * default would reproduce the exact bug this field exists to prevent for
   * any caller that forgets to set it.
   */
  readonly timeZone: string;
  /** Which calendar to read from — defaults to `"primary"`, Spencer's primary Google Calendar (never the "Yoh Plan" secondary calendar a later task writes to). */
  readonly calendarId?: string;
  /** Injectable clock defining "now", defaults to `() => new Date()`. Lets tests fix "today" without depending on real wall-clock time. */
  readonly now?: () => Date;
}

// ============================================================================
// readCalendarEvents (AD-9's primary export)
// ============================================================================

/**
 * Reads every one of today's events from Spencer's primary Google Calendar
 * via the injected read-scoped client, with each event's start/end time
 * (Story 1.4's acceptance criteria). Always queries live (no caching layer
 * in this file — see the module docstring), so an event added or changed on
 * the primary calendar before this read runs is included in its result.
 *
 * Per AD-8, this function does not catch or wrap SDK/network errors: a
 * failure while querying the Calendar API (auth, rate limit, network)
 * propagates as a thrown error to the caller (`rituals/*.ts`, a later
 * task).
 */
export async function readCalendarEvents(
  client: CalendarReadClient,
  config: CalendarAdapterConfig,
): Promise<CalendarEvent[]> {
  const now = (config.now ?? (() => new Date()))();
  const { start, end } = localDayWindowUtc(now, config.timeZone);
  const timeMin = start.toISOString();
  const timeMax = end.toISOString();

  const response = await client.events.list({
    calendarId: config.calendarId ?? "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });

  const items = response.data.items ?? [];
  return items.map(toCalendarEvent);
}

// ============================================================================
// Auth wiring (AD-10)
// ============================================================================

/**
 * Wraps an already-authenticated auth client (the real `OAuth2Client`
 * `token-store.ts` hands out via its `getOAuth2Client()`, structurally) into
 * a `CalendarReadClient`, via `@googleapis/calendar`'s own `calendar()`
 * factory — this is the sole place this file constructs the real
 * `calendar_v3.Calendar` SDK object, and it makes no network call itself
 * (see module docstring for why `authClient`'s type comes from
 * `@googleapis/calendar`'s re-exported `GlobalOptions["auth"]` rather than
 * importing the `OAuth2Client` type by name).
 */
export function createCalendarReadClient(
  authClient: Exclude<GlobalOptions["auth"], undefined>,
): CalendarReadClient {
  return calendar({ version: "v3", auth: authClient });
}

// ============================================================================
// Timezone-aware day-window helpers
//
// "Today" must be Spencer's local calendar day (see module docstring), not
// the UTC one — these helpers compute that local day's start/end as UTC
// instants, deriving the IANA zone's actual offset via `Intl.DateTimeFormat`
// and iterating that lookup to a fixed point (`startOfLocalDayUtc`) rather
// than trusting a single un-verified offset guess, so this is correct
// regardless of what local time-of-day a zone's DST transition falls at
// (including a transition exactly at local midnight, e.g.
// `America/Santiago`'s fall-back — see `startOfLocalDayUtc`'s own docstring
// and the covering test in `tests/calendar-adapter.test.ts`).
// ============================================================================

/** The Y/M/D of `date` as seen in `timeZone`'s local wall-clock time. */
function localDatePartsInZone(
  date: Date,
  timeZone: string,
): { readonly year: number; readonly month: number; readonly day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * `timeZone`'s offset from UTC (in minutes, positive east of UTC) at the
 * instant `utcMillis`, derived by comparing `utcMillis`'s local wall-clock
 * time in `timeZone` against the same instant read as UTC — computed at the
 * specific instant asked about (not a fixed constant), so this is correct
 * across a DST transition.
 */
function zoneOffsetMinutesAt(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  // Reading `utcMillis`'s local wall-clock time in `timeZone`, then
  // re-interpreting those same numbers as if they were UTC, yields
  // `utcMillis + offset` — so subtracting `utcMillis` back out gives the
  // zone's offset (in ms) at that instant.
  const localWallClockAsUtcMillis = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (localWallClockAsUtcMillis - utcMillis) / 60_000;
}

/** Safety bound on `startOfLocalDayUtc`'s fixed-point iteration (see below) — real-world DST shifts converge in 1-2 iterations; this only guards against pathological/malformed zone data. */
const MAX_OFFSET_ITERATIONS = 5;

/**
 * The UTC instant of local midnight (start of day) for the given `timeZone`
 * local Y/M/D.
 *
 * A single-guess approach — read the offset once at the naive
 * "Y/M/D 00:00:00 treated as a UTC literal" candidate, and apply that same
 * offset as the final answer — is WRONG for a zone whose DST transition
 * falls exactly at local midnight (e.g. `America/Santiago`'s fall-back):
 * the offset at the naive candidate can differ from the offset at the
 * actual local-midnight instant, since the naive candidate and the true
 * answer straddle the transition. Confirmed directly against
 * `Intl.DateTimeFormat` for `America/Santiago` on 2026-04-05 (its
 * fall-back date, transitioning at local 00:00 from GMT-03:00 to
 * GMT-04:00): the naive single-guess approach computed
 * `2026-04-05T03:00:00.000Z`, which `Intl.DateTimeFormat` reports as
 * `2026-04-04T23:00:00 GMT-04:00` — a full hour before actual local
 * midnight, not local midnight itself.
 *
 * This instead iterates to a fixed point: recompute the offset AT each new
 * candidate instant, and keep refining the candidate until the offset used
 * to produce it matches the offset actually observed there. This is
 * correct regardless of what local time-of-day a zone's transition falls
 * at, because the offset is always verified against the candidate it
 * produced rather than assumed to still hold.
 */
function startOfLocalDayUtc(year: number, month: number, day: number, timeZone: string): Date {
  // The Y/M/D we want at local midnight, expressed as a UTC-literal number
  // (not yet a real instant) — the fixed point to solve for is a candidate
  // instant whose *local* wall-clock reading in `timeZone` equals this.
  const targetLocalWallClockAsUtcMillis = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  // Initial guess, exactly the old (single-shot) approach's offset lookup.
  let offsetMinutes = zoneOffsetMinutesAt(targetLocalWallClockAsUtcMillis, timeZone);

  for (let iteration = 0; iteration < MAX_OFFSET_ITERATIONS; iteration++) {
    const candidateMillis = targetLocalWallClockAsUtcMillis - offsetMinutes * 60_000;
    const offsetAtCandidate = zoneOffsetMinutesAt(candidateMillis, timeZone);
    if (offsetAtCandidate === offsetMinutes) {
      // The offset used to produce this candidate matches the offset
      // actually observed there — fixed point reached.
      return new Date(candidateMillis);
    }
    offsetMinutes = offsetAtCandidate;
  }

  throw new Error(
    `calendar-adapter: offset for timezone "${timeZone}" did not converge within ${MAX_OFFSET_ITERATIONS} iterations`,
  );
}

/** `timeZone`'s local calendar day containing `date`, as a `[start, end)` pair of UTC instants (`end` exclusive, the following local midnight). */
function localDayWindowUtc(date: Date, timeZone: string): { readonly start: Date; readonly end: Date } {
  const { year, month, day } = localDatePartsInZone(date, timeZone);
  const start = startOfLocalDayUtc(year, month, day, timeZone);

  // `Date.UTC` itself correctly rolls `day + 1` over into the next
  // month/year; reading that rolled-over instant's own UTC Y/M/D back out
  // (not its local-zone Y/M/D — this is pure calendar-date arithmetic, no
  // zone conversion involved) gives the next calendar day's Y/M/D to feed
  // back into `startOfLocalDayUtc`, so a DST-transition day (23 or 25
  // wall-clock hours) is handled correctly rather than assumed to be 24h.
  const nextDayAsUtc = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  const end = startOfLocalDayUtc(
    nextDayAsUtc.getUTCFullYear(),
    nextDayAsUtc.getUTCMonth() + 1,
    nextDayAsUtc.getUTCDate(),
    timeZone,
  );

  return { start, end };
}

// ============================================================================
// Event -> domain-type mapping
// ============================================================================

function toCalendarEvent(event: calendar_v3.Schema$Event): CalendarEvent {
  return {
    id: event.id ?? "",
    title: event.summary ?? "",
    start: toIsoDateTime(event.start),
    end: toIsoDateTime(event.end),
  };
}

/** Converts a `Schema$EventDateTime` (either a timed `dateTime` or an all-day `date`) into `IsoDateTime` (UTC). */
function toIsoDateTime(eventDateTime: calendar_v3.Schema$EventDateTime | undefined | null): IsoDateTime {
  if (eventDateTime?.dateTime) {
    return new Date(eventDateTime.dateTime).toISOString();
  }
  if (eventDateTime?.date) {
    return new Date(`${eventDateTime.date}T00:00:00.000Z`).toISOString();
  }
  throw new Error("calendar-adapter: event is missing both dateTime and date on start/end");
}

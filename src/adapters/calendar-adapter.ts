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
 *  - `Params$Resource$Events$List.timeMin`/`timeMax` are RFC3339 strings, so
 *    "today" is computed as the UTC calendar day containing `now` (an
 *    injectable clock, defaulting to `() => new Date()`), midnight to
 *    midnight — matching `domain.ts`'s Consistency Conventions that dates
 *    are ISO-8601 UTC internally everywhere in `core/` and storage. This is
 *    a reasonable-default reading, not a confirmed requirement that "today"
 *    must track Spencer's local calendar day rather than the UTC one; a
 *    later task can pass an explicit local-day-aware `now` without any
 *    change to this file's shape.
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

/** Config `readCalendarEvents` accepts. Everything here is optional; sensible defaults cover the real production case. */
export interface CalendarAdapterConfig {
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
  config: CalendarAdapterConfig = {},
): Promise<CalendarEvent[]> {
  const now = (config.now ?? (() => new Date()))();
  const timeMin = startOfUtcDay(now).toISOString();
  const timeMax = endOfUtcDay(now).toISOString();

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
// Day-window helpers
// ============================================================================

/** Midnight UTC of the calendar day containing `date`. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

/** Midnight UTC of the calendar day immediately after the one containing `date` (an exclusive upper bound). */
function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
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

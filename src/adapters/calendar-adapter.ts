/**
 * src/adapters/calendar-adapter.ts
 *
 * Owns Yoh's read surface onto Spencer's primary Google Calendar (Story 1.4
 * / FR-1) — every event scheduled for "today", used to build a Plan's fixed
 * `calendar-anchor` PlanBlocks around Spencer's real commitments — AND (Task
 * 12 / Story 1.12, AD-4) Yoh's write surface onto a dedicated "Yoh Plan"
 * secondary calendar, via a genuinely separate, differently-scoped client
 * type (`CalendarWriteClient`, below `CalendarReadClient`'s section). The two
 * client types share nothing: `CalendarReadClient` still has no
 * insert/update/delete member at all (Task 4's original enforcement,
 * unchanged by this task), and `CalendarWriteClient` has no way to express
 * "read the primary calendar" — its two exported functions
 * (`ensureYohPlanCalendar`, `writeTodaysPlanToCalendar`) never accept a
 * caller-supplied `calendarId` at all, so there is no parameter through
 * which a caller could even attempt to target the primary calendar or any
 * calendar other than the one Yoh itself created and persisted.
 *
 * Story 6.6 / FR-27 (AD-13) adds a THIRD, genuinely separate client type,
 * `CalendarBroadClient` (built from the SECOND, broader-scoped `OAuth2Client`
 * `token-store.ts` holds), plus `resolveCalendarEditRoute` /
 * `proposeCalendarEdit` / `proposeNewCalendarEvent` / `applyCalendarEdit` —
 * confirm-gated move/resize/create of Calendar events beyond Yoh's own.
 * `CalendarEditChange` has no `delete` variant, and `CalendarBroadClient`
 * has no `delete` member, so an external event cannot be deleted through
 * this file even by mistake.
 *
 * Per AD-10 of the Architecture Spine, this file receives an
 * already-authenticated `OAuth2Client` (constructed and held solely by
 * `token-store.ts`) as a parameter and must NEVER import
 * token-store's own Google auth-client dependency itself — enforced by the
 * repo scan in `tests/token-store.test.ts`, which also runs against this
 * file and checks for that dependency's exact package name anywhere in a
 * file's source text, including inside a type-only import or a comment.
 * Because even naming that package in a docstring would trip that scan,
 * `createCalendarReadClient`/`createCalendarWriteClient`'s `authClient`
 * parameter is instead typed via `@googleapis/calendar`'s own re-exported
 * `GlobalOptions["auth"]` union
 * (`GoogleAuth | OAuth2Client | BaseExternalAccountClient | string`) — the
 * real `OAuth2Client` instance `token-store.ts` hands out satisfies this
 * union structurally, without this file ever importing or naming
 * token-store's auth-client package.
 *
 * Per AD-1 of the Architecture Spine ("`adapters -> types` only" — the
 * dependency-direction diagram at the top of the spine has no
 * `adapters -> adapters` edge, and every existing `adapters/*.ts` file
 * before this task confirms that in practice: none of them import each
 * other), this file must not import `token-store.ts` either, even though
 * Task 12's persistence need (`TokenStore.getCalendarId`/`.setCalendarId`)
 * lives there. The same structural-typing technique used for the auth
 * client solves this: `ensureYohPlanCalendar` below accepts a
 * `CalendarIdStore` parameter — a minimal local interface with just
 * `getCalendarId`/`setCalendarId` — which the real `TokenStore` instance
 * satisfies structurally without this file ever importing it by name.
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
 * ----------------------------------------------------------------------------
 * PlanBlock <-> Google Calendar event id mapping (Task 12 design choice)
 * ----------------------------------------------------------------------------
 * "Yoh Plan" write functions need a persistent way to know which Google
 * Calendar event (if any) a given `PlanBlock.id` already became, so a second
 * write for the same day updates that same event rather than creating a
 * duplicate, and so a stale block (removed by a re-plan) can be found and
 * deleted. The Task 12 brief offered two options: a `memory-store.ts`
 * mapping table (the pattern Tasks 2/5/6/9 all used for their own
 * persistence), or Google Calendar's own event `extendedProperties`.
 *
 * This file uses `extendedProperties.private` (a `{[key: string]: string}`
 * bag googleapis exposes directly on `Schema$Event`, confirmed against
 * `node_modules/@googleapis/calendar`'s real v3 types), NOT
 * `memory-store.ts`, and NOT because extended properties are cleaner in the
 * abstract — because AD-1 forbids the alternative outright. AD-1's rule is
 * "`adapters -> types` only" with no `adapters -> adapters` edge in the
 * spine's own dependency diagram, and every `adapters/*.ts` file that
 * predates this task (`memory-store.ts`, `notion-adapter.ts`,
 * `token-store.ts`) already only imports from `types/` plus its one external
 * SDK — none of them import each other. A `memory-store.ts` mapping table
 * would require `calendar-adapter.ts` to import `memory-store.ts`, which
 * would be the first `adapters -> adapters` edge in the codebase and would
 * break that invariant. Encoding the mapping inside the Google event itself
 * needs no such import: every write PlanBlock's id is stamped onto its event
 * as `extendedProperties.private.yohPlanBlockId` (see
 * `PLAN_BLOCK_ID_EXTENDED_PROPERTY`, below), and `writeTodaysPlanToCalendar`
 * rebuilds the current day's id -> event mapping on each call by querying
 * `events.list` for the current local day's window on the "Yoh Plan"
 * calendar (the same day-window helpers `readCalendarEvents` already uses)
 * and reading that property back off each returned event — no separate
 * storage layer, and no import outside `@googleapis/calendar` and
 * `types/domain.ts`, ever added to this file.
 *
 * This day-window scoping is also what makes "a prior day's Plan Block
 * events remain untouched" hold by construction rather than by a
 * hand-written exclusion: `writeTodaysPlanToCalendar` only ever reads,
 * inserts, updates, or deletes an event whose start falls inside the
 * *current* local day's `[start, end)` window (Spencer's local calendar day
 * — see `localDayWindowUtc`, shared with the read surface below). An event
 * created for a previous day's Plan falls outside that window and is never
 * returned by the `events.list` call this function makes, so it can be
 * neither matched, updated, nor deleted as a side effect of writing a later
 * day's Plan — it simply never enters this function's working set.
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
import { isValidIsoDateTime, normalizeIsoDateTime as toUtcIsoDateTime } from "./iso-datetime.ts";
import type {
  CalendarEditChange,
  CalendarEvent,
  ExternalId,
  IsoDateTime,
  PlanBlock,
  Proposal,
  Result,
  YohError,
} from "../types/domain.ts";

// ============================================================================
// Injectable read client
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
// Injectable write client ("Yoh Plan" secondary calendar — Task 12 / AD-4)
// ============================================================================

/**
 * The minimal, "Yoh Plan"-scoped slice of `@googleapis/calendar`'s
 * `calendar_v3.Calendar` this file's write surface needs:
 * `calendars.insert` (to create the "Yoh Plan" calendar on first run) and
 * `events.list`/`.insert`/`.update`/`.delete` (to sync a day's `PlanBlock[]`
 * into it — see `writeTodaysPlanToCalendar`). Typed off the real
 * `Params$Resource$Calendars$Insert` / `Params$Resource$Events$*` /
 * `Schema$Calendar` / `Schema$Event` shapes (checked live against
 * `node_modules/@googleapis/calendar`, same as `CalendarReadClient`), so a
 * mismatch with the SDK's actual types fails to compile.
 *
 * This is a GENUINELY SEPARATE type from `CalendarReadClient` (per AD-4's
 * implementer note) — it shares no member with it (`CalendarReadClient` has
 * only `events.list`; this type's `events.list` is a distinct declaration on
 * a distinct interface, not a shared supertype), and a real
 * `calendar_v3.Calendar` object satisfies both only because each is
 * independently a subset of that SDK type, not because one derives from the
 * other. Nothing here can accidentally slip a write call through a variable
 * typed as `CalendarReadClient`.
 *
 * The primary-calendar-write prevention this type participates in is NOT
 * "this type cannot syntactically hold a `calendarId` string" — every
 * `Params$Resource$*` shape below has an optional `calendarId?: string`,
 * inherited unchanged from the real SDK types, so nothing at the CLIENT
 * type level forbids the string `"primary"` from type-checking. The actual
 * guarantee is two-layered: (1) this file's own exported write functions
 * (`ensureYohPlanCalendar`, `writeTodaysPlanToCalendar`) never expose a
 * `calendarId` parameter to their caller at all — every `calendarId` field
 * passed to a method on this client is computed internally from
 * `ensureYohPlanCalendar`'s own return value, so there is no parameter
 * through which a caller could even attempt to name a different calendar
 * (verified by the `// @ts-expect-error` compile check in
 * `tests/calendar-adapter.test.ts`); and (2) per AD-4/AD-10, the OAuth token
 * this client is built from (`GOOGLE_CALENDAR_WRITE_SCOPE`,
 * `calendar.app.created`) is scoped by Google itself to calendars this app
 * created, so even a hypothetical future caller that tried to smuggle
 * `"primary"` through would have that write rejected at the Calendar API
 * layer, not merely at review — the type system's job here is narrower and
 * deliberately so: making the *no-parameter-to-misuse* shape hold, not
 * re-deriving Google's own scope enforcement in TypeScript.
 */
export interface CalendarWriteClient {
  readonly calendars: {
    readonly insert: (
      params: calendar_v3.Params$Resource$Calendars$Insert,
    ) => Promise<{ readonly data: calendar_v3.Schema$Calendar }>;
  };
  readonly events: {
    readonly list: (
      params: calendar_v3.Params$Resource$Events$List,
    ) => Promise<{ readonly data: calendar_v3.Schema$Events }>;
    readonly insert: (
      params: calendar_v3.Params$Resource$Events$Insert,
    ) => Promise<{ readonly data: calendar_v3.Schema$Event }>;
    readonly update: (
      params: calendar_v3.Params$Resource$Events$Update,
    ) => Promise<{ readonly data: calendar_v3.Schema$Event }>;
    readonly delete: (params: calendar_v3.Params$Resource$Events$Delete) => Promise<{ readonly data: void }>;
  };
}

// ============================================================================
// Injectable broad client (Story 6.6 / FR-27, AD-13) — genuinely separate
// from CalendarReadClient/CalendarWriteClient, same reasoning as those two:
// shares no member, built from the SECOND, broader-scoped OAuth2Client
// token-store.ts holds (never the narrow one AD-4's automatic path uses).
// Deliberately has no `delete` member. "Primary only" for this path is
// enforced by `assertPrimaryCalendar` in this file's FR-27 functions (see
// below), not by this client's scope (AD-13 — Google's scope catalog has no
// narrower "primary only" grant).
// ============================================================================

export interface CalendarBroadClient {
  readonly events: {
    readonly get: (params: calendar_v3.Params$Resource$Events$Get) => Promise<{ readonly data: calendar_v3.Schema$Event }>;
    readonly patch: (
      params: calendar_v3.Params$Resource$Events$Patch,
      options?: { readonly headers?: Record<string, string> },
    ) => Promise<{ readonly data: calendar_v3.Schema$Event }>;
    readonly insert: (params: calendar_v3.Params$Resource$Events$Insert) => Promise<{ readonly data: calendar_v3.Schema$Event }>;
  };
}

/**
 * The minimal slice of `token-store.ts`'s `TokenStore` this file's write
 * surface needs — just the "Yoh Plan" calendar id getter/setter. A local
 * interface rather than an import of `TokenStore` itself, per AD-1 (see
 * module docstring's "PlanBlock <-> Google Calendar event id mapping"
 * section for the full reasoning): the real `TokenStore` instance
 * `rituals/*.ts` (a later task) holds satisfies this structurally, without
 * this file ever importing `token-store.ts`.
 */
export interface CalendarIdStore {
  /** The "Yoh Plan" secondary calendar id, if already created and recorded, else `undefined`. */
  readonly getCalendarId: () => string | undefined;
  /** Persists the "Yoh Plan" secondary calendar id once created. */
  readonly setCalendarId: (calendarId: string) => void;
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
  /** Which calendar to read from — defaults to `"primary"`, Spencer's primary Google Calendar (never the "Yoh Plan" secondary calendar Task 12's write surface below writes to). */
  readonly calendarId?: string;
  /** Injectable clock defining "now", defaults to `() => new Date()`. Lets tests fix "today" without depending on real wall-clock time. */
  readonly now?: () => Date;
}

/**
 * Config `writeTodaysPlanToCalendar` accepts. Deliberately has NO
 * `calendarId` field (unlike `CalendarAdapterConfig` above) — see
 * `CalendarWriteClient`'s doc comment for why that omission is itself part
 * of this task's primary-calendar-write prevention.
 */
export interface CalendarWriteConfig {
  /** Spencer's IANA timezone — same role as `CalendarAdapterConfig.timeZone`, required for the same reason (see module docstring). */
  readonly timeZone: string;
  /** Injectable clock defining "now", defaults to `() => new Date()`. */
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
// "Yoh Plan" write surface (Task 12 / Story 1.12, AD-4)
// ============================================================================

/** Google Calendar's own title for the dedicated "Yoh Plan" secondary calendar `ensureYohPlanCalendar` creates on first run. */
export const YOH_PLAN_CALENDAR_SUMMARY = "Yoh Plan";

/**
 * The `extendedProperties.private` key each event `writeTodaysPlanToCalendar`
 * creates is stamped with, holding the `PlanBlock.id` it was created from —
 * see the module docstring's "PlanBlock <-> Google Calendar event id
 * mapping" section for why this (not `memory-store.ts`) is the persistence
 * mechanism.
 */
export const PLAN_BLOCK_ID_EXTENDED_PROPERTY = "yohPlanBlockId";

/**
 * Ensures the dedicated "Yoh Plan" secondary calendar exists, creating it via
 * `Calendars.insert` on first run and persisting the returned id via
 * `calendarIdStore.setCalendarId` (AD-4's "so the app-created precondition
 * the narrower write scope depends on is actually true, not just assumed").
 *
 * Idempotent: if `calendarIdStore.getCalendarId()` already returns an id,
 * this returns it immediately without calling `Calendars.insert` again —
 * Story 1.12's "a second call... does NOT create a second calendar"
 * criterion. Per AD-8, this does not catch or wrap SDK/network errors, and
 * throws a plain `Error` if the API response is missing an `id` (a
 * malformed response, not an expected case).
 */
export async function ensureYohPlanCalendar(
  client: CalendarWriteClient,
  calendarIdStore: CalendarIdStore,
): Promise<string> {
  const existingCalendarId = calendarIdStore.getCalendarId();
  if (existingCalendarId !== undefined) {
    return existingCalendarId;
  }

  const response = await client.calendars.insert({
    requestBody: { summary: YOH_PLAN_CALENDAR_SUMMARY },
  });
  const newCalendarId = response.data.id;
  if (!newCalendarId) {
    throw new Error("calendar-adapter: Calendars.insert response is missing an id");
  }

  calendarIdStore.setCalendarId(newCalendarId);
  return newCalendarId;
}

/**
 * Writes today's `PlanBlock[]` to the dedicated "Yoh Plan" secondary
 * calendar (creating the calendar first via `ensureYohPlanCalendar` if it
 * doesn't exist yet), syncing it to exactly match `blocks`:
 *
 *  - A block whose id was NOT found among today's existing "Yoh Plan" events
 *    gets a new event via `events.insert`, stamped with
 *    `extendedProperties.private[PLAN_BLOCK_ID_EXTENDED_PROPERTY] = block.id`
 *    (Story 1.12's calendar-anchor linkage — see module docstring).
 *  - A block whose id WAS found (a second write for the same day, e.g. after
 *    Mid-Day Re-Flow) gets `events.update` against that same event id,
 *    rather than a duplicate insert.
 *  - An existing "Yoh Plan" event for today whose stamped `PlanBlock.id` is
 *    no longer present in `blocks` (removed by a re-plan) gets
 *    `events.delete` — this is the only case that deletes anything, and it
 *    only ever considers events already scoped to today's window (below).
 *
 * Every one of those `events.*`/`calendars.insert` calls is passed the SAME
 * calendarId — the "Yoh Plan" id from `ensureYohPlanCalendar` — because that
 * id is the only one ever read in this function; `blocks`/`config` carry no
 * calendarId a caller could substitute (see `CalendarWriteConfig`'s doc
 * comment).
 *
 * "Today" is computed via the same `timeZone`-aware local-day-window helpers
 * `readCalendarEvents` uses (`localDayWindowUtc`), so only events whose
 * start falls inside Spencer's current local calendar day are read,
 * matched, updated, or deleted here — a prior day's "Yoh Plan" events fall
 * outside that `events.list` query entirely and so remain untouched as
 * passive history (Story 1.12's third acceptance criterion), by
 * construction rather than by a hand-written exclusion.
 *
 * Per AD-8, this function does not catch or wrap SDK/network errors — a
 * failure partway through leaves whatever inserts/updates/deletes already
 * completed in place; the caller (`rituals/*.ts`, a later task) decides how
 * to handle a thrown error from an in-progress sync.
 *
 * **Which `PlanBlock`s to pass — resolved by the final whole-branch review
 * (Finding 1), Task 12's own review had left this open.** Callers MUST
 * exclude `"calendar-anchor"` blocks from `blocks` before calling this
 * function. A `calendar-anchor` block already exists as a real event on
 * Spencer's PRIMARY calendar (`readCalendarEvents` is where it was read
 * from) — writing it again into this separate "Yoh Plan" calendar would
 * create a confusing duplicate-looking event for something that was never
 * Yoh's own scheduling decision in the first place. `rituals/morning-ritual.ts`
 * is the one caller today and does this filtering at its call site.
 */
export async function writeTodaysPlanToCalendar(
  client: CalendarWriteClient,
  calendarIdStore: CalendarIdStore,
  blocks: readonly PlanBlock[],
  config: CalendarWriteConfig,
): Promise<void> {
  const calendarId = await ensureYohPlanCalendar(client, calendarIdStore);

  const now = (config.now ?? (() => new Date()))();
  const { start, end } = localDayWindowUtc(now, config.timeZone);

  const existingResponse = await client.events.list({
    calendarId,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
  });

  const existingEventIdByBlockId = new Map<string, string>();
  for (const item of existingResponse.data.items ?? []) {
    const blockId = item.extendedProperties?.private?.[PLAN_BLOCK_ID_EXTENDED_PROPERTY];
    const eventId = item.id;
    if (blockId && eventId) {
      existingEventIdByBlockId.set(blockId, eventId);
    }
  }

  for (const block of blocks) {
    const requestBody = toEventRequestBody(block);
    const existingEventId = existingEventIdByBlockId.get(block.id);
    if (existingEventId !== undefined) {
      await client.events.update({ calendarId, eventId: existingEventId, requestBody });
    } else {
      await client.events.insert({ calendarId, requestBody });
    }
  }

  const currentBlockIds = new Set(blocks.map((block) => block.id));
  for (const [blockId, eventId] of existingEventIdByBlockId) {
    if (!currentBlockIds.has(blockId)) {
      await client.events.delete({ calendarId, eventId });
    }
  }
}

// ============================================================================
// FR-27 (AD-13): confirm-gated Calendar editing beyond Yoh-owned events
// ============================================================================

/**
 * The only calendar FR-27's confirm-gated path may touch (AD-13). Google has
 * no "primary only" OAuth scope, so `GOOGLE_CALENDAR_BROAD_SCOPE` covers every
 * calendar Spencer can access — this constant plus `assertPrimaryCalendar`
 * below is the ONE place that restriction is enforced in code.
 */
const PRIMARY_CALENDAR_ID = "primary";

function assertPrimaryCalendar(calendarId: string): void {
  if (calendarId !== PRIMARY_CALENDAR_ID) {
    throw new Error(`calendar-adapter: FR-27 calendar edits are limited to the primary calendar, got "${calendarId}"`);
  }
}

/**
 * Parses an LLM/user-supplied datetime into a normalised UTC `IsoDateTime`.
 * Requires an explicit UTC offset ("Z" or "+hh:mm") and real calendar/clock
 * field values (see `iso-datetime.ts`) — a date-only, offset-less, or
 * out-of-range (e.g. Feb 30) string is rejected rather than silently
 * rolled into a different day.
 */
function normalizeIsoDateTime(raw: string, label: string): IsoDateTime {
  if (!isValidIsoDateTime(raw)) {
    throw new Error(`calendar-adapter: ${label} "${raw}" is not a full, valid ISO-8601 datetime with a UTC offset`);
  }
  return toUtcIsoDateTime(raw);
}

/**
 * Checks whether `eventId` (on `calendarId`) is a Yoh-created "Yoh Plan"
 * event — the SAME `PLAN_BLOCK_ID_EXTENDED_PROPERTY` tag AD-4's automatic
 * path already stamps every "Yoh Plan" event with. Every FR-27 caller
 * (`app/calendar-edit.ts`; Story 8.9: originally `shell/chat-cli.ts`) routes
 * through this first; `'owned'` means this
 * confirm-gated path must decline and defer to AD-4's existing automatic
 * mechanism instead (Mid-Day Re-Flow) — it never proceeds to
 * `proposeCalendarEdit` for an `'owned'` result.
 */
export async function resolveCalendarEditRoute(
  client: CalendarBroadClient,
  calendarId: string,
  eventId: ExternalId,
): Promise<{ readonly kind: "owned" } | { readonly kind: "external" }> {
  assertPrimaryCalendar(calendarId);
  const response = await client.events.get({ calendarId, eventId });
  const isYohOwned = Boolean(response.data.extendedProperties?.private?.[PLAN_BLOCK_ID_EXTENDED_PROPERTY]);
  return isYohOwned ? { kind: "owned" } : { kind: "external" };
}

/** Input to `proposeCalendarEdit` — `newStart` for `move` (duration preserved from the live event), `newEnd` for `resize` (start stays put). */
export type MoveOrResizeChange =
  | { readonly kind: "move"; readonly newStart: IsoDateTime }
  | { readonly kind: "resize"; readonly newEnd: IsoDateTime };

/**
 * Reads the live event (for its current start/end/etag) and returns a
 * `Proposal<CalendarEditChange>` describing exactly what would change —
 * writes nothing. `move` preserves the live event's own duration when
 * computing `newEnd`; `resize` carries the given `newEnd` straight through,
 * leaving the start untouched. `entityVersion` is the live event's `etag`,
 * checked for staleness by `applyCalendarEdit` (AD-3).
 *
 * Per AD-8, SDK/network errors from the live read propagate as a throw.
 */
export async function proposeCalendarEdit(
  client: CalendarBroadClient,
  calendarId: string,
  eventId: ExternalId,
  change: MoveOrResizeChange,
): Promise<Proposal<CalendarEditChange>> {
  assertPrimaryCalendar(calendarId);
  const response = await client.events.get({ calendarId, eventId });
  const event = response.data;
  const summary = event.summary ?? "this event";

  // An all-day event has `date`, not `dateTime`, on start/end — writing
  // `dateTime` fields onto it would be rejected by Google (or silently
  // convert it), so it isn't editable through this path.
  if (!event.start?.dateTime || !event.end?.dateTime) {
    throw new Error(`calendar-adapter: "${summary}" is an all-day event — only timed events can be moved or resized`);
  }
  const liveStartMs = new Date(event.start.dateTime).getTime();
  const liveEndMs = new Date(event.end.dateTime).getTime();

  let suggested: CalendarEditChange;
  let reason: string;
  if (change.kind === "move") {
    const newStart = normalizeIsoDateTime(change.newStart, "new start");
    const durationMs = liveEndMs - liveStartMs;
    if (durationMs <= 0) {
      throw new Error(`calendar-adapter: "${summary}"'s own end is not after its start — cannot preserve its duration for a move`);
    }
    suggested = {
      kind: "move",
      eventId,
      calendarId,
      newStart,
      newEnd: new Date(new Date(newStart).getTime() + durationMs).toISOString(),
    };
    reason = `Move "${summary}" to start at ${newStart}`;
  } else {
    const newEnd = normalizeIsoDateTime(change.newEnd, "new end");
    if (new Date(newEnd).getTime() <= liveStartMs) {
      throw new Error(`calendar-adapter: new end ${newEnd} is not after "${summary}"'s start`);
    }
    suggested = { kind: "resize", eventId, calendarId, newEnd };
    reason = `Resize "${summary}" to end at ${newEnd}`;
  }

  return {
    id: `calendar-edit-${eventId}-${Date.now()}`,
    kind: "calendar-edit",
    entityId: eventId,
    entityVersion: event.etag ?? "",
    suggested,
    reason,
    createdAt: new Date().toISOString(),
  };
}

/** Input to `proposeNewCalendarEvent` — `create`, by definition, has no `eventId` yet. */
export interface CreateBlockChange {
  readonly calendarId: string;
  readonly title: string;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
}

/**
 * Builds a `Proposal<CalendarEditChange>` for a NEW event — pure, no I/O:
 * there is no live entity to read yet, so unlike `proposeCalendarEdit` this
 * makes no client call at all (mirroring `NotionPageDraft`'s own no-live-
 * entity exemption under AD-3).
 */
export function proposeNewCalendarEvent(change: CreateBlockChange): Proposal<CalendarEditChange> {
  assertPrimaryCalendar(change.calendarId);
  const start = normalizeIsoDateTime(change.start, "start");
  const end = normalizeIsoDateTime(change.end, "end");
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error(`calendar-adapter: end ${end} is not after start ${start}`);
  }
  return {
    id: `calendar-create-${Date.now()}`,
    kind: "calendar-edit",
    entityId: "new-event",
    entityVersion: "new",
    suggested: { kind: "create", calendarId: change.calendarId, title: change.title, start, end },
    reason: `Create "${change.title}" from ${start} to ${end}`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Applies a confirmed `Proposal<CalendarEditChange>`. For `move`/`resize`:
 * re-reads the live event and compares its CURRENT `etag` against
 * `proposal.entityVersion` — a mismatch rejects with
 * `YohError.kind: "stale-proposal"` WITHOUT patching anything (AD-3); only
 * on a genuine match does it call `events.patch` with just the changed
 * field(s). For `create`: calls `events.insert` directly, skipping the
 * re-read entirely — there is no live entity to re-check.
 *
 * Unlike this file's other exports, failures come back as a `Result`
 * rather than a throw: this is the confirm-then-write boundary
 * `app/confirm-proposal.ts` must be able to report on without a try/catch
 * (Story 8.9: originally `chat-cli.ts`).
 */
export async function applyCalendarEdit(
  client: CalendarBroadClient,
  proposal: Proposal<CalendarEditChange>,
): Promise<Result<{ readonly eventId: string; readonly calendarId: string }, YohError>> {
  const change = proposal.suggested;

  try {
    assertPrimaryCalendar(change.calendarId);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "validation",
        message: err instanceof Error ? err.message : String(err),
        detail: { calendarId: change.calendarId },
      },
    };
  }

  if (change.kind === "create") {
    try {
      const response = await client.events.insert({
        calendarId: change.calendarId,
        requestBody: { summary: change.title, start: { dateTime: change.start }, end: { dateTime: change.end } },
      });
      const eventId = response.data.id;
      if (!eventId) {
        return { ok: false, error: { kind: "unreachable", message: "calendar-adapter: events.insert response is missing an id" } };
      }
      return { ok: true, value: { eventId, calendarId: change.calendarId } };
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "unreachable",
          message: `calendar-adapter: could not create the event — ${err instanceof Error ? err.message : String(err)}`,
          detail: err,
        },
      };
    }
  }

  let liveEvent: calendar_v3.Schema$Event;
  try {
    const response = await client.events.get({ calendarId: change.calendarId, eventId: change.eventId });
    liveEvent = response.data;
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `calendar-adapter: could not re-read the event before applying — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }

  if ((liveEvent.etag ?? "") !== proposal.entityVersion) {
    return {
      ok: false,
      error: {
        kind: "stale-proposal",
        message: `calendar-adapter: event "${change.eventId}" has changed since this proposal was generated`,
        detail: { eventId: change.eventId, expectedVersion: proposal.entityVersion, actualVersion: liveEvent.etag },
      },
    };
  }

  const requestBody: calendar_v3.Schema$Event =
    change.kind === "move" ? { start: { dateTime: change.newStart }, end: { dateTime: change.newEnd } } : { end: { dateTime: change.newEnd } };

  try {
    // If-Match closes the window between the etag re-read above and this
    // write: if anyone else changed the event in between, Google answers 412
    // rather than letting this patch overwrite their change (AD-3). Omitted
    // (not sent as "*", which would mean "any version" and defeat the
    // precondition) when the live event has no etag at all — an
    // Google-Calendar-API case defensive coding accounts for but that hasn't
    // been observed in practice; the manual etag comparison above remains
    // the primary staleness guard either way.
    await client.events.patch(
      { calendarId: change.calendarId, eventId: change.eventId, requestBody },
      proposal.entityVersion ? { headers: { "If-Match": proposal.entityVersion } } : undefined,
    );
    return { ok: true, value: { eventId: change.eventId, calendarId: change.calendarId } };
  } catch (err) {
    const isPreconditionFailed =
      typeof err === "object" &&
      err !== null &&
      ((err as { code?: unknown }).code === 412 || (err as { status?: unknown }).status === 412);
    if (isPreconditionFailed) {
      return {
        ok: false,
        error: {
          kind: "stale-proposal",
          message: `calendar-adapter: event "${change.eventId}" has changed since this proposal was generated`,
          detail: { eventId: change.eventId, expectedVersion: proposal.entityVersion },
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `calendar-adapter: could not apply the edit — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }
}

/**
 * `applyCalendarEdit`, pre-bound through a LAZY client provider (Story 8.4,
 * Ruling R1) — `getBinding` is called fresh on every actual apply, never at
 * bind time, and reports a construction failure (e.g. Google OAuth not
 * configured) as an ordinary `Result` failure rather than a thrown error, so
 * a session that never applies a Calendar edit is never blocked by it. Only
 * THIS file's own source may name `applyCalendarEdit` directly (AD-16).
 * `shell/server.ts`'s `AnswerOpenItemDeps` construction (consumed by
 * `app/confirm-proposal.ts`'s `"calendar-edit"` branch; Story 8.9:
 * originally `shell/chat-cli.ts`'s own construction) spreads this
 * binder's return value instead of importing/calling it itself, so the name
 * never appears as literal text in `shell/*.ts` (not even as an
 * object-literal property key).
 */
export type CalendarApplyBindingFn = () => Result<CalendarBroadClient, YohError>;

export interface CalendarApplyBinding {
  readonly applyCalendarEdit: (
    proposal: Proposal<CalendarEditChange>,
  ) => Promise<Result<{ readonly eventId: string; readonly calendarId: string }, YohError>>;
}

export function bindCalendarApply(getBinding: CalendarApplyBindingFn): CalendarApplyBinding {
  return {
    applyCalendarEdit: async (proposal) => {
      const binding = getBinding();
      if (!binding.ok) return binding;
      return applyCalendarEdit(binding.value, proposal);
    },
  };
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

/**
 * Wraps an already-authenticated auth client into a `CalendarWriteClient`,
 * via the same `@googleapis/calendar` `calendar()` factory
 * `createCalendarReadClient` uses (the real `calendar_v3.Calendar` object it
 * builds structurally satisfies both client interfaces — each is
 * independently a subset of that SDK type, see `CalendarWriteClient`'s doc
 * comment). Makes no network call itself.
 *
 * The token this `authClient` carries is expected to have been granted
 * `GOOGLE_CALENDAR_WRITE_SCOPE` (`token-store.ts`,
 * `calendar.app.created`) — the OAuth-layer half of AD-4's "a coding mistake
 * that tried to write the primary fails at the API layer" guarantee; this
 * function itself does no scope checking, since token-store.ts is the sole
 * owner of the auth client and its scopes (AD-10).
 */
export function createCalendarWriteClient(
  authClient: Exclude<GlobalOptions["auth"], undefined>,
): CalendarWriteClient {
  return calendar({ version: "v3", auth: authClient });
}

/**
 * Wraps an already-authenticated auth client into a `CalendarBroadClient`.
 * The token this `authClient` carries is expected to have been granted
 * `GOOGLE_CALENDAR_BROAD_SCOPE` (`token-store.ts`, `calendar.events`) — the
 * SECOND, broader-scoped client — never the narrow "Yoh Plan"-only one
 * AD-4's automatic path uses. Makes no network call itself.
 */
export function createCalendarBroadClient(
  authClient: Exclude<GlobalOptions["auth"], undefined>,
): CalendarBroadClient {
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

// ============================================================================
// PlanBlock -> domain-type mapping (Task 12 write surface)
// ============================================================================

/**
 * Converts a `PlanBlock` into the `Schema$Event` request body
 * `writeTodaysPlanToCalendar` inserts/updates into the "Yoh Plan" calendar —
 * `label` becomes the event's title, `start`/`end` (already `IsoDateTime`,
 * i.e. RFC3339 UTC) are passed straight through as `dateTime`, and `id` is
 * stamped onto `extendedProperties.private[PLAN_BLOCK_ID_EXTENDED_PROPERTY]`
 * so a later call can find this same event again by `PlanBlock.id` (see the
 * module docstring's mapping-design section).
 */
function toEventRequestBody(block: PlanBlock): calendar_v3.Schema$Event {
  return {
    summary: block.label,
    start: { dateTime: block.start },
    end: { dateTime: block.end },
    extendedProperties: { private: { [PLAN_BLOCK_ID_EXTENDED_PROPERTY]: block.id } },
  };
}

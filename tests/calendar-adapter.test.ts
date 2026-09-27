/**
 * Tests for `src/adapters/calendar-adapter.ts` (Story 1.4 / Task 4, and Task
 * 12's "Yoh Plan" write surface, Story 1.12).
 *
 * Per the Task 4 brief's implementer note (AD-10), `readCalendarEvents`
 * takes an injectable "read-scoped" client so these tests never make a real
 * network call or require a live Google account — `FakeCalendarReadClient`
 * below stands in for the `events.list`-only slice of `@googleapis/calendar`
 * this file uses, typed against the real `Params$Resource$Events$List` /
 * `Schema$Events` shapes (checked live against
 * `node_modules/@googleapis/calendar`, per the brief's "Before You Begin"
 * guidance) so a mismatch between this test's assumptions and the SDK's
 * actual types would fail to compile, not just fail silently at runtime.
 *
 * `FakeCalendarReadClient`'s type has ONLY a `list` method (no
 * insert/update/delete) — the same read-only enforcement
 * `CalendarReadClient` itself provides in the adapter file, so a call to any
 * write method is impossible even by mistake, not just untested.
 *
 * `CalendarAdapterConfig.timeZone` is required (never defaulted to `"UTC"`
 * in production code — see the adapter's module docstring), so every test
 * below passes one explicitly. Most tests use `"UTC"` for simplicity since
 * their assertions are about other behavior; the dedicated
 * "local calendar day" tests further down use a real non-UTC IANA zone
 * (`America/New_York`, UTC-4 in August under DST) to confirm an event just
 * before/after UTC midnight is bucketed into Spencer's local "today"
 * rather than UTC's.
 *
 * The "Yoh Plan" write-surface tests further down (Task 12) use their own
 * `FakeCalendarWriteClient`/`FakeCalendarIdStore` pair, typed against
 * `CalendarWriteClient`/`CalendarIdStore` the same way — see that section's
 * own header comment for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { calendar_v3 } from "@googleapis/calendar";
import type { GlobalOptions } from "@googleapis/calendar";
import {
  readCalendarEvents,
  createCalendarReadClient,
  createCalendarWriteClient,
  createCalendarBroadClient,
  resolveCalendarEditRoute,
  proposeCalendarEdit,
  proposeNewCalendarEvent,
  applyCalendarEdit,
  ensureYohPlanCalendar,
  writeTodaysPlanToCalendar,
  YOH_PLAN_CALENDAR_SUMMARY,
  PLAN_BLOCK_ID_EXTENDED_PROPERTY,
  type CalendarReadClient,
  type CalendarWriteClient,
  type CalendarBroadClient,
  type CalendarIdStore,
} from "../src/adapters/calendar-adapter.ts";
import type { CalendarEditChange, IsoDate, PlanBlock } from "../src/types/domain.ts";

// ============================================================================
// Fake client
// ============================================================================

/** A fake client whose `events.list` is scripted per-call, one response per invocation (queue). */
class FakeCalendarReadClient implements CalendarReadClient {
  private readonly queue: calendar_v3.Schema$Events[];
  readonly calls: calendar_v3.Params$Resource$Events$List[] = [];

  constructor(responses: calendar_v3.Schema$Events[]) {
    this.queue = [...responses];
  }

  events = {
    list: async (
      params: calendar_v3.Params$Resource$Events$List,
    ): Promise<{ data: calendar_v3.Schema$Events }> => {
      this.calls.push(params);
      const data = this.queue.shift() ?? { items: [] };
      return { data };
    },
  };
}

function eventDateTime(dateTime: string | undefined, date: string | undefined): calendar_v3.Schema$EventDateTime {
  if (date !== undefined) return { date };
  return dateTime !== undefined ? { dateTime } : {};
}

function makeEvent(overrides: {
  id: string;
  summary: string;
  startDateTime?: string;
  endDateTime?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}): calendar_v3.Schema$Event {
  return {
    id: overrides.id,
    summary: overrides.summary,
    status: overrides.status ?? "confirmed",
    start: eventDateTime(overrides.startDateTime, overrides.startDate),
    end: eventDateTime(overrides.endDateTime, overrides.endDate),
  };
}

const FIXED_NOW = () => new Date("2026-08-22T15:00:00.000Z");

// ============================================================================
// Tests
// ============================================================================

test("readCalendarEvents returns every one of today's events with start/end time", async () => {
  const client = new FakeCalendarReadClient([
    {
      items: [
        makeEvent({
          id: "event-1",
          summary: "Dentist",
          startDateTime: "2026-08-22T14:00:00-04:00",
          endDateTime: "2026-08-22T15:00:00-04:00",
        }),
        makeEvent({
          id: "event-2",
          summary: "Team sync",
          startDateTime: "2026-08-22T17:30:00-04:00",
          endDateTime: "2026-08-22T18:00:00-04:00",
        }),
      ],
    },
  ]);

  const events = await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "UTC" });

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.id),
    ["event-1", "event-2"],
  );
  const first = events[0];
  assert.ok(first);
  assert.equal(first.title, "Dentist");
  assert.equal(first.start, new Date("2026-08-22T14:00:00-04:00").toISOString());
  assert.equal(first.end, new Date("2026-08-22T15:00:00-04:00").toISOString());
});

test("readCalendarEvents converts an all-day event's date-only start/end into IsoDateTime", async () => {
  const client = new FakeCalendarReadClient([
    {
      items: [
        makeEvent({
          id: "event-allday",
          summary: "Company holiday",
          startDate: "2026-08-22",
          endDate: "2026-08-23",
        }),
      ],
    },
  ]);

  const events = await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "UTC" });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.start, "2026-08-22T00:00:00.000Z");
  assert.equal(events[0]?.end, "2026-08-23T00:00:00.000Z");
});

test("readCalendarEvents only calls the read-scoped client's events.list — no insert/update/delete call anywhere", async () => {
  const client = new FakeCalendarReadClient([{ items: [] }]);

  await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "UTC" });

  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.ok(call);
  assert.equal(call.calendarId, "primary");
  assert.equal(call.singleEvents, true);
  assert.equal(call.orderBy, "startTime");
  assert.ok(typeof call.timeMin === "string");
  assert.ok(typeof call.timeMax === "string");
  // `FakeCalendarReadClient implements CalendarReadClient`, whose only
  // member is `events.list` — there is no insert/update/delete method on
  // this object at all, so no such call could have happened even by
  // mistake, and the object has exactly the shape the read function used.
  assert.deepEqual(Object.keys(client.events), ["list"]);
});

test("readCalendarEvents reflects an event added since the last read, with no caching", async () => {
  const client = new FakeCalendarReadClient([
    { items: [makeEvent({ id: "event-1", summary: "Existing meeting", startDateTime: "2026-08-22T14:00:00Z", endDateTime: "2026-08-22T15:00:00Z" })] },
    {
      items: [
        makeEvent({ id: "event-1", summary: "Existing meeting", startDateTime: "2026-08-22T14:00:00Z", endDateTime: "2026-08-22T15:00:00Z" }),
        makeEvent({ id: "event-2", summary: "Just added", startDateTime: "2026-08-22T16:00:00Z", endDateTime: "2026-08-22T16:30:00Z" }),
      ],
    },
  ]);

  const first = await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "UTC" });
  assert.equal(first.length, 1);
  assert.deepEqual(first.map((e) => e.id), ["event-1"]);

  // Simulates an event added to the primary calendar between two runs. No
  // caching layer exists in calendar-adapter.ts, so a second call must
  // re-query and include the new event with no manual re-sync step.
  const second = await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "UTC" });
  assert.equal(second.length, 2);
  assert.deepEqual(
    second.map((e) => e.id).sort(),
    ["event-1", "event-2"],
  );
  assert.equal(client.calls.length, 2);
});

test("readCalendarEvents derives a UTC day window from an injected clock when timeZone is 'UTC'", async () => {
  const client = new FakeCalendarReadClient([{ items: [] }]);
  await readCalendarEvents(client, { now: () => new Date("2026-08-22T23:59:00.000Z"), timeZone: "UTC" });

  const call = client.calls[0];
  assert.ok(call);
  assert.equal(call.timeMin, "2026-08-22T00:00:00.000Z");
  assert.equal(call.timeMax, "2026-08-23T00:00:00.000Z");
});

// ============================================================================
// Non-UTC timezone: Spencer's local calendar day, not UTC's (fix for the
// Task 4 code-review finding — see calendar-adapter.ts's module docstring)
// ============================================================================

test("readCalendarEvents computes 'today' as Spencer's local calendar day (America/New_York, UTC-4 in August under DST), not the UTC one", async () => {
  // 2026-08-22T23:30:00-04:00 is already 2026-08-23 in UTC
  // (2026-08-23T03:30:00.000Z), so a UTC-day computation would put "today"
  // one day ahead of Spencer's actual New York evening.
  const nowInNewYorkLateEvening = () => new Date("2026-08-22T23:30:00-04:00");
  const client = new FakeCalendarReadClient([{ items: [] }]);

  await readCalendarEvents(client, { now: nowInNewYorkLateEvening, timeZone: "America/New_York" });

  const call = client.calls[0];
  assert.ok(call);
  // Spencer's local day (2026-08-22, America/New_York) runs from
  // 2026-08-22T04:00:00.000Z (00:00 EDT) up to 2026-08-23T04:00:00.000Z
  // (the following 00:00 EDT) — NOT 2026-08-22T00:00:00.000Z /
  // 2026-08-23T00:00:00.000Z, which is what a (buggy) UTC-day computation
  // would have produced for this same instant.
  assert.equal(call.timeMin, "2026-08-22T04:00:00.000Z");
  assert.equal(call.timeMax, "2026-08-23T04:00:00.000Z");
});

test("readCalendarEvents includes an event just before UTC midnight that is still 'today' in Spencer's local timezone", async () => {
  // 2026-08-22T23:45:00.000Z is 2026-08-22T19:45:00-04:00 in New York —
  // still Spencer's August 22nd evening, well within his local "today".
  const eventJustBeforeUtcMidnight = makeEvent({
    id: "late-event",
    summary: "Late call",
    startDateTime: "2026-08-22T23:45:00.000Z",
    endDateTime: "2026-08-23T00:15:00.000Z",
  });
  const client = new FakeCalendarReadClient([{ items: [eventJustBeforeUtcMidnight] }]);

  const events = await readCalendarEvents(client, {
    now: () => new Date("2026-08-22T23:50:00.000Z"),
    timeZone: "America/New_York",
  });

  assert.deepEqual(
    events.map((e) => e.id),
    ["late-event"],
  );
  const call = client.calls[0];
  assert.ok(call);
  // The event's start (23:45 UTC) falls inside the requested
  // [timeMin, timeMax) window computed for Spencer's New York "today".
  assert.ok(call.timeMin !== undefined && call.timeMin < "2026-08-22T23:45:00.000Z");
  assert.ok(call.timeMax !== undefined && call.timeMax > "2026-08-22T23:45:00.000Z");
});

test("readCalendarEvents excludes an event that is UTC-'today' but already tomorrow in Spencer's local timezone", async () => {
  // 2026-08-23T02:00:00.000Z ("today" by UTC-day reckoning) is
  // 2026-08-22T22:00:00-04:00 in New York — still the 22nd locally — so
  // this test instead picks an instant that genuinely crosses into
  // Spencer's next local day: 2026-08-23T05:00:00.000Z is
  // 2026-08-23T01:00:00-04:00, already August 23rd in New York, even
  // though `now` below is fixed to New York's August 22nd.
  const eventTomorrowLocally = makeEvent({
    id: "past-local-midnight",
    summary: "Very early meeting",
    startDateTime: "2026-08-23T05:00:00.000Z",
    endDateTime: "2026-08-23T05:30:00.000Z",
  });
  const client = new FakeCalendarReadClient([{ items: [eventTomorrowLocally] }]);

  await readCalendarEvents(client, {
    now: () => new Date("2026-08-22T15:00:00-04:00"),
    timeZone: "America/New_York",
  });

  const call = client.calls[0];
  assert.ok(call);
  // The requested window's exclusive upper bound (Spencer's local
  // midnight, August 23rd New York time) is 2026-08-23T04:00:00.000Z —
  // strictly before this event's 05:00 UTC start, so a correctly
  // timezone-aware request would not include this event's start time
  // inside [timeMin, timeMax).
  assert.equal(call.timeMax, "2026-08-23T04:00:00.000Z");
  assert.ok(call.timeMax !== undefined && call.timeMax < "2026-08-23T05:00:00.000Z");
});

// ============================================================================
// Midnight-DST-transition timezone (fix for a bug the round-1 fix itself
// introduced — see calendar-adapter.ts's `startOfLocalDayUtc` docstring)
// ============================================================================

test("readCalendarEvents computes the correct local-midnight boundary for a timezone whose DST transition falls exactly at local midnight (America/Santiago's 2026-04-05 fall-back)", async () => {
  // Ground truth verified directly against `Intl.DateTimeFormat` (not
  // hand-computed from first principles): America/Santiago's DST fall-back
  // on 2026-04-05 switches from GMT-03:00 to GMT-04:00 exactly at local
  // 00:00 — `new Intl.DateTimeFormat("en-US", { timeZone:
  // "America/Santiago", ..., timeZoneName: "longOffset" }).format(...)`
  // confirms:
  //   2026-04-05T00:00:00.000Z -> "04/04/2026, 21:00:00 GMT-03:00"
  //   2026-04-05T03:00:00.000Z -> "04/04/2026, 23:00:00 GMT-04:00" (still
  //     April 4th, NOT local midnight — this is the single-guess approach's
  //     wrong answer)
  //   2026-04-05T04:00:00.000Z -> "04/05/2026, 00:00:00 GMT-04:00" (the
  //     correct local midnight instant for April 5th)
  // So the correctly-computed local day window for Spencer's April 5th in
  // Santiago is [2026-04-05T04:00:00.000Z, 2026-04-06T04:00:00.000Z) — not
  // [2026-04-05T03:00:00.000Z, ...), which is what the round-1 fix's
  // single-guess `startOfLocalDayUtc` produced.
  const client = new FakeCalendarReadClient([{ items: [] }]);

  await readCalendarEvents(client, {
    now: () => new Date("2026-04-05T12:00:00.000Z"), // midday April 5th, Santiago-local, well clear of the transition itself
    timeZone: "America/Santiago",
  });

  const call = client.calls[0];
  assert.ok(call);
  assert.equal(call.timeMin, "2026-04-05T04:00:00.000Z");
  assert.equal(call.timeMax, "2026-04-06T04:00:00.000Z");
});

test("readCalendarEvents computes the correct (unaffected) local-midnight boundary for the day before America/Santiago's DST transition", async () => {
  // Control case: 2026-04-04 has no transition, so the single-guess and
  // fixed-point approaches agree here — this test guards against a fix
  // that "corrects" every day's boundary rather than only the affected one.
  // Ground truth again from `Intl.DateTimeFormat`:
  //   2026-04-04T03:00:00.000Z -> "04/04/2026, 00:00:00 GMT-03:00"
  const client = new FakeCalendarReadClient([{ items: [] }]);

  await readCalendarEvents(client, {
    now: () => new Date("2026-04-04T12:00:00.000Z"),
    timeZone: "America/Santiago",
  });

  const call = client.calls[0];
  assert.ok(call);
  assert.equal(call.timeMin, "2026-04-04T03:00:00.000Z");
  assert.equal(call.timeMax, "2026-04-05T04:00:00.000Z");
});

// ============================================================================
// readCalendarEvents — optional target `date` (real-use fixes plan, Task 5:
// "what's happening tomorrow", read any day). Defaults to today (computed
// from `now`/`timeZone`, unchanged) when `date` is omitted; when given, reads
// THAT day's host-TZ window instead, via the exact same read-only client —
// no new client type, no new function.
// ============================================================================

test("readCalendarEvents reads a given target date's window instead of today's, when config.date is set", async () => {
  const client = new FakeCalendarReadClient([{ items: [] }]);

  // "Today" per FIXED_NOW/UTC is 2026-08-22 — config.date asks for a
  // different day entirely (tomorrow), and the query window must reflect
  // THAT day, not today's.
  await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "UTC", date: "2026-08-23" });

  const call = client.calls[0];
  assert.ok(call);
  assert.equal(call.timeMin, "2026-08-23T00:00:00.000Z");
  assert.equal(call.timeMax, "2026-08-24T00:00:00.000Z");
});

test("readCalendarEvents still defaults to TODAY's window (from now/timeZone) when config.date is omitted", async () => {
  const client = new FakeCalendarReadClient([{ items: [] }]);

  await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "UTC" });

  const call = client.calls[0];
  assert.ok(call);
  assert.equal(call.timeMin, "2026-08-22T00:00:00.000Z");
  assert.equal(call.timeMax, "2026-08-23T00:00:00.000Z");
});

test("readCalendarEvents computes a given target date's window in Spencer's LOCAL timezone, same as it already does for today", async () => {
  const client = new FakeCalendarReadClient([{ items: [] }]);

  await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "America/New_York", date: "2026-08-23" });

  const call = client.calls[0];
  assert.ok(call);
  // 2026-08-23 local midnight in America/New_York (UTC-4, EDT in August) is 2026-08-23T04:00:00.000Z.
  assert.equal(call.timeMin, "2026-08-23T04:00:00.000Z");
  assert.equal(call.timeMax, "2026-08-24T04:00:00.000Z");
});

test("readCalendarEvents returns a target day's real events (not today's), when config.date is set", async () => {
  const client = new FakeCalendarReadClient([
    {
      items: [
        makeEvent({
          id: "tomorrow-event",
          summary: "Study session",
          startDateTime: "2026-08-23T10:00:00-04:00",
          endDateTime: "2026-08-23T11:00:00-04:00",
        }),
      ],
    },
  ]);

  const events = await readCalendarEvents(client, { now: FIXED_NOW, timeZone: "America/New_York", date: "2026-08-23" });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.title, "Study session");
});

// ============================================================================
// Review fix (real-use fixes plan, Task 5 fix): config.date must THROW
// (AD-8's convention — an adapter throws on malformed input rather than
// silently defaulting) on a malformed or unreal date, instead of silently
// treating a missing/garbage year/month/day as 1970-01-01.
// ============================================================================

test("readCalendarEvents throws (never silently defaults to 1970-01-01) when config.date isn't a real, well-formed YYYY-MM-DD date", async () => {
  const client = new FakeCalendarReadClient([{ items: [] }]);

  for (const badDate of ["not-a-date", "2026-13-01", "2026-02-30", "26-08-23", ""]) {
    await assert.rejects(
      () => readCalendarEvents(client, { now: FIXED_NOW, timeZone: "UTC", date: badDate as IsoDate }),
      `expected config.date "${badDate}" to throw rather than silently default`,
    );
  }
});

test("createCalendarReadClient builds a CalendarReadClient from an injected already-authenticated auth client, with no network call", () => {
  // A minimal stand-in for the already-authenticated client `token-store.ts`
  // hands out — `createCalendarReadClient` just wraps it via
  // `@googleapis/calendar`'s own factory, making no network call itself.
  const fakeAuthClient = { credentials: { refresh_token: "fake" } } as unknown as Exclude<
    GlobalOptions["auth"],
    undefined
  >;
  const client = createCalendarReadClient(fakeAuthClient);
  assert.equal(typeof client.events.list, "function");
});

// ============================================================================
// "Yoh Plan" write surface (Task 12 / Story 1.12, AD-4)
//
// `FakeCalendarWriteClient` stands in for the `calendars.insert` +
// `events.list`/`.insert`/`.update`/`.delete` slice of `@googleapis/calendar`
// `CalendarWriteClient` declares — typed against the real
// `Params$Resource$Calendars$Insert`/`Params$Resource$Events$*` shapes
// (checked live against `node_modules/@googleapis/calendar`), so a mismatch
// with the SDK's actual types fails to compile here too. Every call is
// recorded so a test can assert exactly which calendarId/eventId each call
// carried — the runtime half of AD-4's "every insert/update/delete call
// targets only the Yoh Plan calendar" guarantee.
// ============================================================================

class FakeCalendarWriteClient implements CalendarWriteClient {
  readonly calendarsInsertCalls: calendar_v3.Params$Resource$Calendars$Insert[] = [];
  readonly eventsListCalls: calendar_v3.Params$Resource$Events$List[] = [];
  readonly eventsInsertCalls: calendar_v3.Params$Resource$Events$Insert[] = [];
  readonly eventsUpdateCalls: calendar_v3.Params$Resource$Events$Update[] = [];
  readonly eventsDeleteCalls: calendar_v3.Params$Resource$Events$Delete[] = [];

  private readonly calendarInsertResponse: calendar_v3.Schema$Calendar;
  private readonly listQueue: calendar_v3.Schema$Events[];
  private nextGeneratedEventId = 1;

  constructor(
    options: {
      calendarInsertResponse?: calendar_v3.Schema$Calendar;
      listResponses?: calendar_v3.Schema$Events[];
    } = {},
  ) {
    this.calendarInsertResponse = options.calendarInsertResponse ?? { id: "yoh-plan-calendar-id" };
    this.listQueue = [...(options.listResponses ?? [])];
  }

  calendars = {
    insert: async (
      params: calendar_v3.Params$Resource$Calendars$Insert,
    ): Promise<{ data: calendar_v3.Schema$Calendar }> => {
      this.calendarsInsertCalls.push(params);
      return { data: this.calendarInsertResponse };
    },
  };

  events = {
    list: async (params: calendar_v3.Params$Resource$Events$List): Promise<{ data: calendar_v3.Schema$Events }> => {
      this.eventsListCalls.push(params);
      const data = this.listQueue.shift() ?? { items: [] };
      return { data };
    },
    insert: async (
      params: calendar_v3.Params$Resource$Events$Insert,
    ): Promise<{ data: calendar_v3.Schema$Event }> => {
      this.eventsInsertCalls.push(params);
      const id = `generated-event-${this.nextGeneratedEventId++}`;
      return { data: { ...params.requestBody, id } };
    },
    update: async (
      params: calendar_v3.Params$Resource$Events$Update,
    ): Promise<{ data: calendar_v3.Schema$Event }> => {
      this.eventsUpdateCalls.push(params);
      return { data: { ...params.requestBody, id: params.eventId ?? "" } };
    },
    delete: async (params: calendar_v3.Params$Resource$Events$Delete): Promise<{ data: void }> => {
      this.eventsDeleteCalls.push(params);
      return { data: undefined };
    },
  };
}

/** A fake `CalendarIdStore` — an in-memory stand-in for `token-store.ts`'s `TokenStore.getCalendarId`/`.setCalendarId`. */
class FakeCalendarIdStore implements CalendarIdStore {
  private calendarId: string | undefined;
  readonly setCalendarIdCalls: string[] = [];

  constructor(initialCalendarId?: string) {
    this.calendarId = initialCalendarId;
  }

  getCalendarId = (): string | undefined => this.calendarId;

  setCalendarId = (calendarId: string): void => {
    this.calendarId = calendarId;
    this.setCalendarIdCalls.push(calendarId);
  };
}

function planBlock(overrides: {
  id: string;
  start: string;
  end: string;
  label: string;
  kind?: PlanBlock["kind"];
}): PlanBlock {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "work",
    start: overrides.start,
    end: overrides.end,
    label: overrides.label,
  };
}

// ---- ensureYohPlanCalendar --------------------------------------------------

test("ensureYohPlanCalendar creates the 'Yoh Plan' calendar via Calendars.insert on first run and persists the returned id via setCalendarId", async () => {
  const client = new FakeCalendarWriteClient({ calendarInsertResponse: { id: "yoh-plan-calendar-id" } });
  const store = new FakeCalendarIdStore();

  const calendarId = await ensureYohPlanCalendar(client, store);

  assert.equal(calendarId, "yoh-plan-calendar-id");
  assert.equal(client.calendarsInsertCalls.length, 1);
  assert.equal(client.calendarsInsertCalls[0]?.requestBody?.summary, YOH_PLAN_CALENDAR_SUMMARY);
  assert.equal(store.getCalendarId(), "yoh-plan-calendar-id");
  assert.deepEqual(store.setCalendarIdCalls, ["yoh-plan-calendar-id"]);
});

test("ensureYohPlanCalendar is idempotent — a second call with an already-set calendar id does not create a second calendar", async () => {
  const client = new FakeCalendarWriteClient();
  const store = new FakeCalendarIdStore("already-existing-yoh-plan-id");

  const calendarId = await ensureYohPlanCalendar(client, store);

  assert.equal(calendarId, "already-existing-yoh-plan-id");
  assert.equal(client.calendarsInsertCalls.length, 0);
  assert.deepEqual(store.setCalendarIdCalls, []);
});

test("ensureYohPlanCalendar throws if the Calendars.insert response is missing an id", async () => {
  const client = new FakeCalendarWriteClient({ calendarInsertResponse: {} });
  const store = new FakeCalendarIdStore();

  await assert.rejects(() => ensureYohPlanCalendar(client, store), /missing an id/);
  assert.deepEqual(store.setCalendarIdCalls, []);
});

// ---- writeTodaysPlanToCalendar ---------------------------------------------

const WRITE_FIXED_NOW = () => new Date("2026-08-22T15:00:00.000Z");

test("writeTodaysPlanToCalendar targets only the Yoh Plan calendar id on every calendars.insert/events.list/events.insert call — never 'primary'", async () => {
  const client = new FakeCalendarWriteClient({
    calendarInsertResponse: { id: "yoh-plan-calendar-id" },
    listResponses: [{ items: [] }],
  });
  const store = new FakeCalendarIdStore();
  const blocks = [planBlock({ id: "block-1", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Deep work" })];

  await writeTodaysPlanToCalendar(client, store, blocks, { now: WRITE_FIXED_NOW, timeZone: "UTC" });

  assert.equal(client.calendarsInsertCalls.length, 1);
  assert.equal(client.eventsListCalls.length, 1);
  assert.equal(client.eventsListCalls[0]?.calendarId, "yoh-plan-calendar-id");
  assert.equal(client.eventsInsertCalls.length, 1);
  assert.equal(client.eventsInsertCalls[0]?.calendarId, "yoh-plan-calendar-id");
  assert.notEqual(client.eventsListCalls[0]?.calendarId, "primary");
  assert.notEqual(client.eventsInsertCalls[0]?.calendarId, "primary");
});

test("writeTodaysPlanToCalendar inserts a new block as a new event, stamped with extendedProperties.private.yohPlanBlockId", async () => {
  const client = new FakeCalendarWriteClient({
    calendarInsertResponse: { id: "yoh-plan-calendar-id" },
    listResponses: [{ items: [] }],
  });
  const store = new FakeCalendarIdStore();
  const blocks = [
    planBlock({ id: "block-1", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Deep work" }),
  ];

  await writeTodaysPlanToCalendar(client, store, blocks, { now: WRITE_FIXED_NOW, timeZone: "UTC" });

  assert.equal(client.eventsInsertCalls.length, 1);
  const insertCall = client.eventsInsertCalls[0];
  assert.ok(insertCall);
  assert.equal(insertCall.requestBody?.summary, "Deep work");
  assert.equal(insertCall.requestBody?.start?.dateTime, "2026-08-22T13:00:00.000Z");
  assert.equal(insertCall.requestBody?.end?.dateTime, "2026-08-22T14:00:00.000Z");
  assert.equal(insertCall.requestBody?.extendedProperties?.private?.[PLAN_BLOCK_ID_EXTENDED_PROPERTY], "block-1");
  assert.equal(client.eventsUpdateCalls.length, 0);
  assert.equal(client.eventsDeleteCalls.length, 0);
});

test("writeTodaysPlanToCalendar updates an existing block's event (matched by its stamped PlanBlock.id) rather than inserting a duplicate", async () => {
  const client = new FakeCalendarWriteClient({
    calendarInsertResponse: { id: "yoh-plan-calendar-id" },
    listResponses: [
      {
        items: [
          {
            id: "existing-google-event-1",
            summary: "Deep work (stale title)",
            extendedProperties: { private: { [PLAN_BLOCK_ID_EXTENDED_PROPERTY]: "block-1" } },
          },
        ],
      },
    ],
  });
  const store = new FakeCalendarIdStore();
  const blocks = [
    planBlock({ id: "block-1", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Deep work" }),
  ];

  await writeTodaysPlanToCalendar(client, store, blocks, { now: WRITE_FIXED_NOW, timeZone: "UTC" });

  assert.equal(client.eventsInsertCalls.length, 0);
  assert.equal(client.eventsUpdateCalls.length, 1);
  const updateCall = client.eventsUpdateCalls[0];
  assert.ok(updateCall);
  assert.equal(updateCall.eventId, "existing-google-event-1");
  assert.equal(updateCall.calendarId, "yoh-plan-calendar-id");
  assert.equal(updateCall.requestBody?.summary, "Deep work");
  assert.equal(client.eventsDeleteCalls.length, 0);
});

test("writeTodaysPlanToCalendar deletes a stale block's event when it's no longer part of today's Plan Blocks", async () => {
  const client = new FakeCalendarWriteClient({
    calendarInsertResponse: { id: "yoh-plan-calendar-id" },
    listResponses: [
      {
        items: [
          {
            id: "stale-google-event",
            summary: "Old break",
            extendedProperties: { private: { [PLAN_BLOCK_ID_EXTENDED_PROPERTY]: "block-removed-by-replan" } },
          },
        ],
      },
    ],
  });
  const store = new FakeCalendarIdStore();

  await writeTodaysPlanToCalendar(client, store, [], { now: WRITE_FIXED_NOW, timeZone: "UTC" });

  assert.equal(client.eventsDeleteCalls.length, 1);
  const deleteCall = client.eventsDeleteCalls[0];
  assert.ok(deleteCall);
  assert.equal(deleteCall.eventId, "stale-google-event");
  assert.equal(deleteCall.calendarId, "yoh-plan-calendar-id");
  assert.equal(client.eventsInsertCalls.length, 0);
  assert.equal(client.eventsUpdateCalls.length, 0);
});

test("writeTodaysPlanToCalendar's events.list call is scoped to only today's local calendar day window", async () => {
  const client = new FakeCalendarWriteClient({
    calendarInsertResponse: { id: "yoh-plan-calendar-id" },
    listResponses: [{ items: [] }],
  });
  const store = new FakeCalendarIdStore();
  const blocks = [planBlock({ id: "today-block", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Today's work" })];

  await writeTodaysPlanToCalendar(client, store, blocks, { now: WRITE_FIXED_NOW, timeZone: "UTC" });

  assert.equal(client.eventsListCalls.length, 1);
  assert.equal(client.eventsListCalls[0]?.timeMin, "2026-08-22T00:00:00.000Z");
  assert.equal(client.eventsListCalls[0]?.timeMax, "2026-08-23T00:00:00.000Z");
});

test("writeTodaysPlanToCalendar does not delete or modify a prior day's events when a later day's Plan Blocks are written", async () => {
  // One shared client/store across two separate `writeTodaysPlanToCalendar`
  // calls simulates two real ritual runs on consecutive days. Day 2's
  // `events.list` response is `{ items: [] }` because Day 1's event (created
  // by the first call below) falls outside Day 2's `[timeMin, timeMax)`
  // window — exactly what the real Calendar API would return, since it
  // filters server-side by the `timeMin`/`timeMax` this function passes.
  const client = new FakeCalendarWriteClient({
    calendarInsertResponse: { id: "yoh-plan-calendar-id" },
    listResponses: [{ items: [] }, { items: [] }],
  });
  const store = new FakeCalendarIdStore();

  const day1Blocks = [planBlock({ id: "day1-block", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Day 1 work" })];
  await writeTodaysPlanToCalendar(client, store, day1Blocks, {
    now: () => new Date("2026-08-22T15:00:00.000Z"),
    timeZone: "UTC",
  });
  assert.equal(client.eventsInsertCalls.length, 1);

  const day2Blocks = [planBlock({ id: "day2-block", start: "2026-08-23T13:00:00.000Z", end: "2026-08-23T14:00:00.000Z", label: "Day 2 work" })];
  await writeTodaysPlanToCalendar(client, store, day2Blocks, {
    now: () => new Date("2026-08-23T15:00:00.000Z"),
    timeZone: "UTC",
  });

  // Day 1's event was never deleted or updated as a side effect of writing
  // Day 2's Plan.
  assert.equal(client.eventsDeleteCalls.length, 0);
  assert.equal(client.eventsUpdateCalls.length, 0);
  // One insert per day (Day 1's event, then Day 2's event) — no duplicate
  // work against Day 1's already-created event.
  assert.equal(client.eventsInsertCalls.length, 2);
  // "Yoh Plan" calendar created exactly once, reused across both days.
  assert.equal(client.calendarsInsertCalls.length, 1);
});

test("createCalendarWriteClient builds a CalendarWriteClient from an injected already-authenticated auth client, with no network call", () => {
  const fakeAuthClient = { credentials: { refresh_token: "fake" } } as unknown as Exclude<
    GlobalOptions["auth"],
    undefined
  >;
  const client = createCalendarWriteClient(fakeAuthClient);
  assert.equal(typeof client.calendars.insert, "function");
  assert.equal(typeof client.events.list, "function");
  assert.equal(typeof client.events.insert, "function");
  assert.equal(typeof client.events.update, "function");
  assert.equal(typeof client.events.delete, "function");
});

// ---- Type-level enforcement: no calendarId parameter exists to misuse -----

test("writeTodaysPlanToCalendar's config type structurally cannot express a caller-supplied calendarId (compile-time check)", async () => {
  const client = new FakeCalendarWriteClient({
    calendarInsertResponse: { id: "yoh-plan-calendar-id" },
    listResponses: [{ items: [] }],
  });
  const store = new FakeCalendarIdStore();

  // @ts-expect-error `CalendarWriteConfig` has only `timeZone`/`now` — there
  // is no `calendarId` field anywhere in `writeTodaysPlanToCalendar`'s
  // parameter list through which a caller could target a calendar other
  // than the one `ensureYohPlanCalendar` resolves internally (see
  // `CalendarWriteClient`'s doc comment in calendar-adapter.ts for the full
  // reasoning). If this stops being a compile error, someone added a
  // `calendarId` escape hatch — the point this test guards.
  await writeTodaysPlanToCalendar(client, store, [], { now: WRITE_FIXED_NOW, timeZone: "UTC", calendarId: "primary" });

  // Runtime companion: every call this whole write-surface test section
  // makes (including this one, since the extra property above is just
  // ignored at runtime after type-stripping) is recorded with
  // `calendarId: "yoh-plan-calendar-id"` — asserted directly in the tests
  // above — never `"primary"`.
  assert.equal(client.calendarsInsertCalls.length, 1);
});

// ============================================================================
// resolveCalendarEditRoute / proposeCalendarEdit / proposeNewCalendarEvent /
// applyCalendarEdit (Story 6.6 / FR-27, AD-13)
// ============================================================================

function fakeBroadClient(overrides: {
  getResult?: calendar_v3.Schema$Event;
  insertResult?: calendar_v3.Schema$Event;
  throwOnGet?: Error;
  throwOnPatch?: Error;
  throwOnInsert?: Error;
} = {}): CalendarBroadClient & {
  readonly getCalls: calendar_v3.Params$Resource$Events$Get[];
  readonly patchCalls: calendar_v3.Params$Resource$Events$Patch[];
  readonly insertCalls: calendar_v3.Params$Resource$Events$Insert[];
} {
  const getCalls: calendar_v3.Params$Resource$Events$Get[] = [];
  const patchCalls: calendar_v3.Params$Resource$Events$Patch[] = [];
  const insertCalls: calendar_v3.Params$Resource$Events$Insert[] = [];
  return {
    getCalls,
    patchCalls,
    insertCalls,
    events: {
      get: async (params) => {
        getCalls.push(params);
        if (overrides.throwOnGet) throw overrides.throwOnGet;
        return {
          data: overrides.getResult ?? {
            id: "evt-1",
            etag: '"etag-1"',
            summary: "Team sync",
            start: { dateTime: "2026-09-18T15:00:00.000Z" },
            end: { dateTime: "2026-09-18T16:00:00.000Z" },
          },
        };
      },
      patch: async (params) => {
        patchCalls.push(params);
        if (overrides.throwOnPatch) throw overrides.throwOnPatch;
        return { data: { id: "evt-1" } };
      },
      insert: async (params) => {
        insertCalls.push(params);
        if (overrides.throwOnInsert) throw overrides.throwOnInsert;
        return { data: overrides.insertResult ?? { id: "evt-new" } };
      },
    },
  };
}

test("resolveCalendarEditRoute reports 'owned' for an event stamped with PLAN_BLOCK_ID_EXTENDED_PROPERTY", async () => {
  const client = fakeBroadClient({
    getResult: { id: "evt-1", extendedProperties: { private: { [PLAN_BLOCK_ID_EXTENDED_PROPERTY]: "block-1" } } },
  });
  const route = await resolveCalendarEditRoute(client, "primary", "evt-1");
  assert.deepEqual(route, { kind: "owned" });
});

test("resolveCalendarEditRoute reports 'external' for an event with no such stamp", async () => {
  const client = fakeBroadClient({ getResult: { id: "evt-1" } });
  const route = await resolveCalendarEditRoute(client, "primary", "evt-1");
  assert.deepEqual(route, { kind: "external" });
});

test("proposeCalendarEdit (move) preserves the live event's duration when computing the new end time", async () => {
  const client = fakeBroadClient();
  const proposal = await proposeCalendarEdit(client, "primary", "evt-1", { kind: "move", newStart: "2026-09-18T18:00:00.000Z" });
  assert.equal(proposal.suggested.kind, "move");
  if (proposal.suggested.kind !== "move") return;
  assert.equal(proposal.suggested.newStart, "2026-09-18T18:00:00.000Z");
  assert.equal(proposal.suggested.newEnd, "2026-09-18T19:00:00.000Z"); // same 1-hour duration as the live event
  assert.equal(proposal.entityVersion, '"etag-1"');
});

test("proposeCalendarEdit (resize) carries the given new end time straight through", async () => {
  const client = fakeBroadClient();
  const proposal = await proposeCalendarEdit(client, "primary", "evt-1", { kind: "resize", newEnd: "2026-09-18T17:30:00.000Z" });
  assert.deepEqual(proposal.suggested, {
    kind: "resize",
    eventId: "evt-1",
    calendarId: "primary",
    newEnd: "2026-09-18T17:30:00.000Z",
  });
});

test("proposeNewCalendarEvent is pure — makes no client call at all", () => {
  const proposal = proposeNewCalendarEvent({
    calendarId: "primary",
    title: "Focus block",
    start: "2026-09-18T14:00:00.000Z",
    end: "2026-09-18T15:00:00.000Z",
  });
  assert.deepEqual(proposal.suggested, {
    kind: "create",
    calendarId: "primary",
    title: "Focus block",
    start: "2026-09-18T14:00:00.000Z",
    end: "2026-09-18T15:00:00.000Z",
  });
});

test("applyCalendarEdit (move/resize) re-reads the live event, confirms the etag still matches, and patches only start/end", async () => {
  const client = fakeBroadClient();
  const proposal = await proposeCalendarEdit(client, "primary", "evt-1", { kind: "move", newStart: "2026-09-18T18:00:00.000Z" });

  const result = await applyCalendarEdit(client, proposal);

  assert.equal(result.ok, true);
  assert.equal(client.patchCalls.length, 1);
  assert.deepEqual(client.patchCalls[0]!.requestBody, {
    start: { dateTime: "2026-09-18T18:00:00.000Z" },
    end: { dateTime: "2026-09-18T19:00:00.000Z" },
  });
});

test("applyCalendarEdit (move/resize) rejects a stale proposal (etag changed since proposal time) without patching anything", async () => {
  const client = fakeBroadClient();
  const proposal = await proposeCalendarEdit(client, "primary", "evt-1", { kind: "move", newStart: "2026-09-18T18:00:00.000Z" });

  // Simulate the event changing between propose and apply.
  const staleClient = fakeBroadClient({ getResult: { id: "evt-1", etag: '"etag-2"' } });
  const result = await applyCalendarEdit(staleClient, proposal);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "stale-proposal");
  assert.equal(staleClient.patchCalls.length, 0);
});

test("applyCalendarEdit (create) inserts the new event directly, with no re-read/staleness check (AD-3's create exemption)", async () => {
  const client = fakeBroadClient();
  const proposal = proposeNewCalendarEvent({
    calendarId: "primary",
    title: "Focus block",
    start: "2026-09-18T14:00:00.000Z",
    end: "2026-09-18T15:00:00.000Z",
  });

  const result = await applyCalendarEdit(client, proposal);

  assert.equal(result.ok, true);
  assert.equal(client.getCalls.length, 0, "create must never re-read a live entity — there isn't one yet");
  assert.equal(client.insertCalls.length, 1);
  assert.deepEqual(client.insertCalls[0]!.requestBody, {
    summary: "Focus block",
    start: { dateTime: "2026-09-18T14:00:00.000Z" },
    end: { dateTime: "2026-09-18T15:00:00.000Z" },
  });
});

test("applyCalendarEdit returns an 'unreachable' failure (not a throw) when the patch call fails", async () => {
  const proposal = await proposeCalendarEdit(fakeBroadClient(), "primary", "evt-1", { kind: "resize", newEnd: "2026-09-18T17:30:00.000Z" });
  const failing = fakeBroadClient({ throwOnPatch: new Error("boom") });

  const result = await applyCalendarEdit(failing, proposal);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "unreachable");
});

test("createCalendarBroadClient wraps an auth client without making a network call", () => {
  const client = createCalendarBroadClient("fake-api-key");
  assert.equal(typeof client.events.get, "function");
  assert.equal(typeof client.events.patch, "function");
  assert.equal(typeof client.events.insert, "function");
});

test("CalendarEditChange has no delete variant — structurally impossible to construct one", () => {
  // A grep-based structural guard, the same convention notion-adapter.ts's
  // AD-12 test already uses: this file's source can never construct a
  // 'delete' kind for CalendarEditChange.
  const source = readFileSync(join(import.meta.dirname, "..", "src", "adapters", "calendar-adapter.ts"), "utf8");
  assert.doesNotMatch(source, /kind:\s*["']delete["']/, "no delete variant may ever be constructed for CalendarEditChange (AD-13)");
});

// ---- Review fixes: primary-only guard, datetime validation, all-day, If-Match ----

test("FR-27 functions reject any calendarId other than 'primary' (AD-13's primary-only guarantee is enforced in code)", async () => {
  const client = fakeBroadClient();
  await assert.rejects(resolveCalendarEditRoute(client, "yoh-plan-id", "evt-1"), /primary calendar/);
  await assert.rejects(
    proposeCalendarEdit(client, "other-calendar", "evt-1", { kind: "move", newStart: "2026-09-18T18:00:00.000Z" }),
    /primary calendar/,
  );
  assert.throws(
    () => proposeNewCalendarEvent({ calendarId: "other-calendar", title: "x", start: "2026-09-18T14:00:00.000Z", end: "2026-09-18T15:00:00.000Z" }),
    /primary calendar/,
  );
  assert.equal(client.getCalls.length, 0, "a rejected calendarId must never reach the API");

  // applyCalendarEdit trusts nothing in the proposal: a hand-built non-primary proposal is refused too.
  const forged = { ...proposeNewCalendarEvent({ calendarId: "primary", title: "x", start: "2026-09-18T14:00:00.000Z", end: "2026-09-18T15:00:00.000Z" }) };
  const result = await applyCalendarEdit(client, { ...forged, suggested: { ...(forged.suggested as { kind: "create"; title: string; start: string; end: string }), calendarId: "other-calendar" } });
  assert.equal(result.ok, false);
  assert.equal(client.insertCalls.length, 0);
});

test("proposeCalendarEdit / proposeNewCalendarEvent reject date-only and offset-less datetimes", async () => {
  const client = fakeBroadClient();
  for (const bad of ["2026-09-18", "2026-09-18T16:00:00", "tomorrow"]) {
    await assert.rejects(proposeCalendarEdit(client, "primary", "evt-1", { kind: "move", newStart: bad }), /ISO-8601/);
    await assert.rejects(proposeCalendarEdit(client, "primary", "evt-1", { kind: "resize", newEnd: bad }), /ISO-8601/);
    assert.throws(() => proposeNewCalendarEvent({ calendarId: "primary", title: "x", start: bad, end: "2026-09-18T15:00:00.000Z" }), /ISO-8601/);
  }
});

test("datetimes with a non-UTC offset are normalised to UTC before being proposed", async () => {
  const proposal = await proposeCalendarEdit(fakeBroadClient(), "primary", "evt-1", { kind: "move", newStart: "2026-09-18T14:00:00-04:00" });
  assert.equal(proposal.suggested.kind === "move" && proposal.suggested.newStart, "2026-09-18T18:00:00.000Z");
});

test("a resize whose end is not after the live start, and a create with end <= start, are rejected", async () => {
  await assert.rejects(
    proposeCalendarEdit(fakeBroadClient(), "primary", "evt-1", { kind: "resize", newEnd: "2026-09-18T14:00:00.000Z" }),
    /not after/,
  );
  assert.throws(
    () => proposeNewCalendarEvent({ calendarId: "primary", title: "x", start: "2026-09-18T15:00:00.000Z", end: "2026-09-18T14:00:00.000Z" }),
    /not after/,
  );
});

test("proposeCalendarEdit refuses an all-day event (start/end are `date`, not `dateTime`)", async () => {
  const client = fakeBroadClient({ getResult: { id: "evt-1", etag: '"e"', summary: "Holiday", start: { date: "2026-09-18" }, end: { date: "2026-09-19" } } });
  await assert.rejects(proposeCalendarEdit(client, "primary", "evt-1", { kind: "resize", newEnd: "2026-09-18T20:00:00.000Z" }), /all-day/);
});

test("applyCalendarEdit patches with an If-Match header carrying the proposal's etag, and maps a 412 to stale-proposal", async () => {
  const seenOptions: unknown[] = [];
  const base = fakeBroadClient();
  const proposal = await proposeCalendarEdit(base, "primary", "evt-1", { kind: "move", newStart: "2026-09-18T18:00:00.000Z" });

  const client: CalendarBroadClient = {
    events: {
      ...base.events,
      patch: async (_params, options) => {
        seenOptions.push(options);
        throw Object.assign(new Error("Precondition Failed"), { code: 412 });
      },
    },
  };
  const result = await applyCalendarEdit(client, proposal);

  assert.deepEqual(seenOptions, [{ headers: { "If-Match": '"etag-1"' } }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "stale-proposal");
});

// ---- Second review pass: range-checked datetimes, move-duration guard, non-object throw safety ----

test("proposeCalendarEdit / proposeNewCalendarEvent reject a shape-valid but out-of-range datetime (e.g. Feb 30, hour 24) instead of silently rolling it over", async () => {
  const client = fakeBroadClient();
  for (const bad of ["2026-02-30T10:00:00Z", "2026-01-01T24:00:00Z", "2026-04-31T10:00:00Z"]) {
    await assert.rejects(proposeCalendarEdit(client, "primary", "evt-1", { kind: "move", newStart: bad }), /ISO-8601/);
    assert.throws(() => proposeNewCalendarEvent({ calendarId: "primary", title: "x", start: bad, end: "2026-09-18T15:00:00.000Z" }), /ISO-8601/);
  }
});

test("proposeCalendarEdit (move) rejects when the live event's own end is not after its start, rather than silently preserving a zero/negative duration", async () => {
  const client = fakeBroadClient({
    getResult: { id: "evt-1", etag: '"e"', summary: "Bad event", start: { dateTime: "2026-09-18T15:00:00.000Z" }, end: { dateTime: "2026-09-18T15:00:00.000Z" } },
  });
  await assert.rejects(proposeCalendarEdit(client, "primary", "evt-1", { kind: "move", newStart: "2026-09-18T18:00:00.000Z" }), /not after/);
});

test("applyCalendarEdit's non-primary guard also refuses a forged move/resize proposal (not just create)", async () => {
  const client = fakeBroadClient();
  const proposal = await proposeCalendarEdit(client, "primary", "evt-1", { kind: "move", newStart: "2026-09-18T18:00:00.000Z" });
  const forged = { ...proposal, suggested: { ...proposal.suggested, calendarId: "other-calendar" } as CalendarEditChange };

  const result = await applyCalendarEdit(client, forged);

  assert.equal(result.ok, false);
  assert.equal(client.patchCalls.length, 0);
});

test("applyCalendarEdit's 412 detection doesn't itself throw when the patch call rejects with a non-object value", async () => {
  const base = fakeBroadClient();
  const proposal = await proposeCalendarEdit(base, "primary", "evt-1", { kind: "move", newStart: "2026-09-18T18:00:00.000Z" });

  const client: CalendarBroadClient = {
    events: {
      ...base.events,
      patch: async () => {
        throw "boom"; // a non-object throw — the Result contract must still hold
      },
    },
  };

  const result = await applyCalendarEdit(client, proposal);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "unreachable");
});

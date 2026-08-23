/**
 * Tests for `src/adapters/calendar-adapter.ts` (Story 1.4 / Task 4).
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
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { calendar_v3 } from "@googleapis/calendar";
import type { GlobalOptions } from "@googleapis/calendar";
import {
  readCalendarEvents,
  createCalendarReadClient,
  type CalendarReadClient,
} from "../src/adapters/calendar-adapter.ts";

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

  const events = await readCalendarEvents(client, { now: FIXED_NOW });

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

  const events = await readCalendarEvents(client, { now: FIXED_NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.start, "2026-08-22T00:00:00.000Z");
  assert.equal(events[0]?.end, "2026-08-23T00:00:00.000Z");
});

test("readCalendarEvents only calls the read-scoped client's events.list — no insert/update/delete call anywhere", async () => {
  const client = new FakeCalendarReadClient([{ items: [] }]);

  await readCalendarEvents(client, { now: FIXED_NOW });

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

  const first = await readCalendarEvents(client, { now: FIXED_NOW });
  assert.equal(first.length, 1);
  assert.deepEqual(first.map((e) => e.id), ["event-1"]);

  // Simulates an event added to the primary calendar between two runs. No
  // caching layer exists in calendar-adapter.ts, so a second call must
  // re-query and include the new event with no manual re-sync step.
  const second = await readCalendarEvents(client, { now: FIXED_NOW });
  assert.equal(second.length, 2);
  assert.deepEqual(
    second.map((e) => e.id).sort(),
    ["event-1", "event-2"],
  );
  assert.equal(client.calls.length, 2);
});

test("readCalendarEvents defaults 'today' from the system clock and derives a UTC day window from an injected clock", async () => {
  const client = new FakeCalendarReadClient([{ items: [] }]);
  await readCalendarEvents(client, { now: () => new Date("2026-08-22T23:59:00.000Z") });

  const call = client.calls[0];
  assert.ok(call);
  assert.equal(call.timeMin, "2026-08-22T00:00:00.000Z");
  assert.equal(call.timeMax, "2026-08-23T00:00:00.000Z");
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

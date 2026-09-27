/**
 * Tests for `src/app/calendar-edit.ts` (Story 8.4).
 *
 * Moved/adapted from `tests/chat-cli.test.ts`'s `handleCalendarEditCommand`
 * end-to-end section, restructured for the one-shot
 * draft-then-`openProposal` shape: a valid move/resize/create now returns a
 * `question` (the confirm/apply happens on a LATER turn via
 * `answerOpenItem` -> `confirmProposal`, already covered by Story 8.2's own
 * tests) rather than blocking here for a "yes"/"no" line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { proposeCalendarEdit, type CalendarEditDeps } from "../src/app/calendar-edit.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import type { CalendarEvent } from "../src/types/domain.ts";

const TEAM_SYNC: CalendarEvent = { id: "evt-1", title: "Team sync", start: "2026-09-18T15:00:00.000Z", end: "2026-09-18T16:00:00.000Z" };
const TODAY = "2026-09-18";
const TIME_ZONE = "America/New_York";

function makeFakeLlmClient(responseText: string): AnthropicMessagesClient {
  return { messages: { create: async () => ({ content: [{ type: "text", text: responseText }] }) } } as unknown as AnthropicMessagesClient;
}

/** A real `:memory:` connection by default — `proposeCalendarEdit` calls the real `openProposal` (Story 8.2) whenever it actually builds a Proposal, so any test reaching that path needs somewhere real to persist into. Pass `connection` explicitly to share one across two calls (the conflict test below). */
function tempDeps(overrides: {
  events?: readonly CalendarEvent[];
  route?: { readonly kind: "owned" } | { readonly kind: "external" };
  llmResponse?: string;
  readEventsThrows?: boolean;
  connection?: SqliteConnection;
} = {}): CalendarEditDeps & { readonly connection: SqliteConnection } {
  const connection = overrides.connection ?? openSqliteConnection({ databasePath: ":memory:" });
  const store = createMemoryStore(connection);
  return {
    connection,
    store,
    llmClient: makeFakeLlmClient(overrides.llmResponse ?? "NONE"),
    timeZone: TIME_ZONE,
    readCalendarEventsFn: async () => {
      if (overrides.readEventsThrows) throw new Error("no Google credentials");
      return overrides.events ?? [];
    },
    resolveCalendarEditRouteFn: async () => overrides.route ?? { kind: "external" },
    proposeCalendarEditFn: async (calendarId, eventId, change) => ({
      id: `calendar-edit-${eventId}-1`,
      kind: "calendar-edit",
      entityId: eventId,
      entityVersion: "etag-1",
      suggested: change.kind === "move" ? { kind: "move", eventId, calendarId, newStart: change.newStart, newEnd: "2026-09-18T19:00:00.000Z" } : { kind: "resize", eventId, calendarId, newEnd: change.newEnd },
      reason: "adapter reason (overwritten by this file's own describeCalendarEditPreview)",
      createdAt: "2026-09-18T15:00:00.000Z",
    }),
    // The real adapter (`proposeNewCalendarEvent`) mints a fresh `id` per
    // call but always returns the SAME fixed `entityId: "new-event"` — this
    // fake mirrors both, so a test asserting two "create" calls don't
    // conflict exercises the real reason they don't (this file overrides
    // `entityId` to a fresh id before calling `openProposal` — see calendar-
    // edit.ts).
    proposeNewCalendarEventFn: ((): CalendarEditDeps["proposeNewCalendarEventFn"] => {
      let counter = 0;
      return (change) => ({
        id: `calendar-create-${++counter}`,
        kind: "calendar-edit",
        entityId: "new-event",
        entityVersion: "new",
        suggested: { kind: "create", calendarId: change.calendarId, title: change.title, start: change.start, end: change.end },
        reason: "adapter reason",
        createdAt: "2026-09-18T15:00:00.000Z",
      });
    })(),
  };
}

test("a message that only looks like a calendar edit (draft is NONE) returns the empty fall-through convention", async () => {
  const deps = tempDeps({ events: [TEAM_SYNC], llmResponse: "NONE" });
  const result = await proposeCalendarEdit(deps, { line: "move on to the next topic", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { reply: "", receipts: [] });
  deps.connection.close();
});

test("a MOVE-shaped but malformed draft is reported distinctly (not the empty fall-through)", async () => {
  const deps = tempDeps({ events: [TEAM_SYNC], llmResponse: "MOVE: Team sync | not a real time" });
  const result = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /I couldn't work out that calendar change/i);
  deps.connection.close();
});

test("a thrown error while reading today's events is reported as a reply, not a throw", async () => {
  const deps = tempDeps({ readEventsThrows: true });
  const result = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /no Google credentials/);
  deps.connection.close();
});

test("an event resolveCalendarEditRoute reports as 'owned' is declined — never proposed", async () => {
  const deps = tempDeps({ events: [TEAM_SYNC], route: { kind: "owned" }, llmResponse: "MOVE: Team sync | 2026-09-18T18:00:00.000Z" });
  const result = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /one of my own Plan blocks/);
  deps.connection.close();
});

test("an event named in the request that isn't found among today's events reports plainly", async () => {
  const deps = tempDeps({ events: [], llmResponse: "MOVE: Nonexistent meeting | 2026-09-18T18:00:00.000Z" });
  const result = await proposeCalendarEdit(deps, { line: "move nonexistent meeting to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /couldn't find/i);
  deps.connection.close();
});

test("two events with the same title are not guessed between — nothing is proposed", async () => {
  const deps = tempDeps({
    events: [
      { id: "a", title: "Standup", start: "2026-09-18T13:00:00.000Z", end: "2026-09-18T13:15:00.000Z" },
      { id: "b", title: "standup", start: "2026-09-18T20:00:00.000Z", end: "2026-09-18T20:15:00.000Z" },
    ],
    llmResponse: "MOVE: Standup | 2026-09-18T18:00:00.000Z",
  });
  const result = await proposeCalendarEdit(deps, { line: "move standup to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.value.reply, /2 events called "Standup"/);
    assert.match(result.value.reply, /Rename one so I can tell them apart/);
  }
  deps.connection.close();
});

test("an event with no id is never matched", async () => {
  const deps = tempDeps({ events: [{ id: "", title: "Standup", start: "2026-09-18T13:00:00.000Z", end: "2026-09-18T13:15:00.000Z" }], llmResponse: "MOVE: Standup | 2026-09-18T18:00:00.000Z" });
  const result = await proposeCalendarEdit(deps, { line: "move standup to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /couldn't find/i);
  deps.connection.close();
});

test("a valid move is persisted as an open Proposal and returned as `question`; the preview names the event, date, and year", async () => {
  const deps = tempDeps({ events: [TEAM_SYNC], llmResponse: "MOVE: Team sync | 2026-09-18T18:00:00.000Z" });
  const result = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "");
  assert.ok(result.value.question, "expected a follow-up confirm question");
  assert.match(result.value.question?.text ?? "", /Move "Team sync" to Fri, Sep 18, 2026, 2:00 PM/);
  deps.connection.close();
});

test("Review Focus #1: a second open calendar-edit proposal for the SAME event conflicts — openProposal itself enforces this (C4), proposeCalendarEdit surfaces it as a plain reply", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  createMemoryStore(connection);
  const deps = tempDeps({ events: [TEAM_SYNC], llmResponse: "MOVE: Team sync | 2026-09-18T18:00:00.000Z", connection });

  const first = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(first.ok, true);
  if (first.ok) assert.ok(first.value.question, "expected the first proposal to open cleanly");

  const second = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.match(second.value.reply, /already waiting/);
    assert.equal(second.value.question, undefined, "no second interaction request was created");
  }
  connection.close();
});

test("a create (no eventId) request skips route resolution and proposes directly", async () => {
  const deps = tempDeps({ llmResponse: "CREATE: Deep work | 2026-09-18T14:00:00.000Z | 2026-09-18T16:00:00.000Z" });
  const result = await proposeCalendarEdit(deps, { line: "create a time block for deep work", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.value.question);
  deps.connection.close();
});

test("Controller ruling: two consecutive 'create' calendar requests never conflict — each is keyed by its own fresh id, not the adapter's fixed 'new-event' placeholder", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  createMemoryStore(connection);
  const deps = tempDeps({ llmResponse: "CREATE: Deep work | 2026-09-18T14:00:00.000Z | 2026-09-18T16:00:00.000Z", connection });

  const first = await proposeCalendarEdit(deps, { line: "create a time block for deep work", today: TODAY });
  const second = await proposeCalendarEdit(deps, { line: "create a time block for admin", today: TODAY });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.ok(first.value.question);
  if (second.ok) assert.ok(second.value.question, "expected the SECOND create to ALSO open cleanly — no conflict (controller ruling)");
  connection.close();
});

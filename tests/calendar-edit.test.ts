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
import { createMemoryStore, getOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { proposeCalendarEdit, type CalendarEditDeps, type CalendarEditProposal } from "../src/app/calendar-edit.ts";
import { confirmProposal, type ConfirmProposalDeps } from "../src/app/confirm-proposal.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import type { CalendarEditChange, CalendarEvent, Proposal } from "../src/types/domain.ts";

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
  /** Final fix round (M3): the primary lookup (`resolveCalendarEditRouteFn`) throws — e.g. Google 404s a since-deleted event — to verify it is caught, not left to propagate. */
  resolveRouteThrows?: boolean;
} = {}): CalendarEditDeps & { readonly connection: SqliteConnection } {
  const connection = overrides.connection ?? openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db); // Task 7 (Epic 8): interaction-request writes (via openProposal) now append an outbox row.
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
    resolveCalendarEditRouteFn: async () => {
      if (overrides.resolveRouteThrows) throw new Error("Not Found");
      return overrides.route ?? { kind: "external" };
    },
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
  // Task 4 (real-use fixes plan): the known leftover from Task 2 — a
  // malformed CREATE used to leak `llm-adapter: CREATE response has an
  // invalid or out-of-range datetime: ...` verbatim. Now a plain, honest
  // sentence with no adapter wording.
  if (result.ok) assert.equal(result.value.reply, "I couldn't reach Claude right now; nothing was changed.");
  if (result.ok) assert.doesNotMatch(result.value.reply, /llm-adapter/);
  deps.connection.close();
});

test("a thrown error while reading today's events is reported as a reply, not a throw", async () => {
  const deps = tempDeps({ readEventsThrows: true });
  const result = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  // Task 4 (real-use fixes plan): a plain, honest sentence — never the raw
  // thrown message ("no Google credentials") verbatim.
  if (result.ok) assert.equal(result.value.reply, "I couldn't reach Google Calendar right now; nothing was changed.");
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
  // Post-review fix, Important #2: the persisted Proposal carries its own
  // past-tense receiptText, distinct from the future-tense question text
  // above — confirm-proposal.ts reads this, never `question.text`/`reason`.
  assert.equal((result.value.question?.proposal as CalendarEditProposal | undefined)?.receiptText, 'Moved "Team sync" to Fri, Sep 18, 2:00 PM–3:00 PM.');
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

// ============================================================================
// Real-use fixes plan, Task 2: the "create" confirm question names the
// event, the local day, and the local time range on one line, and says so
// when draftCalendarEditRequest had to assume the 60-minute default duration
// (no explicit end time or duration phrase in Spencer's line).
// ============================================================================

test("a 'create' confirm question names the event, the local day, and the local time range — an EXPLICIT duration is stated plainly, with no 'I assumed' note", async () => {
  const deps = tempDeps({ llmResponse: "CREATE: Meet with Alex | 2026-09-28T14:45:00.000Z | 2026-09-28T16:15:00.000Z | EXPLICIT" });
  const result = await proposeCalendarEdit(deps, {
    line: "make a event at 10:45 am tommorow to meet with alex. itll go for an hour and a half",
    today: "2026-09-27",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.question?.text ?? "", /^Create "Meet with Alex" on Mon, Sep 28, 10:45 AM–12:15 PM\?$/);
  assert.doesNotMatch(result.value.question?.text ?? "", /I assumed/);
  // Post-review fix, Important #2: the exact past-tense receipt, distinct
  // from the future-tense confirm question above.
  assert.equal((result.value.question?.proposal as CalendarEditProposal | undefined)?.receiptText, 'Added "Meet with Alex" to Google Calendar — Mon, Sep 28, 10:45 AM–12:15 PM.');
  deps.connection.close();
});

test("a 'create' confirm question says so when the duration was ASSUMED (no end/duration given) — the exact incident-adjacent wording", async () => {
  const deps = tempDeps({ llmResponse: "CREATE: Meeting with Alex | 2026-09-28T19:00:00.000Z | 2026-09-28T20:00:00.000Z | ASSUMED" });
  const result = await proposeCalendarEdit(deps, { line: "schedule a meeting with Alex tomorrow at 3", today: "2026-09-27" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.question?.text ?? "", /\(1 hour, I assumed\)\?$/);
  deps.connection.close();
});

test("a 'create' draft with no duration marker at all (older/malformed response shape), but Spencer's OWN line states a duration, is never reported as assumed — the deterministic cross-check (Important #3) trusts the drafted end because the line itself states the duration", async () => {
  const deps = tempDeps({ llmResponse: "CREATE: Deep work | 2026-09-18T14:00:00.000Z | 2026-09-18T16:00:00.000Z" });
  const result = await proposeCalendarEdit(deps, { line: "create a time block for deep work for 2 hours", today: TODAY });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.doesNotMatch(result.value.question?.text ?? "", /I assumed/);
  deps.connection.close();
});

// ============================================================================
// Post-review fix, Important #3: draftCalendarEditRequest's own optional
// ASSUMED/EXPLICIT marker is never trusted unconditionally — `proposeCalendarEdit`
// cross-checks it against Spencer's OWN line (core/calendar-duration.ts's
// `lineStatesDurationOrEnd`). A line with no duration/end at all is ALWAYS
// reported as assumed, even if the model's marker (wrongly) says EXPLICIT.
// ============================================================================

test("Important #3: a line with NO duration or end at all is always reported as assumed, even when the model's own marker (wrongly) says EXPLICIT", async () => {
  const deps = tempDeps({ llmResponse: "CREATE: Study block | 2026-09-18T20:00:00.000Z | 2026-09-18T21:00:00.000Z | EXPLICIT" });
  const result = await proposeCalendarEdit(deps, { line: "put a study block at 4 today", today: TODAY });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.question?.text ?? "", /\(1 hour, I assumed\)\?$/);
  deps.connection.close();
});

// ============================================================================
// Post-review fix (re-review, AD-9): `receiptText` lives on the ADDITIVE
// `CalendarEditProposal` type, never a widened `Proposal<T>` — this must
// still survive the REAL round trip: `openProposal` persists it into
// `memory-store.ts` (plain JSON), a later re-read (`getOpenInteractionRequest`
// — the same call `answerOpenItem` makes on a later turn) gets it back, and
// `confirmProposal` reads it off that RE-READ object, not the original
// in-memory one.
// ============================================================================

test("Important #2 (re-review): receiptText survives the real interaction-request store round-trip — persist (proposeCalendarEdit -> openProposal), re-read (getOpenInteractionRequest), confirm (confirmProposal)", async () => {
  const deps = tempDeps({ llmResponse: "CREATE: Meet with Alex | 2026-09-28T14:45:00.000Z | 2026-09-28T16:15:00.000Z | EXPLICIT" });

  const proposed = await proposeCalendarEdit(deps, {
    line: "make a event at 10:45 am tommorow to meet with alex. itll go for an hour and a half",
    today: "2026-09-27",
  });
  assert.equal(proposed.ok, true);
  if (!proposed.ok) return;
  const requestId = proposed.value.question?.requestId;
  assert.ok(requestId, "expected proposeCalendarEdit to persist an open interaction request");

  // Re-read fresh from the REAL store — a genuinely separate read from the
  // in-memory `proposed.value.question.proposal` object above, exercising
  // the same JSON persist/parse round-trip `answerOpenItem` relies on.
  const record = getOpenInteractionRequest(deps.store, requestId!);
  assert.ok(record, "expected the interaction request to be re-readable from the store");
  const detail = record!.data.detail as { readonly proposal?: CalendarEditProposal };
  assert.ok(detail.proposal, "expected the re-read record to carry the persisted proposal");
  assert.equal(detail.proposal!.receiptText, 'Added "Meet with Alex" to Google Calendar — Mon, Sep 28, 10:45 AM–12:15 PM.', "receiptText must survive the store round-trip byte-for-byte");

  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "calendar-create-1", calendarId: "primary" } });
  const confirmed = await confirmProposal({ store: deps.store, applyCalendarEdit }, { proposal: detail.proposal as Proposal<CalendarEditChange>, accept: true, requestId: requestId! });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.deepEqual(confirmed.value.receipts, ['Added "Meet with Alex" to Google Calendar — Mon, Sep 28, 10:45 AM–12:15 PM.']);
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

// ============================================================================
// Final fix round, M3: title matching only ever considers PRIMARY events
// (no `calendarId`) — an extra (school) calendar's event can never become
// an edit target, and Spencer gets an honest, plain reply instead of a
// Google 404 leaking out as a generic error.
// ============================================================================

const CHEMISTRY: CalendarEvent = {
  id: "school-evt-1",
  title: "Chemistry",
  start: "2026-09-18T20:00:00.000Z",
  end: "2026-09-18T21:00:00.000Z",
  calendarId: "spencerhatch@seattleacademy.org",
};

test("M3: the only title match is on an extra (school) calendar — a plain, honest reply, no adapter call, nothing thrown", async () => {
  const deps = tempDeps({ events: [CHEMISTRY], llmResponse: "MOVE: Chemistry | 2026-09-18T22:00:00.000Z" });
  const result = await proposeCalendarEdit(deps, { line: "move chemistry to 2pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.reply, '"Chemistry" is on your school calendar — I can only read it, not change it.');
    assert.equal(result.value.question, undefined, "no Proposal was opened");
  }
  deps.connection.close();
});

test("M3: a primary event and a same-titled extra-calendar event — only the primary one is matched, no disambiguation prompt", async () => {
  const deps = tempDeps({
    events: [TEAM_SYNC, { ...TEAM_SYNC, id: "school-evt-2", calendarId: "spencerhatch@seattleacademy.org" }],
    llmResponse: "MOVE: Team sync | 2026-09-18T18:00:00.000Z",
  });
  const result = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.value.question, "the primary match alone must resolve cleanly, not trigger the '2 events' disambiguation reply");
    assert.doesNotMatch(result.value.reply, /2 events/);
  }
  deps.connection.close();
});

test("M3: a thrown error resolving the primary event's route (e.g. a stale 404) is reported as a reply, never a throw", async () => {
  const deps = tempDeps({ events: [TEAM_SYNC], llmResponse: "MOVE: Team sync | 2026-09-18T18:00:00.000Z", resolveRouteThrows: true });
  const result = await proposeCalendarEdit(deps, { line: "move team sync to 6pm", today: TODAY });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reply, "I couldn't reach Google Calendar right now; nothing was changed.");
  deps.connection.close();
});

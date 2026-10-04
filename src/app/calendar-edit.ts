/**
 * src/app/calendar-edit.ts
 *
 * Story 8.4 (FR-27, AD-3, AD-13, AD-16). Recognizes and drafts a Calendar
 * move/resize/create request end-to-end EXCEPT the actual write: an
 * 'external' Proposal is persisted via `open-proposal.ts` (Story 8.2) and
 * its confirm question returned. `applyCalendarEdit` is called only from
 * `confirm-proposal.ts`'s `"calendar-edit"` branch (Story 8.2), reached via
 * `answerOpenItem` on a later turn — this file never calls it.
 *
 * Moved from `shell/chat-cli.ts`'s `handleCalendarEditCommand` (Story 6.6),
 * restructured out of its blocking confirm loop into this one-shot shape.
 * `resolveCalendarEditRoute`'s unreachable `'owned'` branch moves unchanged
 * (Epic 6 retro item 5 — Spencer's to reconcile).
 *
 * **Return convention (this file's own, not part of the wire contract):**
 * `{ reply: "", receipts: [], question: undefined }` — every field empty —
 * means "the line wasn't actually a Calendar edit" (the LLM draft came back
 * NONE). `chat-turn.ts` falls through to the tool loop for exactly this
 * shape; every other return communicates something real (an error line, a
 * disambiguation message, or a genuine confirm question).
 */
import { randomUUID } from "node:crypto";
import { draftCalendarEditRequest, type AnthropicMessagesClient, type DraftedCalendarEditRequest } from "../adapters/llm-adapter.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { lineStatesDurationOrEnd } from "../core/calendar-duration.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { openProposal, type OpenProposalDeps } from "./open-proposal.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { CalendarEditChange, CalendarEvent, ExternalId, IsoDate, Proposal, Result, YohError } from "../types/domain.ts";

export type ResolveCalendarEditRouteFn = (
  calendarId: string,
  eventId: string,
) => Promise<{ readonly kind: "owned" } | { readonly kind: "external" }>;

/** Mirrors `calendar-adapter.ts`'s own `MoveOrResizeChange` — redeclared here so this file never needs to import a Calendar SDK type. */
export type MoveOrResizeChange = { readonly kind: "move"; readonly newStart: string } | { readonly kind: "resize"; readonly newEnd: string };

export type ProposeCalendarEditAdapterFn = (
  calendarId: string,
  eventId: ExternalId,
  change: MoveOrResizeChange,
) => Promise<Proposal<CalendarEditChange>>;

export type ProposeNewCalendarEventFn = (change: {
  readonly calendarId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
}) => Proposal<CalendarEditChange>;

/**
 * Post-review fix (re-review, AD-9): a `"calendar-edit"` Proposal, ADDITIVELY
 * extended with its own past-tense `receiptText` — never widen the SHARED
 * `Proposal<T>` in `types/domain.ts` itself (AD-9: "no file may locally
 * redeclare, widen, or shadow a type `domain.ts` already exports" — the
 * first-round fix did exactly that, adding an optional `receiptText?` field
 * to `Proposal<T>` for every kind, which this type replaces). This file
 * builds the value (`proposeCalendarEdit` below); `openProposal` still
 * accepts it structurally as a `Proposal<unknown>` (an intersection with
 * extra own properties is always assignable to a narrower — here, wider —
 * shape it's a superset of); `confirm-proposal.ts`'s `"calendar-edit"`
 * branch asserts `proposal as CalendarEditProposal` to read it back.
 */
export type CalendarEditProposal = Proposal<CalendarEditChange> & { readonly receiptText: string };

export interface CalendarEditDeps extends OpenProposalDeps {
  readonly llmClient: AnthropicMessagesClient;
  readonly timeZone: string;
  readonly readCalendarEventsFn: () => Promise<readonly CalendarEvent[]>;
  readonly resolveCalendarEditRouteFn: ResolveCalendarEditRouteFn;
  readonly proposeCalendarEditFn: ProposeCalendarEditAdapterFn;
  readonly proposeNewCalendarEventFn: ProposeNewCalendarEventFn;
  /** Real-use fixes plan, Task 9: passed straight through to `draftCalendarEditRequest`'s own trailing `connection` argument so its usage gets recorded. Optional, mirroring `CreateItemDeps`'s identical field. */
  readonly connection?: SqliteConnection;
}

export interface CalendarEditInput {
  readonly line: string;
  readonly today: IsoDate;
}

const EMPTY: ChatTurnResponse = { reply: "", receipts: [] };

/** `iso` as Spencer's local weekday, date, year, and wall-clock time — the date AND year matter: the drafted datetime is LLM-computed, so a wrong day (or year) must be visible before confirming. */
function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** `iso`'s local weekday + month + day (no year, no time) — real-use fixes plan, Task 2's "create" confirm names the day once, then a single local time range, rather than repeating the full date on both ends. */
function formatLocalDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

/** `iso`'s local wall-clock time only (no date) — paired with `formatLocalDay` for a "create" confirm's time range. */
function formatLocalClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** The "(N hour(s), I assumed)"/"(N min, I assumed)" note appended to a "create" confirm when `draftCalendarEditRequest` had to default the duration (Task 2) — computed from the actual start/end rather than hardcoded, though today that default is always exactly 60 minutes. */
function formatAssumedDurationNote(start: string, end: string): string {
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  const label = minutes > 0 && minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} min`;
  return ` (${label}, I assumed)`;
}

/**
 * Future-tense preview only — a real, distinct QUESTION (always ends "?"
 * for "create"; unchanged, no "?" for move/resize, matching how those two
 * read before this task). The past-tense RECEIPT (below,
 * `describeCalendarEditReceipt`) is a separate string, computed here (where
 * `eventTitle`/`timeZone` are both already in hand) and carried on the
 * persisted proposal as `CalendarEditProposal.receiptText` (Task 2,
 * post-review fix, Important #2 — and, re-review, built as an ADDITIVE type
 * rather than a new field on the shared `Proposal<T>`, per AD-9) —
 * `app/confirm-proposal.ts`'s `"calendar-edit"` branch reads THAT, never
 * `proposal.reason`, for what Spencer sees after he says yes. (Before this
 * fix, confirm-proposal.ts reused `proposal.reason` verbatim as the receipt
 * too, so confirming showed Spencer back his own still-future-tense,
 * still-"?"-suffixed confirm question instead of a real receipt.)
 *
 * Real-use fixes plan, Task 2: a "create" preview names the event, the
 * local day, and the local time range on one line (e.g. 'Create "Meet with
 * Alex" on Sat Sep 28, 10:45 AM–12:15 PM?'), and says so when the duration
 * was assumed rather than stated (`durationAssumed` — only ever set for
 * `change.kind === "create"`, via `draftCalendarEditRequest`'s own
 * `durationAssumed` flag, cross-checked against Spencer's own line by
 * `proposeCalendarEdit` below — see Important #3's fix).
 */
function describeCalendarEditPreview(change: CalendarEditChange, eventTitle: string, timeZone: string, durationAssumed = false): string {
  switch (change.kind) {
    case "move":
      return `Move "${eventTitle}" to ${formatLocalTime(change.newStart, timeZone)}–${formatLocalTime(change.newEnd, timeZone)}`;
    case "resize":
      return `Resize "${eventTitle}" to end at ${formatLocalTime(change.newEnd, timeZone)}`;
    case "create": {
      const day = formatLocalDay(change.start, timeZone);
      const startTime = formatLocalClock(change.start, timeZone);
      const endTime = formatLocalClock(change.end, timeZone);
      const assumedNote = durationAssumed ? formatAssumedDurationNote(change.start, change.end) : "";
      return `Create "${eventTitle}" on ${day}, ${startTime}–${endTime}${assumedNote}?`;
    }
    case "delete":
      return `Delete "${eventTitle}"`;
  }
}

/**
 * Past-tense receipt (Task 2, post-review fix, Important #2) — what Spencer
 * sees AFTER he says yes, via `confirm-proposal.ts`'s `"calendar-edit"`
 * branch reading this `CalendarEditProposal`'s own `receiptText` (never
 * `proposal.reason`, which stays the future-tense confirm question, still
 * ending "?" for "create"). A statement, never a question — no trailing "?"
 * on any branch.
 */
function describeCalendarEditReceipt(change: CalendarEditChange, eventTitle: string, timeZone: string): string {
  switch (change.kind) {
    case "move":
      return `Moved "${eventTitle}" to ${formatLocalDay(change.newStart, timeZone)}, ${formatLocalClock(change.newStart, timeZone)}–${formatLocalClock(change.newEnd, timeZone)}.`;
    case "resize":
      return `Resized "${eventTitle}" — now ends ${formatLocalDay(change.newEnd, timeZone)}, ${formatLocalClock(change.newEnd, timeZone)}.`;
    case "create":
      return `Added "${eventTitle}" to Google Calendar — ${formatLocalDay(change.start, timeZone)}, ${formatLocalClock(change.start, timeZone)}–${formatLocalClock(change.end, timeZone)}.`;
    case "delete":
      return `Deleted "${eventTitle}".`;
  }
}

export async function proposeCalendarEdit(deps: CalendarEditDeps, input: CalendarEditInput): Promise<Result<ChatTurnResponse, YohError>> {
  let events: readonly CalendarEvent[];
  try {
    events = await deps.readCalendarEventsFn();
  } catch (err) {
    return { ok: true, value: { reply: errorCopyForThrown(err, { service: "Google Calendar" }), receipts: [] } };
  }

  let draft: DraftedCalendarEditRequest | undefined;
  try {
    draft = await draftCalendarEditRequest(
      deps.llmClient,
      input.line,
      input.today,
      deps.timeZone,
      events.map((e) => ({ title: e.title, start: e.start, end: e.end })),
      deps.connection,
    );
  } catch (err) {
    // Known leftover from Task 2: a malformed CREATE response used to leak
    // `llm-adapter: CREATE response has an invalid or out-of-range
    // datetime: ...` verbatim. `errorCopyForThrown` (Task 4,
    // `core/error-copy.ts`) always drops a thrown adapter's raw `.message`
    // for an `"unreachable"`-shaped failure — a bad/unparseable model
    // response is, from Spencer's side, indistinguishable from "couldn't
    // reach it."
    return { ok: true, value: { reply: errorCopyForThrown(err, { service: "Claude" }), receipts: [] } };
  }

  if (!draft) return { ok: true, value: EMPTY }; // not actually a calendar edit — chat-turn.ts falls through.

  let proposal: Proposal<CalendarEditChange>;
  let eventTitle: string;

  if (draft.kind === "create") {
    eventTitle = draft.title;
    proposal = deps.proposeNewCalendarEventFn({ calendarId: "primary", title: draft.title, start: draft.start, end: draft.end });
  } else {
    const requestedTitle = draft.eventTitle.trim().toLowerCase();
    const titleMatches = events.filter((e) => e.id !== "" && e.title.trim().toLowerCase() === requestedTitle);
    // Final fix round (M3): title-match only Spencer's PRIMARY calendar
    // (`calendarId === undefined`) — an extra (e.g. school) calendar's event
    // can never become an edit target, same as the adapter's own
    // `assertPrimaryCalendar`. If the only matches are on an extra
    // calendar, say so plainly instead of routing "primary" + that event's
    // (extra-calendar) id into `resolveCalendarEditRouteFn`, which would
    // 404 against Google.
    const matches = titleMatches.filter((e) => e.calendarId === undefined);
    if (matches.length === 0) {
      const extraMatch = titleMatches.find((e) => e.calendarId !== undefined);
      if (extraMatch) {
        return {
          ok: true,
          value: { reply: `"${extraMatch.title}" is on your school calendar — I can only read it, not change it.`, receipts: [] },
        };
      }
      return { ok: true, value: { reply: `I couldn't find an event called "${draft.eventTitle}" on today's calendar.`, receipts: [] } };
    }
    if (matches.length > 1) {
      return {
        ok: true,
        value: {
          reply: `You have ${matches.length} events called "${draft.eventTitle}" today (${matches.map((e) => formatLocalTime(e.start, deps.timeZone)).join("; ")}) — I won't guess which one. Rename one so I can tell them apart, then try again.`,
          receipts: [],
        },
      };
    }
    const matchedEvent = matches[0]!;
    eventTitle = matchedEvent.title;

    let route: { readonly kind: "owned" } | { readonly kind: "external" };
    try {
      route = await deps.resolveCalendarEditRouteFn("primary", matchedEvent.id);
    } catch (err) {
      return { ok: true, value: { reply: errorCopyForThrown(err, { service: "Google Calendar" }), receipts: [] } };
    }
    if (route.kind === "owned") {
      return { ok: true, value: { reply: "That's one of my own Plan blocks — ask me to re-flow the day to adjust it instead.", receipts: [] } };
    }

    try {
      proposal = await deps.proposeCalendarEditFn("primary", matchedEvent.id, draft.kind === "move" ? { kind: "move", newStart: draft.newStart } : { kind: "resize", newEnd: draft.newEnd });
    } catch (err) {
      return { ok: true, value: { reply: errorCopyForThrown(err, { service: "Google Calendar" }), receipts: [] } };
    }
  }

  // Controller ruling: a `create` Proposal's own adapter-provided `entityId`
  // ("new-event", a fixed placeholder) would make every "create" request
  // collide with every other — override it to a fresh id so two independent
  // captures never conflict. `move`/`resize`'s `entityId` (the real event
  // id, set by `proposeCalendarEditFn`/the adapter) is left untouched —
  // THAT is the one case `openProposal`'s conflict rule should actually fire
  // for (Review Focus #1).
  const entityId = draft.kind === "create" ? `calendar-create-${randomUUID()}` : proposal.entityId;

  // Post-review fix, Important #3: `draft.durationAssumed` (the model's own
  // optional ASSUMED/EXPLICIT marker on the CREATE response line) is never
  // trusted unconditionally — `lineStatesDurationOrEnd` is a deterministic,
  // pure cross-check (`core/calendar-duration.ts`) over Spencer's OWN line.
  // If his line states neither a duration nor an explicit end at all, the
  // duration is ALWAYS treated as assumed, regardless of what the marker
  // claims (a model that forgets to say ASSUMED must never silently
  // understate that a 60-minute default was applied). If his line DOES
  // state a duration or an end, the marker (and the drafted end itself) is
  // trusted as-is.
  const durationAssumed = draft.kind === "create" ? (lineStatesDurationOrEnd(input.line) ? draft.durationAssumed : true) : false;

  const preview = describeCalendarEditPreview(proposal.suggested, eventTitle, deps.timeZone, durationAssumed);
  // Post-review fix, Important #2 (re-review: additive type, not a widened
  // shared Proposal<T>, per AD-9): the past-tense receipt is a SEPARATE
  // string from `preview` (the future-tense confirm question) — computed
  // here, where `eventTitle`/`timeZone` are both in hand, and carried on the
  // persisted proposal (as a `CalendarEditProposal`) so `confirm-proposal.ts`
  // never has to (and never again reuses `proposal.reason`, a future-tense,
  // "?"-suffixed question, as if it were a receipt). `openProposal` still
  // accepts this structurally as a `Proposal<unknown>` — the extra
  // `receiptText` field rides along through `memory-store.ts`'s plain
  // JSON persistence untouched (pinned by this file's own round-trip test).
  const receiptText = describeCalendarEditReceipt(proposal.suggested, eventTitle, deps.timeZone);
  const proposalWithReceipt: CalendarEditProposal = { ...proposal, entityId, reason: preview, receiptText };
  const opened = await openProposal(deps, { proposal: proposalWithReceipt });
  if (!opened.ok) {
    // Review Focus #1 — openProposal's own conflict rule (Story 8.2, C4) —
    // reachable only for the move/resize (existing-entity) branch above.
    return { ok: true, value: { reply: `I'm already waiting on your answer about a change to "${eventTitle}" — answer that first.`, receipts: [] } };
  }

  return { ok: true, value: { reply: "", receipts: [], question: opened.value } };
}

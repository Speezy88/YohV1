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
 * NONE). `chat-turn.ts` falls through to `answerQuestion` for exactly this
 * shape; every other return communicates something real (an error line, a
 * disambiguation message, or a genuine confirm question).
 */
import { randomUUID } from "node:crypto";
import { draftCalendarEditRequest, type AnthropicMessagesClient, type DraftedCalendarEditRequest } from "../adapters/llm-adapter.ts";
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

export interface CalendarEditDeps extends OpenProposalDeps {
  readonly llmClient: AnthropicMessagesClient;
  readonly timeZone: string;
  readonly readCalendarEventsFn: () => Promise<readonly CalendarEvent[]>;
  readonly resolveCalendarEditRouteFn: ResolveCalendarEditRouteFn;
  readonly proposeCalendarEditFn: ProposeCalendarEditAdapterFn;
  readonly proposeNewCalendarEventFn: ProposeNewCalendarEventFn;
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

/** Future-tense preview only — the past-tense receipt is `app/confirm-proposal.ts`'s own job (Story 8.2, built before this file existed — its receipt for `"calendar-edit"` is `proposal.reason` verbatim, i.e. this exact preview string). */
function describeCalendarEditPreview(change: CalendarEditChange, eventTitle: string, timeZone: string): string {
  switch (change.kind) {
    case "move":
      return `Move "${eventTitle}" to ${formatLocalTime(change.newStart, timeZone)}–${formatLocalTime(change.newEnd, timeZone)}`;
    case "resize":
      return `Resize "${eventTitle}" to end at ${formatLocalTime(change.newEnd, timeZone)}`;
    case "create":
      return `Create "${eventTitle}" from ${formatLocalTime(change.start, timeZone)} to ${formatLocalTime(change.end, timeZone)}`;
  }
}

export async function proposeCalendarEdit(deps: CalendarEditDeps, input: CalendarEditInput): Promise<Result<ChatTurnResponse, YohError>> {
  let events: readonly CalendarEvent[];
  try {
    events = await deps.readCalendarEventsFn();
  } catch (err) {
    return { ok: true, value: { reply: `I hit a problem with that calendar change: ${err instanceof Error ? err.message : String(err)}`, receipts: [] } };
  }

  let draft: DraftedCalendarEditRequest | undefined;
  try {
    draft = await draftCalendarEditRequest(deps.llmClient, input.line, input.today, deps.timeZone, events.map((e) => ({ title: e.title, start: e.start, end: e.end })));
  } catch (err) {
    return { ok: true, value: { reply: `I couldn't work out that calendar change: ${err instanceof Error ? err.message : String(err)}`, receipts: [] } };
  }

  if (!draft) return { ok: true, value: EMPTY }; // not actually a calendar edit — chat-turn.ts falls through.

  let proposal: Proposal<CalendarEditChange>;
  let eventTitle: string;

  if (draft.kind === "create") {
    eventTitle = draft.title;
    proposal = deps.proposeNewCalendarEventFn({ calendarId: "primary", title: draft.title, start: draft.start, end: draft.end });
  } else {
    const requestedTitle = draft.eventTitle.trim().toLowerCase();
    const matches = events.filter((e) => e.id !== "" && e.title.trim().toLowerCase() === requestedTitle);
    if (matches.length === 0) {
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

    const route = await deps.resolveCalendarEditRouteFn("primary", matchedEvent.id);
    if (route.kind === "owned") {
      return { ok: true, value: { reply: "That's one of my own Plan blocks — ask me to re-flow the day to adjust it instead.", receipts: [] } };
    }

    try {
      proposal = await deps.proposeCalendarEditFn("primary", matchedEvent.id, draft.kind === "move" ? { kind: "move", newStart: draft.newStart } : { kind: "resize", newEnd: draft.newEnd });
    } catch (err) {
      return { ok: true, value: { reply: `I hit a problem with that calendar change: ${err instanceof Error ? err.message : String(err)}`, receipts: [] } };
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
  const preview = describeCalendarEditPreview(proposal.suggested, eventTitle, deps.timeZone);
  const opened = await openProposal(deps, { proposal: { ...proposal, entityId, reason: preview } });
  if (!opened.ok) {
    // Review Focus #1 — openProposal's own conflict rule (Story 8.2, C4) —
    // reachable only for the move/resize (existing-entity) branch above.
    return { ok: true, value: { reply: `I'm already waiting on your answer about a change to "${eventTitle}" — answer that first.`, receipts: [] } };
  }

  return { ok: true, value: { reply: "", receipts: [], question: opened.value } };
}

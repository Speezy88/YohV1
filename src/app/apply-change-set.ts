/**
 * src/app/apply-change-set.ts
 *
 * Applies a confirmed chat change set (`app/chat-agent.ts` stages it,
 * `app/confirm-proposal.ts` calls this on a yes). Each item goes through
 * the same write path its single-change equivalent uses. A failed item
 * never stops the rest; every item reports its own outcome.
 */
import { describeChangeSetItem, orderForApply } from "../core/chat-tools.ts";
import { errorCopy, errorCopyForThrown, type ErrorCopyContext } from "../core/error-copy.ts";
import type {
  CalendarEditChange,
  ChangeSet,
  ChangeSetItem,
  ChangeSetItemResult,
  NotionDatabaseTarget,
  Proposal,
  Result,
  YohError,
} from "../types/domain.ts";

export const CHANGE_SET_PROPOSAL_KIND = "change-set";

const PRIMARY_CALENDAR = "primary";

export interface ApplyChangeSetDeps {
  readonly timeZone: string;
  readonly now: () => Date;
  readonly applyCalendarEdit: (proposal: Proposal<CalendarEditChange>) => Promise<Result<{ readonly eventId: string; readonly calendarId: string }, YohError>>;
  readonly createPage: (database: NotionDatabaseTarget, properties: Readonly<Record<string, string>>) => Promise<Result<{ readonly pageId: string; readonly url?: string }, YohError>>;
  /** `app/update-task.ts`'s `updateTask`, pre-bound to its deps. */
  readonly updateTaskField: (taskId: string, field: "dueDate" | "estimatedDurationMinutes" | "priority", value: string) => Promise<Result<{ readonly receipt: string }, YohError>>;
  /** `app/update-task.ts`'s `renameTask`, pre-bound. */
  readonly renameTask: (taskId: string, title: string) => Promise<Result<{ readonly receipt: string }, YohError>>;
  /** `app/check-off.ts`'s `checkOff`, pre-bound: keeps the Completion Log entry and the undo window. */
  readonly completeTask: (taskId: string) => Promise<Result<unknown, YohError>>;
  /** `app/plan-day.ts`'s `planDay`, pre-bound. */
  readonly planDay: () => Promise<Result<{ readonly reply: string }, YohError>>;
  /** `requestReshuffle({kind:"reflow-now"})` then `approveReshuffle`, pre-bound. */
  readonly refitPlan: () => Promise<Result<{ readonly reply: string }, YohError>>;
}

function calendarProposal(deps: ApplyChangeSetDeps, entityId: string, entityVersion: string, suggested: CalendarEditChange): Proposal<CalendarEditChange> {
  return { id: `change-set:${entityId}`, kind: "calendar-edit", entityId, entityVersion, suggested, reason: "", createdAt: deps.now().toISOString() };
}

/** "Add "X" on …" → "Added "X" on …." — the receipt is the staged line in past tense. */
const PAST: Readonly<Record<ChangeSetItem["kind"], readonly [string, string]>> = {
  "create-event": ["Add", "Added"],
  "move-event": ["Move", "Moved"],
  "resize-event": ["End", "Ended"],
  "delete-event": ["Delete", "Deleted"],
  "create-task": ["Create", "Created"],
  "update-task": ["Set", "Set"],
  "rename-task": ["Rename", "Renamed"],
  "complete-task": ["Mark", "Marked"],
  "plan-day": ["Build", "Built"],
  "refit-plan": ["Re-fit", "Re-fit"],
};

function receipt(item: ChangeSetItem, timeZone: string, extra?: string): string {
  const line = describeChangeSetItem(item, timeZone);
  const [present, past] = PAST[item.kind];
  return `${past}${line.slice(present.length)}.${extra ? ` ${extra}` : ""}`;
}

const CALENDAR_KINDS: ReadonlySet<ChangeSetItem["kind"]> = new Set(["create-event", "move-event", "resize-event", "delete-event"]);
const NOTION_KINDS: ReadonlySet<ChangeSetItem["kind"]> = new Set(["create-task", "update-task", "rename-task", "complete-task"]);

function serviceContext(item: ChangeSetItem): ErrorCopyContext {
  if (CALENDAR_KINDS.has(item.kind)) return { service: "Google Calendar" };
  if (NOTION_KINDS.has(item.kind)) return { service: "Notion" };
  return {};
}

function failureText(item: ChangeSetItem, timeZone: string, copy: string): string {
  const line = describeChangeSetItem(item, timeZone);
  return `Couldn't ${line[0]!.toLowerCase()}${line.slice(1)}: ${copy}`;
}

async function applyItem(deps: ApplyChangeSetDeps, item: ChangeSetItem): Promise<Result<string | undefined, YohError>> {
  switch (item.kind) {
    case "create-event": {
      const r = await deps.applyCalendarEdit(calendarProposal(deps, "new", "", { kind: "create", calendarId: PRIMARY_CALENDAR, title: item.title, start: item.start, end: item.end }));
      return r.ok ? { ok: true, value: undefined } : r;
    }
    case "move-event": {
      const r = await deps.applyCalendarEdit(calendarProposal(deps, item.eventId, item.etag, { kind: "move", eventId: item.eventId, calendarId: PRIMARY_CALENDAR, newStart: item.newStart, newEnd: item.newEnd }));
      return r.ok ? { ok: true, value: undefined } : r;
    }
    case "resize-event": {
      const r = await deps.applyCalendarEdit(calendarProposal(deps, item.eventId, item.etag, { kind: "resize", eventId: item.eventId, calendarId: PRIMARY_CALENDAR, newEnd: item.newEnd }));
      return r.ok ? { ok: true, value: undefined } : r;
    }
    case "delete-event": {
      const r = await deps.applyCalendarEdit(calendarProposal(deps, item.eventId, item.etag, { kind: "delete", eventId: item.eventId, calendarId: PRIMARY_CALENDAR }));
      return r.ok ? { ok: true, value: undefined } : r;
    }
    case "create-task": {
      const r = await deps.createPage("Tasks", item.properties);
      return r.ok ? { ok: true, value: undefined } : r;
    }
    case "update-task": {
      const r = await deps.updateTaskField(item.taskId, item.field, item.value);
      return r.ok ? { ok: true, value: undefined } : r;
    }
    case "rename-task": {
      const r = await deps.renameTask(item.taskId, item.newTitle);
      return r.ok ? { ok: true, value: undefined } : r;
    }
    case "complete-task": {
      const r = await deps.completeTask(item.taskId);
      return r.ok ? { ok: true, value: undefined } : r;
    }
    case "plan-day": {
      const r = await deps.planDay();
      return r.ok ? { ok: true, value: r.value.reply } : r;
    }
    case "refit-plan": {
      const r = await deps.refitPlan();
      return r.ok ? { ok: true, value: r.value.reply } : r;
    }
  }
}

export async function applyChangeSet(
  deps: ApplyChangeSetDeps,
  input: { readonly changeSet: ChangeSet },
): Promise<Result<{ readonly results: readonly ChangeSetItemResult[] }, YohError>> {
  const items = input.changeSet?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: { kind: "validation", message: "There was nothing to apply." } };
  }
  const results: ChangeSetItemResult[] = [];
  for (const item of orderForApply(items)) {
    let outcome: Result<string | undefined, YohError>;
    try {
      outcome = await applyItem(deps, item);
    } catch (err) {
      results.push({ item, ok: false, text: failureText(item, deps.timeZone, errorCopyForThrown(err, serviceContext(item))) });
      continue;
    }
    results.push(
      outcome.ok
        ? { item, ok: true, text: receipt(item, deps.timeZone, outcome.value) }
        : { item, ok: false, text: failureText(item, deps.timeZone, errorCopy(outcome.error, serviceContext(item))) },
    );
  }
  return { ok: true, value: { results } };
}

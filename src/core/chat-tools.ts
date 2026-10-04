/**
 * src/core/chat-tools.ts
 *
 * The pure half of the chat tool loop (`app/chat-agent.ts`): tool
 * definitions sent to the model, input checks, task totals, and the copy a
 * staged change set is shown with. No I/O.
 */
import { localIsoDate, localMinutesToIso } from "./local-time.ts";
import type { ChangeSetItem, IsoDate, IsoDateTime, Task } from "../types/domain.ts";

/** The most model calls one chat turn may make before the loop stops. */
export const CHAT_AGENT_MAX_STEPS = 8;

export interface ChatToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: { readonly type: "object"; readonly properties: Readonly<Record<string, unknown>>; readonly required?: readonly string[] };
}

const DATE = { type: "string", description: "A local date, YYYY-MM-DD." } as const;
const TIME = { type: "string", description: "A local 24-hour clock time, HH:MM." } as const;

export const CHAT_TOOLS: readonly ChatToolDefinition[] = [
  {
    name: "list_tasks",
    description: "Read Spencer's Notion Tasks. Returns the matching tasks and totals (count, totalMinutes, missingDurationCount) computed for you. Use the totals; do not add durations yourself.",
    input_schema: {
      type: "object",
      properties: {
        dueFrom: DATE,
        dueTo: DATE,
        titleQuery: { type: "string", description: "Case-insensitive text the title must contain." },
        includeCompleted: { type: "boolean" },
      },
    },
  },
  {
    name: "list_events",
    description: "Read Google Calendar events for one local date. Each event has an id you must use for move, resize or delete.",
    input_schema: { type: "object", properties: { date: DATE }, required: ["date"] },
  },
  { name: "get_plan", description: "Read today's stored Plan blocks.", input_schema: { type: "object", properties: {} } },
  {
    name: "search_memory",
    description: "Search what Yoh remembers about Spencer.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "web_search",
    description: "Search the web for current facts.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "create_event",
    description: "Stage a new calendar event. Nothing is written until Spencer approves.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, date: DATE, startTime: TIME, endTime: TIME },
      required: ["title", "date", "startTime", "endTime"],
    },
  },
  {
    name: "move_event",
    description: "Stage moving an existing event (id from list_events) to a new time on a date.",
    input_schema: {
      type: "object",
      properties: { eventId: { type: "string" }, date: DATE, startTime: TIME, endTime: TIME },
      required: ["eventId", "date", "startTime", "endTime"],
    },
  },
  {
    name: "resize_event",
    description: "Stage changing an existing event's end time (id from list_events).",
    input_schema: { type: "object", properties: { eventId: { type: "string" }, date: DATE, endTime: TIME }, required: ["eventId", "date", "endTime"] },
  },
  {
    name: "delete_event",
    description: "Stage deleting an event Yoh created (yohCreated is true in list_events). Any other event cannot be deleted here.",
    input_schema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
  },
  {
    name: "create_task",
    description: "Stage a new Notion Task.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, dueDate: DATE, estimatedDurationMinutes: { type: "integer", minimum: 1 } },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Stage a change to one field of an existing Task (id from list_tasks). field is dueDate, estimatedDurationMinutes, priority or title.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        field: { type: "string", enum: ["dueDate", "estimatedDurationMinutes", "priority", "title"] },
        value: { type: "string" },
      },
      required: ["taskId", "field", "value"],
    },
  },
  {
    name: "complete_task",
    description: "Stage marking a Task done (id from list_tasks).",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  { name: "plan_day", description: "Stage building today's Plan from Tasks and Calendar. Use when there is no Plan yet.", input_schema: { type: "object", properties: {} } },
  { name: "refit_plan", description: "Stage re-fitting the rest of today's existing Plan around the calendar.", input_schema: { type: "object", properties: {} } },
];

const READ_TOOLS = new Set(["list_tasks", "list_events", "get_plan", "search_memory", "web_search"]);

export function isWriteTool(name: string): boolean {
  return CHAT_TOOLS.some((t) => t.name === name) && !READ_TOOLS.has(name);
}

export interface TaskFilter {
  readonly dueFrom?: string;
  readonly dueTo?: string;
  readonly titleQuery?: string;
  readonly includeCompleted?: boolean;
}

export function filterTasks(tasks: readonly Task[], filter: TaskFilter): readonly Task[] {
  const query = filter.titleQuery?.trim().toLowerCase();
  const ranged = filter.dueFrom !== undefined || filter.dueTo !== undefined;
  return tasks.filter((t) => {
    if (!filter.includeCompleted && t.status === "completed") return false;
    if (ranged) {
      if (t.dueDate === undefined) return false;
      if (filter.dueFrom !== undefined && t.dueDate < filter.dueFrom) return false;
      if (filter.dueTo !== undefined && t.dueDate > filter.dueTo) return false;
    }
    if (query && !t.title.toLowerCase().includes(query)) return false;
    return true;
  });
}

export interface TaskTotals {
  readonly count: number;
  readonly totalMinutes: number;
  readonly missingDurationCount: number;
}

export function summarizeTasks(tasks: readonly Task[]): TaskTotals {
  let totalMinutes = 0;
  let missingDurationCount = 0;
  for (const t of tasks) {
    if (t.estimatedDurationMinutes === undefined) missingDurationCount++;
    else totalMinutes += t.estimatedDurationMinutes;
  }
  return { count: tasks.length, totalMinutes, missingDurationCount };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clockMinutes(time: string): number | undefined {
  const m = TIME_RE.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export function resolveEventTimes(
  input: { readonly date: string; readonly startTime: string; readonly endTime: string },
  timeZone: string,
): { readonly ok: true; readonly start: IsoDateTime; readonly end: IsoDateTime } | { readonly ok: false; readonly message: string } {
  if (!DATE_RE.test(input.date)) return { ok: false, message: "date must be YYYY-MM-DD." };
  const start = clockMinutes(input.startTime);
  const end = clockMinutes(input.endTime);
  if (start === undefined || end === undefined) return { ok: false, message: "startTime and endTime must be HH:MM in 24-hour time." };
  if (end <= start) return { ok: false, message: "endTime must be after startTime on the same date." };
  return { ok: true, start: localMinutesToIso(input.date as IsoDate, start, timeZone), end: localMinutesToIso(input.date as IsoDate, end, timeZone) };
}

function clock(iso: IsoDateTime, timeZone: string): string {
  // Newer ICU puts a narrow no-break space before AM/PM; normalize so copy is plain ASCII spaces.
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(/\u202f/g, " ");
}

function day(iso: IsoDateTime, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
}

const FIELD_WORDS = { dueDate: "due date", estimatedDurationMinutes: "duration", priority: "priority" } as const;

export function describeChangeSetItem(item: ChangeSetItem, timeZone: string): string {
  switch (item.kind) {
    case "create-event":
      return `Add "${item.title}" on ${day(item.start, timeZone)}, ${clock(item.start, timeZone)}–${clock(item.end, timeZone)}`;
    case "move-event":
      return `Move "${item.label}" to ${day(item.newStart, timeZone)}, ${clock(item.newStart, timeZone)}–${clock(item.newEnd, timeZone)}`;
    case "resize-event":
      return `End "${item.label}" at ${clock(item.newEnd, timeZone)}`;
    case "delete-event":
      return `Delete "${item.label}" from your calendar`;
    case "create-task":
      return `Create the Task "${item.properties["title"] ?? ""}"`;
    case "update-task":
      return `Set the ${FIELD_WORDS[item.field]} of "${item.label}" to ${item.field === "estimatedDurationMinutes" ? `${item.value} min` : item.value}`;
    case "rename-task":
      return `Rename "${item.label}" to "${item.newTitle}"`;
    case "complete-task":
      return `Mark "${item.label}" done`;
    case "plan-day":
      return "Build today's Plan";
    case "refit-plan":
      return "Re-fit the rest of today's Plan";
  }
}

/** Closing line of a change set that replaces an earlier, unanswered one. */
export const CHANGE_SET_REPLACES_NOTE = "This replaces the changes I suggested earlier, which are no longer pending.";

/** Closing line when a write tool was refused this turn but other items were staged. */
export const CHANGE_SET_PARTIAL_NOTE = "Some of what you asked for isn't in this list because I can't do it here.";

/** Reply to a bare yes/no/approve/discard typed while a change set is open: the card is the only way to answer it. */
export const CHANGE_SET_USE_CARD_REPLY = "Use Approve or Discard on the card above.";

export function changeSetPrompt(
  items: readonly ChangeSetItem[],
  timeZone: string,
  options: { readonly replacesEarlier?: boolean; readonly someRejected?: boolean } = {},
): string {
  return [
    "Here's what I'd change:",
    ...items.map((i) => `- ${describeChangeSetItem(i, timeZone)}`),
    "Approve to apply all of it, or discard to change nothing.",
    ...(options.someRejected ? [CHANGE_SET_PARTIAL_NOTE] : []),
    ...(options.replacesEarlier ? [CHANGE_SET_REPLACES_NOTE] : []),
  ].join("\n");
}

const isPlanStep = (item: ChangeSetItem): boolean => item.kind === "plan-day" || item.kind === "refit-plan";

export function orderForApply(items: readonly ChangeSetItem[]): readonly ChangeSetItem[] {
  return [...items.filter((i) => !isPlanStep(i)), ...items.filter(isPlanStep)];
}

/** Appended to a reply that claimed (or followed a rejected attempt at) a write that was never staged. */
export const NOTHING_CHANGED_NOTE = "Nothing has been changed.";

const WRITE_VERBS = "added|moved|deleted|removed|created|scheduled|rescheduled|booked|saved|updated|marked|built|re-fit|refit|cancelled|canceled";
const WRITE_CLAIM_PATTERNS: readonly RegExp[] = [
  /^\s*(done|all set)\b/i,
  /\ball set\b/i,
  /\bgone ahead and\b/i,
  new RegExp(`(^|[.!?\\n])\\s*(${WRITE_VERBS})\\b`, "i"),
  new RegExp(`\\b(was|were)\\s+(${WRITE_VERBS})\\b`, "i"),
  new RegExp(`\\b(i've|i have|i)\\s+(${WRITE_VERBS})\\b`, "i"),
  new RegExp(`\\b(has|have)\\s+been\\s+(${WRITE_VERBS})\\b`, "i"),
  /\b(is|are)\s+now\s+(on|in)\s+your\s+(calendar|tasks|plan)\b/i,
];

/** True when model prose says a change was made. With nothing staged, no change was. */
export function claimsAWrite(text: string): boolean {
  return WRITE_CLAIM_PATTERNS.some((p) => p.test(text));
}

const STAGING_CLAIM_PATTERNS: readonly RegExp[] = [
  /(^|[.!?\n])\s*(staging|staged)\b/i,
  /\b(i've|i have|i)\s+staged\b/i,
  /\bstaging area\b/i,
  /(^|[.!?\n])\s*confirm\b[^.!?\n]*\?/i,
  /\bonce you (confirm|approve)\b/i,
];

/**
 * True when model prose says a change is staged or asks for a typed confirm.
 * A real staged change is never reported in model prose (the reply is
 * `changeSetPrompt` and the answer is the card), so with nothing staged this is false.
 */
export function claimsStaging(text: string): boolean {
  return STAGING_CLAIM_PATTERNS.some((p) => p.test(text));
}

/** Replaces a reply that still claims a write or a staged change when nothing was staged. */
export const UNSTAGED_CLAIM_REPLY = "Nothing was staged or changed. I described a change without making it. Ask again; if no Approve card appears, it's something I can't do here.";

/** Sent back to the model, once per turn, when its prose claims a write or a staged change and nothing is staged. */
export const UNSTAGED_CLAIM_CORRECTION =
  "Nothing is staged and nothing has changed: text alone does neither. If a tool covers the request, call it now. If no tool covers it, say plainly that you can't do that. Do not say anything was staged, changed, or is waiting for a confirm.";

/** A change set is valid only on the local day (host time zone) it was staged. */
export function changeSetIsStale(createdAt: string, now: Date, timeZone: string): boolean {
  if (Number.isNaN(new Date(createdAt).getTime())) return true;
  return localIsoDate(new Date(createdAt), timeZone) !== localIsoDate(now, timeZone);
}

/**
 * The date and time lines of the chat system prompt: today, the local time, tomorrow, and the
 * dates of the six days after it, so the model never has to work out (or ask) what "tomorrow" or "Monday" is.
 * Days are stepped on the calendar date, not by adding 24 hours, so a daylight-saving change cannot skip or repeat one.
 */
export function chatDateContext(now: Date, timeZone: string): string {
  const today = localIsoDate(now, timeZone);
  const day = (offset: number) => {
    const d = new Date(`${today}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return {
      iso: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      monthDay: d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }),
    };
  };
  const t = day(0);
  const tomorrow = day(1);
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(/\u202f/g, " ");
  const ahead = [2, 3, 4, 5, 6, 7].map((n) => day(n)).map((d) => `${d.weekday} ${d.iso}`).join(", ");
  return [
    `Today is ${t.weekday}, ${t.monthDay}, ${t.iso.slice(0, 4)} (${t.iso}). The local time is ${time}, time zone ${timeZone}.`,
    `Tomorrow is ${tomorrow.weekday}, ${tomorrow.monthDay} (${tomorrow.iso}). After that: ${ahead}.`,
    "Work out dates such as tomorrow, tonight or Monday from these lines. Never ask Spencer what the date or time is.",
  ].join("\n");
}

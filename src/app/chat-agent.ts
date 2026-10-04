/**
 * src/app/chat-agent.ts
 *
 * The chat tool loop: what a free-form chat line reaches once no
 * deterministic recognizer in `app/chat-turn.ts` matched. Read tools run
 * immediately. Write tools only stage a `ChangeSetItem`; the staged set is
 * stored as one "change-set" Proposal and applied by `confirmProposal` on
 * an explicit yes. This file never writes to Notion or Calendar.
 */
import { randomUUID } from "node:crypto";
import { runToolTurn, type AnthropicMessagesClient, type ToolTurnMessage } from "../adapters/llm-adapter.ts";
import { clearInteractionRequest, getPlan, listOpenInteractionRequests, type MemoryStore } from "../adapters/memory-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import {
  CHAT_AGENT_MAX_STEPS,
  CHAT_TOOLS,
  changeSetPrompt,
  claimsAWrite,
  NOTHING_CHANGED_NOTE,
  isWriteTool,
  filterTasks,
  resolveEventTimes,
  summarizeTasks,
  type TaskFilter,
} from "../core/chat-tools.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { localIsoDate } from "../core/local-time.ts";
import type { MemoryContext } from "../core/memory-context.ts";
import { CHANGE_SET_PROPOSAL_KIND } from "./apply-change-set.ts";
import { openProposal } from "./open-proposal.ts";
import type { ChatStreamEvent, ChatTurnResponse } from "../types/api.ts";
import type { CalendarEvent, ChangeSet, ChangeSetItem, ChatTurn, IsoDate, Proposal, Result, Task, YohError } from "../types/domain.ts";

export const CHAT_AGENT_STEP_CAP_REPLY = "I stopped before finishing that — it took more steps than I allow in one turn. Nothing was changed. Try asking for one part at a time.";

const STATUS_BY_TOOL: Readonly<Record<string, string>> = {
  list_tasks: "Checking your Tasks…",
  list_events: "Checking your Calendar…",
  get_plan: "Checking today's Plan…",
  search_memory: "Checking what I remember…",
  web_search: "Searching the web…",
};

export interface ChatAgentDeps {
  readonly llmClient: AnthropicMessagesClient;
  readonly store: MemoryStore;
  readonly connection?: SqliteConnection;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly readCalendarEventsForDate: (date: IsoDate) => Promise<readonly CalendarEvent[]>;
  /** `app/memory-search.ts`'s `searchMemory`, pre-bound and reduced to text for the model. */
  readonly searchMemory: (query: string) => Promise<Result<{ readonly text: string }, YohError>>;
  /** `app/web-search.ts`'s `searchWeb`, pre-bound and reduced to text for the model. */
  readonly searchWeb: (query: string) => Promise<Result<{ readonly text: string }, YohError>>;
  readonly emit?: (event: ChatStreamEvent) => void;
  readonly log?: (entry: LogEntry) => void;
}

export interface ChatAgentInput {
  readonly message: string;
  readonly history: readonly ChatTurn[];
  /** The tone system prompt `chatTurn` already resolves for this message. */
  readonly systemPrompt: string;
  readonly memory?: MemoryContext;
}

interface ToolOutcome {
  readonly content: string;
  readonly isError?: boolean;
}

/** What the read tools returned this turn — the only ids a write tool may name. */
interface Seen {
  readonly tasks: Map<string, Task>;
  readonly events: Map<string, CalendarEvent>;
}

function agentSystemPrompt(tone: string, now: Date, timeZone: string): string {
  const longDate = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(/\u202f/g, " ");
  return [
    tone,
    "",
    `Today is ${longDate} (${localIsoDate(now, timeZone)}). The local time is ${time}, time zone ${timeZone}. Never ask what the date is.`,
    "You have tools to read Spencer's Tasks, Calendar, Plan and memory. Use them instead of saying you lack access.",
    "Write tools only stage a change. Spencer then approves or discards everything staged in one step. Never say a change has been made, added, moved, deleted or saved. Say what you have staged.",
    "Use ids exactly as a read tool returned them in this turn. Call list_tasks or list_events first when you need an id.",
    "If a request needs something no tool covers (Canvas, deleting an event Yoh did not create), say plainly that you can't do that.",
  ].join("\n");
}

const err = (content: string): ToolOutcome => ({ content, isError: true });
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function localClock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

async function runReadTool(deps: ChatAgentDeps, name: string, args: Record<string, unknown>, seen: Seen): Promise<ToolOutcome> {
  try {
    if (name === "list_tasks") {
      const tasks = filterTasks(await deps.readTasks(), args as TaskFilter);
      for (const t of tasks) seen.tasks.set(t.id, t);
      return {
        content: JSON.stringify({
          totals: summarizeTasks(tasks),
          tasks: tasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, estimatedDurationMinutes: t.estimatedDurationMinutes, priority: t.priority, status: t.status })),
        }),
      };
    }
    if (name === "list_events") {
      const date = str(args["date"]);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("date must be YYYY-MM-DD.");
      const events = await deps.readCalendarEventsForDate(date as IsoDate);
      for (const e of events) seen.events.set(e.id, e);
      return {
        content: JSON.stringify({
          date,
          events: events.map((e) => ({
            id: e.id,
            title: e.title,
            localStart: localClock(e.start, deps.timeZone),
            localEnd: localClock(e.end, deps.timeZone),
            allDay: e.allDay === true,
            editable: e.calendarId === undefined,
            yohCreated: e.yohCreated === true,
          })),
        }),
      };
    }
    if (name === "get_plan") {
      const plan = getPlan(deps.store, localIsoDate(deps.now(), deps.timeZone));
      if (!plan) return { content: JSON.stringify({ plan: null, note: "There is no Plan for today yet." }) };
      return {
        content: JSON.stringify({
          blocks: plan.data.blocks.map((b) => ({ kind: b.kind, label: b.label, localStart: localClock(b.start, deps.timeZone), localEnd: localClock(b.end, deps.timeZone) })),
        }),
      };
    }
    const query = str(args["query"]);
    if (!query) return err("query is required.");
    const found = name === "search_memory" ? await deps.searchMemory(query) : await deps.searchWeb(query);
    return found.ok ? { content: found.value.text } : err(found.error.message);
  } catch (thrown) {
    deps.log?.({ level: "error", event: "chat-agent.read-tool-failed", detail: { tool: name, message: thrown instanceof Error ? thrown.message : String(thrown) } });
    return err(errorCopyForThrown(thrown));
  }
}

function sameTarget(a: ChangeSetItem, b: ChangeSetItem): boolean {
  switch (b.kind) {
    case "plan-day":
    case "refit-plan":
      return a.kind === "plan-day" || a.kind === "refit-plan";
    case "move-event":
    case "resize-event":
    case "delete-event":
      return (a.kind === "move-event" || a.kind === "resize-event" || a.kind === "delete-event") && a.eventId === b.eventId;
    case "update-task":
      return a.kind === "update-task" && a.taskId === b.taskId && a.field === b.field;
    case "rename-task":
      return a.kind === "rename-task" && a.taskId === b.taskId;
    case "complete-task":
      return a.kind === "complete-task" && a.taskId === b.taskId;
    default:
      return false;
  }
}

/** One staged item per target: a later item for the same event, task field or plan step replaces the earlier one. */
function stage(staged: ChangeSetItem[], item: ChangeSetItem): void {
  for (let i = staged.length - 1; i >= 0; i--) {
    if (sameTarget(staged[i]!, item)) staged.splice(i, 1);
  }
  staged.push(item);
}

function runWriteTool(deps: ChatAgentDeps, name: string, args: Record<string, unknown>, seen: Seen, staged: ChangeSetItem[]): ToolOutcome {
  const stagedOk = (item: ChangeSetItem): ToolOutcome => {
    stage(staged, item);
    return { content: "Staged. Nothing is written until Spencer approves." };
  };

  if (name === "plan_day") return stagedOk({ kind: "plan-day" });
  if (name === "refit_plan") {
    if (!getPlan(deps.store, localIsoDate(deps.now(), deps.timeZone))) return err("There is no Plan for today to re-fit. Use plan_day.");
    return stagedOk({ kind: "refit-plan" });
  }

  if (name === "create_event") {
    const title = str(args["title"]);
    if (!title) return err("title is required.");
    const times = resolveEventTimes({ date: String(args["date"] ?? ""), startTime: String(args["startTime"] ?? ""), endTime: String(args["endTime"] ?? "") }, deps.timeZone);
    if (!times.ok) return err(times.message);
    return stagedOk({ kind: "create-event", title, start: times.start, end: times.end });
  }

  if (name === "move_event" || name === "resize_event" || name === "delete_event") {
    const event = seen.events.get(String(args["eventId"] ?? ""));
    if (!event) return err("No event with that id was returned by list_events in this turn. Call list_events first and use its id.");
    if (event.calendarId !== undefined) return err("That event is on a read-only calendar and can't be changed here.");
    if (!event.etag) return err("That event can't be changed right now.");
    if (name === "delete_event") {
      if (event.yohCreated !== true) return err("I can only delete events Yoh created. Tell Spencer to delete this one in Google Calendar.");
      return stagedOk({ kind: "delete-event", eventId: event.id, label: event.title, etag: event.etag });
    }
    const date = String(args["date"] ?? "");
    if (name === "move_event") {
      const times = resolveEventTimes({ date, startTime: String(args["startTime"] ?? ""), endTime: String(args["endTime"] ?? "") }, deps.timeZone);
      if (!times.ok) return err(times.message);
      return stagedOk({ kind: "move-event", eventId: event.id, label: event.title, etag: event.etag, newStart: times.start, newEnd: times.end });
    }
    const times = resolveEventTimes({ date, startTime: localClock(event.start, deps.timeZone), endTime: String(args["endTime"] ?? "") }, deps.timeZone);
    if (!times.ok) return err(times.message);
    return stagedOk({ kind: "resize-event", eventId: event.id, label: event.title, etag: event.etag, newEnd: times.end });
  }

  if (name === "create_task") {
    const title = str(args["title"]);
    if (!title) return err("title is required.");
    const properties: Record<string, string> = { title };
    const due = str(args["dueDate"]);
    if (due) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return err("dueDate must be YYYY-MM-DD.");
      properties["dueDate"] = due;
    }
    const minutes = args["estimatedDurationMinutes"];
    if (minutes !== undefined) {
      if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1) return err("estimatedDurationMinutes must be a whole number of minutes.");
      properties["estimatedDurationMinutes"] = String(minutes);
    }
    return stagedOk({ kind: "create-task", properties });
  }

  if (name === "update_task" || name === "complete_task") {
    const task = seen.tasks.get(String(args["taskId"] ?? ""));
    if (!task) return err("No Task with that id was returned by list_tasks in this turn. Call list_tasks first and use its id.");
    if (name === "complete_task") return stagedOk({ kind: "complete-task", taskId: task.id, label: task.title });
    const field = String(args["field"] ?? "");
    const value = str(args["value"]);
    if (!value) return err("value is required.");
    if (field === "title") return stagedOk({ kind: "rename-task", taskId: task.id, label: task.title, newTitle: value });
    if (field !== "dueDate" && field !== "estimatedDurationMinutes" && field !== "priority") return err("field must be dueDate, estimatedDurationMinutes, priority or title.");
    return stagedOk({ kind: "update-task", taskId: task.id, label: task.title, field, value });
  }

  return err(`Unknown tool "${name}".`);
}

function guardedWriteTool(deps: ChatAgentDeps, name: string, args: Record<string, unknown>, seen: Seen, staged: ChangeSetItem[]): ToolOutcome {
  try {
    return runWriteTool(deps, name, args, seen, staged);
  } catch (thrown) {
    deps.log?.({ level: "error", event: "chat-agent.write-tool-failed", detail: { tool: name, message: thrown instanceof Error ? thrown.message : String(thrown) } });
    return err(errorCopyForThrown(thrown));
  }
}

/** A newer change set replaces an older one that was never answered. */
function clearOpenChangeSets(store: MemoryStore): void {
  for (const record of listOpenInteractionRequests(store)) {
    if (record.data.requestKind !== "proposal") continue;
    const proposal = (record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined)?.proposal;
    if (proposal?.kind === CHANGE_SET_PROPOSAL_KIND) clearInteractionRequest(store, record.id, record.version);
  }
}

export async function chatAgent(deps: ChatAgentDeps, input: ChatAgentInput): Promise<Result<ChatTurnResponse, YohError>> {
  const systemPrompt = agentSystemPrompt(input.systemPrompt, deps.now(), deps.timeZone);
  const messages: ToolTurnMessage[] = input.history.map((t) => ({ role: t.role, content: t.content }));
  const seen: Seen = { tasks: new Map(), events: new Map() };
  const staged: ChangeSetItem[] = [];
  let finalText: string | undefined;
  let wroteAttempted = false;

  try {
    for (let step = 0; step < CHAT_AGENT_MAX_STEPS; step++) {
      const turn = await runToolTurn(deps.llmClient, {
        systemPrompt,
        messages,
        tools: CHAT_TOOLS,
        ...(input.memory ? { memory: input.memory } : {}),
        ...(deps.connection ? { connection: deps.connection } : {}),
      });
      if (turn.toolUses.length === 0) {
        finalText = turn.text;
        break;
      }
      messages.push({ role: "assistant", content: turn.assistantContent });
      const results: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];
      for (const toolUse of turn.toolUses) {
        const args = (typeof toolUse.input === "object" && toolUse.input !== null ? toolUse.input : {}) as Record<string, unknown>;
        const status = STATUS_BY_TOOL[toolUse.name];
        if (status) deps.emit?.({ type: "status", text: status });
        if (isWriteTool(toolUse.name)) wroteAttempted = true;
        const outcome = status ? await runReadTool(deps, toolUse.name, args, seen) : guardedWriteTool(deps, toolUse.name, args, seen, staged);
        results.push({ type: "tool_result", tool_use_id: toolUse.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (thrown) {
    deps.log?.({ level: "error", event: "chat-agent.model-call-failed", detail: { message: thrown instanceof Error ? thrown.message : String(thrown) } });
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(thrown) } };
  }

  if (staged.length > 0) {
    const reply = changeSetPrompt(staged, deps.timeZone);
    const proposal: Proposal<ChangeSet> = {
      id: randomUUID(),
      kind: CHANGE_SET_PROPOSAL_KIND,
      entityId: "chat",
      entityVersion: "",
      suggested: { items: staged },
      reason: reply,
      createdAt: deps.now().toISOString(),
    };
    try {
      clearOpenChangeSets(deps.store);
    } catch (thrown) {
      return { ok: false, error: { kind: "conflict", message: errorCopyForThrown(thrown) } };
    }
    const opened = await openProposal({ store: deps.store, now: deps.now }, { proposal });
    if (!opened.ok) return opened;
    return { ok: true, value: { reply, receipts: [], question: opened.value, substantive: true } };
  }

  if (finalText === undefined) return { ok: true, value: { reply: CHAT_AGENT_STEP_CAP_REPLY, receipts: [] } };
  const text = finalText.length > 0 ? finalText : "I don't have an answer for that.";
  // Nothing was staged, so nothing changed: never let prose say otherwise.
  const reply = wroteAttempted || claimsAWrite(text) ? `${text}\n\n${NOTHING_CHANGED_NOTE}` : text;
  deps.emit?.({ type: "delta", text: reply });
  return { ok: true, value: { reply, receipts: [], substantive: true } };
}

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
import { clearInteractionRequest, getPlan, hasOpenProposalOfKind, listOpenInteractionRequests, type MemoryStore } from "../adapters/memory-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import {
  CHAT_AGENT_MAX_STEPS,
  CHAT_TOOLS,
  changeSetIsStale,
  chatDateContext,
  changeSetPrompt,
  claimsAWrite,
  claimsStaging,
  NOTHING_CHANGED_NOTE,
  UNSTAGED_CLAIM_CORRECTION,
  UNSTAGED_CLAIM_REPLY,
  isWriteTool,
  filterTasks,
  planBlockEdits,
  resolveEventTimes,
  resolveLocalTime,
  summarizeTasks,
  type TaskFilter,
} from "../core/chat-tools.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { localIsoDate } from "../core/local-time.ts";
import type { MemoryContext } from "../core/memory-context.ts";
import { CHANGE_SET_PROPOSAL_KIND } from "./apply-change-set.ts";
import { openProposal } from "./open-proposal.ts";
import type { ChatStreamEvent, ChatTurnResponse } from "../types/api.ts";
import type { CalendarEvent, ChangeSet, ChangeSetItem, ChatTurn, IsoDate, PlanBlock, Proposal, Result, Task, YohError } from "../types/domain.ts";

export const CHAT_AGENT_TRUNCATED_NOTE = "That answer was cut off for length. Ask for the rest if you need it.";
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
  readonly blocks: Map<string, PlanBlock>;
}

function agentSystemPrompt(tone: string, now: Date, timeZone: string): string {
  return [
    tone,
    "",
    chatDateContext(now, timeZone),
    "You have tools to read Spencer's Tasks, Calendar, Plan and memory. Use them instead of saying you lack access.",
    "A Plan exists only for today. You cannot read, build or reorder a Plan for another day; say so plainly instead of asking for more.",
    "Write tools only stage a change. Spencer then approves or discards everything staged in one step. Never say a change has been made, added, moved, deleted or saved.",
    "Only a write tool call stages a change; describing one in text does nothing. Never ask Spencer to confirm in text: the Approve card is the only confirmation.",
    "Use ids exactly as a read tool returned them in this turn. Call list_tasks, list_events or get_plan first when you need an id.",
    "To change one block of today's Plan, call get_plan, then move_block, resize_block or remove_block. Use refit_plan only when Spencer asks to re-fit the whole day.",
    "If a request needs something no tool covers (Canvas, deleting an event Yoh did not create, resizing or removing a Routine or break), say plainly that you can't do that.",
  ].join("\n");
}

/** With nothing staged, prose that says a change was made, is staged, or awaits a typed confirm is false. */
const claimsUnstagedChange = (text: string): boolean => claimsAWrite(text) || claimsStaging(text);

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
      const nowMs = deps.now().getTime();
      seen.blocks.clear();
      for (const b of plan.data.blocks) seen.blocks.set(b.id, b);
      return {
        content: JSON.stringify({
          blocks: plan.data.blocks.map((b) => ({
            id: b.id,
            kind: b.kind,
            label: b.label,
            localStart: localClock(b.start, deps.timeZone),
            localEnd: localClock(b.end, deps.timeZone),
            ...planBlockEdits(b, nowMs),
          })),
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

/** The Task or Routine a staged block edit acts on; `undefined` for any other item. */
function blockKey(item: ChangeSetItem): string | undefined {
  if (item.kind === "move-block") return item.subject.kind === "task" ? `t:${item.subject.taskId}` : `r:${item.subject.routineId}`;
  if (item.kind === "resize-block" || item.kind === "remove-block") return `t:${item.taskId}`;
  return undefined;
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
    case "move-block":
      return (a.kind === "move-block" && blockKey(a) === blockKey(b)) || (a.kind === "remove-block" && blockKey(a) === blockKey(b));
    case "resize-block":
      return (a.kind === "resize-block" || a.kind === "remove-block") && a.taskId === b.taskId;
    case "remove-block":
      return blockKey(a) !== undefined && blockKey(a) === blockKey(b);
    case "update-task":
      return a.kind === "update-task" && a.taskId === b.taskId && a.field === b.field;
    case "rename-task":
      return a.kind === "rename-task" && a.taskId === b.taskId;
    case "complete-task":
      return a.kind === "complete-task" && a.taskId === b.taskId;
    case "delete-task":
      return (a.kind === "update-task" || a.kind === "rename-task" || a.kind === "complete-task" || a.kind === "delete-task") && a.taskId === b.taskId;
    default:
      return false;
  }
}

/** One staged item per target: a later item for the same event, task field or plan step replaces the earlier one, and deleting a Task replaces every earlier change to it. */
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

  if (name === "plan_day") {
    if (getPlan(deps.store, localIsoDate(deps.now(), deps.timeZone))) return err("There is already a Plan for today. Use refit_plan to re-fit it.");
    return stagedOk({ kind: "plan-day" });
  }
  if (name === "refit_plan") {
    if (!getPlan(deps.store, localIsoDate(deps.now(), deps.timeZone))) return err("There is no Plan for today to re-fit. Use plan_day.");
    return stagedOk({ kind: "refit-plan" });
  }

  if (name === "move_block" || name === "resize_block" || name === "remove_block") {
    const block = seen.blocks.get(String(args["blockId"] ?? ""));
    if (!block) return err("No block with that id was returned by get_plan in this turn. Call get_plan first and use its id.");
    const nowMs = deps.now().getTime();
    const can = planBlockEdits(block, nowMs);
    if (name === "move_block") {
      if (!can.canMove) return err("That block can't be moved: only a Task or Routine block that hasn't started can.");
      const newStart = resolveLocalTime(localIsoDate(deps.now(), deps.timeZone), String(args["startTime"] ?? ""), deps.timeZone);
      if (!newStart) return err("startTime must be HH:MM in 24-hour time.");
      if (Date.parse(newStart) < nowMs) return err("startTime must be later today.");
      const subject = block.kind === "routine" ? ({ kind: "routine", routineId: block.routineId! } as const) : ({ kind: "task", taskId: block.taskId! } as const);
      return stagedOk({ kind: "move-block", subject, label: block.label, newStart });
    }
    if (name === "remove_block") {
      if (!can.canRemove) return err("That block can't be removed: only a Task's block that hasn't started can. Routines, breaks and calendar events stay.");
      return stagedOk({ kind: "remove-block", taskId: block.taskId!, label: block.label });
    }
    if (!can.canResize) return err("That block can't be resized: only a Task's block that hasn't started can. Routines, breaks and calendar events keep their length.");
    let durationMinutes = args["durationMinutes"];
    if (durationMinutes === undefined) {
      const upcoming = [...seen.blocks.values()].filter((b) => b.kind === "work" && b.taskId === block.taskId && Date.parse(b.start) >= nowMs);
      if (upcoming.length > 1) return err("That Task is split across several blocks today. Give durationMinutes, its total work time for the rest of today, instead of endTime.");
      const newEnd = resolveLocalTime(localIsoDate(new Date(block.start), deps.timeZone), String(args["endTime"] ?? ""), deps.timeZone);
      if (!newEnd) return err("Give endTime as HH:MM in 24-hour time, or durationMinutes.");
      durationMinutes = Math.round((Date.parse(newEnd) - Date.parse(block.start)) / 60_000);
      if ((durationMinutes as number) <= 0) return err("endTime must be after the block's start.");
    }
    if (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 1) return err("durationMinutes must be a whole number of minutes.");
    return stagedOk({ kind: "resize-block", taskId: block.taskId!, label: block.label, durationMinutes });
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
    // A resize keeps the event's own day; the model's `date` is ignored.
    const times = resolveEventTimes({ date: localIsoDate(new Date(event.start), deps.timeZone), startTime: localClock(event.start, deps.timeZone), endTime: String(args["endTime"] ?? "") }, deps.timeZone);
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

  if (name === "update_task" || name === "complete_task" || name === "delete_task") {
    const task = seen.tasks.get(String(args["taskId"] ?? ""));
    if (!task) return err("No Task with that id was returned by list_tasks in this turn. Call list_tasks first and use its id.");
    if (name === "complete_task") return stagedOk({ kind: "complete-task", taskId: task.id, label: task.title });
    if (name === "delete_task") return stagedOk({ kind: "delete-task", taskId: task.id, label: task.title });
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
  const seen: Seen = { tasks: new Map(), events: new Map(), blocks: new Map() };
  const staged: ChangeSetItem[] = [];
  let finalText: string | undefined;
  let wroteAttempted = false;
  let writeRejected = false;
  let ranTool = false;
  let corrected = false;
  // The model was stopped (step cap or output limit) before it finished the request.
  let incomplete = true;
  let truncatedText = false;

  try {
    for (let step = 0; step < CHAT_AGENT_MAX_STEPS; step++) {
      const turn = await runToolTurn(deps.llmClient, {
        systemPrompt,
        messages,
        tools: CHAT_TOOLS,
        ...(input.memory ? { memory: input.memory } : {}),
        ...(deps.connection ? { connection: deps.connection } : {}),
      });
      if (turn.truncated) {
        // A cut-off turn's tool calls may be partial: run none of them.
        if (turn.toolUses.length === 0 && turn.text.length > 0) {
          finalText = turn.text;
          truncatedText = true;
        }
        break;
      }
      if (turn.toolUses.length === 0) {
        // A false claim gets one chance to become a real tool call (or a plain "can't") before it is replaced below.
        if (staged.length === 0 && !corrected && claimsUnstagedChange(turn.text)) {
          corrected = true;
          messages.push({ role: "assistant", content: turn.assistantContent }, { role: "user", content: UNSTAGED_CLAIM_CORRECTION });
          continue;
        }
        finalText = turn.text;
        incomplete = false;
        break;
      }
      messages.push({ role: "assistant", content: turn.assistantContent });
      const results: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];
      for (const toolUse of turn.toolUses) {
        const args = (typeof toolUse.input === "object" && toolUse.input !== null ? toolUse.input : {}) as Record<string, unknown>;
        ranTool = true;
        const status = STATUS_BY_TOOL[toolUse.name];
        if (status) deps.emit?.({ type: "status", text: status });
        if (isWriteTool(toolUse.name)) wroteAttempted = true;
        const outcome = status ? await runReadTool(deps, toolUse.name, args, seen) : guardedWriteTool(deps, toolUse.name, args, seen, staged);
        if (!status && outcome.isError) writeRejected = true;
        results.push({ type: "tool_result", tool_use_id: toolUse.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (thrown) {
    deps.log?.({ level: "error", event: "chat-agent.model-call-failed", detail: { message: thrown instanceof Error ? thrown.message : String(thrown) } });
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(thrown) } };
  }

  if (staged.length > 0) {
    let replacesEarlier = false;
    try {
      replacesEarlier = hasOpenProposalOfKind(deps.store, CHANGE_SET_PROPOSAL_KIND, (createdAt) => changeSetIsStale(createdAt, deps.now(), deps.timeZone));
    } catch {
      // the clear below reports a store failure
    }
    const reply = changeSetPrompt(staged, deps.timeZone, { replacesEarlier, someRejected: writeRejected, incomplete });
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
  const answered = claimsUnstagedChange(text) ? UNSTAGED_CLAIM_REPLY : wroteAttempted ? `${text}\n\n${NOTHING_CHANGED_NOTE}` : text;
  const reply = truncatedText ? `${answered}\n\n${CHAT_AGENT_TRUNCATED_NOTE}` : answered;
  deps.emit?.({ type: "delta", text: reply });
  // Only a turn that ran a tool is substantive (rating eligibility); a plain answer carries no key.
  return { ok: true, value: { reply, receipts: [], ...(ranTool ? { substantive: true as const } : {}) } };
}

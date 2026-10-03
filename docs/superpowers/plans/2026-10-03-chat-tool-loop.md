# Chat Tool Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free-form chat can read Tasks, Calendar, the Plan and memory, and stage calendar, Notion and Plan changes that apply together on one yes.

**Architecture:** The LLM tail of `chatTurn` (`classifyCapture` → `classifyChatIntent` → `answerQuestion`) is replaced by one app function, `chatAgent`, that runs a bounded Haiku tool loop. Read tools execute immediately. Write tools only append to a change set, which is stored as one `"change-set"` Proposal and applied by `confirmProposal` through a new `applyChangeSet` app function that reuses the existing write paths. Pure tool schemas, validation, totals and copy live in `core/`.

**Tech Stack:** Node 24 native TypeScript, `@anthropic-ai/sdk` Messages API with `tools`, Hono, better-sqlite3, `node:test`, React + Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-chat-tool-loop-design.md`

## Global Constraints

- `AGENTS.md` binding constraints apply to every task (layering, `app/` export shape, writes only from `app/`, error copy, logging, no real external calls in tests).
- Model: Haiku 4.5 through one export, `CHAT_AGENT_MODEL`. Step cap: `CHAT_AGENT_MAX_STEPS = 8`. Each has exactly one defining export.
- Nothing is written before the yes. A decline writes nothing.
- Text stating that a change was made comes only from apply results, never from model prose.
- Calendar delete is allowed only for an event carrying a Yoh marker, checked at staging and again at apply.
- Only events on the primary calendar are edited (the existing `assertPrimaryCalendar` rule).
- Copy: second person, peer-level, neutral, no emoji, no filler.
- "Today" uses the host timezone (`deps.timeZone`), never the browser's.
- Commit trailer is exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge.
- Work in a worktree, not the main checkout. Fixture server on port 8788.

## Deviation from the spec (needs Spencer's nod at plan review)

The spec says "mark done" writes the status directly and skips the undo window.
`src/app/update-task.ts` refuses a direct `completed` write because the
check-off path is what records the Completion Log entry. This plan therefore
routes `complete_task` through the existing `checkOff` app function: the
Completion Log entry is kept, and the task also gets the normal undo window.

## File Structure

| File | Responsibility |
|---|---|
| `src/types/domain.ts` (modify) | `ChangeSetItem`, `ChangeSet`, `ChangeSetItemResult`; `"delete"` on `CalendarEditChange`; `etag`, `yohCreated` on `CalendarEvent` |
| `src/core/chat-tools.ts` (create) | Tool definitions, input validation, task totals, change-set copy, apply order. Pure. |
| `src/adapters/calendar-adapter.ts` (modify) | Expose `etag`/`yohCreated`; stamp chat-created events; apply `"delete"` |
| `src/adapters/llm-adapter.ts` (modify) | `CHAT_AGENT_MODEL`, `runToolTurn` |
| `src/adapters/llm-usage-store.ts` (modify) | `"agent"` usage purpose |
| `src/app/apply-change-set.ts` (create) | Apply each item through existing write paths; per-item results |
| `src/app/confirm-proposal.ts` (modify) | `"change-set"` branch |
| `src/core/open-item-questions.ts` (modify) | Approve/Discard options for `"change-set"` |
| `src/app/chat-agent.ts` (create) | The tool loop |
| `src/app/chat-turn.ts` (modify) | Route the LLM tail and parse failures to `chatAgent` |
| `src/shell/server.ts` (modify) | Wire the new deps |
| `web/src/components/StructuredQuestion.tsx`, `ChatMessage.tsx` (modify) | Render change-set items as a list |
| `tests/e2e/fixture-server.ts`, `web/e2e/change-set.spec.ts` | E2E |

## Review Focus

1. **A model reply that claims a write with nothing staged** ("Done, added both"). Expected: the reply never says a change happened. Pinned in Task 5 (system prompt assertion and a no-receipts test).
2. **A write tool call with an id the model invented.** Expected: rejected back to the model, nothing staged. Pinned in Task 5.
3. **An event changed in Google between staging and the yes.** Expected: that item reports stale, the others still apply. Pinned in Task 4.
4. **Times given across midnight or with end before start** (`create_event` 23:30–00:30). Expected: validation error to the model, nothing staged. Pinned in Task 1.
5. **A second free-form request while a change set is still open.** Expected: the earlier open change set is replaced, not left to conflict. Pinned in Task 5.

---

### Task 1: Domain types and pure tool logic

**Files:**
- Modify: `src/types/domain.ts` (next to `CalendarEditChange`, around line 436)
- Create: `src/core/chat-tools.ts`
- Test: `tests/core-chat-tools.test.ts`

**Interfaces:**
- Consumes: `localMinutesToIso(date, minutes, timeZone)` from `src/core/local-time.ts`; `Task`, `IsoDate`, `IsoDateTime`, `ExternalId`, `EditableTaskField` from `src/types/domain.ts` (grep `EditableTaskField` for its defining file and import from there).
- Produces:
  - `ChangeSetItem`, `ChangeSet`, `ChangeSetItemResult` (domain types below)
  - `CHAT_AGENT_MAX_STEPS: number`
  - `CHAT_TOOLS: readonly ChatToolDefinition[]`
  - `isWriteTool(name: string): boolean`
  - `summarizeTasks(tasks: readonly Task[]): TaskTotals`
  - `filterTasks(tasks: readonly Task[], filter: TaskFilter): readonly Task[]`
  - `resolveEventTimes(input: { date: string; startTime: string; endTime: string }, timeZone: string): { ok: true; start: IsoDateTime; end: IsoDateTime } | { ok: false; message: string }`
  - `describeChangeSetItem(item: ChangeSetItem, timeZone: string): string`
  - `changeSetPrompt(items: readonly ChangeSetItem[], timeZone: string): string`
  - `orderForApply(items: readonly ChangeSetItem[]): readonly ChangeSetItem[]`

- [ ] **Step 1: Add the domain types**

In `src/types/domain.ts`, add a `"delete"` variant to `CalendarEditChange` and update its doc comment (delete is now allowed, only for Yoh-created events, enforced in `applyCalendarEdit`):

```ts
  | { readonly kind: "delete"; readonly eventId: ExternalId; readonly calendarId: string };
```

Add to `CalendarEvent`:

```ts
  /** The event's Google etag, used as a Proposal's `entityVersion` for a move, resize or delete. Absent on a fake or pre-existing fixture event. */
  readonly etag?: string;
  /** `true` when the event carries a Yoh marker (a Plan block or an event created through chat). Only such an event may be deleted by chat. */
  readonly yohCreated?: true;
```

Add after `CalendarEditChange`:

```ts
/** One staged change in a chat change set. `label` is the entity's display name at staging time, used only for copy. */
export type ChangeSetItem =
  | { readonly kind: "create-event"; readonly title: string; readonly start: IsoDateTime; readonly end: IsoDateTime }
  | { readonly kind: "move-event"; readonly eventId: ExternalId; readonly label: string; readonly etag: string; readonly newStart: IsoDateTime; readonly newEnd: IsoDateTime }
  | { readonly kind: "resize-event"; readonly eventId: ExternalId; readonly label: string; readonly etag: string; readonly newEnd: IsoDateTime }
  | { readonly kind: "delete-event"; readonly eventId: ExternalId; readonly label: string; readonly etag: string }
  | { readonly kind: "create-task"; readonly properties: Readonly<Record<string, string>> }
  | { readonly kind: "update-task"; readonly taskId: ExternalId; readonly label: string; readonly field: "dueDate" | "estimatedDurationMinutes" | "priority"; readonly value: string }
  | { readonly kind: "rename-task"; readonly taskId: ExternalId; readonly label: string; readonly newTitle: string }
  | { readonly kind: "complete-task"; readonly taskId: ExternalId; readonly label: string }
  | { readonly kind: "plan-day" }
  | { readonly kind: "refit-plan" };

export interface ChangeSet {
  readonly items: readonly ChangeSetItem[];
}

export interface ChangeSetItemResult {
  readonly item: ChangeSetItem;
  readonly ok: boolean;
  /** Past-tense receipt when `ok`; user-facing failure copy otherwise. */
  readonly text: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/core-chat-tools.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_TOOLS,
  changeSetPrompt,
  describeChangeSetItem,
  filterTasks,
  isWriteTool,
  orderForApply,
  resolveEventTimes,
  summarizeTasks,
} from "../src/core/chat-tools.ts";
import type { ChangeSetItem, Task } from "../src/types/domain.ts";

const TZ = "America/New_York";

function task(overrides: Partial<Task>): Task {
  return { id: "t1", title: "Task", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...overrides };
}

test("summarizeTasks totals minutes and counts tasks with no duration", () => {
  const totals = summarizeTasks([
    task({ id: "a", estimatedDurationMinutes: 45 }),
    task({ id: "b", estimatedDurationMinutes: 30 }),
    task({ id: "c" }),
  ]);
  assert.deepEqual(totals, { count: 3, totalMinutes: 75, missingDurationCount: 1 });
});

test("filterTasks keeps tasks inside the due range and drops completed ones unless asked", () => {
  const tasks = [
    task({ id: "a", dueDate: "2026-10-05" }),
    task({ id: "b", dueDate: "2026-10-06" }),
    task({ id: "c", dueDate: "2026-10-05", status: "completed" }),
    task({ id: "d" }),
  ];
  assert.deepEqual(filterTasks(tasks, { dueFrom: "2026-10-05", dueTo: "2026-10-05" }).map((t) => t.id), ["a"]);
  assert.deepEqual(filterTasks(tasks, { dueFrom: "2026-10-05", dueTo: "2026-10-05", includeCompleted: true }).map((t) => t.id), ["a", "c"]);
  assert.deepEqual(filterTasks(tasks, { titleQuery: "TASK" }).length, 3);
});

test("resolveEventTimes converts local clock times to UTC instants", () => {
  const resolved = resolveEventTimes({ date: "2026-10-03", startTime: "13:10", endTime: "14:50" }, TZ);
  assert.deepEqual(resolved, { ok: true, start: "2026-10-03T17:10:00.000Z", end: "2026-10-03T18:50:00.000Z" });
});

test("resolveEventTimes rejects an end at or before the start, and malformed input", () => {
  assert.equal(resolveEventTimes({ date: "2026-10-03", startTime: "23:30", endTime: "00:30" }, TZ).ok, false);
  assert.equal(resolveEventTimes({ date: "2026-10-03", startTime: "14:00", endTime: "14:00" }, TZ).ok, false);
  assert.equal(resolveEventTimes({ date: "10/3", startTime: "14:00", endTime: "15:00" }, TZ).ok, false);
  assert.equal(resolveEventTimes({ date: "2026-10-03", startTime: "25:00", endTime: "26:00" }, TZ).ok, false);
});

test("describeChangeSetItem writes a future-tense line per kind", () => {
  const create: ChangeSetItem = { kind: "create-event", title: "Workout", start: "2026-10-03T17:10:00.000Z", end: "2026-10-03T18:50:00.000Z" };
  assert.equal(describeChangeSetItem(create, TZ), 'Add "Workout" on Sat, Oct 3, 1:10 PM–2:50 PM');
  assert.equal(describeChangeSetItem({ kind: "complete-task", taskId: "t", label: "Lab report" }, TZ), 'Mark "Lab report" done');
  assert.equal(describeChangeSetItem({ kind: "delete-event", eventId: "e", label: "Dinner", etag: "x" }, TZ), 'Delete "Dinner" from your calendar');
  assert.equal(describeChangeSetItem({ kind: "plan-day" }, TZ), "Build today's Plan");
});

test("changeSetPrompt lists every item and asks once", () => {
  const items: ChangeSetItem[] = [{ kind: "plan-day" }, { kind: "complete-task", taskId: "t", label: "Lab report" }];
  assert.equal(changeSetPrompt(items, TZ), "Here's what I'd change:\n- Build today's Plan\n- Mark \"Lab report\" done\nApprove to apply all of it, or discard to change nothing.");
});

test("orderForApply moves the Plan step last and keeps the rest in staged order", () => {
  const items: ChangeSetItem[] = [
    { kind: "refit-plan" },
    { kind: "complete-task", taskId: "t", label: "A" },
    { kind: "create-event", title: "B", start: "2026-10-03T17:00:00.000Z", end: "2026-10-03T18:00:00.000Z" },
  ];
  assert.deepEqual(orderForApply(items).map((i) => i.kind), ["complete-task", "create-event", "refit-plan"]);
});

test("every tool has a name, description and object schema; write tools are classified", () => {
  for (const tool of CHAT_TOOLS) {
    assert.ok(tool.name.length > 0 && tool.description.length > 0);
    assert.equal(tool.input_schema.type, "object");
  }
  assert.equal(isWriteTool("create_event"), true);
  assert.equal(isWriteTool("list_tasks"), false);
  assert.deepEqual(
    CHAT_TOOLS.map((t) => t.name),
    ["list_tasks", "list_events", "get_plan", "search_memory", "web_search", "create_event", "move_event", "resize_event", "delete_event", "create_task", "update_task", "complete_task", "plan_day", "refit_plan"],
  );
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/core-chat-tools.test.ts`
Expected: FAIL, cannot find module `../src/core/chat-tools.ts`.

- [ ] **Step 4: Implement `src/core/chat-tools.ts`**

```ts
/**
 * src/core/chat-tools.ts
 *
 * The pure half of the chat tool loop (`app/chat-agent.ts`): tool
 * definitions sent to the model, input checks, task totals, and the copy a
 * staged change set is shown with. No I/O.
 */
import { localMinutesToIso } from "./local-time.ts";
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
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(/ /g, " ");
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

export function changeSetPrompt(items: readonly ChangeSetItem[], timeZone: string): string {
  return ["Here's what I'd change:", ...items.map((i) => `- ${describeChangeSetItem(i, timeZone)}`), "Approve to apply all of it, or discard to change nothing."].join("\n");
}

const isPlanStep = (item: ChangeSetItem): boolean => item.kind === "plan-day" || item.kind === "refit-plan";

export function orderForApply(items: readonly ChangeSetItem[]): readonly ChangeSetItem[] {
  return [...items.filter((i) => !isPlanStep(i)), ...items.filter(isPlanStep)];
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `node --test tests/core-chat-tools.test.ts && npm run typecheck`
Expected: tests PASS. Typecheck reports errors only where `CalendarEditChange` is switched on exhaustively (the new `"delete"` variant); note them — Task 2 fixes them. If any other file fails, fix it here.

- [ ] **Step 6: Commit**

```bash
git add src/types/domain.ts src/core/chat-tools.ts tests/core-chat-tools.test.ts
git commit -m "feat(core): chat tool definitions and change-set copy"
```

---

### Task 2: Calendar adapter — etag, Yoh marker, delete

**Files:**
- Modify: `src/adapters/calendar-adapter.ts` (`CalendarBroadClient` ~line 281, `applyCalendarEdit` ~line 946, `toCalendarEvent` ~line 1345, `PLAN_BLOCK_ID_EXTENDED_PROPERTY` ~line 587)
- Modify: `src/app/confirm-proposal.ts` (`calendarEditEventDate`, line 86) and any other exhaustive switch on `CalendarEditChange` Task 1's typecheck reported
- Test: the existing calendar adapter test file (find it with `ls tests | grep calendar-adapter`); append to it

**Interfaces:**
- Consumes: `CalendarEditChange` with `"delete"`, `CalendarEvent.etag`/`.yohCreated` (Task 1).
- Produces:
  - `export const CHAT_CREATED_EXTENDED_PROPERTY = "yohChatCreated"`
  - `CalendarBroadClient.events.delete(params: calendar_v3.Params$Resource$Events$Delete, options?: { headers?: Record<string, string> }): Promise<unknown>`
  - `applyCalendarEdit` handles `kind: "delete"`; a create stamps the chat marker
  - `readCalendarEvents` returns `etag` and `yohCreated` on each event

- [ ] **Step 1: Write the failing tests**

Append to the calendar adapter test file, reusing that file's existing fake broad client helper if it has one (grep `events: {` in the file); otherwise use this inline fake:

```ts
function fakeBroadClient(live: { etag: string; extendedProperties?: { private?: Record<string, string> } }) {
  const calls: { op: string; params: unknown; options?: unknown }[] = [];
  return {
    calls,
    client: {
      events: {
        get: async (params: unknown) => { calls.push({ op: "get", params }); return { data: { id: "e1", ...live } }; },
        patch: async (params: unknown, options?: unknown) => { calls.push({ op: "patch", params, options }); return { data: {} }; },
        insert: async (params: unknown) => { calls.push({ op: "insert", params }); return { data: { id: "new-1" } }; },
        delete: async (params: unknown, options?: unknown) => { calls.push({ op: "delete", params, options }); return {}; },
      },
    },
  };
}

const deleteProposal = (etag: string) => ({
  id: "p1", kind: "calendar-edit", entityId: "e1", entityVersion: etag, reason: "", createdAt: "2026-10-03T00:00:00.000Z",
  suggested: { kind: "delete" as const, eventId: "e1", calendarId: "primary" },
});

test("applyCalendarEdit deletes an event that carries the chat marker", async () => {
  const fake = fakeBroadClient({ etag: "v1", extendedProperties: { private: { [CHAT_CREATED_EXTENDED_PROPERTY]: "1" } } });
  const result = await applyCalendarEdit(fake.client, deleteProposal("v1"));
  assert.deepEqual(result, { ok: true, value: { eventId: "e1", calendarId: "primary" } });
  assert.equal(fake.calls.filter((c) => c.op === "delete").length, 1);
});

test("applyCalendarEdit refuses to delete an event with no Yoh marker", async () => {
  const fake = fakeBroadClient({ etag: "v1" });
  const result = await applyCalendarEdit(fake.client, deleteProposal("v1"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "validation");
  assert.equal(fake.calls.filter((c) => c.op === "delete").length, 0);
});

test("applyCalendarEdit reports a stale delete when the etag moved", async () => {
  const fake = fakeBroadClient({ etag: "v2", extendedProperties: { private: { [CHAT_CREATED_EXTENDED_PROPERTY]: "1" } } });
  const result = await applyCalendarEdit(fake.client, deleteProposal("v1"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "stale-proposal");
  assert.equal(fake.calls.filter((c) => c.op === "delete").length, 0);
});

test("applyCalendarEdit stamps the chat marker on a created event", async () => {
  const fake = fakeBroadClient({ etag: "v1" });
  await applyCalendarEdit(fake.client, {
    id: "p2", kind: "calendar-edit", entityId: "new", entityVersion: "", reason: "", createdAt: "2026-10-03T00:00:00.000Z",
    suggested: { kind: "create", calendarId: "primary", title: "Workout", start: "2026-10-03T17:10:00.000Z", end: "2026-10-03T18:50:00.000Z" },
  });
  const insert = fake.calls.find((c) => c.op === "insert")!.params as { requestBody: { extendedProperties?: { private?: Record<string, string> } } };
  assert.equal(insert.requestBody.extendedProperties?.private?.[CHAT_CREATED_EXTENDED_PROPERTY], "1");
});
```

Add a fifth test in the same file's existing `readCalendarEvents` style: one listed item with `etag: "v9"` and `extendedProperties.private.yohChatCreated = "1"` maps to an event with `etag: "v9"` and `yohCreated: true`; one with neither has no `yohCreated` key.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/<calendar adapter test file>`
Expected: FAIL — `CHAT_CREATED_EXTENDED_PROPERTY` is not exported.

- [ ] **Step 3: Implement**

Next to `PLAN_BLOCK_ID_EXTENDED_PROPERTY`:

```ts
/** Stamped on every event `applyCalendarEdit` creates, so chat can later tell it apart from an event Spencer or someone else made. */
export const CHAT_CREATED_EXTENDED_PROPERTY = "yohChatCreated";

function hasYohMarker(event: calendar_v3.Schema$Event): boolean {
  const priv = event.extendedProperties?.private;
  return Boolean(priv?.[PLAN_BLOCK_ID_EXTENDED_PROPERTY] || priv?.[CHAT_CREATED_EXTENDED_PROPERTY]);
}
```

Add to `CalendarBroadClient.events`:

```ts
    readonly delete: (params: calendar_v3.Params$Resource$Events$Delete, options?: { readonly headers?: Record<string, string> }) => Promise<unknown>;
```

In `toCalendarEvent`, add:

```ts
    ...(event.etag ? { etag: event.etag } : {}),
    ...(hasYohMarker(event) ? { yohCreated: true as const } : {}),
```

In `applyCalendarEdit`'s create branch, change the `requestBody` to:

```ts
        requestBody: {
          summary: change.title,
          start: { dateTime: change.start },
          end: { dateTime: change.end },
          extendedProperties: { private: { [CHAT_CREATED_EXTENDED_PROPERTY]: "1" } },
        },
```

After the existing etag staleness check and before `const requestBody`, add:

```ts
  if (change.kind === "delete") {
    if (!hasYohMarker(liveEvent)) {
      return {
        ok: false,
        error: { kind: "validation", message: "calendar-adapter: only an event Yoh created can be deleted", detail: { eventId: change.eventId } },
      };
    }
    try {
      await client.events.delete(
        { calendarId: change.calendarId, eventId: change.eventId },
        proposal.entityVersion ? { headers: { "If-Match": proposal.entityVersion } } : undefined,
      );
      return { ok: true, value: { eventId: change.eventId, calendarId: change.calendarId } };
    } catch (err) {
      return {
        ok: false,
        error: { kind: "unreachable", message: `calendar-adapter: could not delete the event — ${err instanceof Error ? err.message : String(err)}`, detail: err },
      };
    }
  }
```

In `src/app/confirm-proposal.ts`'s `calendarEditEventDate`, return `undefined` for `change.kind === "delete"` (the hint is then topic-only, which refetches every cached date). Fix every other compile error Task 1's typecheck listed the same way: a delete has no new time.

- [ ] **Step 4: Run tests and typecheck**

Run: `node --test tests/<calendar adapter test file> && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/calendar-adapter.ts src/app/confirm-proposal.ts tests/
git commit -m "feat(calendar): Yoh marker on chat-created events and marker-gated delete"
```

---

### Task 3: `runToolTurn` in the LLM adapter

**Files:**
- Modify: `src/adapters/llm-adapter.ts` (after `streamGeneralQuestion`, ~line 550)
- Modify: `src/adapters/llm-usage-store.ts:41` (`LlmUsagePurpose`)
- Test: `tests/llm-adapter-tool-turn.test.ts` (create)

**Interfaces:**
- Consumes: `AnthropicMessagesClient`, `cacheableSystemBlock`, `memorySystemBlocks`, `recordUsageSafely`, `CLAUDE_CHAT_MODEL_FAST`, `CLAUDE_CHAT_MAX_TOKENS` (all already in `llm-adapter.ts`); `ChatToolDefinition` from `src/core/chat-tools.ts`.
- Produces:
  - `export const CHAT_AGENT_MODEL: Anthropic.Model`
  - `export type ToolTurnMessage = Anthropic.MessageParam`
  - `export interface ToolTurnResult { readonly text: string; readonly toolUses: readonly { readonly id: string; readonly name: string; readonly input: unknown }[]; readonly assistantContent: Anthropic.ContentBlock[] }`
  - `export async function runToolTurn(client: AnthropicMessagesClient, input: { systemPrompt: string; messages: readonly ToolTurnMessage[]; tools: readonly ChatToolDefinition[]; memory?: MemoryContext; connection?: SqliteConnection }): Promise<ToolTurnResult>`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_AGENT_MODEL, runToolTurn, type AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { CHAT_TOOLS } from "../src/core/chat-tools.ts";

function fakeClient(content: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: (async (params: Record<string, unknown>) => {
        calls.push(params);
        return { content, usage: { input_tokens: 1, output_tokens: 1 } };
      }) as unknown as AnthropicMessagesClient["messages"]["create"],
    },
  };
  return { client, calls };
}

test("runToolTurn sends the tools and returns text and tool uses", async () => {
  const { client, calls } = fakeClient([
    { type: "text", text: "Checking." },
    { type: "tool_use", id: "tu_1", name: "list_tasks", input: { dueFrom: "2026-10-05", dueTo: "2026-10-05" } },
  ]);
  const result = await runToolTurn(client, { systemPrompt: "sys", messages: [{ role: "user", content: "hi" }], tools: CHAT_TOOLS });
  assert.equal(result.text, "Checking.");
  assert.deepEqual(result.toolUses, [{ id: "tu_1", name: "list_tasks", input: { dueFrom: "2026-10-05", dueTo: "2026-10-05" } }]);
  assert.equal(result.assistantContent.length, 2);
  assert.equal(calls[0]!["model"], CHAT_AGENT_MODEL);
  assert.equal((calls[0]!["tools"] as unknown[]).length, CHAT_TOOLS.length);
});

test("runToolTurn returns empty text and no tool uses for an empty reply", async () => {
  const { client } = fakeClient([]);
  const result = await runToolTurn(client, { systemPrompt: "sys", messages: [{ role: "user", content: "hi" }], tools: CHAT_TOOLS });
  assert.deepEqual({ text: result.text, toolUses: result.toolUses }, { text: "", toolUses: [] });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/llm-adapter-tool-turn.test.ts`
Expected: FAIL — `runToolTurn` is not exported.

- [ ] **Step 3: Implement**

In `llm-usage-store.ts`, add `| "agent"` to `LlmUsagePurpose`.

In `llm-adapter.ts`:

```ts
/** The model the chat tool loop runs on (`app/chat-agent.ts`). The one place to change it. */
export const CHAT_AGENT_MODEL: Anthropic.Model = CLAUDE_CHAT_MODEL_FAST;

export type ToolTurnMessage = Anthropic.MessageParam;

export interface ToolTurnResult {
  readonly text: string;
  readonly toolUses: readonly { readonly id: string; readonly name: string; readonly input: unknown }[];
  /** The assistant content blocks, to be echoed back as the next request's assistant message. */
  readonly assistantContent: Anthropic.ContentBlock[];
}

/** One model call of the chat tool loop. Throws on a transport failure; `app/chat-agent.ts` converts that to a Result. */
export async function runToolTurn(
  client: AnthropicMessagesClient,
  input: {
    readonly systemPrompt: string;
    readonly messages: readonly ToolTurnMessage[];
    readonly tools: readonly ChatToolDefinition[];
    readonly memory?: MemoryContext;
    readonly connection?: SqliteConnection;
  },
): Promise<ToolTurnResult> {
  const blocks = memorySystemBlocks(input.memory);
  const message = await client.messages.create({
    model: CHAT_AGENT_MODEL,
    max_tokens: CLAUDE_CHAT_MAX_TOKENS,
    system: [cacheableSystemBlock(input.systemPrompt), ...blocks.always, ...blocks.relevant],
    tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
    messages: [...input.messages],
  });
  recordUsageSafely(input.connection, "agent", CHAT_AGENT_MODEL, message.usage);
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const toolUses = message.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return { text, toolUses, assistantContent: message.content };
}
```

Add `import type { ChatToolDefinition } from "../core/chat-tools.ts";`.

- [ ] **Step 4: Run tests and typecheck**

Run: `node --test tests/llm-adapter-tool-turn.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/llm-adapter.ts src/adapters/llm-usage-store.ts tests/llm-adapter-tool-turn.test.ts
git commit -m "feat(llm): runToolTurn for the chat tool loop"
```

---

### Task 4: Apply a change set on confirm

**Files:**
- Create: `src/app/apply-change-set.ts`
- Modify: `src/app/confirm-proposal.ts` (`ConfirmProposalDeps` line 226; new branch before the final "unrecognized proposal kind" return)
- Modify: `src/core/open-item-questions.ts` (`buildProposalQuestion`, line 229)
- Test: `tests/app-apply-change-set.test.ts` (create); append to `tests/confirm-proposal.test.ts`

**Interfaces:**
- Consumes: `ChangeSet`, `ChangeSetItem`, `ChangeSetItemResult` (Task 1); `orderForApply`, `describeChangeSetItem` (Task 1); `updateTask`, `renameTask`, `UpdateTaskDeps` (`src/app/update-task.ts`); `checkOff`, `CheckOffDeps` (`src/app/check-off.ts`); `planDay`, `PlanDayDeps` (`src/app/plan-day.ts`); `requestReshuffle` (`src/app/request-reshuffle.ts`); `approveReshuffle`, `ApproveReshuffleDeps` (`src/app/approve-reshuffle.ts`); `errorCopy` from `src/core/error-copy.ts`.
- Produces:
  - `export const CHANGE_SET_PROPOSAL_KIND = "change-set"`
  - `export interface ApplyChangeSetDeps` (below)
  - `export async function applyChangeSet(deps: ApplyChangeSetDeps, input: { readonly changeSet: ChangeSet }): Promise<Result<{ readonly results: readonly ChangeSetItemResult[] }, YohError>>`
  - `ConfirmProposalDeps.changeSet?: ApplyChangeSetDeps`

- [ ] **Step 1: Write the failing tests**

Create `tests/app-apply-change-set.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChangeSet, type ApplyChangeSetDeps } from "../src/app/apply-change-set.ts";
import type { ChangeSetItem, Result, YohError } from "../src/types/domain.ts";

const TZ = "America/New_York";
const ok = <T>(value: T): Result<T, YohError> => ({ ok: true, value });

function fakeDeps(overrides: Partial<ApplyChangeSetDeps> = {}) {
  const log: string[] = [];
  const deps: ApplyChangeSetDeps = {
    timeZone: TZ,
    now: () => new Date("2026-10-03T16:00:00.000Z"),
    applyCalendarEdit: async (p) => { log.push(`calendar:${p.suggested.kind}`); return ok({ eventId: "e", calendarId: "primary" }); },
    createPage: async (_db, props) => { log.push(`create:${props["title"]}`); return ok({ pageId: "p" }); },
    updateTaskField: async (id, field) => { log.push(`field:${id}:${field}`); return ok({ receipt: "Due Date set to Mon, Oct 5." }); },
    renameTask: async (id, title) => { log.push(`rename:${id}:${title}`); return ok({ receipt: `Renamed to "${title}".` }); },
    completeTask: async (id) => { log.push(`complete:${id}`); return ok(undefined); },
    planDay: async () => { log.push("plan"); return ok({ reply: "2 Tasks scheduled across 5 blocks." }); },
    refitPlan: async () => { log.push("refit"); return ok({ reply: "Moved 2 blocks." }); },
    ...overrides,
  };
  return { deps, log };
}

const workout: ChangeSetItem = { kind: "create-event", title: "Workout", start: "2026-10-03T17:10:00.000Z", end: "2026-10-03T18:50:00.000Z" };
const dinner: ChangeSetItem = { kind: "create-event", title: "Dinner", start: "2026-10-03T22:00:00.000Z", end: "2026-10-03T23:00:00.000Z" };

test("applies every item, with the Plan step last, and returns one receipt each", async () => {
  const { deps, log } = fakeDeps();
  const result = await applyChangeSet(deps, { changeSet: { items: [{ kind: "plan-day" }, workout, dinner] } });
  assert.equal(result.ok, true);
  assert.deepEqual(log, ["calendar:create", "calendar:create", "plan"]);
  if (result.ok) {
    assert.deepEqual(result.value.results.map((r) => r.ok), [true, true, true]);
    assert.equal(result.value.results[0]!.text, 'Added "Workout" on Sat, Oct 3, 1:10 PM–2:50 PM.');
    assert.equal(result.value.results[2]!.text, "Built today's Plan. 2 Tasks scheduled across 5 blocks.");
  }
});

test("a failed item does not stop the rest, and reports plain copy", async () => {
  const { deps, log } = fakeDeps({
    applyCalendarEdit: async (p) =>
      p.suggested.kind === "move"
        ? { ok: false, error: { kind: "stale-proposal", message: "calendar-adapter: event changed" } }
        : ok({ eventId: "e", calendarId: "primary" }),
  });
  const move: ChangeSetItem = { kind: "move-event", eventId: "e1", label: "Dentist", etag: "v1", newStart: "2026-10-03T19:00:00.000Z", newEnd: "2026-10-03T20:00:00.000Z" };
  const result = await applyChangeSet(deps, { changeSet: { items: [move, workout, { kind: "complete-task", taskId: "t1", label: "Lab report" }] } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.results.map((r) => r.ok), [false, true, true]);
  assert.match(result.value.results[0]!.text, /^Couldn't move "Dentist"/);
  assert.doesNotMatch(result.value.results[0]!.text, /calendar-adapter/);
  assert.deepEqual(log, ["complete:t1"]); // the overridden applyCalendarEdit does not log
});

test("a thrown dependency becomes a failed item, not a thrown error", async () => {
  const { deps } = fakeDeps({ createPage: async () => { throw new Error("socket hang up"); } });
  const result = await applyChangeSet(deps, { changeSet: { items: [{ kind: "create-task", properties: { title: "Read ch. 4" } }] } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.results[0]!.ok, false);
    assert.doesNotMatch(result.value.results[0]!.text, /socket hang up/);
  }
});

test("move, resize and delete pass the staged etag as the proposal version", async () => {
  const versions: string[] = [];
  const { deps } = fakeDeps({ applyCalendarEdit: async (p) => { versions.push(`${p.suggested.kind}:${p.entityVersion}`); return ok({ eventId: "e", calendarId: "primary" }); } });
  await applyChangeSet(deps, {
    changeSet: {
      items: [
        { kind: "resize-event", eventId: "e1", label: "A", etag: "v1", newEnd: "2026-10-03T20:00:00.000Z" },
        { kind: "delete-event", eventId: "e2", label: "B", etag: "v2" },
      ],
    },
  });
  assert.deepEqual(versions, ["resize:v1", "delete:v2"]);
});

test("an empty change set is a validation error", async () => {
  const { deps } = fakeDeps();
  const result = await applyChangeSet(deps, { changeSet: { items: [] } });
  assert.equal(result.ok, false);
});
```

Append to `tests/confirm-proposal.test.ts` (reuse that file's own store helper):

```ts
test("change-set: accept applies the items and returns one receipt per applied item plus failures in message", async () => {
  const store = /* this file's existing temp-store helper */;
  const proposal = { id: "cs1", kind: "change-set", entityId: "chat", entityVersion: "", reason: "Here's what I'd change:", createdAt: "2026-10-03T16:00:00.000Z",
    suggested: { items: [{ kind: "complete-task", taskId: "t1", label: "Lab report" }, { kind: "create-task", properties: { title: "Read ch. 4" } }] } };
  const result = await confirmProposal(
    { store, changeSet: {
        timeZone: "America/New_York", now: () => new Date("2026-10-03T16:00:00.000Z"),
        applyCalendarEdit: async () => ({ ok: true, value: { eventId: "e", calendarId: "primary" } }),
        createPage: async () => ({ ok: false, error: { kind: "unreachable", message: "raw" } }),
        updateTaskField: async () => ({ ok: true, value: { receipt: "" } }),
        renameTask: async () => ({ ok: true, value: { receipt: "" } }),
        completeTask: async () => ({ ok: true, value: undefined }),
        planDay: async () => ({ ok: true, value: { reply: "" } }),
        refitPlan: async () => ({ ok: true, value: { reply: "" } }),
    } },
    { proposal, accept: true },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.applied, true);
    assert.deepEqual(result.value.receipts, ['Marked "Lab report" done.']);
    assert.match(result.value.message ?? "", /Couldn't create the Task "Read ch. 4"/);
  }
});

test("change-set: decline writes nothing", async () => {
  let called = false;
  const never = async () => { called = true; return { ok: true as const, value: undefined as never }; };
  const result = await confirmProposal(
    { store: /* temp store */, changeSet: { timeZone: "America/New_York", now: () => new Date(), applyCalendarEdit: never, createPage: never, updateTaskField: never, renameTask: never, completeTask: never, planDay: never, refitPlan: never } },
    { proposal: { id: "cs2", kind: "change-set", entityId: "chat", entityVersion: "", reason: "", createdAt: "2026-10-03T16:00:00.000Z", suggested: { items: [{ kind: "plan-day" }] } }, accept: false },
  );
  assert.deepEqual(result, { ok: true, value: { applied: false, receipts: [] } });
  assert.equal(called, false);
});
```

(Replace the two `/* temp store */` comments with the helper call that file already uses for its other tests; it is the first function defined in the file.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/app-apply-change-set.test.ts tests/confirm-proposal.test.ts`
Expected: FAIL — module `apply-change-set.ts` not found.

- [ ] **Step 3: Implement `src/app/apply-change-set.ts`**

```ts
/**
 * src/app/apply-change-set.ts
 *
 * Applies a confirmed chat change set (`app/chat-agent.ts` stages it,
 * `app/confirm-proposal.ts` calls this on a yes). Each item goes through
 * the same write path its single-change equivalent uses. A failed item
 * never stops the rest; every item reports its own outcome.
 */
import { describeChangeSetItem, orderForApply } from "../core/chat-tools.ts";
import { errorCopy, errorCopyForThrown } from "../core/error-copy.ts";
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
      results.push({ item, ok: false, text: failureText(item, deps.timeZone, errorCopyForThrown(err)) });
      continue;
    }
    results.push(
      outcome.ok
        ? { item, ok: true, text: receipt(item, deps.timeZone, outcome.value) }
        : { item, ok: false, text: failureText(item, deps.timeZone, errorCopy(outcome.error)) },
    );
  }
  return { ok: true, value: { results } };
}
```

Before relying on `errorCopy(error)` with one argument, check its signature (`grep -n "export function errorCopy" src/core/error-copy.ts`); `update-task.ts` calls it as `errorCopy(error, { service: "Notion" })`. Pass `{ service: "Notion" }` for task items and `{ service: "Google Calendar" }` for event items if the second argument is required or improves the copy.

- [ ] **Step 4: Add the `"change-set"` branch to `confirmProposal`**

In `ConfirmProposalDeps` add:

```ts
  /** Needed only for a `"change-set"` proposal (the chat tool loop). */
  readonly changeSet?: ApplyChangeSetDeps;
```

Before the final `clearRequestIfGiven(...)` / "unrecognized proposal kind" return:

```ts
  if (proposal.kind === CHANGE_SET_PROPOSAL_KIND) {
    if (!accept) {
      clearRequestIfGiven(deps.store, requestId);
      return { ok: true, value: { applied: false, receipts: [] } };
    }
    if (!deps.changeSet) {
      clearRequestIfGiven(deps.store, requestId);
      return missingDependency(proposal.kind, "changeSet");
    }
    const applied = await applyChangeSet(deps.changeSet, { changeSet: proposal.suggested as ChangeSet });
    clearRequestIfGiven(deps.store, requestId);
    if (!applied.ok) return applied;
    const done = applied.value.results.filter((r) => r.ok).map((r) => r.text);
    const failed = applied.value.results.filter((r) => !r.ok).map((r) => r.text);
    if (deps.connection) deps.connection.writeTx((db) => appendOutboxInTx(db, { topic: PLAN_TOPIC, entityId: "" }));
    return { ok: true, value: { applied: done.length > 0, receipts: done, ...(failed.length > 0 ? { message: failed.join("\n") } : {}) } };
  }
```

Check how the other branches treat `accept === false` first (`grep -n "accept" src/app/confirm-proposal.ts`): if a decline is already handled once above every branch, drop the `!accept` block here and rely on it.

- [ ] **Step 5: Approve/Discard options**

In `buildProposalQuestion` (`src/core/open-item-questions.ts`), make `"change-set"` use `APPROVE_DISCARD_OPTIONS` and no free text:

```ts
        : proposal.kind === "reshuffle" || proposal.kind === "change-set"
          ? APPROVE_DISCARD_OPTIONS
          : YES_NO_OPTIONS,
    allowsFreeText: proposal.kind !== "rule-change" && proposal.kind !== "pattern" && proposal.kind !== "change-set",
```

Add a test to the existing open-item-questions test file asserting both for a `kind: "change-set"` proposal.

- [ ] **Step 6: Run tests, layering test, typecheck**

Run: `node --test tests/app-apply-change-set.test.ts tests/confirm-proposal.test.ts tests/layering-rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/apply-change-set.ts src/app/confirm-proposal.ts src/core/open-item-questions.ts tests/
git commit -m "feat(app): apply a chat change set on one confirm"
```

---

### Task 5: The tool loop (`chatAgent`)

**Files:**
- Create: `src/app/chat-agent.ts`
- Test: `tests/app-chat-agent.test.ts`

**Interfaces:**
- Consumes: `runToolTurn`, `ToolTurnMessage`, `AnthropicMessagesClient` (Task 3); `CHAT_TOOLS`, `CHAT_AGENT_MAX_STEPS`, `isWriteTool`, `filterTasks`, `summarizeTasks`, `resolveEventTimes`, `changeSetPrompt` (Task 1); `CHANGE_SET_PROPOSAL_KIND` (Task 4); `openProposal` (`src/app/open-proposal.ts`); `searchMemory`, `SearchMemoryDeps` (`src/app/memory-search.ts`); `searchWeb`, `WebSearchDeps` (`src/app/web-search.ts`); `getPlan`, `listOpenInteractionRequests`, `clearInteractionRequest`, `MemoryStore` (`src/adapters/memory-store.ts`); `localIsoDate` (`src/core/local-time.ts`); `errorCopyForThrown`.
- Produces:
  - `export interface ChatAgentDeps` (below)
  - `export interface ChatAgentInput { readonly message: string; readonly history: readonly ChatTurn[]; readonly systemPrompt: string; readonly memory?: MemoryContext }`
  - `export async function chatAgent(deps: ChatAgentDeps, input: ChatAgentInput): Promise<Result<ChatTurnResponse, YohError>>`
  - `export const CHAT_AGENT_STEP_CAP_REPLY: string`

- [ ] **Step 1: Write the failing tests**

Create `tests/app-chat-agent.test.ts`. The scripted client returns one queued response per call and records each request:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryStore, listOpenInteractionRequests } from "../src/adapters/memory-store.ts";
import { chatAgent, CHAT_AGENT_STEP_CAP_REPLY, type ChatAgentDeps } from "../src/app/chat-agent.ts";
import { CHAT_AGENT_MAX_STEPS } from "../src/core/chat-tools.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import type { CalendarEvent, ChangeSet, Proposal, Task } from "../src/types/domain.ts";

const TZ = "America/New_York";
const NOW = new Date("2026-10-03T16:00:00.000Z"); // Sat Oct 3, 12:00 PM local

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

function scripted(turns: Block[][]) {
  const requests: { system: unknown; messages: unknown[]; tools: unknown[] }[] = [];
  let i = 0;
  const client = {
    messages: {
      create: (async (params: { system: unknown; messages: unknown[]; tools: unknown[] }) => {
        requests.push(structuredClone(params));
        const content = turns[Math.min(i, turns.length - 1)]!;
        i++;
        return { content, usage: { input_tokens: 1, output_tokens: 1 } };
      }) as unknown as AnthropicMessagesClient["messages"]["create"],
    },
  };
  return { client, requests };
}

const use = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
const say = (text: string): Block => ({ type: "text", text });

const TASKS: Task[] = [
  { id: "t-mgp", title: "English MGP assignment", dueDate: "2026-10-05", estimatedDurationMinutes: 45, createdAt: "", updatedAt: "" },
  { id: "t-stats", title: "Stats problem set", dueDate: "2026-10-05", estimatedDurationMinutes: 60, createdAt: "", updatedAt: "" },
  { id: "t-ps", title: "Personal Statement", dueDate: "2026-10-05", createdAt: "", updatedAt: "" },
  { id: "t-later", title: "Lab report", dueDate: "2026-10-09", estimatedDurationMinutes: 90, createdAt: "", updatedAt: "" },
];

const EVENTS: CalendarEvent[] = [
  { id: "ev-dinner", title: "Dinner", start: "2026-10-03T22:00:00.000Z", end: "2026-10-03T23:00:00.000Z", etag: "v1", yohCreated: true },
  { id: "ev-dentist", title: "Dentist", start: "2026-10-03T19:00:00.000Z", end: "2026-10-03T20:00:00.000Z", etag: "v7" },
];

function deps(client: AnthropicMessagesClient, overrides: Partial<ChatAgentDeps> = {}): ChatAgentDeps {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return {
    llmClient: client,
    store: createMemoryStore(connection),
    timeZone: TZ,
    now: () => NOW,
    readTasks: async () => TASKS,
    readCalendarEventsForDate: async () => EVENTS,
    searchMemory: async () => ({ ok: true, value: { text: "No matches." } }),
    searchWeb: async () => ({ ok: true, value: { text: "No results." } }),
    ...overrides,
  };
}

const input = (message: string) => ({ message, history: [{ role: "user" as const, content: message }], systemPrompt: "TONE" });

function toolResult(requests: { messages: unknown[] }[], call: number): string {
  const last = requests[call]!.messages.at(-1) as { content: { type: string; content: string }[] };
  return last.content[0]!.content;
}

function openChangeSet(d: ChatAgentDeps): ChangeSet | undefined {
  const record = listOpenInteractionRequests(d.store).find((r) => r.data.requestKind === "proposal");
  return (record?.data.detail as { proposal?: Proposal<ChangeSet> } | undefined)?.proposal?.suggested;
}

test("answers a totals question from list_tasks without staging anything", async () => {
  const { client, requests } = scripted([
    [use("1", "list_tasks", { dueFrom: "2026-10-05", dueTo: "2026-10-05" })],
    [say("You have 105 minutes due Monday across 3 tasks; Personal Statement has no duration yet.")],
  ]);
  const d = deps(client);
  const result = await chatAgent(d, input("what is the total amount of minutes of tasks that i have due on monday"));
  assert.equal(result.ok, true);
  const tool = JSON.parse(toolResult(requests, 1));
  assert.deepEqual(tool.totals, { count: 3, totalMinutes: 105, missingDurationCount: 1 });
  if (result.ok) {
    assert.match(result.value.reply, /105 minutes/);
    assert.deepEqual(result.value.receipts, []);
    assert.equal(result.value.question, undefined);
  }
  assert.equal(openChangeSet(d), undefined);
});

test("the system prompt carries today's date, the time zone and the never-claim-a-write rule", async () => {
  const { client, requests } = scripted([[say("Hi.")]]);
  await chatAgent(deps(client), input("hello"));
  const system = JSON.stringify(requests[0]!.system);
  assert.match(system, /TONE/);
  assert.match(system, /Saturday, October 3, 2026/);
  assert.match(system, /2026-10-03/);
  assert.match(system, /America\/New_York/);
  assert.match(system, /never say a change has been made/i);
});

test("two events in one message become one change-set question and write nothing", async () => {
  const { client } = scripted([
    [
      use("1", "create_event", { title: "Workout", date: "2026-10-03", startTime: "13:10", endTime: "14:50" }),
      use("2", "create_event", { title: "Dinner", date: "2026-10-03", startTime: "18:00", endTime: "19:00" }),
    ],
    [say("Done! Both events are on your calendar.")],
  ]);
  const d = deps(client);
  const result = await chatAgent(d, input("add the workout and dinner to my google calendar for today"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.reply,
    "Here's what I'd change:\n- Add \"Workout\" on Sat, Oct 3, 1:10 PM–2:50 PM\n- Add \"Dinner\" on Sat, Oct 3, 6:00 PM–7:00 PM\nApprove to apply all of it, or discard to change nothing.",
  );
  assert.doesNotMatch(result.value.reply, /Done/);
  assert.deepEqual(result.value.receipts, []);
  assert.equal(result.value.question?.proposal?.kind, "change-set");
  assert.deepEqual(result.value.question?.options.map((o) => o.value), ["approve", "discard"]);
  assert.equal(openChangeSet(d)?.items.length, 2);
});

test("events then a plan step chain into one change set", async () => {
  const { client } = scripted([
    [use("1", "create_event", { title: "Workout", date: "2026-10-03", startTime: "13:10", endTime: "14:50" }), use("2", "plan_day", {})],
    [say("Staged.")],
  ]);
  const d = deps(client);
  await chatAgent(d, input("add my workout then build the plan around it"));
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["create-event", "plan-day"]);
});

test("a task found by name is placed after a real event", async () => {
  const { client, requests } = scripted([
    [use("1", "list_tasks", { titleQuery: "MGP" }), use("2", "list_events", { date: "2026-10-03" })],
    [use("3", "create_event", { title: "English MGP assignment", date: "2026-10-03", startTime: "19:00", endTime: "19:45" })],
    [say("Staged.")],
  ]);
  const d = deps(client);
  await chatAgent(d, input("add the english MGP assignment to my google calendar after dinner"));
  const events = JSON.parse((requests[1]!.messages.at(-1) as { content: { content: string }[] }).content[1]!.content);
  assert.equal(events.events[0].title, "Dinner");
  assert.equal(events.events[0].localStart, "18:00");
  assert.equal(openChangeSet(d)?.items[0]?.kind, "create-event");
});

test("a write tool with an unknown id is rejected back to the model and stages nothing", async () => {
  const { client, requests } = scripted([[use("1", "complete_task", { taskId: "made-up" })], [say("I couldn't find that task.")]]);
  const d = deps(client);
  const result = await chatAgent(d, input("mark the essay done"));
  assert.match(toolResult(requests, 1), /No Task with that id/);
  assert.equal(openChangeSet(d), undefined);
  if (result.ok) assert.equal(result.value.question, undefined);
});

test("delete is refused for an event Yoh did not create and staged for one it did", async () => {
  const { client, requests } = scripted([
    [use("1", "list_events", { date: "2026-10-03" })],
    [use("2", "delete_event", { eventId: "ev-dentist" }), use("3", "delete_event", { eventId: "ev-dinner" })],
    [say("Staged.")],
  ]);
  const d = deps(client);
  await chatAgent(d, input("delete the dentist and the dinner"));
  const results = (requests[2]!.messages.at(-1) as { content: { content: string; is_error?: boolean }[] }).content;
  assert.match(results[0]!.content, /can only delete events Yoh created/);
  assert.equal(results[0]!.is_error, true);
  assert.deepEqual(openChangeSet(d)?.items, [{ kind: "delete-event", eventId: "ev-dinner", label: "Dinner", etag: "v1" }]);
});

test("an event time that ends before it starts is rejected and stages nothing", async () => {
  const { client, requests } = scripted([[use("1", "create_event", { title: "Late", date: "2026-10-03", startTime: "23:30", endTime: "00:30" })], [say("That crosses midnight.")]]);
  const d = deps(client);
  await chatAgent(d, input("add a late thing 11:30pm to 12:30am"));
  assert.match(toolResult(requests, 1), /endTime must be after startTime/);
  assert.equal(openChangeSet(d), undefined);
});

test("a read tool that throws returns plain copy to the model, never the raw error", async () => {
  const { client, requests } = scripted([[use("1", "list_tasks", {})], [say("I couldn't reach your Tasks just now.")]]);
  const result = await chatAgent(deps(client, { readTasks: async () => { throw new Error("ECONNRESET 10.0.0.4"); } }), input("what's due"));
  assert.doesNotMatch(toolResult(requests, 1), /ECONNRESET/);
  assert.equal(result.ok, true);
});

test("the loop stops at the step cap and says so", async () => {
  const { client, requests } = scripted([[use("x", "list_tasks", {})]]);
  const result = await chatAgent(deps(client), input("loop forever"));
  assert.equal(requests.length, CHAT_AGENT_MAX_STEPS);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reply, CHAT_AGENT_STEP_CAP_REPLY);
});

test("a model transport failure is a Result error with user copy", async () => {
  const client = { messages: { create: (async () => { throw new Error("401 invalid x-api-key sk-ant-123"); }) as unknown as AnthropicMessagesClient["messages"]["create"] } };
  const result = await chatAgent(deps(client), input("hello"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.doesNotMatch(result.error.message, /sk-ant/);
});

test("a new change set replaces an earlier one that is still open", async () => {
  const first = scripted([[use("1", "plan_day", {})], [say("Staged.")]]);
  const d = deps(first.client);
  await chatAgent(d, input("plan my afternoon"));
  const second = scripted([[use("1", "refit_plan", {})], [say("Staged.")]]);
  const result = await chatAgent({ ...d, llmClient: second.client }, input("actually re-fit instead"));
  assert.equal(result.ok, true);
  const open = listOpenInteractionRequests(d.store).filter((r) => r.data.requestKind === "proposal");
  assert.equal(open.length, 1);
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["refit-plan"]);
});

test("plan_day and refit_plan are not both staged; the later one wins", async () => {
  const { client } = scripted([[use("1", "plan_day", {}), use("2", "refit_plan", {})], [say("Staged.")]]);
  const d = deps(client);
  await chatAgent(d, input("plan and refit"));
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["refit-plan"]);
});

test("emits a status per tool and the final text as a delta", async () => {
  const events: { type: string; text?: string }[] = [];
  const { client } = scripted([[use("1", "list_tasks", {})], [say("Three tasks.")]]);
  await chatAgent(deps(client, { emit: (e) => events.push(e as { type: string; text?: string }) }), input("what's due"));
  assert.deepEqual(events, [{ type: "status", text: "Checking your Tasks…" }, { type: "delta", text: "Three tasks." }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/app-chat-agent.test.ts`
Expected: FAIL — module `chat-agent.ts` not found.

- [ ] **Step 3: Implement `src/app/chat-agent.ts`**

```ts
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
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
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

function stage(staged: ChangeSetItem[], item: ChangeSetItem): void {
  if (item.kind === "plan-day" || item.kind === "refit-plan") {
    const existing = staged.findIndex((i) => i.kind === "plan-day" || i.kind === "refit-plan");
    if (existing !== -1) staged.splice(existing, 1);
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
        const outcome = status ? await runReadTool(deps, toolUse.name, args, seen) : runWriteTool(deps, toolUse.name, args, seen, staged);
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
  const reply = finalText.length > 0 ? finalText : "I don't have an answer for that.";
  deps.emit?.({ type: "delta", text: reply });
  return { ok: true, value: { reply, receipts: [], substantive: true } };
}
```

Notes for the implementer:
- `listOpenInteractionRequests` returns stored records with `id`, `version`, `data` (see its use in `src/app/open-proposal.ts` and `src/app/answer-open-item.ts`). Confirm `clearInteractionRequest(store, id, version)`'s signature with `grep -n "export function clearInteractionRequest" src/adapters/memory-store.ts`.
- The step-cap test expects the cap reply even though nothing was staged; if the cap is hit with items staged, the staged branch runs first and the change set is still offered. That is intended.
- The "a task found by name is placed after a real event" test asserts `localStart: "18:00"` for the Dinner event (22:00Z in `America/New_York` on Oct 3). Events arrive in the order the fake returns them; do not sort.
- `agentSystemPrompt`'s time line uses `toLocaleTimeString("en-US", …)`; strip ` ` there too, as `core/chat-tools.ts`'s `clock` does.

- [ ] **Step 4: Run tests, layering test, typecheck**

Run: `node --test tests/app-chat-agent.test.ts tests/layering-rules.test.ts && npm run typecheck`
Expected: PASS. The layering test confirms `chat-agent.ts` exports only functions of shape `(deps, input) => Promise<Result>` plus types and constants.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-agent.ts tests/app-chat-agent.test.ts
git commit -m "feat(app): chat tool loop with staged change sets"
```

---

### Task 6: Route chat to the loop and wire the server

**Files:**
- Modify: `src/app/chat-turn.ts` (imports; `ChatTurnDeps` line 134; create-item branch ~line 404; calendar-delete branch ~line 416; LLM tail lines ~512–560)
- Modify: `src/shell/server.ts` (`buildChatDeps` line 1815; the answer-open-items deps near line 2071)
- Modify: `tests/app-chat-turn.test.ts`, `tests/server-chat.test.ts`

**Interfaces:**
- Consumes: `chatAgent`, `ChatAgentDeps` (Task 5); `ApplyChangeSetDeps` (Task 4); `searchMemory`, `searchWeb`, `updateTask`, `renameTask`, `checkOff`, `planDay`, `requestReshuffle`, `approveReshuffle`.
- Produces: `chatTurn` routes every line no deterministic recognizer handles to `chatAgent`. `ChatTurnDeps` no longer needs `classifyCapture`/`classifyChatIntent`. `CALENDAR_DELETE_NOT_SUPPORTED_REPLY` is removed.

- [ ] **Step 1: Write the failing routing tests**

In `tests/app-chat-turn.test.ts`, add a scripted tool client next to `makeFakeLlmClient`:

```ts
function toolLoopClient(turns: unknown[][]) {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  const client = {
    messages: {
      create: (async (params: Record<string, unknown>) => {
        calls.push(params);
        const content = turns[Math.min(i++, turns.length - 1)]!;
        return { content, usage: { input_tokens: 1, output_tokens: 1 } };
      }) as unknown as AnthropicMessagesClient["messages"]["create"],
    },
  };
  return { client, calls };
}
```

Add:

```ts
test("an unmatched line goes to the tool loop in one model call, with tools attached", async () => {
  const { client, calls } = toolLoopClient([[{ type: "text", text: "Napoleon was a French general." }]]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "who was napoleon" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reply, "Napoleon was a French general.");
  assert.equal(calls.length, 1);
  assert.ok(Array.isArray(calls[0]!["tools"]));
});

test("'add the workout and dinner to my google calendar for today' reaches the tool loop, not a Tasks draft", async () => {
  const { client } = toolLoopClient([
    [
      { type: "tool_use", id: "1", name: "create_event", input: { title: "Workout", date: TEST_TODAY, startTime: "13:10", endTime: "14:50" } },
      { type: "tool_use", id: "2", name: "create_event", input: { title: "Dinner", date: TEST_TODAY, startTime: "18:00", endTime: "19:00" } },
    ],
    [{ type: "text", text: "Staged." }],
  ]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "add the workout and dinner to my google calendar for today" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.doesNotMatch(result.value.reply, /couldn't tell what you want/i);
    assert.equal(result.value.question?.proposal?.kind, "change-set");
  }
});

test("a calendar delete request reaches the tool loop instead of a fixed refusal", async () => {
  const { client, calls } = toolLoopClient([[{ type: "text", text: "I can only delete events Yoh created." }]]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "cancel my dentist appointment tomorrow" });
  assert.equal(calls.length, 1);
  if (result.ok) assert.equal(result.value.reply, "I can only delete events Yoh created.");
});

test("a deterministic command still costs zero model calls", async () => {
  const { client, calls } = toolLoopClient([[{ type: "text", text: "unused" }]]);
  await chatTurn(baseDeps({ llmClient: client }), { message: "plan" });
  assert.equal(calls.length, 0);
});

test("a turn answered by the tool loop is not marked handledDeterministically", async () => {
  const { client } = toolLoopClient([[{ type: "text", text: "Hi." }]]);
  const result = await chatTurn(baseDeps({ llmClient: client }), { message: "hello there" });
  if (result.ok) assert.notEqual(result.value.handledDeterministically, true);
});
```

Update or delete the existing tests in this file that assert the old tail (search the file for `classifyCapture`, `classifyChatIntent`, `fakeCaptureRoutingClient`, `CALENDAR_DELETE_NOT_SUPPORTED_REPLY`, and "exactly three"): each either asserts the same user-visible outcome through `toolLoopClient`, or is removed because the behaviour it pinned (two classifier calls) no longer exists. Keep every test that pins a deterministic recognizer.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/app-chat-turn.test.ts`
Expected: the five new tests FAIL (replies come from the old path; `calls[0].tools` is undefined).

- [ ] **Step 3: Rewire `chatTurn`**

In `src/app/chat-turn.ts`:

1. Add to `ChatTurnDeps`:

```ts
  /** Pre-bound read helpers for the tool loop (`app/chat-agent.ts`). Absent in a test that never reaches the loop's search tools. */
  readonly agentSearchMemory?: ChatAgentDeps["searchMemory"];
```

2. Add a private helper above `chatTurn`:

```ts
/** The final step of routing: the tool loop. Everything no deterministic recognizer handled ends here. */
async function runAgent(deps: ChatTurnDeps, input: ChatTurnRequest, reachedLlm: { value: boolean }): Promise<Result<ChatTurnResponse, YohError>> {
  reachedLlm.value = true;
  const searchWebForModel: ChatAgentDeps["searchWeb"] = async (query) => {
    const found = await searchWeb(deps, { query });
    return found.ok ? { ok: true, value: { text: found.value.reply } } : found;
  };
  return chatAgent(
    {
      llmClient: deps.llmClient,
      store: deps.store,
      ...(deps.connection ? { connection: deps.connection } : {}),
      timeZone: deps.timeZone,
      now: deps.now,
      readTasks: deps.readTasks,
      readCalendarEventsForDate: deps.readCalendarEventsForDate,
      searchMemory: deps.agentSearchMemory ?? (async () => ({ ok: true, value: { text: "Memory search isn't available right now." } })),
      searchWeb: searchWebForModel,
      ...(deps.emit ? { emit: deps.emit } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    },
    {
      message: input.message,
      history: trimHistory(historyForModel(deps, input.message)),
      systemPrompt: resolveToneSystemPrompt(input.message, deps.webSearchAvailable ?? true, COMMANDS),
      ...(await recallFor(deps, input.message)),
    },
  );
}
```

Import `chatAgent, type ChatAgentDeps` from `./chat-agent.ts` and `resolveToneSystemPrompt` from `../core/tone.ts`.

3. Create-item branch: `draftItem` returns the "couldn't tell what you want" reply when its LLM draft finds nothing. Find the exact constant (`grep -n "couldn't tell what you want" src/app/create-item.ts`) and, in `routeChatTurn`, fall through when the draft produced no question:

```ts
  const createItemCommand = parseCreateItemCommand(input.message);
  if (createItemCommand) {
    const drafted = await draftItem(deps, { ...createItemCommand, ...(await recallFor(deps, createItemCommand.request)) });
    if (!drafted.ok || drafted.value.question !== undefined) return drafted;
    // No draft could be built from the line: let the tool loop handle it.
  }
```

4. Calendar-delete branch: delete the `isCalendarDeleteRequestCommand` block, the `CALENDAR_DELETE_NOT_SUPPORTED_REPLY` export, and the now-unused import. A delete request now matches nothing deterministic and reaches the loop. Confirm `isCalendarEditCommand` does not match "cancel/delete/remove/clear" lines (`node --test tests/chat-commands.test.ts`); if it does, add `if (isCalendarDeleteRequestCommand(input.message)) return runAgent(deps, input, reachedLlm);` in the deleted block's place instead of removing the import.

5. Replace everything from `let captured: "task" | "event" | "none" = "none";` through the final `return answerQuestion(...)` with:

```ts
  return runAgent(deps, input, reachedLlm);
```

Remove the `classifyCapture`, `classifyChatIntent` and `answerQuestion` imports, and update the file's header comment: the tail is now one tool loop, and an unmatched line costs between one and `CHAT_AGENT_MAX_STEPS` model calls.

6. Leave `parseSearchIntent` and the `search:` prefix as they are: a search-shaped line still goes straight to `searchWeb`.

- [ ] **Step 4: Wire the server**

In `src/shell/server.ts`:

1. In `buildChatDeps`, add `agentSearchMemory` to the returned deps, built from `searchMemory` (import from `../app/memory-search.ts`) with the same `memoryItems`, `chatHistory`, `connection`, `readTasks`, `now`, `timeZone` that function already has in scope:

```ts
    agentSearchMemory: async (query) => {
      const found = await searchMemory({ memoryItems, chatHistory, connection, readTasks, now, timeZone }, { query });
      if (!found.ok) return found;
      const lines = [...found.value.items.map((i) => `- ${i.text}`), ...found.value.turns.map((t) => `- (${t.date}, ${t.role}) ${t.snippet}`)];
      return { ok: true, value: { text: lines.length > 0 ? lines.join("\n") : "Nothing in memory matches that." } };
    },
```

(`MemoryItemView` has a `text` field; confirm with `grep -n "export interface MemoryItemView" -A8 src/core/memory-item-view.ts src/types/api.ts`.)

2. Where the answer-open-items deps are assembled (the object containing `...bindNotionTaskWrites(getNotionTaskWriteBinding)`, near line 2071), add a `changeSet: ApplyChangeSetDeps` built from deps already in scope:

```ts
    changeSet: {
      timeZone,
      now,
      applyCalendarEdit: /* the same bound applyCalendarEdit this object already passes */,
      createPage: /* the same bound createPage this object already passes */,
      updateTaskField: (taskId, field, value) => updateTask(updateTaskDeps, { taskId, field, value }),
      renameTask: (taskId, title) => renameTask(updateTaskDeps, { taskId, title }),
      completeTask: (taskId) => checkOff(checkOffDeps, { taskId }),
      planDay: () => planDay(planDayDeps, {}),
      refitPlan: async () => {
        const requested = await requestReshuffle(reshuffleDeps, { request: { kind: "reflow-now" } });
        if (!requested.ok) return requested;
        const approved = await approveReshuffle({ ...reshuffleDeps, store, connection }, { proposal: requested.value.proposal, requestId: requested.value.question.requestId });
        return approved.ok ? { ok: true, value: { reply: requested.value.proposal.suggested.summary } } : approved;
      },
    },
```

Each named deps object already exists for its own route: find them with `grep -n "updateTask(\|renameTask(\|checkOff(\|planDay(\|approveReshuffle(" src/shell/server.ts` and reuse the same deps value that call site passes. If one is only built inside `createApp`, lift its construction into the same `build*Deps` function rather than duplicating it. When `checkOffDeps` is undefined (Notion not configured), make `completeTask` return `{ ok: false, error: { kind: "missing-field", message: "Notion isn't set up, so I can't mark Tasks done." } }`.

3. Thread `changeSet` through `AnswerOpenItemDeps` (`src/app/answer-open-item.ts`) the same way `reshuffle` is: add `readonly changeSet?: ConfirmProposalDeps["changeSet"];` so it reaches `confirmProposal(deps, …)`.

- [ ] **Step 5: Server test**

In `tests/server-chat.test.ts`, add one test in that file's existing style: `POST /api/chat` with a scripted `runChatTurn`-free real `chatTurn` is not what this file does (it scripts `runChatTurn`), so instead add to the file that tests `POST /api/open-items/answer` (`ls tests | grep open-item`): an open `"change-set"` proposal with one `complete-task` item, answered `"approve"`, returns `receipts: ['Marked "…" done.']` and calls the fake `changeSet.completeTask` once; answered `"discard"`, calls nothing.

- [ ] **Step 6: Run focused tests, then the full gate**

Run: `node --test tests/app-chat-turn.test.ts tests/chat-commands.test.ts tests/layering-rules.test.ts`
Expected: PASS.

Run: `npm run check > /tmp/chat-tool-loop-gate.log 2>&1; tail -40 /tmp/chat-tool-loop-gate.log`
Expected: all five stages pass. Read only failures and the summary.

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-turn.ts src/app/answer-open-item.ts src/shell/server.ts tests/
git commit -m "feat(chat): free-form lines run through the tool loop"
```

---

### Task 7: Web — change-set card and E2E

**Files:**
- Modify: `web/src/components/StructuredQuestion.tsx`, `web/src/components/StructuredQuestion.test.tsx`
- Modify: `web/src/components/ChatMessage.tsx`
- Modify: `tests/e2e/fixture-server.ts`
- Create: `web/e2e/change-set.spec.ts`

**Interfaces:**
- Consumes: `OpenItemQuestion.proposal` with `kind: "change-set"` and `text` = the `changeSetPrompt` string (first line a lead-in, then `- ` lines, then a closing line).
- Produces: `StructuredQuestionProps.items?: readonly string[]`; exported fixture constant `FIXTURE_CHANGE_SET_MESSAGE`.

- [ ] **Step 1: Write the failing component test**

Append to `web/src/components/StructuredQuestion.test.tsx`:

```tsx
it("renders change-set items as a list between the lead-in and the options", () => {
  render(
    <StructuredQuestion
      text="Here's what I'd change:"
      items={['Add "Workout" on Sat, Oct 3, 1:10 PM–2:50 PM', "Build today's Plan"]}
      options={[{ label: "Approve", value: "approve" }, { label: "Discard", value: "discard" }]}
      allowsFreeText={false}
      onAnswer={() => {}}
    />,
  );
  const list = screen.getByRole("list", { name: "Proposed changes" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
});

it("renders no list when items is absent", () => {
  render(<StructuredQuestion text="Create it?" options={[{ label: "Yes", value: "yes" }]} allowsFreeText={false} onAnswer={() => {}} />);
  expect(screen.queryByRole("list", { name: "Proposed changes" })).not.toBeInTheDocument();
});
```

(Add `within` to the file's `@testing-library/react` import if missing.)

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/components/StructuredQuestion.test.tsx`
Expected: FAIL — no list with that name.

- [ ] **Step 3: Implement**

In `StructuredQuestion.tsx`, add to the props interface and destructuring:

```tsx
  /** A change-set proposal's staged changes, one line each, shown as a list under `text`. */
  readonly items?: readonly string[];
```

Render directly after the element that shows `text`, copying that element's text classes (tokens only, no hard-coded values):

```tsx
      {items !== undefined && items.length > 0 && (
        <ul aria-label="Proposed changes" className="list-disc pl-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
```

In `ChatMessage.tsx`, where `<StructuredQuestion … text={question.text} …>` is rendered for a message's question, split a change-set's text:

```tsx
function changeSetParts(question: OpenItemQuestion): { text: string; items?: readonly string[] } {
  if (question.proposal?.kind !== "change-set") return { text: question.text };
  const lines = question.text.split("\n");
  const items = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  return { text: lines.filter((l) => !l.startsWith("- ")).join(" "), items };
}
```

and pass `{...changeSetParts(message.question)}` in place of `text={…}`. The message's own reply text for that turn is the same prompt string; check how `ChatMessage` avoids showing a question's words twice (commit `3441eee`, "a question on a chat reply is not shown as a second card") and follow that rule so the list appears once.

- [ ] **Step 4: Fixture**

In `tests/e2e/fixture-server.ts`, export a trigger and make the scripted `runChatTurn` answer it with a real stored change set, so `POST /api/open-items/answer` applies it through the real `confirmProposal`:

```ts
export const FIXTURE_CHANGE_SET_MESSAGE = "add a workout at 1 and mark the first task done";
```

In the scripted `runChatTurn`, before its default reply:

```ts
    if (input.message === FIXTURE_CHANGE_SET_MESSAGE) {
      const items: ChangeSetItem[] = [
        { kind: "create-event", title: "Workout", start: new Date(startedAt.getTime() + 3_600_000).toISOString(), end: new Date(startedAt.getTime() + 7_200_000).toISOString() },
        { kind: "complete-task", taskId: FIXTURE_TASKS[0]!.id, label: FIXTURE_TASKS[0]!.title },
      ];
      const reply = changeSetPrompt(items, TIME_ZONE);
      const proposal = { id: randomUUID(), kind: "change-set", entityId: "chat", entityVersion: "", suggested: { items }, reason: reply, createdAt: new Date().toISOString() };
      const opened = await openProposal({ store }, { proposal });
      if (!opened.ok) return opened;
      return { ok: true, value: { reply, receipts: [], question: opened.value } };
    }
```

Give the fixture's answer-open-items deps a `changeSet` whose `applyCalendarEdit` records into an exported array `fixtureCalendarCreates`, whose `completeTask` calls the fixture's existing fake check-off path, and whose other members return `{ ok: true, … }` fakes. Expose `fixtureCalendarCreates.length` on the existing `GET /__fixture/state` response as `calendarCreates`.

- [ ] **Step 5: Playwright spec**

Create `web/e2e/change-set.spec.ts`, copying the page-open and send helpers from `web/e2e/capture-flow.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { FIXTURE_CHANGE_SET_MESSAGE } from "../../tests/e2e/fixture-server.ts";

test("a change set shows every item once and applies on Approve", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: /message/i }).fill(FIXTURE_CHANGE_SET_MESSAGE);
  await page.keyboard.press("Enter");
  const list = page.getByRole("list", { name: "Proposed changes" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText('Add "Workout"', { exact: false })).toHaveCount(1);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/^Added "Workout"/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  const state = await (await request.get("/__fixture/state?taskId=none")).json();
  expect(state.calendarCreates).toBe(1);
});

test("Discard writes nothing", async ({ page, request }) => {
  const before = (await (await request.get("/__fixture/state?taskId=none")).json()).calendarCreates;
  await page.goto("/");
  await page.getByRole("textbox", { name: /message/i }).fill(FIXTURE_CHANGE_SET_MESSAGE);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
  const after = (await (await request.get("/__fixture/state?taskId=none")).json()).calendarCreates;
  expect(after).toBe(before);
});
```

If `web/e2e` specs import fixture constants by a different route (check the top of `capture-flow.spec.ts`), use that route; `web/` may only `import type` from `src/types/`, and the existing specs show the allowed way to reach `tests/e2e/`. Match the chat input's real accessible name from that spec.

- [ ] **Step 6: Run web tests, Playwright, full gate**

Run: `cd web && npx vitest run src/components/StructuredQuestion.test.tsx`
Expected: PASS.

Run: `cd web && npx playwright test e2e/change-set.spec.ts e2e/capture-flow.spec.ts e2e/chat.spec.ts`
Expected: PASS (fixture server on 8788).

Run: `npm run check > /tmp/chat-tool-loop-gate.log 2>&1; tail -40 /tmp/chat-tool-loop-gate.log`
Expected: all stages pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components web/e2e/change-set.spec.ts tests/e2e/fixture-server.ts
git commit -m "feat(web): change-set confirm card"
```

---

## After the last task

- Update `AGENTS.md`'s "Chat routing" idiom line: deterministic recognizers → `chatAgent` tool loop; writes staged as a `"change-set"` Proposal.
- Spencer deploys to the Pi (`deploy/RASPBERRY-PI.md` section 9). First real-use check, in chat: "what is the total amount of minutes of tasks that i have due on monday", then "add a test event at 9pm tonight", Approve, then "delete the test event", Approve.

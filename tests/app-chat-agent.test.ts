import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryStore, listOpenInteractionRequests, putOpenInteractionRequest, putPlan } from "../src/adapters/memory-store.ts";
import { errorCopyForThrown } from "../src/core/error-copy.ts";
import { chatAgent, CHAT_AGENT_STEP_CAP_REPLY, type ChatAgentDeps } from "../src/app/chat-agent.ts";
import { CHAT_AGENT_MAX_STEPS, CHANGE_SET_PARTIAL_NOTE, CHANGE_SET_REPLACES_NOTE, NOTHING_CHANGED_NOTE, UNSTAGED_CLAIM_REPLY, changeSetPrompt } from "../src/core/chat-tools.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import type { CalendarEvent, ChangeSet, Plan, Proposal, Task } from "../src/types/domain.ts";

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

function seedPlan(d: ChatAgentDeps): void {
  const plan: Plan = {
    id: "plan-2026-10-03",
    date: "2026-10-03",
    blocks: [{ id: "work-1", kind: "work", start: "2026-10-03T17:00:00.000Z", end: "2026-10-03T18:00:00.000Z", label: "Draft", taskId: "t-mgp" }],
    reasoning: "r",
    version: 1,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  };
  putPlan(d.store, plan);
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
  assert.match(system, /never ask Spencer to confirm in text/i);
  assert.match(system, /deleting a Task/);
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
  const tr = (requests[1]!.messages.at(-1) as { content: { content: string; is_error?: boolean }[] }).content[0]!;
  assert.equal(tr.is_error, true);
  assert.equal(tr.content, errorCopyForThrown(new Error("ECONNRESET 10.0.0.4")));
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
  if (!result.ok) {
    assert.doesNotMatch(result.error.message, /sk-ant/);
    assert.equal(result.error.kind, "unreachable");
    assert.equal(result.error.message, errorCopyForThrown(new Error("401 invalid x-api-key sk-ant-123")));
  }
});

test("a new change set replaces an earlier one that is still open", async () => {
  const first = scripted([[use("1", "create_event", { title: "Workout", date: "2026-10-03", startTime: "13:10", endTime: "14:50" })], [say("Staged.")]]);
  const d = deps(first.client);
  seedPlan(d);
  await chatAgent(d, input("add a workout"));
  const second = scripted([[use("1", "refit_plan", {})], [say("Staged.")]]);
  const result = await chatAgent({ ...d, llmClient: second.client }, input("actually re-fit instead"));
  assert.equal(result.ok, true);
  const open = listOpenInteractionRequests(d.store).filter((r) => r.data.requestKind === "proposal");
  assert.equal(open.length, 1);
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["refit-plan"]);
  if (result.ok) assert.equal(result.value.reply.split("\n").at(-1), CHANGE_SET_REPLACES_NOTE);
});

test("every model call is told today's date, the time and tomorrow's date, and not to ask for them", async () => {
  const { client, requests } = scripted([[say("Tomorrow is Sunday.")]]);
  await chatAgent(deps(client), input("what is tomorrow"));
  const system = JSON.stringify(requests[0]!.system);
  assert.match(system, /Today is Saturday, October 3, 2026 \(2026-10-03\)/);
  assert.match(system, /The local time is 12:00 PM/);
  assert.match(system, /Tomorrow is Sunday, October 4 \(2026-10-04\)/);
  assert.match(system, /Never ask Spencer what the date or time is/);
  assert.match(system, /A Plan exists only for today/);
});

test("a first change set carries no replacement line", async () => {
  const { client } = scripted([[use("1", "create_task", { title: "Read" })], [say("Staged.")]]);
  const result = await chatAgent(deps(client), input("add a task"));
  assert.equal(result.ok && result.value.reply.includes(CHANGE_SET_REPLACES_NOTE), false);
});

test("a change set left from an earlier day is replaced without the replacement line", async () => {
  const { client } = scripted([[use("1", "create_task", { title: "Read" })], [say("Staged.")]]);
  const d = deps(client);
  const createdAt = "2026-10-01T18:00:00.000Z";
  putOpenInteractionRequest(d.store, "proposal:old", {
    requestKind: "proposal",
    promptText: "Here's what I'd change:",
    detail: { proposal: { id: "old", kind: "change-set", entityId: "chat", entityVersion: "", suggested: { items: [{ kind: "plan-day" }] }, reason: "r", createdAt }, cursor: { questionId: "confirm" } },
    createdAt,
  });
  const result = await chatAgent(d, input("add a task"));
  assert.equal(result.ok && result.value.reply.includes(CHANGE_SET_REPLACES_NOTE), false);
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["create-task"]);
});

test("plan_day is rejected when today already has a Plan", async () => {
  const { client, requests } = scripted([[use("1", "plan_day", {})], [say("Use re-fit.")]]);
  const d = deps(client);
  seedPlan(d);
  await chatAgent(d, input("plan my day"));
  assert.match(toolResult(requests, 1), /already a Plan.*refit_plan/);
  assert.equal(openChangeSet(d), undefined);
});

test("resize_event takes the date from the event itself, ignoring the model's date", async () => {
  const { client } = stageTurn(FIRST_EVENTS, use("1", "resize_event", { eventId: "ev-dinner", date: "2026-12-25", endTime: "19:30" }));
  const d = deps(client);
  await chatAgent(d, input("end dinner at 7:30"));
  const item = openChangeSet(d)?.items[0];
  assert.equal(item?.kind, "resize-event");
  assert.equal(item?.kind === "resize-event" && item.newEnd, "2026-10-03T23:30:00.000Z");
});

test("a rejected write beside a staged item adds the partial-set line", async () => {
  const { client } = stageTurn(
    FIRST_EVENTS,
    use("1", "delete_event", { eventId: "ev-dentist" }),
    use("2", "create_event", { title: "Workout", date: "2026-10-03", startTime: "13:10", endTime: "14:50" }),
  );
  const d = deps(client);
  const result = await chatAgent(d, input("delete the dentist and add a workout"));
  assert.equal(result.ok && result.value.reply.split("\n").at(-1), CHANGE_SET_PARTIAL_NOTE);
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["create-event"]);
});

test("plan_day and refit_plan are not both staged; the later one wins", async () => {
  const { client } = scripted([[use("1", "plan_day", {}), use("2", "refit_plan", {})], [say("Staged.")]]);
  const d = deps(client);
  seedPlan(d);
  await chatAgent(d, input("plan and refit"));
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["refit-plan"]);
});

test("emits a status per tool and the final text as a delta", async () => {
  const events: { type: string; text?: string }[] = [];
  const { client } = scripted([[use("1", "list_tasks", {})], [say("Three tasks.")]]);
  await chatAgent(deps(client, { emit: (e) => events.push(e as { type: string; text?: string }) }), input("what's due"));
  assert.deepEqual(events, [{ type: "status", text: "Checking your Tasks…" }, { type: "delta", text: "Three tasks." }]);
});

test("refit_plan with no stored Plan returns an error tool result and stages nothing", async () => {
  const { client, requests } = scripted([[use("1", "refit_plan", {})], [say("There is no Plan yet.")]]);
  const d = deps(client);
  await chatAgent(d, input("refit my plan"));
  assert.match(toolResult(requests, 1), /no Plan for today/);
  assert.equal(openChangeSet(d), undefined);
});

const stageTurn = (...calls: Block[]) => scripted([calls, [say("Staged.")]]);
const FIRST_EVENTS = use("0", "list_events", { date: "2026-10-03" });

test("step cap with items staged still returns the change-set question", async () => {
  const { client } = scripted([
    [use("1", "create_task", { title: "A" })],
    [use("x", "list_tasks", {})],
  ]);
  const d = deps(client);
  const result = await chatAgent(d, input("loop"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, changeSetPrompt([{ kind: "create-task", properties: { title: "A" } }], TZ));
  assert.equal(result.value.question?.proposal?.kind, "change-set");
});

test("a rejected write followed by a claim is replaced, never shown beside a contradiction", async () => {
  const { client } = scripted([[use("1", "complete_task", { taskId: "made-up" })], [say("Done, I marked it complete.")]]);
  const result = await chatAgent(deps(client), input("mark the essay done"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, UNSTAGED_CLAIM_REPLY);
  assert.deepEqual(result.value.receipts, []);
  assert.equal(result.value.question, undefined);
});

test("a rejected write followed by an honest answer keeps the answer and the nothing-changed note", async () => {
  const { client } = scripted([[use("1", "complete_task", { taskId: "made-up" })], [say("I couldn't find that task.")]]);
  const result = await chatAgent(deps(client), input("mark the essay done"));
  assert.equal(result.ok && result.value.reply, `I couldn't find that task.\n\n${NOTHING_CHANGED_NOTE}`);
});

test("a claim with no tools at all is replaced by the fixed reply", async () => {
  const { client } = scripted([[say("Done. Both events are now on your calendar.")]]);
  const result = await chatAgent(deps(client), input("add them"));
  assert.equal(result.ok && result.value.reply, UNSTAGED_CLAIM_REPLY);
});

test("prose that fakes staging is sent back once, and the tool call that follows stages a real change set", async () => {
  const { client, requests } = scripted([
    [say("Staging Golf on your calendar for tomorrow (Sunday, Oct 4):\n\n**Golf**\n9:00 AM - 12:00 PM\n\nConfirm?")],
    [use("1", "create_event", { title: "Golf", date: "2026-10-04", startTime: "09:00", endTime: "12:00" })],
    [say("Staged.")],
  ]);
  const d = deps(client);
  const result = await chatAgent(d, input("I am golfing from 9am to noon tomorrow"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.question?.proposal?.kind, "change-set");
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["create-event"]);
  assert.doesNotMatch(result.value.reply, /Confirm\?/);
  const correction = requests[1]!.messages.at(-1) as { role: string; content: string };
  assert.equal(correction.role, "user");
  assert.match(correction.content, /nothing is staged/i);
});

test("prose that keeps faking staging is corrected only once, then replaced; nothing is staged", async () => {
  const { client, requests } = scripted([[say("Staging both for deletion.\n\nConfirm and I'll remove them?")]]);
  const d = deps(client);
  const result = await chatAgent(d, input("Remove the northwestern supplements and uc supplements from the tasks"));
  assert.equal(result.ok && result.value.reply, UNSTAGED_CLAIM_REPLY);
  assert.equal(requests.length, 2);
  assert.equal(openChangeSet(d), undefined);
});

test("a plain answer gets no note, and the delta equals the reply", async () => {
  const events: { type: string; text?: string }[] = [];
  const { client } = scripted([[say("Napoleon was a French general.")]]);
  const result = await chatAgent(deps(client, { emit: (e) => events.push(e as { type: string; text?: string }) }), input("who was napoleon"));
  assert.equal(result.ok && result.value.reply, "Napoleon was a French general.");
  assert.deepEqual(events, [{ type: "delta", text: "Napoleon was a French general." }]);
});

test("the delta carries the replacement reply, not the model's claim", async () => {
  const events: { type: string; text?: string }[] = [];
  const { client } = scripted([[say("All set.")]]);
  const result = await chatAgent(deps(client, { emit: (e) => events.push(e as { type: string; text?: string }) }), input("x"));
  assert.ok(result.ok);
  assert.deepEqual(events, [{ type: "delta", text: result.ok ? result.value.reply : "" }]);
  assert.equal(events[0]!.text, UNSTAGED_CLAIM_REPLY);
});

test("moving the same event twice stages one move with the second time", async () => {
  const { client } = stageTurn(
    FIRST_EVENTS,
    use("1", "move_event", { eventId: "ev-dinner", date: "2026-10-03", startTime: "19:00", endTime: "20:00" }),
    use("2", "move_event", { eventId: "ev-dinner", date: "2026-10-03", startTime: "20:00", endTime: "21:00" }),
  );
  const d = deps(client);
  await chatAgent(d, input("move dinner twice"));
  const items = openChangeSet(d)?.items ?? [];
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "move-event");
  assert.equal(items[0]?.kind === "move-event" && items[0].newStart, "2026-10-04T00:00:00.000Z");
});

test("move then delete of one event stages only the delete", async () => {
  const { client } = stageTurn(
    FIRST_EVENTS,
    use("1", "move_event", { eventId: "ev-dinner", date: "2026-10-03", startTime: "19:00", endTime: "20:00" }),
    use("2", "delete_event", { eventId: "ev-dinner" }),
  );
  const d = deps(client);
  await chatAgent(d, input("x"));
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["delete-event"]);
});

test("the same task field updated twice stages one item with the second value; complete twice stages one", async () => {
  const { client } = stageTurn(
    use("0", "list_tasks", {}),
    use("1", "update_task", { taskId: "t-mgp", field: "dueDate", value: "2026-10-06" }),
    use("2", "update_task", { taskId: "t-mgp", field: "dueDate", value: "2026-10-07" }),
    use("3", "update_task", { taskId: "t-mgp", field: "title", value: "One" }),
    use("4", "update_task", { taskId: "t-mgp", field: "title", value: "Two" }),
    use("5", "complete_task", { taskId: "t-stats" }),
    use("6", "complete_task", { taskId: "t-stats" }),
  );
  const d = deps(client);
  await chatAgent(d, input("x"));
  const items = openChangeSet(d)?.items ?? [];
  assert.equal(items.length, 3);
  assert.ok(items.some((i) => i.kind === "update-task" && i.value === "2026-10-07"));
  assert.ok(items.some((i) => i.kind === "rename-task" && i.newTitle === "Two"));
  assert.equal(items.filter((i) => i.kind === "complete-task").length, 1);
});

test("a throw inside a write tool becomes an error result and earlier staged items survive", async () => {
  const { client, requests } = scripted([
    [use("1", "create_task", { title: "A" }), use("2", "refit_plan", {})],
    [say("Staged what I could.")],
  ]);
  const d = deps(client);
  const real = d.store.getRecord.bind(d.store);
  d.store.getRecord = ((kind: string, id: string) => {
    if (kind === "plan") throw new Error("SQLITE_BUSY /var/db/secret");
    return real(kind, id);
  }) as typeof d.store.getRecord;
  const logs: unknown[] = [];
  const result = await chatAgent({ ...d, log: (e) => logs.push(e) }, input("x"));
  assert.equal(result.ok, true);
  const results = (requests[1]!.messages.at(-1) as { content: { content: string; is_error?: boolean }[] }).content;
  assert.equal(results[1]!.is_error, true);
  assert.doesNotMatch(results[1]!.content, /SQLITE_BUSY/);
  assert.equal(logs.length, 1);
  assert.deepEqual(openChangeSet(d)?.items.map((i) => i.kind), ["create-task"]);
});

test("P12: a plain answer with no tool call carries no substantive key", async () => {
  const { client } = scripted([[say("I'm well, thanks.")]]);
  const result = await chatAgent(deps(client), input("how are you"));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal("substantive" in result.value, false);
});

test("P12: an answer after a read tool call, or after a rejected write, is substantive", async () => {
  const read = scripted([[use("1", "list_tasks", {})], [say("You have four open Tasks.")]]);
  const a = await chatAgent(deps(read.client), input("how many tasks"));
  assert.equal(a.ok && a.value.substantive, true);
  const rejected = scripted([[use("1", "complete_task", { taskId: "made-up" })], [say("Couldn't find it.")]]);
  const b = await chatAgent(deps(rejected.client), input("mark it done"));
  assert.equal(b.ok && b.value.substantive, true);
});

test("P12: a change-set question is substantive", async () => {
  const { client } = stageTurn(use("1", "create_task", { title: "A" }));
  const result = await chatAgent(deps(client), input("add a task A"));
  assert.equal(result.ok && result.value.substantive, true);
});

// Now is 12:00 PM local: one block already past, a Task block, a break and a Routine still to come.
const DAY_BLOCKS: Plan["blocks"] = [
  { id: "b-past", kind: "work", start: "2026-10-03T14:00:00.000Z", end: "2026-10-03T15:00:00.000Z", label: "Reading", taskId: "t-later" },
  { id: "b-draft", kind: "work", start: "2026-10-03T17:00:00.000Z", end: "2026-10-03T18:00:00.000Z", label: "Draft", taskId: "t-mgp" },
  { id: "b-break", kind: "break", start: "2026-10-03T18:00:00.000Z", end: "2026-10-03T18:15:00.000Z", label: "Break" },
  { id: "b-commute", kind: "routine", start: "2026-10-03T19:00:00.000Z", end: "2026-10-03T19:30:00.000Z", label: "Commute", routineId: "r-commute" },
];

function seedBlocks(d: ChatAgentDeps, blocks: Plan["blocks"] = DAY_BLOCKS): void {
  putPlan(d.store, { id: "plan-2026-10-03", date: "2026-10-03", blocks, reasoning: "r", version: 1, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" });
}

const GET_PLAN = use("0", "get_plan", {});
type ToolResults = { content: string; is_error?: boolean }[];
const resultsOf = (requests: { messages: unknown[] }[], call: number): ToolResults => (requests[call]!.messages.at(-1) as { content: ToolResults }).content;

test("get_plan returns each block's id and what chat may do to it", async () => {
  const { client, requests } = scripted([[GET_PLAN], [say("Your next block is Draft at 1.")]]);
  const d = deps(client);
  seedBlocks(d);
  await chatAgent(d, input("what's next"));
  const blocks = JSON.parse(toolResult(requests, 1)).blocks as Record<string, unknown>[];
  assert.deepEqual(blocks.map((b) => b["id"]), ["b-past", "b-draft", "b-break", "b-commute"]);
  assert.deepEqual(blocks.map((b) => [b["canMove"], b["canResize"], b["canRemove"]]), [
    [false, false, false],
    [true, true, true],
    [false, false, false],
    [true, false, false],
  ]);
});

test("move_block and resize_block on a Task block stage side by side; a Routine block moves by its Routine", async () => {
  const { client } = scripted([
    [GET_PLAN],
    [use("1", "move_block", { blockId: "b-draft", startTime: "15:00" }), use("2", "resize_block", { blockId: "b-draft", endTime: "14:30" }), use("3", "move_block", { blockId: "b-commute", startTime: "17:00" })],
    [say("Staged.")],
  ]);
  const d = deps(client);
  seedBlocks(d);
  const result = await chatAgent(d, input("push the draft to 3, make it 90 minutes, commute at 5"));
  assert.equal(result.ok, true);
  assert.deepEqual(openChangeSet(d)?.items, [
    { kind: "move-block", subject: { kind: "task", taskId: "t-mgp" }, label: "Draft", newStart: "2026-10-03T19:00:00.000Z" },
    { kind: "resize-block", taskId: "t-mgp", label: "Draft", durationMinutes: 90 },
    { kind: "move-block", subject: { kind: "routine", routineId: "r-commute" }, label: "Commute", newStart: "2026-10-03T21:00:00.000Z" },
  ]);
  if (result.ok) assert.match(result.value.reply, /Move "Draft" to 3:00 PM in today's Plan/);
});

test("remove_block replaces an earlier move or resize of the same Task; a later move_block replaces an earlier one", async () => {
  const { client } = scripted([
    [GET_PLAN],
    [
      use("1", "move_block", { blockId: "b-commute", startTime: "16:00" }),
      use("2", "move_block", { blockId: "b-draft", startTime: "15:00" }),
      use("3", "resize_block", { blockId: "b-draft", durationMinutes: 30 }),
      use("4", "remove_block", { blockId: "b-draft" }),
      use("5", "move_block", { blockId: "b-commute", startTime: "17:00" }),
    ],
    [say("Staged.")],
  ]);
  const d = deps(client);
  seedBlocks(d);
  await chatAgent(d, input("drop the draft and move commute to 5"));
  assert.deepEqual(openChangeSet(d)?.items, [
    { kind: "remove-block", taskId: "t-mgp", label: "Draft" },
    { kind: "move-block", subject: { kind: "routine", routineId: "r-commute" }, label: "Commute", newStart: "2026-10-03T21:00:00.000Z" },
  ]);
});

test("block tools refuse an id get_plan did not return, a block that can't change, and a time that isn't later today", async () => {
  const { client, requests } = scripted([
    [use("1", "move_block", { blockId: "b-draft", startTime: "15:00" })],
    [GET_PLAN],
    [
      use("2", "move_block", { blockId: "b-past", startTime: "15:00" }),
      use("3", "move_block", { blockId: "b-break", startTime: "15:00" }),
      use("4", "resize_block", { blockId: "b-commute", endTime: "16:00" }),
      use("5", "remove_block", { blockId: "b-commute" }),
      use("6", "move_block", { blockId: "b-draft", startTime: "11:00" }),
      use("7", "move_block", { blockId: "b-draft", startTime: "3pm" }),
      use("8", "resize_block", { blockId: "b-draft", endTime: "12:30" }),
      use("9", "resize_block", { blockId: "b-draft", durationMinutes: 0 }),
      use("10", "resize_block", { blockId: "b-draft" }),
    ],
    [say("I can't change those.")],
  ]);
  const d = deps(client);
  seedBlocks(d);
  const result = await chatAgent(d, input("change things"));
  assert.equal(result.ok, true);
  assert.match(resultsOf(requests, 1)[0]!.content, /Call get_plan first/);
  const refused = resultsOf(requests, 3);
  assert.equal(refused.length, 9);
  assert.ok(refused.every((r) => r.is_error === true));
  assert.match(refused[0]!.content, /can't be moved/);
  assert.match(refused[2]!.content, /can't be resized/);
  assert.match(refused[3]!.content, /can't be removed/);
  assert.match(refused[4]!.content, /later today/);
  assert.match(refused[6]!.content, /after the block's start/);
  assert.equal(openChangeSet(d), undefined);
});

test("resize_block by endTime is refused for a Task split across blocks; durationMinutes is taken as its total", async () => {
  const split: Plan["blocks"] = [
    { id: "b-1", kind: "work", start: "2026-10-03T17:00:00.000Z", end: "2026-10-03T18:00:00.000Z", label: "Draft", taskId: "t-mgp" },
    { id: "b-2", kind: "work", start: "2026-10-03T18:15:00.000Z", end: "2026-10-03T18:45:00.000Z", label: "Draft", taskId: "t-mgp" },
  ];
  const { client, requests } = scripted([
    [GET_PLAN],
    [use("1", "resize_block", { blockId: "b-1", endTime: "14:30" })],
    [use("2", "resize_block", { blockId: "b-1", durationMinutes: 120 })],
    [say("Staged.")],
  ]);
  const d = deps(client);
  seedBlocks(d, split);
  await chatAgent(d, input("give the draft two hours"));
  assert.match(resultsOf(requests, 2)[0]!.content, /split across several blocks/);
  assert.deepEqual(openChangeSet(d)?.items, [{ kind: "resize-block", taskId: "t-mgp", label: "Draft", durationMinutes: 120 }]);
});

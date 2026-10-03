import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryStore, listOpenInteractionRequests, putPlan } from "../src/adapters/memory-store.ts";
import { chatAgent, CHAT_AGENT_STEP_CAP_REPLY, type ChatAgentDeps } from "../src/app/chat-agent.ts";
import { CHAT_AGENT_MAX_STEPS } from "../src/core/chat-tools.ts";
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
  seedPlan(d);
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

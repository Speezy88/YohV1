/**
 * Tests for Epic 10 (10.3, R8) Routines: parser, store, app, chat routing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { getRoutine, initRoutineStoreSchema, listRoutines, upsertRoutine } from "../src/adapters/routine-store.ts";
import { manageRoutine } from "../src/app/routines.ts";
import { chatTurn, type ChatTurnDeps } from "../src/app/chat-turn.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { isPlanEditRequest } from "../src/core/chat-commands.ts";
import { parseRoutineCommand, type RoutineCommand } from "../src/core/routine-commands.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

test("parser: add lines", () => {
  assert.deepEqual(parseRoutineCommand("my commute is 3:00–3:30 on weekdays"), {
    kind: "add", label: "commute", days: WEEKDAYS, startMinutes: 15 * 60, durationMinutes: 30,
  });
  const lunch = parseRoutineCommand("lunch is 12 to 12:30 every day") as Extract<RoutineCommand, { kind: "add" }>;
  assert.equal(lunch.startMinutes, 12 * 60);
  assert.equal(lunch.durationMinutes, 30);
  assert.equal(lunch.days.length, 7);
  const gym = parseRoutineCommand("my gym time is 9-10am on mondays and wednesdays") as Extract<RoutineCommand, { kind: "add" }>;
  assert.equal(gym.label, "gym time");
  assert.equal(gym.startMinutes, 9 * 60);
  assert.deepEqual(gym.days, ["mon", "wed"]);
  const wk = parseRoutineCommand("my brunch is 10 to 11 on weekends") as Extract<RoutineCommand, { kind: "add" }>;
  assert.equal(wk.startMinutes, 10 * 60);
  assert.deepEqual(wk.days, ["sat", "sun"]);
  const daily = parseRoutineCommand("my walk is 8:00-8:30 daily") as Extract<RoutineCommand, { kind: "add" }>;
  assert.equal(daily.startMinutes, 8 * 60);
});

test("parser: bare-time rule (1-7 PM, 8-11 AM, 12 noon)", () => {
  const at = (line: string) => (parseRoutineCommand(line) as Extract<RoutineCommand, { kind: "add" }>).startMinutes;
  assert.equal(at("dinner is 6 to 7"), 18 * 60);
  assert.equal(at("class is 11 to 12"), 11 * 60);
  assert.equal(at("class is 8 to 9"), 8 * 60);
});

test("parser: change, remove, list", () => {
  assert.deepEqual(parseRoutineCommand("change my commute to 3:15"), { kind: "change", label: "commute", startMinutes: 15 * 60 + 15, explicit: false });
  assert.deepEqual(parseRoutineCommand("change my commute routine to weekends"), { kind: "change", label: "commute", days: ["sat", "sun"], explicit: true });
  assert.deepEqual(parseRoutineCommand("remove my commute routine"), { kind: "remove", label: "commute" });
  assert.deepEqual(parseRoutineCommand("what are my routines"), { kind: "list" });
  assert.deepEqual(parseRoutineCommand("What are my routines?"), { kind: "list" });
  assert.deepEqual(parseRoutineCommand("list my routines"), { kind: "list" });
});

test("parser: negatives (plan edits, task captures, calendar, other)", () => {
  for (const line of [
    "change my plan to focus on writing",
    "swap the essay for the reading",
    "work on math instead of history",
    "finish the report by 3",
    "add a task to email Sam",
    "remove the task email Sam",
    "delete my report",
    "the meeting is at 3 to 4",
    "my meeting is 3 to 4 tomorrow",
    "I'm behind",
    "what's my plan",
    "plan my day",
    "/routines",
    "budget is 3 to 4",
  ]) {
    assert.equal(parseRoutineCommand(line), undefined, line);
  }
  assert.equal(isPlanEditRequest("my commute is 3:00–3:30 on weekdays"), false);
});

test("store: idempotent init, upsert, list order", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initRoutineStoreSchema(connection.db);
  initRoutineStoreSchema(connection.db);
  upsertRoutine(connection, { id: "routine-b", label: "b", days: ["mon"], startMinutes: 600, durationMinutes: 30 });
  upsertRoutine(connection, { id: "routine-a", label: "a", days: WEEKDAYS as never, startMinutes: 540, durationMinutes: 15 });
  upsertRoutine(connection, { id: "routine-b", label: "b", days: ["tue"], startMinutes: 605, durationMinutes: 30 });
  assert.deepEqual(listRoutines(connection).map((r) => r.id), ["routine-a", "routine-b"]);
  assert.deepEqual(getRoutine(connection, "routine-b"), { id: "routine-b", label: "b", days: ["tue"], startMinutes: 605, durationMinutes: 30 });
});

function freshConnection() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initRoutineStoreSchema(connection.db);
  return connection;
}

async function say(connection: ReturnType<typeof freshConnection>, line: string): Promise<{ handled: boolean; reply: string }> {
  const cmd = parseRoutineCommand(line);
  assert.ok(cmd, line);
  const result = await manageRoutine({ connection }, cmd);
  assert.ok(result.ok);
  return result.value;
}

test("app: add, change, list, remove", async () => {
  const connection = freshConnection();
  assert.equal((await say(connection, "my commute is 3:00–3:30 on weekdays")).reply, "Added your commute: weekdays, 3:00–3:30 PM.");
  assert.equal((await say(connection, "change my commute to 3:15")).reply, "Updated your commute: weekdays, 3:15–3:45 PM.");
  assert.equal((await say(connection, "lunch is 11:30 to 12:30 every day")).reply, "Added your lunch: every day, 11:30 AM–12:30 PM.");
  assert.equal((await say(connection, "what are my routines")).reply, "Your routines:\n- lunch: every day, 11:30 AM–12:30 PM\n- commute: weekdays, 3:15–3:45 PM");
  assert.equal((await say(connection, "remove my commute routine")).reply, "Removed your commute routine.");
  assert.equal((await say(connection, "remove my commute routine")).reply, "I don't have a routine called commute.");
  assert.equal(listRoutines(connection).length, 1);
});

test("app: change of an unknown label without the word routine is not handled", async () => {
  const connection = freshConnection();
  assert.equal((await say(connection, "change my dentist to 3:15")).handled, false);
  assert.equal((await say(connection, "what are my routines")).reply.startsWith("You haven't set any routines"), true);
});

test("chat: routine lines route before plan-edit and LLM steps", async () => {
  const connection = freshConnection();
  initNotificationStoreSchema(connection.db);
  const llmClient = { messages: { create: async () => { throw new Error("LLM must not be called"); } } } as unknown as AnthropicMessagesClient;
  const deps = {
    store: createMemoryStore(connection),
    connection,
    timeZone: "UTC",
    now: () => new Date("2026-08-22T18:00:00.000Z"),
    readTasks: async () => { throw new Error("readTasks must not be called"); },
    llmClient,
    session: { recentMessages: [], lastSearchAnswer: undefined },
    getCompletedTaskIdsToday: () => new Set(),
  } as unknown as ChatTurnDeps;
  const added = await chatTurn(deps, { message: "my commute is 3:00–3:30 on weekdays" });
  assert.ok(added.ok);
  assert.equal(added.value.reply, "Added your commute: weekdays, 3:00–3:30 PM.");
  const listed = await chatTurn(deps, { message: "what are my routines" });
  assert.ok(listed.ok);
  assert.match(listed.value.reply, /commute: weekdays, 3:00–3:30 PM/);
  const removed = await chatTurn(deps, { message: "remove my commute routine" });
  assert.ok(removed.ok);
  assert.equal(listRoutines(connection).length, 0);
});

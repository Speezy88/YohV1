import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_TOOLS,
  changeSetPrompt,
  claimsAWrite,
  NOTHING_CHANGED_NOTE,
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

test("claimsAWrite catches claims that something was changed", () => {
  for (const text of [
    "Done. Both events are now on your calendar.",
    "Done! Both events are on your calendar.",
    "All set",
    "All set - you're good.",
    "I've added the workout to your calendar.",
    "I moved your dentist visit to 3 PM.",
    "I have deleted the dinner event.",
    "Your task has been marked complete.",
    "The tasks have been updated.",
    "Both are now in your plan.",
    "The event is now on your calendar.",
  ]) {
    assert.equal(claimsAWrite(text), true, text);
  }
});

test("claimsAWrite lets honest answers through", () => {
  for (const text of [
    "You have 105 minutes due Monday across 3 tasks.",
    "I couldn't find that task.",
    "Napoleon was a French general.",
    "I've staged the workout for your approval.",
    "Dinner is on your calendar at 6:00 PM.",
    "Undone items remain.",
  ]) {
    assert.equal(claimsAWrite(text), false, text);
  }
  assert.equal(NOTHING_CHANGED_NOTE, "Nothing has been changed.");
});

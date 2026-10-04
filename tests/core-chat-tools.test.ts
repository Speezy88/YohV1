import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatDateContext,
  CHAT_TOOLS,
  changeSetPrompt,
  CHANGE_SET_PARTIAL_NOTE,
  CHANGE_SET_REPLACES_NOTE,
  CHANGE_SET_USE_CARD_REPLY,
  claimsAWrite,
  claimsStaging,
  NOTHING_CHANGED_NOTE,
  describeChangeSetItem,
  filterTasks,
  isWriteTool,
  orderForApply,
  planBlockEdits,
  resolveEventTimes,
  resolveLocalTime,
  summarizeTasks,
} from "../src/core/chat-tools.ts";
import type { ChangeSetItem, PlanBlock, Task } from "../src/types/domain.ts";

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

test("changeSetPrompt closes with the replacement and partial notes when asked, replacement last", () => {
  const items: ChangeSetItem[] = [{ kind: "plan-day" }];
  const both = changeSetPrompt(items, TZ, { replacesEarlier: true, someRejected: true }).split("\n");
  assert.equal(both.at(-1), CHANGE_SET_REPLACES_NOTE);
  assert.equal(both.at(-2), CHANGE_SET_PARTIAL_NOTE);
  assert.equal(changeSetPrompt(items, TZ, { someRejected: true }).split("\n").at(-1), CHANGE_SET_PARTIAL_NOTE);
  assert.equal(CHANGE_SET_USE_CARD_REPLY, "Use Approve or Discard on the card above.");
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
    ["list_tasks", "list_events", "get_plan", "search_memory", "web_search", "create_event", "move_event", "resize_event", "delete_event", "create_task", "update_task", "complete_task", "move_block", "resize_block", "remove_block", "plan_day", "refit_plan"],
  );
  assert.equal(isWriteTool("move_block") && isWriteTool("resize_block") && isWriteTool("remove_block"), true);
});

test("describeChangeSetItem names a block edit as a change to today's Plan", () => {
  assert.equal(describeChangeSetItem({ kind: "move-block", subject: { kind: "task", taskId: "t" }, label: "Draft", newStart: "2026-10-03T19:00:00.000Z" }, TZ), 'Move "Draft" to 3:00 PM in today\'s Plan');
  assert.equal(describeChangeSetItem({ kind: "resize-block", taskId: "t", label: "Draft", durationMinutes: 90 }, TZ), 'Give "Draft" 90 min in today\'s Plan');
  assert.equal(describeChangeSetItem({ kind: "remove-block", taskId: "t", label: "Draft" }, TZ), 'Drop "Draft" from today\'s Plan');
});

test("orderForApply puts block edits after other writes and before a whole-Plan step", () => {
  const items: ChangeSetItem[] = [
    { kind: "refit-plan" },
    { kind: "remove-block", taskId: "t", label: "A" },
    { kind: "complete-task", taskId: "t2", label: "B" },
    { kind: "resize-block", taskId: "t3", label: "C", durationMinutes: 30 },
  ];
  assert.deepEqual(orderForApply(items).map((i) => i.kind), ["complete-task", "remove-block", "resize-block", "refit-plan"]);
});

test("planBlockEdits: a Task block still to come can be moved, resized and removed; a Routine only moved; the rest nothing", () => {
  const nowMs = Date.parse("2026-10-03T16:00:00.000Z");
  const block = (kind: PlanBlock["kind"], start: string, extra: Partial<PlanBlock> = {}): PlanBlock => ({ id: "b", kind, start, end: start, label: "x", ...extra });
  const none = { canMove: false, canResize: false, canRemove: false };
  assert.deepEqual(planBlockEdits(block("work", "2026-10-03T17:00:00.000Z", { taskId: "t" }), nowMs), { canMove: true, canResize: true, canRemove: true });
  assert.deepEqual(planBlockEdits(block("routine", "2026-10-03T17:00:00.000Z", { routineId: "r" }), nowMs), { canMove: true, canResize: false, canRemove: false });
  assert.deepEqual(planBlockEdits(block("work", "2026-10-03T15:00:00.000Z", { taskId: "t" }), nowMs), none);
  assert.deepEqual(planBlockEdits(block("break", "2026-10-03T17:00:00.000Z"), nowMs), none);
  assert.deepEqual(planBlockEdits(block("calendar-anchor", "2026-10-03T17:00:00.000Z"), nowMs), none);
});

test("resolveLocalTime converts a local clock time on a date and rejects malformed input", () => {
  assert.equal(resolveLocalTime("2026-10-03", "15:00", TZ), "2026-10-03T19:00:00.000Z");
  assert.equal(resolveLocalTime("2026-10-03", "3pm", TZ), undefined);
  assert.equal(resolveLocalTime("Oct 3", "15:00", TZ), undefined);
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
    "Added the workout to your calendar.",
    "Sure. Moved your dentist visit to 3 PM.",
    "You're all set.",
    "The event was created.",
    "Both tasks were updated.",
    "I've gone ahead and put it on your calendar.",
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
    "Do you want me to add the workout?",
    "I can't delete that event.",
    "Napoleon was born in Corsica.",
    "Was the event created by you?",
  ]) {
    assert.equal(claimsAWrite(text), false, text);
  }
  assert.equal(NOTHING_CHANGED_NOTE, "Nothing has been changed.");
});

test("claimsStaging catches prose that says a change is staged or asks for a typed confirm", () => {
  for (const text of [
    "Staging both for deletion:\n\n**Northwestern Supplements** (180 min, due Tue)\n\nConfirm and I'll remove them?",
    "Staging Golf on your calendar for tomorrow (Sunday, Oct 4):\n\n**Golf**\n9:00 AM - 12:00 PM\n\nConfirm?",
    "You're right. I staged it, but nothing's written yet. You need to approve it in the staging area.",
    "Sound right? I'll add them to your Google Calendar once you confirm.",
    "I've staged the workout for your approval.",
  ]) {
    assert.equal(claimsStaging(text), true, text);
  }
});

test("claimsStaging lets honest answers through", () => {
  for (const text of [
    "You have 105 minutes due Monday across 3 tasks.",
    "I can't delete a Task from here.",
    "Nothing is staged.",
    "Do you want me to add the workout?",
    "Can you confirm which task you mean?",
  ]) {
    assert.equal(claimsStaging(text), false, text);
  }
});

test("chatDateContext names today, the time, tomorrow and the week ahead in the host time zone", () => {
  // 01:48 UTC on Oct 4 is still Saturday Oct 3, 6:48 PM in Los Angeles.
  const text = chatDateContext(new Date("2026-10-04T01:48:00.000Z"), "America/Los_Angeles");
  assert.match(text, /Today is Saturday, October 3, 2026 \(2026-10-03\)/);
  assert.match(text, /The local time is 6:48 PM, time zone America\/Los_Angeles/);
  assert.match(text, /Tomorrow is Sunday, October 4 \(2026-10-04\)/);
  assert.match(text, /Monday 2026-10-05, Tuesday 2026-10-06, Wednesday 2026-10-07, Thursday 2026-10-08, Friday 2026-10-09, Saturday 2026-10-10/);
});

test("chatDateContext steps whole calendar days across a daylight-saving change", () => {
  // Sunday Nov 1 2026 is the 25-hour day in Los Angeles; 11:30 PM Saturday must still give Sunday as tomorrow.
  const text = chatDateContext(new Date("2026-11-01T06:30:00.000Z"), "America/Los_Angeles");
  assert.match(text, /Today is Saturday, October 31, 2026 \(2026-10-31\)/);
  assert.match(text, /Tomorrow is Sunday, November 1 \(2026-11-01\)/);
  assert.match(text, /Monday 2026-11-02/);
});

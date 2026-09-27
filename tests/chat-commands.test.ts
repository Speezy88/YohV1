/**
 * Tests for `src/core/chat-commands.ts` (Story 8.3).
 *
 * Moved verbatim from `tests/chat-cli.test.ts` — only the import path
 * changes (AD-16 "moved, not copied").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isBlockerReportCommand,
  isCalendarDeleteRequestCommand,
  isCalendarEditCommand,
  isMidDayReflowCommand,
  isPlanDayCommand,
  isPlanViewCommand,
  isSaveSearchResultCommand,
  parseCreateItemCommand,
  parseTimeBudgetCommand,
  parseWhyPrioritizedCommand,
} from "../src/core/chat-commands.ts";

// ============================================================================
// parseTimeBudgetCommand
// ============================================================================

test("parseTimeBudgetCommand recognizes '<N>h' shorthand", () => {
  const result = parseTimeBudgetCommand("time budget 6h");
  assert.deepEqual(result, { totalMinutes: 360 });
});

test("parseTimeBudgetCommand recognizes 'set time budget to <N> hours'", () => {
  const result = parseTimeBudgetCommand("set time budget to 6 hours");
  assert.deepEqual(result, { totalMinutes: 360 });
});

test("parseTimeBudgetCommand recognizes minutes ('<N>m', '<N> minutes')", () => {
  assert.deepEqual(parseTimeBudgetCommand("time budget 90m"), { totalMinutes: 90 });
  assert.deepEqual(parseTimeBudgetCommand("change time budget to 90 minutes"), { totalMinutes: 90 });
});

test("parseTimeBudgetCommand treats a bare number with no unit as hours (documented default)", () => {
  const result = parseTimeBudgetCommand("time budget 5");
  assert.deepEqual(result, { totalMinutes: 300 });
});

test("parseTimeBudgetCommand is case-insensitive and tolerates extra whitespace", () => {
  const result = parseTimeBudgetCommand("  SET Time   Budget TO 2 HOURS  ");
  assert.deepEqual(result, { totalMinutes: 120 });
});

test("parseTimeBudgetCommand accepts a fractional hour amount", () => {
  const result = parseTimeBudgetCommand("time budget 1.5h");
  assert.deepEqual(result, { totalMinutes: 90 });
});

test("parseTimeBudgetCommand rejects a fractional amount that doesn't land on a whole minute", () => {
  assert.equal(parseTimeBudgetCommand("time budget 0.5m"), undefined);
});

test("parseTimeBudgetCommand returns undefined for unrelated free text (falls through to the placeholder)", () => {
  assert.equal(parseTimeBudgetCommand("show me today's plan"), undefined);
  assert.equal(parseTimeBudgetCommand("hello"), undefined);
  assert.equal(parseTimeBudgetCommand(""), undefined);
});

test("parseTimeBudgetCommand returns undefined for a zero or negative amount", () => {
  assert.equal(parseTimeBudgetCommand("time budget 0h"), undefined);
  assert.equal(parseTimeBudgetCommand("time budget -3h"), undefined);
});

// ============================================================================
// isPlanViewCommand
// ============================================================================

test("isPlanViewCommand recognizes a few plan-view phrasings, case-insensitively", () => {
  for (const line of [
    "plan",
    "Plan",
    "what's my plan",
    "what is my plan",
    "show plan",
    "show my plan",
    "show me today's plan",
    "SHOW MY PLAN",
  ]) {
    assert.equal(isPlanViewCommand(line), true, `expected "${line}" to be recognized as a Plan-view request`);
  }
});

test("isPlanViewCommand returns false for unrelated input, including other recognized commands", () => {
  for (const line of ["hello", "time budget 6h", "what's the weather", ""]) {
    assert.equal(isPlanViewCommand(line), false, `expected "${line}" NOT to be recognized as a Plan-view request`);
  }
});

// ============================================================================
// isPlanDayCommand (Task 1, real-use fixes plan / "plan my day on demand")
// ============================================================================

test("isPlanDayCommand recognizes the four documented on-demand-generation phrasings, case-insensitively", () => {
  for (const line of ["plan my day", "make my plan", "generate today's plan", "generate todays plan", "plan today", "Plan My Day", "PLAN TODAY"]) {
    assert.equal(isPlanDayCommand(line), true, `expected "${line}" to be recognized as a Plan-day (generate) request`);
  }
});

test("isPlanDayCommand returns false for a Plan-VIEW request — generating and viewing are different commands", () => {
  for (const line of ["plan", "what's my plan", "show my plan", "show me today's plan"]) {
    assert.equal(isPlanDayCommand(line), false, `expected "${line}" NOT to be recognized as a Plan-day (generate) request`);
  }
});

test("isPlanDayCommand returns false for unrelated input, including other recognized commands", () => {
  for (const line of ["hello", "time budget 6h", "what's the weather", ""]) {
    assert.equal(isPlanDayCommand(line), false, `expected "${line}" NOT to be recognized as a Plan-day (generate) request`);
  }
});

test("isPlanViewCommand returns false for a Plan-DAY (generate) request — the two commands never overlap", () => {
  for (const line of ["plan my day", "make my plan", "generate today's plan", "plan today"]) {
    assert.equal(isPlanViewCommand(line), false, `expected "${line}" NOT to be recognized as a Plan-view request`);
  }
});

// ============================================================================
// isMidDayReflowCommand
// ============================================================================

test("isMidDayReflowCommand recognizes the documented trigger phrasings, case-insensitively", () => {
  for (const line of [
    "reflow",
    "re-flow",
    "REFLOW",
    "refit",
    "reflow my day",
    "re-flow my plan",
    "refit my day",
    "refit plan",
    "redo my plan",
    "redo my day",
    "redo plan",
    "please reflow my day",
    "reflow?",
  ]) {
    assert.equal(isMidDayReflowCommand(line), true, `expected "${line}" to be recognized as a Mid-Day Re-Flow trigger`);
  }
});

test("isMidDayReflowCommand returns false for unrelated input, including other recognized commands and a bare 'redo'", () => {
  for (const line of ["hello", "time budget 6h", "show plan", "what's my plan", "redo", ""]) {
    assert.equal(isMidDayReflowCommand(line), false, `expected "${line}" NOT to be recognized as a Mid-Day Re-Flow trigger`);
  }
});

// ============================================================================
// isBlockerReportCommand
// ============================================================================

test("isBlockerReportCommand recognizes documented starting keyword/phrase heuristics, case-insensitively", () => {
  for (const line of [
    "meeting ran over",
    "the meeting ran over",
    "the call ran over",
    "running late",
    "I'm running late",
    "I ran late",
    "something came up",
    "stuck in traffic",
    "I'm stuck in traffic",
    "call went long",
    "the call went long",
    "the meeting ran long",
    "got held up",
    "held up",
    "got stuck",
    "got interrupted",
    "MEETING RAN OVER",
  ]) {
    assert.equal(isBlockerReportCommand(line), true, `expected "${line}" to be recognized as a Blocker report`);
  }
});

test(
  "isBlockerReportCommand returns false for unrelated input, including other recognized commands and (post-review fix) plausible unrelated " +
    "sentences that merely CONTAIN a formerly-bare-word trigger",
  () => {
    for (const line of [
      "hello",
      "time budget 6h",
      "show plan",
      "reflow my day",
      "what's the weather",
      "",
      "what's traffic like on I-95 right now",
      "how's traffic looking this morning",
      "my package got delayed",
      "the flight was delayed by two hours",
      "the meeting went great",
      "the call went really well",
    ]) {
      assert.equal(isBlockerReportCommand(line), false, `expected "${line}" NOT to be recognized as a Blocker report`);
    }
  },
);

// ============================================================================
// parseWhyPrioritizedCommand
// ============================================================================

test("parseWhyPrioritizedCommand recognizes 'why is X prioritized [today]' phrasings, case-insensitively, and extracts the Task name", () => {
  assert.equal(parseWhyPrioritizedCommand("why is Draft the memo prioritized"), "Draft the memo");
  assert.equal(parseWhyPrioritizedCommand("why is Draft the memo prioritized today"), "Draft the memo");
  assert.equal(parseWhyPrioritizedCommand("Why Is Draft The Memo Prioritized Today?"), "Draft The Memo");
  assert.equal(parseWhyPrioritizedCommand("  why is Draft the memo prioritized today  "), "Draft the memo");
});

test("parseWhyPrioritizedCommand returns undefined for unrelated input, including other recognized commands", () => {
  for (const line of ["hello", "time budget 6h", "show plan", "reflow", "meeting ran over", "why is the sky blue", ""]) {
    assert.equal(
      parseWhyPrioritizedCommand(line),
      undefined,
      `expected "${line}" NOT to be recognized as a why-prioritized request`,
    );
  }
});

// ============================================================================
// parseCreateItemCommand (Story 8.4)
// ============================================================================

test("parseCreateItemCommand recognizes 'create a task ...' and targets Tasks", () => {
  const result = parseCreateItemCommand("create a task to buy hiking boots");
  assert.deepEqual(result, { database: "Tasks", request: "to buy hiking boots" });
});

test("parseCreateItemCommand recognizes 'add a project ...' and targets Projects", () => {
  assert.equal(parseCreateItemCommand("add a project called Kitchen Remodel")?.database, "Projects");
});

test("parseCreateItemCommand recognizes a research vault request and targets ResearchVault", () => {
  assert.equal(parseCreateItemCommand("create a research vault entry about hiking boots")?.database, "ResearchVault");
});

test("parseCreateItemCommand returns undefined for an unrelated database name — no fourth target is ever produced", () => {
  assert.equal(parseCreateItemCommand("create a shopping list"), undefined);
});

test("parseCreateItemCommand returns undefined for ordinary conversational input", () => {
  assert.equal(parseCreateItemCommand("what's my plan today"), undefined);
});

test("parseCreateItemCommand recognizes a Notion-mention request that isn't phrased as 'create a ...'", () => {
  assert.deepEqual(parseCreateItemCommand("can we input the high priority data to the notion tasks db"), {
    database: "Tasks",
    request: "can we input the high priority data to the notion tasks db",
  });
});

test("parseCreateItemCommand recognizes 'put this in the notion research vault'", () => {
  assert.equal(parseCreateItemCommand("put this in the notion research vault")?.database, "ResearchVault");
});

test("parseCreateItemCommand's Notion-mention branch requires a write verb, not just a question about Notion", () => {
  assert.equal(parseCreateItemCommand("what's in the notion tasks db"), undefined);
});

test("parseCreateItemCommand's Notion-mention branch requires 'notion' and the database word in the same clause", () => {
  assert.equal(parseCreateItemCommand("add milk to the list. also check notion tasks later"), undefined);
});

// ============================================================================
// isSaveSearchResultCommand (Story 8.4)
// ============================================================================

test("isSaveSearchResultCommand recognizes 'save that'/'save this'/'file that' phrasings, case-insensitively", () => {
  for (const line of ["save that", "Save This", "file that", "save that to the vault", "file this to the research vault"]) {
    assert.equal(isSaveSearchResultCommand(line), true, `expected "${line}" to be recognized`);
  }
});

test("isSaveSearchResultCommand returns false for unrelated input", () => {
  for (const line of ["what's my plan", "create a task to buy boots", "save my progress"]) {
    assert.equal(isSaveSearchResultCommand(line), false, `expected "${line}" NOT to be recognized`);
  }
});

// ============================================================================
// isCalendarEditCommand (Story 8.4)
// ============================================================================

test("isCalendarEditCommand recognizes move/reschedule/resize/extend/schedule/block-off phrasings", () => {
  for (const line of [
    "move team sync to 6pm",
    "reschedule standup",
    "resize the meeting",
    "extend focus block",
    "schedule a call with Jane",
    "block off an hour for gym",
    "create a time block for reading",
  ]) {
    assert.equal(isCalendarEditCommand(line), true, `expected "${line}" to be recognized`);
  }
});

test("isCalendarEditCommand returns false for unrelated input — including a delete request, which has no trigger at all", () => {
  for (const line of ["what's my plan", "create a task to buy boots", "search for the weather", "delete my team sync", "remove the 3pm meeting"]) {
    assert.equal(isCalendarEditCommand(line), false, `expected "${line}" NOT to be recognized`);
  }
});

// ============================================================================
// isCalendarEditCommand broadening (real-use fixes plan, Task 2) — the
// incident line ("make a event at 10:45 am tommorow to meet with alex...")
// and its sibling phrasings must all route to the calendar-edit CREATE path,
// never fall through to detectTaskCapture/classifyCapture and be mistaken
// for a Notion Task.
// ============================================================================

test("isCalendarEditCommand recognizes the broadened create-verb + event-noun and 'meet with' + time/date phrasings (Task 2)", () => {
  for (const line of [
    "make a event at 10:45 am tommorow to meet with alex. itll go for an hour and a half",
    "schedule a meeting with Alex tomorrow at 3",
    "add dentist appointment Friday 2pm",
    "put a study block at 4 today",
    "create an event for coffee with Sam tomorrow at 9am",
  ]) {
    assert.equal(isCalendarEditCommand(line), true, `expected "${line}" to be recognized`);
  }
});

test("isCalendarEditCommand's broadened create-verb/noun and 'meet with' shapes still don't swallow an unrelated Task-capture line", () => {
  for (const line of ["Lab report draft, due Thursday", "add milk to the shopping list", "let's catch up sometime"]) {
    assert.equal(isCalendarEditCommand(line), false, `expected "${line}" NOT to be recognized`);
  }
});

// ============================================================================
// Post-review fix, Important #1 (AD-13): the broadened "meet with"/"meeting
// with" + time/date shape above is verb-agnostic, so — unexcluded — it also
// matched a cancel/delete/remove request. isCalendarDeleteRequestCommand
// recognizes these, and isCalendarEditCommand excludes them.
// ============================================================================

test("isCalendarDeleteRequestCommand recognizes a cancel/delete/remove/clear request naming an event-ish noun or 'meet(ing) with'", () => {
  for (const line of [
    "delete my meeting with Alex tomorrow at 3",
    "cancel the meeting with Alex tomorrow",
    "remove my meeting with Alex at 3pm",
    "cancel my dentist appointment",
    "clear the 4pm block",
  ]) {
    assert.equal(isCalendarDeleteRequestCommand(line), true, `expected "${line}" to be recognized as a delete/cancel request`);
  }
});

test("isCalendarDeleteRequestCommand returns false for unrelated input, including an ordinary create-shaped line", () => {
  for (const line of ["schedule a meeting with Alex tomorrow at 3", "add a task to email Alex tomorrow", "remind me to call Alex", "what's my plan"]) {
    assert.equal(isCalendarDeleteRequestCommand(line), false, `expected "${line}" NOT to be recognized as a delete/cancel request`);
  }
});

test("isCalendarEditCommand excludes a cancel/delete/remove/clear request even though it names 'meet(ing) with' + a time — AD-13, no delete variant at all", () => {
  for (const line of ["delete my meeting with Alex tomorrow at 3", "cancel the meeting with Alex tomorrow", "remove my meeting with Alex at 3pm"]) {
    assert.equal(isCalendarEditCommand(line), false, `expected "${line}" NOT to be recognized by isCalendarEditCommand (AD-13)`);
  }
});

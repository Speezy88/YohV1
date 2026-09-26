/**
 * Tests for `src/rituals/morning-ritual.ts` (Story 1.10 / Task 10).
 *
 * The ritual is exercised end-to-end against a real (throwaway, `:memory:`)
 * `MemoryStore` with every I/O edge injected: `readTasks` /
 * `readCalendarEvents` stand in for the Notion/Calendar adapters (both of
 * which throw on failure per AD-8 — several tests below make them throw on
 * purpose), and `sendNotification` stands in for
 * `adapters/notification-adapter.ts`. No network, no real clock: `now` is
 * always injected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearUncheckedDay,
  createMemoryStore,
  getOpenInteractionRequest,
  getPlan,
  getRitualRun,
  getUncheckedDay,
  putOpenInteractionRequest,
  putRitualRun,
  putTimeBudget,
  putUncheckedDay,
  type MemoryStore,
} from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import {
  MORNING_RITUAL_ID,
  PLAN_GENERATION_DEGRADED_THRESHOLD_MS,
  runMorningRitual,
  TIME_BUDGET_PROPOSAL_REQUEST_ID,
  UNCHECKED_NIGHT_TEXT_MARKER,
  type MorningRitualDeps,
} from "../src/rituals/morning-ritual.ts";
import { ACCENT, ATTENTION, MUTED, RESET, renderPlan, type PlanNotification } from "../src/rituals/ritual-shared.ts";
import type { LogEntry } from "../src/adapters/logger.ts";
import { DATA_COMPLETENESS_REQUEST_ID } from "../src/rituals/data-completeness.ts";
import {
  applyNightCloseOutConfirmation,
  buildNightCloseOutPromptText,
  clearNightCloseOutRequestIfOpen,
  NIGHT_CLOSE_OUT_REQUEST_ID,
  NIGHT_ESCALATE_RITUAL_ID,
  runNightEscalateRitual,
  type NightCloseOutRequestDetail,
} from "../src/rituals/night-ritual.ts";
import { PUSHOVER_MESSAGE_LIMIT, PUSHOVER_TITLE_LIMIT } from "../src/adapters/notification-adapter.ts";
import type { CalendarEvent, Plan, PlanBlock, Proposal, Task, TimeBudget } from "../src/types/domain.ts";

// ============================================================================
// Fixtures
// ============================================================================

/** 2026-08-22 is a Saturday. Every test pins "now" to it so nothing depends on the real clock. */
const NOW_ISO = "2026-08-22T13:00:00.000Z";
const TODAY = "2026-08-22";

function tempStore(): MemoryStore {
  return createMemoryStore(openSqliteConnection({ databasePath: ":memory:" }));
}

function makeTask(id: string, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    estimatedDurationMinutes: 30,
    area: "Work",
    dueDate: TODAY,
    status: "not-started",
    energy: "medium",
    ...overrides,
  };
}

interface Harness {
  readonly store: MemoryStore;
  readonly notifications: PlanNotification[];
  readonly deps: MorningRitualDeps;
}

function harness(options: {
  tasks?: readonly Task[];
  events?: readonly CalendarEvent[];
  readTasks?: () => Promise<readonly Task[]>;
  readCalendarEvents?: () => Promise<readonly CalendarEvent[]>;
  sendNotification?: (n: PlanNotification) => Promise<void>;
  bumpLevels?: Readonly<Record<string, number>>;
  declareBudgetMinutes?: number | undefined;
  timeZone?: string;
  store?: MemoryStore;
}): Harness {
  const store = options.store ?? tempStore();
  const notifications: PlanNotification[] = [];

  const budgetMinutes = options.declareBudgetMinutes === undefined ? 240 : options.declareBudgetMinutes;
  if (budgetMinutes > 0) {
    putTimeBudget(store, { date: TODAY, totalMinutes: budgetMinutes, workMinutes: 70, breakMinutes: 15 });
  }

  const deps: MorningRitualDeps = {
    store,
    readTasks: options.readTasks ?? (async () => options.tasks ?? []),
    readCalendarEvents: options.readCalendarEvents ?? (async () => options.events ?? []),
    sendNotification:
      options.sendNotification ??
      (async (n) => {
        notifications.push(n);
      }),
    now: () => new Date(NOW_ISO),
    timeZone: options.timeZone ?? "UTC",
    color: false,
    ...(options.bumpLevels ? { bumpLevels: options.bumpLevels } : {}),
  };

  return { store, notifications, deps };
}

function block(over: Partial<PlanBlock> & Pick<PlanBlock, "id" | "kind" | "start" | "end" | "label">): PlanBlock {
  return over;
}

function samplePlan(): Plan {
  return {
    id: `plan-${TODAY}`,
    date: TODAY,
    blocks: [
      block({ id: "work-1", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: "Draft the memo", taskId: "t1" }),
      block({ id: "calendar-anchor-0", kind: "calendar-anchor", start: "2026-08-22T14:00:00.000Z", end: "2026-08-22T14:30:00.000Z", label: "Standup" }),
      block({ id: "break-2", kind: "break", start: "2026-08-22T14:30:00.000Z", end: "2026-08-22T14:45:00.000Z", label: "Break" }),
    ],
    reasoning: '"Draft the memo" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

// ============================================================================
// renderPlan — DESIGN.md layout/color rules (UX-DR1..DR4, DR7, DR8, DR20)
// ============================================================================

test("renderPlan: header, blank line, one line per block in Plan order, blank line, reasoning (UX-DR2)", () => {
  const rendered = renderPlan(samplePlan(), { timeZone: "UTC", color: false });
  const lines = rendered.split("\n");

  assert.equal(lines[0], "Today's Plan for Saturday, August 22");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "13:00-14:00  Draft the memo");
  assert.equal(lines[3], "14:00-14:30  Standup (fixed)");
  assert.equal(lines[4], "14:30-14:45  Break");
  assert.equal(lines[5], "");
  assert.equal(lines[6], '"Draft the memo" leads today\'s Plan — due soonest.');
  assert.equal(lines.length, 7, "exactly one blank line separates each structural unit — no extra padding");
});

test("renderPlan: a fixed Calendar event reads as an immovable anchor in plain text, not just by kind", () => {
  const rendered = renderPlan(samplePlan(), { timeZone: "UTC", color: false });
  assert.match(rendered, /14:00-14:30 {2}Standup \(fixed\)/);
  // Work/break blocks carry no such marker — the word is reserved for anchors.
  assert.doesNotMatch(rendered, /Draft the memo \(fixed\)/);
  assert.doesNotMatch(rendered, /Break \(fixed\)/);
});

test("renderPlan: no emoji, ASCII art, box-drawing characters, or dividers (UX-DR7, UX-DR8)", () => {
  const rendered = renderPlan(samplePlan(), { timeZone: "UTC", color: false });
  assert.doesNotMatch(rendered, /[─-╿]/, "no box-drawing characters");
  assert.doesNotMatch(rendered, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "no emoji");
  assert.doesNotMatch(rendered, /^\s*([-=*_|~+])\1{2,}\s*$/m, "no ASCII divider rules");
});

test("renderPlan: body wraps at ~80 characters with a hanging indent under the item column (UX-DR2)", () => {
  const long = "Write the extremely long and unusually detailed quarterly planning memorandum for the leadership team";
  const plan: Plan = {
    ...samplePlan(),
    blocks: [
      block({ id: "work-0", kind: "work", start: "2026-08-22T13:00:00.000Z", end: "2026-08-22T14:00:00.000Z", label: long, taskId: "t1" }),
    ],
  };
  const rendered = renderPlan(plan, { timeZone: "UTC", color: false });
  for (const line of rendered.split("\n")) {
    assert.ok(line.length <= 80, `line exceeds 80 columns: ${JSON.stringify(line)}`);
  }
  const bodyLines = rendered.split("\n").slice(2).filter((l) => l.length > 0 && !l.startsWith('"'));
  assert.ok(bodyLines.length > 1, "a long label wraps onto a continuation line");
  assert.match(bodyLines[1]!, /^ {13}\S/, "continuation lines hang under the item column");
});

test("renderPlan: color:true accents only the Plan label and mutes only the reasoning line (UX-DR1)", () => {
  const rendered = renderPlan(samplePlan(), { timeZone: "UTC", color: true });
  const lines = rendered.split("\n");

  assert.equal(lines[0], `${ACCENT}Today's Plan for Saturday, August 22${RESET}`);
  assert.equal(lines[2], "13:00-14:00  Draft the memo", "block lines use the terminal's default body color");
  assert.ok(lines[6]!.startsWith(MUTED) && lines[6]!.endsWith(RESET), "the reasoning line is muted");
  assert.equal((rendered.match(/\x1b\[/g) ?? []).length, 4, "only two colored spans in the whole render");
});

test("renderPlan: color:false degrades to plain text carrying the same meaning (UX-DR20)", () => {
  const rendered = renderPlan(samplePlan(), { timeZone: "UTC", color: false });
  assert.doesNotMatch(rendered, /\x1b\[/, "no ANSI escapes at all");
  assert.match(rendered, /Today's Plan/, "the label is still identifiable as the Plan without color");
  assert.match(rendered, /\(fixed\)/, "the anchor cue survives without color");
});

test("renderPlan: times render in the given timezone, not UTC (Consistency Conventions)", () => {
  const rendered = renderPlan(samplePlan(), { timeZone: "America/New_York", color: false });
  assert.match(rendered, /09:00-10:00 {2}Draft the memo/);
  assert.match(rendered, /10:00-10:30 {2}Standup \(fixed\)/);
});

test("renderPlan: includeHeader:false drops the header (what the notification body uses)", () => {
  const rendered = renderPlan(samplePlan(), { timeZone: "UTC", color: false, includeHeader: false });
  assert.doesNotMatch(rendered, /Today's Plan for/);
  assert.equal(rendered.split("\n")[0], "13:00-14:00  Draft the memo");
});

test("renderPlan: an empty Plan says so in plain words rather than rendering an empty region", () => {
  const rendered = renderPlan({ ...samplePlan(), blocks: [], reasoning: "No Tasks are scheduled in today's Plan yet." }, {
    timeZone: "UTC",
    color: false,
  });
  assert.match(rendered, /Nothing is scheduled/);
});

// ============================================================================
// runMorningRitual — orchestration
// ============================================================================

test("happy path: sends exactly one notification containing the ordered Plan and its reasoning line", async () => {
  const h = harness({
    tasks: [
      makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60, dueDate: "2026-08-22" }),
      makeTask("t2", "Book the flights", { estimatedDurationMinutes: 30, dueDate: "2026-08-25" }),
    ],
    events: [{ id: "e1", title: "Standup", start: "2026-08-22T15:00:00.000Z", end: "2026-08-22T15:30:00.000Z" }],
  });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "delivered");

  assert.equal(h.notifications.length, 1, "exactly one Pushover notification");
  const sent = h.notifications[0]!;
  assert.match(sent.title, /Today's Plan/);
  assert.match(sent.message, /Draft the memo/);
  assert.match(sent.message, /Standup \(fixed\)/);
  assert.ok(result.value.status === "delivered");
  assert.ok(sent.message.includes(result.value.plan.reasoning), "the notification body carries the reasoning line");
  assert.doesNotMatch(sent.message, /\x1b\[/, "a push notification never carries ANSI escapes");
});

test("fixed Calendar events land in the Plan as calendar-anchor blocks with their times reproduced verbatim", async () => {
  const h = harness({
    tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })],
    events: [{ id: "e1", title: "Standup", start: "2026-08-22T15:00:00.000Z", end: "2026-08-22T15:30:00.000Z" }],
  });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");
  const anchors = result.value.plan.blocks.filter((b) => b.kind === "calendar-anchor");
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0]!.start, "2026-08-22T15:00:00.000Z");
  assert.equal(anchors[0]!.end, "2026-08-22T15:30:00.000Z");
  assert.equal(anchors[0]!.taskId, undefined, "an anchor is never attributed to a Task Yoh could reschedule");
});

test("idempotent: a second same-day trigger sends no second notification and re-generates no Plan", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });

  const first = await runMorningRitual(h.deps);
  assert.ok(first.ok && first.value.status === "delivered");
  assert.equal(h.notifications.length, 1);
  const storedAfterFirst = getPlan(h.store, TODAY);
  assert.ok(storedAfterFirst);

  const second = await runMorningRitual(h.deps);
  assert.ok(second.ok, `expected success, got ${JSON.stringify(second)}`);
  assert.equal(second.value.status, "already-ran");
  assert.equal(h.notifications.length, 1, "no second Plan-generation notification");
  assert.equal(getPlan(h.store, TODAY)!.version, storedAfterFirst.version, "the stored Plan is untouched");
});

test("the ran-today marker records the date the Morning Ritual last ran", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo")] });
  await runMorningRitual(h.deps);
  const run = getRitualRun(h.store, MORNING_RITUAL_ID);
  assert.equal(run?.data.date, TODAY);
  assert.equal(run?.data.planId, `plan-${TODAY}`);
});

test("an incomplete Task does not block the complete Tasks from being planned (AD-11, UX-DR10)", async () => {
  const incomplete: Task = {
    id: "t2",
    title: "Renew the passport",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    area: "Errands",
    dueDate: "2026-08-30",
    status: "not-started",
    // estimatedDurationMinutes and energy deliberately absent
  };
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 }), incomplete] });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");

  const workBlocks = result.value.plan.blocks.filter((b) => b.kind === "work");
  assert.deepEqual(
    workBlocks.map((b) => b.taskId),
    ["t1"],
    "the complete Task is planned; the incomplete one is simply absent",
  );
  assert.equal(h.notifications.length, 1, "the Plan still ships");

  const request = getOpenInteractionRequest(h.store, DATA_COMPLETENESS_REQUEST_ID);
  assert.ok(request, "the incomplete Task is surfaced through the existing interaction-request mechanism");
  assert.match(request.data.promptText, /Renew the passport/);
  assert.match(request.data.promptText, /Estimated Duration/);
  assert.deepEqual(result.value.incompleteTaskIds, ["t2"]);
});

test("when every Task is incomplete there is nothing to plan: no notification, no ran-today marker, request opened", async () => {
  const incomplete: Task = {
    id: "t1",
    title: "Renew the passport",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
  const h = harness({ tasks: [incomplete] });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "nothing-to-plan");
  assert.equal(h.notifications.length, 0, "no notification is sent for an empty Plan");
  assert.equal(getRitualRun(h.store, MORNING_RITUAL_ID), undefined, "the day is not burned — a later trigger can still plan");
  assert.ok(getOpenInteractionRequest(h.store, DATA_COMPLETENESS_REQUEST_ID));
});

test("an answered field (a stored TaskFieldOverride) makes a previously-incomplete Task plannable", async () => {
  const incomplete: Task = {
    id: "t1",
    title: "Renew the passport",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    area: "Errands",
    dueDate: TODAY,
    status: "not-started",
    energy: "low",
  };
  const store = tempStore();
  const first = harness({ tasks: [incomplete], store });
  const firstResult = await runMorningRitual(first.deps);
  assert.ok(firstResult.ok && firstResult.value.status === "nothing-to-plan");

  // Spencer answers the prompt in chat-cli; the override is persisted.
  const { mergeTaskFieldOverride } = await import("../src/adapters/memory-store.ts");
  mergeTaskFieldOverride(store, "t1", { estimatedDurationMinutes: 45 });

  const second = harness({ tasks: [incomplete], store });
  const secondResult = await runMorningRitual(second.deps);
  assert.ok(secondResult.ok && secondResult.value.status === "delivered");
  assert.deepEqual(
    secondResult.value.plan.blocks.filter((b) => b.kind === "work").map((b) => b.taskId),
    ["t1"],
  );
  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined, "the request is cleared");
});

test("the reasoning line describes the same ordering the blocks were built from, bumpLevels included", async () => {
  // Without a bump, "Book the flights" (due sooner) leads. With a Slip-Bump
  // on "Draft the memo", the ordering flips — and the reasoning line must
  // flip with it, because both are computed from the same tasks/bumpLevels.
  const tasks = [
    makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60, dueDate: "2026-08-26" }),
    makeTask("t2", "Book the flights", { estimatedDurationMinutes: 60, dueDate: "2026-08-23" }),
  ];

  const plain = harness({ tasks });
  const plainResult = await runMorningRitual(plain.deps);
  assert.ok(plainResult.ok && plainResult.value.status === "delivered");
  const plainLead = plainResult.value.plan.blocks.find((b) => b.kind === "work")!;
  assert.equal(plainLead.taskId, "t2");
  assert.match(plainResult.value.plan.reasoning, /^"Book the flights"/);

  const bumped = harness({ tasks, bumpLevels: { t1: 5 } });
  const bumpedResult = await runMorningRitual(bumped.deps);
  assert.ok(bumpedResult.ok && bumpedResult.value.status === "delivered");
  const bumpedLead = bumpedResult.value.plan.blocks.find((b) => b.kind === "work")!;
  assert.equal(bumpedLead.taskId, "t1", "the bump reorders the Plan");
  assert.match(
    bumpedResult.value.plan.reasoning,
    /^"Draft the memo"/,
    "the reasoning line names the Task the Plan actually leads with",
  );
});

// ============================================================================
// AD-8 — rituals/ is the only layer that catches an adapter's throw
// ============================================================================

test("AD-8: a Notion adapter throw is caught and converted to a Result failure, not left to crash", async () => {
  const logged: unknown[] = [];
  const h = harness({
    readTasks: async () => {
      throw new Error("notion: 401 unauthorized");
    },
  });
  const result = await runMorningRitual({ ...h.deps, log: (entry) => logged.push(entry) });

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.error.kind, "unreachable");
  assert.match(result.error.message, /notion/i);
  assert.equal(h.notifications.length, 0, "a failed read never produces a Plan notification");
  assert.ok(
    logged.some((e) => (e as { event?: string }).event === "morning-ritual.read-tasks-failed"),
    "the failure is emitted as a structured log line",
  );
});

test("AD-8: a Calendar adapter throw is caught and converted to a Result failure", async () => {
  const h = harness({
    tasks: [makeTask("t1", "Draft the memo")],
    readCalendarEvents: async () => {
      throw new Error("calendar: rate limit exceeded");
    },
  });
  const result = await runMorningRitual(h.deps);

  assert.ok(!result.ok);
  assert.equal(result.error.kind, "unreachable");
  assert.match(result.error.message, /calendar/i);
  assert.equal(h.notifications.length, 0);
});

test("AD-8: a notification-adapter throw is caught, the Plan stays persisted, and the day is NOT marked done", async () => {
  const h = harness({
    tasks: [makeTask("t1", "Draft the memo")],
    sendNotification: async () => {
      throw new Error("pushover: 500");
    },
  });
  const result = await runMorningRitual(h.deps);

  assert.ok(!result.ok);
  assert.equal(result.error.kind, "unreachable");
  assert.ok(getPlan(h.store, TODAY), "the generated Plan is persisted, not thrown away");
  assert.equal(
    getRitualRun(h.store, MORNING_RITUAL_ID),
    undefined,
    "a failed send must not burn the day — the marker is only written after delivery succeeds",
  );
});

test("a transient send failure is retried by the next trigger, and then delivered exactly once", async () => {
  const store = tempStore();
  const failing = harness({
    store,
    tasks: [makeTask("t1", "Draft the memo")],
    sendNotification: async () => {
      throw new Error("pushover: network blip");
    },
  });
  assert.ok(!(await runMorningRitual(failing.deps)).ok);

  // Same day, next cron trigger: Pushover is back.
  const retry = harness({ store, tasks: [makeTask("t1", "Draft the memo")], declareBudgetMinutes: 0 });
  const retried = await runMorningRitual(retry.deps);
  assert.ok(retried.ok && retried.value.status === "delivered", "the retry is not short-circuited by already-ran");
  assert.equal(retry.notifications.length, 1);

  // And a third trigger, after a successful delivery, is the no-op it should be.
  const third = harness({ store, tasks: [makeTask("t1", "Draft the memo")], declareBudgetMinutes: 0 });
  const thirdResult = await runMorningRitual(third.deps);
  assert.ok(thirdResult.ok && thirdResult.value.status === "already-ran");
  assert.equal(third.notifications.length, 0);
});

// ============================================================================
// All-deferred day (review finding #1) and Pushover's real size limits (#3)
// ============================================================================

test("a day where nothing fits the Time Budget is its own outcome — never a Plan whose reasoning names an absent Task", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: TODAY, totalMinutes: 60, workMinutes: 70, breakMinutes: 15 });
  const h = harness({
    store,
    declareBudgetMinutes: 0,
    tasks: [makeTask("t1", "Rebuild the deck", { estimatedDurationMinutes: 600 })],
    events: [{ id: "e1", title: "Standup", start: "2026-08-22T15:00:00.000Z", end: "2026-08-22T15:30:00.000Z" }],
  });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "nothing-fits");
  assert.equal(h.notifications.length, 0, "no notification claims a Plan that has no Tasks in it");
  assert.equal(getRitualRun(h.store, MORNING_RITUAL_ID), undefined, "a bigger Time Budget later today can still produce a Plan");
  assert.ok(result.value.status === "nothing-fits");
  assert.deepEqual(result.value.deferredTaskIds, ["t1"]);
});

test("when some Tasks are deferred, the reasoning line names one that is actually in the Plan", async () => {
  const store = tempStore();
  // 100 minutes: the 600-minute Task can never fit; the 30-minute one can.
  putTimeBudget(store, { date: TODAY, totalMinutes: 100, workMinutes: 70, breakMinutes: 15 });
  const h = harness({
    store,
    declareBudgetMinutes: 0,
    tasks: [
      makeTask("t1", "Rebuild the deck", { estimatedDurationMinutes: 600, dueDate: "2026-08-22" }),
      makeTask("t2", "Tidy the inbox", { estimatedDurationMinutes: 30, dueDate: "2026-08-24" }),
    ],
  });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.deepEqual(result.value.deferredTaskIds, ["t1"]);
  assert.match(result.value.plan.reasoning, /Tidy the inbox/, "the reasoning names the Task that made it in");
  assert.doesNotMatch(result.value.plan.reasoning, /Rebuild the deck/, "never a deferred Task");

  const sent = h.notifications[0]!;
  assert.match(sent.message, /Tidy the inbox/);
  assert.doesNotMatch(sent.message, /Rebuild the deck/);
});

test("the notification body never exceeds Pushover's documented message limit, however busy the day", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: TODAY, totalMinutes: 1400, workMinutes: 70, breakMinutes: 15 });
  const longTitle = "Draft the extremely long and unusually detailed quarterly planning memorandum";
  const tasks = Array.from({ length: 14 }, (_, i) =>
    makeTask(`t${i}`, `${longTitle} number ${i}`, { estimatedDurationMinutes: 60, dueDate: "2026-08-22" }),
  );
  const h = harness({ store, declareBudgetMinutes: 0, tasks });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");

  const sent = h.notifications[0]!;
  assert.ok(
    sent.message.length <= PUSHOVER_MESSAGE_LIMIT,
    `notification body is ${sent.message.length} chars, over Pushover's ${PUSHOVER_MESSAGE_LIMIT} limit`,
  );
  assert.ok(sent.title.length <= PUSHOVER_TITLE_LIMIT);
  assert.match(sent.message, /more block/, "truncation is stated plainly rather than silently cutting the Plan off");
  assert.ok(
    sent.message.includes(result.value.plan.reasoning),
    "the reasoning line survives truncation — it is the one piece DESIGN.md requires in the body",
  );
  // The terminal render is NOT truncated: it has no such limit.
  assert.ok(result.value.rendered.length > PUSHOVER_MESSAGE_LIMIT);
});

test("a short day's notification body is not truncated at all", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.doesNotMatch(h.notifications[0]!.message, /more block/);
});

test("no declared Time Budget: fails with a missing-field Result rather than inventing one", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo")], declareBudgetMinutes: 0 });
  const result = await runMorningRitual(h.deps);

  assert.ok(!result.ok);
  assert.equal(result.error.kind, "missing-field");
  assert.match(result.error.message, /Time Budget/i);
  assert.equal(h.notifications.length, 0);
  assert.equal(getRitualRun(h.store, MORNING_RITUAL_ID), undefined);
});

test("a carried-forward Time Budget from a prior day is used as-is (Story 1.6 — it never silently reverts)", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-19", totalMinutes: 120, workMinutes: 70, breakMinutes: 15 });
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 200 })], store, declareBudgetMinutes: 0 });

  const result = await runMorningRitual(h.deps);
  // 200 minutes cannot fit a 120-minute budget, so the Task is deferred —
  // proof the carried-forward 120 (not a fresh default, and not an
  // unlimited one) was the budget actually used. With every Task deferred
  // this is a `nothing-fits` day, not a Plan with nothing in it.
  assert.ok(result.ok && result.value.status === "nothing-fits");
  assert.deepEqual(result.value.deferredTaskIds, ["t1"]);
  assert.equal(h.notifications.length, 0);
});

test("a carried-forward Time Budget still produces a real Plan for a Task that fits it", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-19", totalMinutes: 120, workMinutes: 70, breakMinutes: 15 });
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 100 })], store, declareBudgetMinutes: 0 });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.deepEqual(result.value.deferredTaskIds, []);
  assert.equal(h.notifications.length, 1);
});

test("today is Spencer's local calendar date, not the UTC one", async () => {
  // 2026-08-23T02:00Z is still 2026-08-22 in America/New_York.
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-22", totalMinutes: 240, workMinutes: 70, breakMinutes: 15 });
  const h = harness({ tasks: [makeTask("t1", "Draft the memo")], store, declareBudgetMinutes: 0, timeZone: "America/New_York" });
  const deps: MorningRitualDeps = { ...h.deps, now: () => new Date("2026-08-23T02:00:00.000Z") };

  const result = await runMorningRitual(deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.equal(result.value.plan.date, "2026-08-22");
});

// ============================================================================
// The unchecked-day flag (Task 21 / Story 3.3, FR-14, UX-DR14)
//
// Post-review redesign: detection now happens entirely inside
// rituals/night-ritual.ts's runNightEscalateRitual, at cap-spend time — see
// that file's own doc comment. rituals/morning-ritual.ts only ever READS
// memory-store.ts's UncheckedDay records (via listUncheckedDays) to decide
// what to DISPLAY, and stamps `shownAt` once it does. The unit-level tests
// below therefore seed UncheckedDay rows directly (simulating "night-escalate
// already recorded this"), and the end-to-end test further down exercises
// the REAL runNightEscalateRitual -> runMorningRitual pipeline across three
// mornings, reproducing the exact multi-day-gap scenario a code review
// traced against the FIRST version of this task (which lost the flag
// permanently in this scenario).
// ============================================================================

const PRIOR_NIGHT = "2026-08-21";

test("a delivered Plan carries the unchecked-night notice — visibly flagged, naming every rolled-forward Task by title", async () => {
  const store = tempStore();
  putUncheckedDay(store, {
    date: PRIOR_NIGHT,
    rolledForwardTasks: [
      { taskId: "t1", taskTitle: "Draft the memo" },
      { taskId: "t2", taskTitle: "Book the flights" },
    ],
    recordedAt: "2026-08-22T01:00:00.000Z",
  });
  const h = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.ok(result.value.status === "delivered");

  assert.ok(result.value.uncheckedNight, "expected the outcome to carry uncheckedNight");
  assert.equal(result.value.uncheckedNight?.date, PRIOR_NIGHT);

  assert.match(result.value.rendered, /wasn't closed out/i);
  assert.match(result.value.rendered, /Draft the memo/);
  assert.match(result.value.rendered, /Book the flights/);
  assert.match(result.value.rendered, new RegExp(UNCHECKED_NIGHT_TEXT_MARKER.replace(":", "\\:")));

  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0]!.message, /wasn't closed out/i);
  assert.match(h.notifications[0]!.message, /Draft the memo/);
  assert.doesNotMatch(h.notifications[0]!.message, /\x1b\[/, "the push notification body never carries ANSI color");
});

test("the notice uses the ATTENTION color when color output is on — the same DESIGN.md token Task 20 reserved for exactly this second moment (UX-DR6)", async () => {
  const store = tempStore();
  putUncheckedDay(store, {
    date: PRIOR_NIGHT,
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T01:00:00.000Z",
  });
  const h = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const deps: MorningRitualDeps = { ...h.deps, color: true };

  const result = await runMorningRitual(deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.ok(result.value.rendered.includes(ATTENTION), "expected the literal {colors.attention} escape in the colored rendering");
});

test("a normal morning (no pending UncheckedDay record at all) carries no notice — a closed day must never be confused with an unchecked one", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.equal(result.value.uncheckedNight, undefined);
  assert.doesNotMatch(result.value.rendered, /wasn't closed out/i);
  assert.doesNotMatch(h.notifications[0]!.message, /wasn't closed out/i);
  assert.equal(getUncheckedDay(h.store, PRIOR_NIGHT), undefined, "no UncheckedDay row should ever exist for a normally-closed night");
});

test("a delivered Plan carrying the notice stamps shownAt on the UncheckedDay row, AFTER a successful send", async () => {
  const store = tempStore();
  putUncheckedDay(store, {
    date: PRIOR_NIGHT,
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T01:00:00.000Z",
  });
  const h = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });

  assert.equal(getUncheckedDay(store, PRIOR_NIGHT)?.data.shownAt, undefined, "sanity: not yet shown before this run");
  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");

  const record = getUncheckedDay(store, PRIOR_NIGHT);
  assert.ok(record?.data.shownAt, "expected shownAt to be stamped after a confirmed delivery");
  assert.deepEqual(record.data.rolledForwardTasks, [{ taskId: "t1", taskTitle: "Draft the memo" }], "rolledForwardTasks is untouched by the stamp");
});

test("a run that ends in nothing-to-plan never stamps shownAt — nothing was actually shown to Spencer this trigger, so the record stays pending", async () => {
  const store = tempStore();
  putUncheckedDay(store, {
    date: PRIOR_NIGHT,
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T01:00:00.000Z",
  });
  const h = harness({ store, tasks: [] }); // no Tasks at all -> nothing-to-plan

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "nothing-to-plan");
  assert.equal(getUncheckedDay(store, PRIOR_NIGHT)?.data.shownAt, undefined, "the flag must not be burned on a run that delivered nothing");
});

test("already shown (UncheckedDay.shownAt already set): the notice is NOT shown again — shown once, not a standing reminder (UX-DR14)", async () => {
  const store = tempStore();
  putUncheckedDay(store, {
    date: PRIOR_NIGHT,
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-21T23:00:00.000Z",
    shownAt: "2026-08-22T06:00:00.000Z", // already shown by an earlier trigger
  });
  const h = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.equal(result.value.uncheckedNight, undefined);
  assert.doesNotMatch(result.value.rendered, /wasn't closed out/i);
});

test("when multiple nights are pending, the OLDEST not-yet-shown one is displayed first — decoupled from 'yesterday specifically'", async () => {
  const store = tempStore();
  putUncheckedDay(store, {
    date: "2026-08-19",
    rolledForwardTasks: [{ taskId: "t-old", taskTitle: "Older unresolved Task" }],
    recordedAt: "2026-08-19T23:00:00.000Z",
  });
  putUncheckedDay(store, {
    date: PRIOR_NIGHT, // 2026-08-21, more recent than 2026-08-19
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T01:00:00.000Z",
  });
  const h = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.equal(result.value.uncheckedNight?.date, "2026-08-19", "the OLDER pending night must be shown first, not the more recent one");
  assert.match(result.value.rendered, /Older unresolved Task/);
  assert.equal(getUncheckedDay(store, "2026-08-19")?.data.shownAt !== undefined, true);
  assert.equal(getUncheckedDay(store, PRIOR_NIGHT)?.data.shownAt, undefined, "the newer pending night is untouched — its turn comes later");
});

// ============================================================================
// End-to-end: the REAL runNightEscalateRitual -> runMorningRitual pipeline
// across three mornings, reproducing the exact scenario a code review traced
// against the FIRST version of this task (Important #1): night N goes
// unchecked, morning N+1 does NOT deliver, and — the bug being fixed here —
// the flag must NOT be lost; it must surface on the next morning that
// actually delivers, still correctly attributed to night N.
// ============================================================================

test("end-to-end: a capped-and-unanswered night is recorded as unchecked the MOMENT the cap is reached, survives a non-delivering morning without being lost, and is shown once on the next delivering morning", async () => {
  const store = tempStore();

  // --- Night N (2026-08-21): both close-out attempts spent, still unanswered.
  putOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, {
    requestKind: "night-close-out",
    promptText: buildNightCloseOutPromptText([{ taskId: "t1", taskTitle: "Draft the memo" }]),
    detail: { date: PRIOR_NIGHT, tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] },
    createdAt: "2026-08-21T20:00:00.000Z",
  });
  const escalated = await runNightEscalateRitual({
    store,
    sendEscalationEmail: async () => {},
    now: () => new Date(`${PRIOR_NIGHT}T23:00:00.000Z`),
    timeZone: "UTC",
  });
  assert.ok(escalated.ok && escalated.value.status === "escalated", `expected escalation, got ${JSON.stringify(escalated)}`);
  assert.ok(getUncheckedDay(store, PRIOR_NIGHT), "recorded the MOMENT the cap was reached — not deferred to some later morning");
  assert.equal(getUncheckedDay(store, PRIOR_NIGHT)?.data.shownAt, undefined);
  assert.equal(getRitualRun(store, NIGHT_ESCALATE_RITUAL_ID)?.data.date, PRIOR_NIGHT);

  // --- Morning N+1 (2026-08-22): the Morning Ritual does NOT deliver
  //     (nothing-to-plan) — the exact scenario the review traced as
  //     PERMANENTLY losing the flag in the first version of this task,
  //     because that version inferred "unchecked" from state the NEXT
  //     night's own rituals would go on to overwrite, rather than recording
  //     it durably up front.
  const notDelivering = harness({ store, tasks: [] });
  const notDeliveredResult = await runMorningRitual(notDelivering.deps);
  assert.ok(notDeliveredResult.ok && notDeliveredResult.value.status === "nothing-to-plan");
  assert.equal(
    getUncheckedDay(store, PRIOR_NIGHT)?.data.shownAt,
    undefined,
    "the recorded unchecked night must survive a non-delivering morning — not lost",
  );

  // --- Night N+1 runs normally (no escalation needed) — nothing recorded for
  //     it; this is the "later night" whose own night-prompt would, in the
  //     OLD design, have overwritten the singletons detection used to depend
  //     on. That dependency no longer exists.

  // --- Morning N+2 (2026-08-23): the next morning that actually delivers ---
  const delivering = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const deliveringDeps: MorningRitualDeps = { ...delivering.deps, now: () => new Date("2026-08-23T13:00:00.000Z") };
  const delivered = await runMorningRitual(deliveringDeps);
  assert.ok(delivered.ok, `expected success, got ${JSON.stringify(delivered)}`);
  assert.ok(delivered.value.status === "delivered");
  assert.ok(delivered.value.uncheckedNight, "the still-pending unchecked night must still surface — not lost");
  assert.equal(delivered.value.uncheckedNight?.date, PRIOR_NIGHT, "still the ORIGINAL unchecked night, correctly attributed — not conflated with a later one");
  assert.match(delivered.value.rendered, /wasn't closed out/i);
  assert.match(delivered.value.rendered, /Draft the memo/);
  assert.ok(getUncheckedDay(store, PRIOR_NIGHT)?.data.shownAt, "now stamped as shown");

  // The original interaction request must survive completely untouched
  // throughout — Spencer can still answer it via the normal chat-cli.ts path.
  const stillOpen = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID);
  assert.ok(stillOpen, "the original close-out request must not be cleared by any of this");
  assert.equal((stillOpen.data.detail as NightCloseOutRequestDetail).date, PRIOR_NIGHT);

  // --- A hypothetical morning N+3 must NOT show it again (shown once) -------
  const third = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const thirdDeps: MorningRitualDeps = { ...third.deps, now: () => new Date("2026-08-24T13:00:00.000Z") };
  const thirdResult = await runMorningRitual(thirdDeps);
  assert.ok(thirdResult.ok && thirdResult.value.status === "delivered");
  assert.equal(thirdResult.value.uncheckedNight, undefined, "the flag must not repeat on a later Morning Plan");
  assert.doesNotMatch(thirdResult.value.rendered, /wasn't closed out/i);
});

test("end-to-end: a night Spencer answers AFTER escalation does NOT get falsely flagged on the next Morning Plan (Task 21, second post-review fix / AC3)", async () => {
  const store = tempStore();

  // --- Night N (2026-08-21): both close-out attempts spent, still unanswered
  //     at the time night-escalate runs — recorded as unchecked.
  putOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, {
    requestKind: "night-close-out",
    promptText: buildNightCloseOutPromptText([{ taskId: "t1", taskTitle: "Draft the memo" }]),
    detail: { date: PRIOR_NIGHT, tasks: [{ taskId: "t1", taskTitle: "Draft the memo" }] },
    createdAt: "2026-08-21T20:00:00.000Z",
  });
  const escalated = await runNightEscalateRitual({
    store,
    sendEscalationEmail: async () => {},
    now: () => new Date(`${PRIOR_NIGHT}T23:00:00.000Z`),
    timeZone: "UTC",
  });
  assert.ok(escalated.ok && escalated.value.status === "escalated");
  assert.ok(getUncheckedDay(store, PRIOR_NIGHT), "sanity: recorded as unchecked after the cap was reached");

  // --- Spencer answers — the escalation feature's actual success path: the
  //     SECOND attempt reaching him and working, later that same night (or
  //     any time before the request is overwritten by a later night).
  const applied = await applyNightCloseOutConfirmation(
    {
      store,
      setTaskStatus: async () => ({ ok: true, value: undefined }),
      recordCompletion: (): void => {},
      lookupTask: (): Promise<Task | undefined> => Promise.resolve(undefined),
    },
    "t1",
    "Draft the memo",
    "completed",
    PRIOR_NIGHT,
    `${PRIOR_NIGHT}T22:00:00.000Z`,
  );
  assert.ok(applied.ok, `expected the answer to apply successfully, got ${JSON.stringify(applied)}`);
  // The same call chat-cli.ts makes once every named Task is answered — no
  // skips here, so resolveUncheckedDay: true (see chat-cli.ts's own call
  // site: it passes `skippedTitles.length === 0`).
  clearNightCloseOutRequestIfOpen(store, { resolveUncheckedDay: true });
  assert.equal(getUncheckedDay(store, PRIOR_NIGHT), undefined, "sanity: the UncheckedDay record is resolved immediately on answer");

  // --- The next Morning Plan (2026-08-22) must NOT falsely flag this night —
  //     it was genuinely closed out, however late.
  const h = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.ok(result.value.status === "delivered");
  assert.equal(result.value.uncheckedNight, undefined, "a properly closed-out night must never be flagged as unchecked (AC3)");
  assert.doesNotMatch(result.value.rendered, /wasn't closed out/i);
  assert.doesNotMatch(h.notifications[0]!.message, /wasn't closed out/i);
});

// ============================================================================
// Time-Budget-change Proposal (Task 23 / Story 4.2, AD-3) — the real
// suggestion mechanism Task 6's own AC deferred, wired up end-to-end here.
// ============================================================================

/** Runs the ritual for one calendar `date`, against `store`, with a fixed too-small budget and whatever `tasks` are given. */
async function runMorningRitualOn(
  store: MemoryStore,
  date: string,
  tasks: readonly Task[],
): Promise<Awaited<ReturnType<typeof runMorningRitual>>> {
  const deps: MorningRitualDeps = {
    store,
    readTasks: async () => tasks,
    readCalendarEvents: async () => [],
    sendNotification: async () => {},
    now: () => new Date(`${date}T13:00:00.000Z`),
    timeZone: "UTC",
    color: false,
  };
  return runMorningRitual(deps);
}

const OVERSIZED_TASK: readonly Task[] = [makeTask("t1", "Rebuild the deck", { estimatedDurationMinutes: 600 })];

test("Task 23: 3 consecutive days of budget-insufficient deferrals produces a real, persisted Time-Budget-change Proposal", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-18", totalMinutes: 60, workMinutes: 70, breakMinutes: 15 });

  const dates = ["2026-08-20", "2026-08-21", "2026-08-22"];
  for (const [index, date] of dates.entries()) {
    const result = await runMorningRitualOn(store, date, OVERSIZED_TASK);
    assert.ok(result.ok && result.value.status === "nothing-fits", `expected nothing-fits on ${date}`);

    if (index < dates.length - 1) {
      assert.equal(
        getOpenInteractionRequest(store, TIME_BUDGET_PROPOSAL_REQUEST_ID),
        undefined,
        `no Proposal expected yet after ${date} — the streak hasn't met the threshold`,
      );
    }
  }

  const open = getOpenInteractionRequest(store, TIME_BUDGET_PROPOSAL_REQUEST_ID);
  assert.ok(open, "expected an open Time-Budget-change Proposal interaction request after the 3rd consecutive deferral day");
  assert.equal(open.data.requestKind, "proposal");
  assert.match(open.data.promptText, /3 consecutive days/);
  assert.match(open.data.promptText, /yes/i);
  assert.match(open.data.promptText, /no/i);

  const detail = open.data.detail as { readonly proposal?: Proposal<Partial<TimeBudget>> };
  assert.ok(detail.proposal, "the interaction request carries the real Proposal, not a placeholder");
  assert.equal(detail.proposal.kind, "time-budget-change");
  assert.equal(detail.proposal.entityVersion, "1", "the budget was declared exactly once — StoredRecord.version 1 throughout");
  assert.ok(detail.proposal.suggested.totalMinutes !== undefined && detail.proposal.suggested.totalMinutes > 60);
  assert.match(detail.proposal.reason, /3 consecutive days/);
  assert.match(detail.proposal.reason, /60 minutes/);
});

test("Task 23: a day with no deferrals clears the streak — a later partial recurrence (below threshold) produces no Proposal", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-18", totalMinutes: 60, workMinutes: 70, breakMinutes: 15 });
  const smallTask: readonly Task[] = [makeTask("t2", "Quick email", { estimatedDurationMinutes: 20 })];

  await runMorningRitualOn(store, "2026-08-19", OVERSIZED_TASK); // streak: 1
  await runMorningRitualOn(store, "2026-08-20", OVERSIZED_TASK); // streak: 2
  const cleared = await runMorningRitualOn(store, "2026-08-21", smallTask); // fits — streak resets to 0
  assert.ok(cleared.ok && cleared.value.status === "delivered");
  await runMorningRitualOn(store, "2026-08-22", OVERSIZED_TASK); // streak restarts at: 1

  assert.equal(
    getOpenInteractionRequest(store, TIME_BUDGET_PROPOSAL_REQUEST_ID),
    undefined,
    "the reset means only 1 consecutive day has re-accumulated — below the 3-day threshold",
  );
});

test("Task 23: an already-open Time-Budget-change Proposal is not silently replaced by a fresher one each day it stays unanswered", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-18", totalMinutes: 60, workMinutes: 70, breakMinutes: 15 });

  for (const date of ["2026-08-20", "2026-08-21", "2026-08-22"]) {
    await runMorningRitualOn(store, date, OVERSIZED_TASK);
  }
  const firstOpen = getOpenInteractionRequest(store, TIME_BUDGET_PROPOSAL_REQUEST_ID);
  assert.ok(firstOpen);
  const firstProposalId = (firstOpen.data.detail as { readonly proposal?: Proposal<Partial<TimeBudget>> }).proposal?.id;

  // A 4th consecutive deferral day, with the Proposal still open/unanswered.
  await runMorningRitualOn(store, "2026-08-23", OVERSIZED_TASK);

  const stillOpen = getOpenInteractionRequest(store, TIME_BUDGET_PROPOSAL_REQUEST_ID);
  assert.ok(stillOpen);
  assert.equal(stillOpen.version, firstOpen.version, "the SAME interaction request row — not replaced with a new one");
  const secondProposalId = (stillOpen.data.detail as { readonly proposal?: Proposal<Partial<TimeBudget>> }).proposal?.id;
  assert.equal(secondProposalId, firstProposalId, "the same Proposal — Spencer still sees exactly what he was first shown");
});

test("Review fix (Important #3): when the deferral streak resets to zero, an already-open Time-Budget-change Proposal is invalidated (cleared), not left open with stale justification", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-18", totalMinutes: 60, workMinutes: 70, breakMinutes: 15 });

  for (const date of ["2026-08-20", "2026-08-21", "2026-08-22"]) {
    await runMorningRitualOn(store, date, OVERSIZED_TASK);
  }
  assert.ok(
    getOpenInteractionRequest(store, TIME_BUDGET_PROPOSAL_REQUEST_ID),
    "sanity: a Proposal is open after 3 consecutive deferral days",
  );

  // The next day, everything fits — zero deferrals, so the streak (and the
  // "3 consecutive days" justification the open Proposal's reason names)
  // is no longer true as of THIS run.
  const smallTask: readonly Task[] = [makeTask("t2", "Quick email", { estimatedDurationMinutes: 20 })];
  const result = await runMorningRitualOn(store, "2026-08-23", smallTask);
  assert.ok(result.ok && result.value.status === "delivered");

  assert.equal(
    getOpenInteractionRequest(store, TIME_BUDGET_PROPOSAL_REQUEST_ID),
    undefined,
    "the Proposal must be invalidated (cleared) — it is never left open with a justification this same run just disproved",
  );
});

// ============================================================================
// Task 27 / Story 5.3 — shared LogEntry type, Plan-generation timing, and the
// unchecked-day-already-resolved logging gap
// ============================================================================

test("morning-ritual.ts's own log seam accepts the SHARED adapters/logger.ts LogEntry type, not a private local one", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const logged: LogEntry[] = [];
  // If this compiles, MorningRitualDeps.log is genuinely typed against the
  // shared `LogEntry` — a structural/type-level proof, not just a runtime one.
  const deps: MorningRitualDeps = { ...h.deps, log: (entry: LogEntry) => logged.push(entry) };

  const result = await runMorningRitual(deps);
  assert.ok(result.ok && result.value.status === "delivered");
  assert.ok(logged.length > 0, "at least one structured log line was emitted");
  assert.ok(logged.every((e) => e.level === "info" || e.level === "warn" || e.level === "error"));
});

test("a delivered Plan's outcome carries planGenerationMs, and the SAME value appears in the final structured log line's detail", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const logged: LogEntry[] = [];
  const result = await runMorningRitual({ ...h.deps, log: (e) => logged.push(e) });

  assert.ok(result.ok && result.value.status === "delivered");
  assert.equal(typeof result.value.planGenerationMs, "number");
  assert.ok(result.value.planGenerationMs! >= 0);

  const delivered = logged.find((e) => e.event === "morning-ritual.delivered");
  assert.ok(delivered, "expected a morning-ritual.delivered log line");
  const detail = delivered!.detail as { planGenerationMs?: number };
  assert.equal(detail.planGenerationMs, result.value.planGenerationMs, "the log line's timing must match the outcome's own field, not a second independent measurement");
});

test("planGenerationMs is genuinely measured, not hardcoded — a slower Data-Completeness-Gate-through-fitting portion of the span produces a measurably larger duration", async () => {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const fast = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const fastResult = await runMorningRitual(fast.deps);
  assert.ok(fastResult.ok && fastResult.value.status === "delivered");

  const slow = harness({
    tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })],
    readCalendarEvents: async () => {
      // readCalendarEvents (step 5) sits INSIDE the timed span (which now
      // runs from the Data-Completeness Gate through right before
      // deps.sendNotification, post-review-fix widening — see
      // PLAN_GENERATION_DEGRADED_THRESHOLD_MS's own doc comment) — an
      // artificial delay here proves the timer measures real elapsed wall
      // time through that span, rather than reporting a constant.
      await sleep(60);
      return [];
    },
  });
  const slowResult = await runMorningRitual(slow.deps);
  assert.ok(slowResult.ok && slowResult.value.status === "delivered");

  assert.ok(
    slowResult.value.planGenerationMs! - fastResult.value.planGenerationMs! >= 40,
    `expected the artificially-slowed run's planGenerationMs (${slowResult.value.planGenerationMs}) to exceed the fast run's (${fastResult.value.planGenerationMs}) by roughly the injected 60ms delay`,
  );
});

test("planGenerationMs's WIDENED span (post-review fix) also measures work AFTER Work/Break fitting — a slow putPlan persistence write now correctly counts toward the duration", async () => {
  const store = tempStore();
  const originalReadModifyWrite = store.readModifyWrite.bind(store);
  let sawPlanWrite = false;
  // A synchronous busy-wait (not setTimeout) since `putPlan` -> `readModifyWrite`
  // is itself a synchronous MemoryStore call, never awaited by runMorningRitual.
  const busyWaitMs = (ms: number): void => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      /* deliberately busy — simulates a slow synchronous SQLite write */
    }
  };
  store.readModifyWrite = ((...args: Parameters<typeof originalReadModifyWrite>) => {
    if (args[0] === "plan") {
      sawPlanWrite = true;
      busyWaitMs(40);
    }
    return originalReadModifyWrite(...args);
  }) as typeof store.readModifyWrite;

  const h = harness({ store, tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const result = await runMorningRitual(h.deps);

  assert.ok(result.ok && result.value.status === "delivered", `expected delivered, got ${JSON.stringify(result)}`);
  assert.ok(sawPlanWrite, "sanity: the patched readModifyWrite call for putPlan's own 'plan' kind was actually reached");
  assert.ok(
    result.value.planGenerationMs! >= 35,
    `expected planGenerationMs (${result.value.planGenerationMs}) to reflect the injected ~40ms putPlan delay now that the span extends past Work/Break fitting through persistence — a value confined to the OLD gate-through-fit boundary could never see this delay at all`,
  );
});

test("a nothing-fits outcome (the run still reaches Work/Break fitting) also carries planGenerationMs", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: TODAY, totalMinutes: 60, workMinutes: 70, breakMinutes: 15 });
  const h = harness({
    store,
    declareBudgetMinutes: 0,
    tasks: [makeTask("t1", "Rebuild the deck", { estimatedDurationMinutes: 600 })],
  });

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "nothing-fits", `expected nothing-fits, got ${JSON.stringify(result)}`);
  assert.equal(typeof result.value.planGenerationMs, "number");
  assert.ok(result.value.planGenerationMs! >= 0);
});

test("a nothing-to-plan outcome carries NO planGenerationMs — that run never reaches Work/Break fitting at all", async () => {
  const h = harness({ tasks: [] }); // no Tasks at all -> nothing-to-plan, per the existing "nothing-to-plan" test's own convention above

  const result = await runMorningRitual(h.deps);
  assert.ok(result.ok && result.value.status === "nothing-to-plan", `expected nothing-to-plan, got ${JSON.stringify(result)}`);
  assert.equal((result.value as { planGenerationMs?: number }).planGenerationMs, undefined);
});

test("PLAN_GENERATION_DEGRADED_THRESHOLD_MS is a concrete, documented low-seconds starting value", () => {
  assert.equal(typeof PLAN_GENERATION_DEGRADED_THRESHOLD_MS, "number");
  assert.ok(PLAN_GENERATION_DEGRADED_THRESHOLD_MS > 0);
  // "low-seconds" per the task brief's own implementer note.
  assert.ok(PLAN_GENERATION_DEGRADED_THRESHOLD_MS <= 10_000);
  assert.ok(PLAN_GENERATION_DEGRADED_THRESHOLD_MS >= 1_000);
});

// ---- the logging-gap fix: markUncheckedDayShown finding the record already gone ----

test("logging-gap fix: a race where a concurrent process clears the UncheckedDay record before this run stamps it shown is logged, not silently ignored — and the run still delivers normally", async () => {
  const store = tempStore();
  putUncheckedDay(store, {
    date: PRIOR_NIGHT,
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T01:00:00.000Z",
  });
  const logged: LogEntry[] = [];

  const h = harness({
    store,
    tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })],
    // Simulates a SEPARATE chat-cli.ts process answering and clearing the
    // close-out (which clears the matching UncheckedDay record too, per
    // night-ritual.ts's clearNightCloseOutRequestIfOpen) in the window
    // between step 1.5's read and this run's own step 12d write — the exact
    // real, reachable race markUncheckedDayShown's own doc comment names.
    sendNotification: async () => {
      clearUncheckedDay(store, PRIOR_NIGHT);
    },
  });

  const result = await runMorningRitual({ ...h.deps, log: (e) => logged.push(e) });

  assert.ok(result.ok && result.value.status === "delivered", "the race must not fail the run — the Plan still delivers normally");
  assert.equal(getUncheckedDay(store, PRIOR_NIGHT), undefined, "sanity: genuinely gone by the time step 12d runs");

  const gapEvent = logged.find((e) => e.event === "morning-ritual.unchecked-day-already-resolved");
  assert.ok(gapEvent, "expected a log line for the previously-silent 'already resolved, nothing to stamp' branch");
  assert.equal(gapEvent!.level, "info");
  assert.deepEqual(gapEvent!.detail, { date: PRIOR_NIGHT });
});

// ============================================================================
// writeCalendarPlan — the "Yoh Plan" Calendar sync (final whole-branch
// review, Finding 1 / Task 12, AD-4). Wiring, not calendar-adapter.ts's own
// I/O behavior — that is already covered by tests/calendar-adapter.test.ts.
// ============================================================================

test("a delivered run with writeCalendarPlan stubbed calls it exactly once, with only non-calendar-anchor blocks", async () => {
  const calls: (readonly PlanBlock[])[] = [];
  const h = harness({
    tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })],
    events: [{ id: "e1", title: "Standup", start: "2026-08-22T15:00:00.000Z", end: "2026-08-22T15:30:00.000Z" }],
  });

  const result = await runMorningRitual({
    ...h.deps,
    writeCalendarPlan: async (blocks) => {
      calls.push(blocks);
    },
  });

  assert.ok(result.ok && result.value.status === "delivered");
  assert.equal(calls.length, 1, "writeCalendarPlan is called exactly once");
  assert.ok(calls[0]!.length > 0, "sanity: the delivered Plan actually has blocks");
  assert.ok(
    calls[0]!.every((b) => b.kind !== "calendar-anchor"),
    "calendar-anchor blocks are excluded — they already exist as real events on the PRIMARY calendar",
  );
  assert.deepEqual(
    calls[0]!.map((b) => b.id),
    result.value.plan.blocks.filter((b) => b.kind !== "calendar-anchor").map((b) => b.id),
    "exactly the non-calendar-anchor blocks from the delivered Plan, nothing added or dropped",
  );
});

test("a delivered run with writeCalendarPlan throwing still returns ok:true/status:delivered (non-fatal) and logs a warn", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  const logged: LogEntry[] = [];

  const result = await runMorningRitual({
    ...h.deps,
    log: (e) => logged.push(e),
    writeCalendarPlan: async () => {
      throw new Error("Calendar API is down");
    },
  });

  assert.ok(result.ok, `a Calendar-write failure must never fail the run, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "delivered");
  assert.equal(h.notifications.length, 1, "the Plan notification still sends");

  const warnEvent = logged.find((e) => e.event === "morning-ritual.calendar-sync-failed");
  assert.ok(warnEvent, "expected a warn log line for the failed Calendar sync");
  assert.equal(warnEvent!.level, "warn");
});

test("a delivered run with writeCalendarPlan undefined behaves exactly as before — no crash, no call", async () => {
  const h = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 60 })] });
  assert.equal(h.deps.writeCalendarPlan, undefined, "sanity: the harness's default deps do not stub writeCalendarPlan");

  const result = await runMorningRitual(h.deps);

  assert.ok(result.ok && result.value.status === "delivered");
  assert.equal(h.notifications.length, 1);
});

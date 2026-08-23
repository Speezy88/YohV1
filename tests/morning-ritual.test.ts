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
  createMemoryStore,
  getOpenInteractionRequest,
  getPlan,
  getRitualRun,
  putTimeBudget,
  type MemoryStore,
} from "../src/adapters/memory-store.ts";
import {
  ACCENT,
  MORNING_RITUAL_ID,
  MUTED,
  RESET,
  renderPlan,
  runMorningRitual,
  type MorningRitualDeps,
  type PlanNotification,
} from "../src/rituals/morning-ritual.ts";
import { DATA_COMPLETENESS_REQUEST_ID } from "../src/shell/chat-cli.ts";
import type { CalendarEvent, Plan, PlanBlock, Task } from "../src/types/domain.ts";

// ============================================================================
// Fixtures
// ============================================================================

/** 2026-08-22 is a Saturday. Every test pins "now" to it so nothing depends on the real clock. */
const NOW_ISO = "2026-08-22T13:00:00.000Z";
const TODAY = "2026-08-22";

function tempStore(): MemoryStore {
  return createMemoryStore({ databasePath: ":memory:" });
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

test("AD-8: a notification-adapter throw is caught, and the Plan stays persisted so the day isn't replanned", async () => {
  const h = harness({
    tasks: [makeTask("t1", "Draft the memo")],
    sendNotification: async () => {
      throw new Error("pushover: 500");
    },
  });
  const result = await runMorningRitual(h.deps);

  assert.ok(!result.ok);
  assert.equal(result.error.kind, "unreachable");
  assert.ok(getPlan(h.store, TODAY), "the Plan was persisted before the send was attempted");
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
  assert.ok(result.ok && result.value.status === "delivered");
  // 200 minutes cannot fit a 120-minute budget, so the Task is deferred —
  // proof the carried-forward 120 (not a fresh default) was the budget used.
  assert.deepEqual(result.value.deferredTaskIds, ["t1"]);
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

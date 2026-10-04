/**
 * Tests for `src/app/plan-day.ts` (real-use fixes plan, Task 1: "Plan my
 * day on demand", `/plan`).
 *
 * `planDay` runs the exact same `rituals/morning-ritual.ts` `runMorningRitual`
 * pipeline the 6am cron uses, minus the Pushover push. These tests cover:
 *  - a first on-demand run genuinely builds and persists a Plan;
 *  - `PlanDayDeps` structurally cannot send a push (no such dependency
 *    exists at all, mirroring `tests/morning-view-app.test.ts`'s own pin);
 *  - a repeat `/plan` the same day never regenerates, replying with a
 *    one-line summary and a re-flow suggestion instead, and never re-reads
 *    Notion/Calendar;
 *  - the idempotence interaction with the 6am cron path: after `/plan`,
 *    `runMorningRitual` (the cron's own entry point) no-ops for the SAME
 *    day and sends no second notification;
 *  - the dead-man's-switch (`RitualInvocation`) is untouched by an
 *    on-demand run;
 *  - `nothing-to-plan`/`nothing-fits`/missing-Time-Budget outcomes are
 *    reported plainly, with the Data-Completeness open question attached
 *    where one exists, and never persist a Plan or the ran-today marker
 *    (so a later `/plan` the same day can still try again).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import {
  createMemoryStore,
  getPlan,
  getRitualInvocation,
  getRitualRun,
  putTimeBudget,
  type MemoryStore,
} from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema, listUnreadNotifications } from "../src/adapters/notification-store.ts";
import { planDay, planDayForChangeSet, type PlanDayDeps } from "../src/app/plan-day.ts";
import { MORNING_RITUAL_ID, runMorningRitual } from "../src/rituals/morning-ritual.ts";
import type { PlanNotification } from "../src/rituals/ritual-shared.ts";
import type { ChatSession } from "../src/app/chat-session.ts";
import type { CalendarEvent, Task } from "../src/types/domain.ts";

const TODAY = "2026-09-27";
const NOW_ISO = `${TODAY}T13:00:00.000Z`;

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

function makeSession(): ChatSession {
  return { recentMessages: [], lastSearchAnswer: undefined };
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

/** A Task missing "dueDate" — one of `core/data-completeness-gate.ts`'s two Required Fields (Story 9.1) — so the gate reports it incomplete rather than planning it. */
function incompleteTask(id: string, title: string): Task {
  return {
    id,
    title,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    estimatedDurationMinutes: 30,
    area: "Work",
    status: "not-started",
    energy: "medium",
    // dueDate deliberately absent
  };
}

function harness(options: {
  tasks?: readonly Task[];
  events?: readonly CalendarEvent[];
  readTasks?: () => Promise<readonly Task[]>;
  declareBudgetMinutes?: number;
  store?: MemoryStore;
}): { store: MemoryStore; deps: PlanDayDeps } {
  const store = options.store ?? tempStore();
  const budgetMinutes = options.declareBudgetMinutes === undefined ? 240 : options.declareBudgetMinutes;
  if (budgetMinutes > 0) {
    putTimeBudget(store, { date: TODAY, totalMinutes: budgetMinutes, workMinutes: 70, breakMinutes: 15 });
  }
  const deps: PlanDayDeps = {
    store,
    session: makeSession(),
    timeZone: "UTC",
    now: () => new Date(NOW_ISO),
    readTasks: options.readTasks ?? (async () => options.tasks ?? []),
    readCalendarEvents: async () => options.events ?? [],
  };
  return { store, deps };
}

// ============================================================================
// A genuine first run
// ============================================================================

test("planDay builds and persists today's Plan on a first call, replying with the rendered, uncolored Plan text plus its reasoning line", async () => {
  const { store, deps } = harness({ tasks: [makeTask("t1", "Draft the memo")] });

  const result = await planDay(deps, {});

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.equal(/\x1b\[/.test(result.value.reply), false, "the chat reply is never ANSI-colored");
  assert.deepEqual(result.value.receipts, []);

  const stored = getPlan(store, TODAY);
  assert.ok(stored, "the Plan is genuinely persisted, not just rendered");
  assert.ok(stored!.data.reasoning.length > 0, "a real reasoning line was generated");
  assert.match(result.value.reply, /leads today/, "the reasoning line is folded into the reply");

  assert.equal(getRitualRun(store, MORNING_RITUAL_ID)?.data.date, TODAY, "the ran-today marker is written, same as a real cron run");
});

test("PlanDayDeps names no notification-capable dependency at all — /plan cannot push even by accident (Spencer, 2026-09-27)", () => {
  const { deps } = harness({ tasks: [] });
  const keys = Object.keys(deps);
  for (const forbidden of ["sendNotification", "sendPushoverNotification", "sendFailureAlert"]) {
    assert.equal(keys.includes(forbidden), false, `PlanDayDeps must not carry ${forbidden}`);
  }
});

// ============================================================================
// Already exists — doesn't regenerate
// ============================================================================

test("a repeat /plan the same day doesn't regenerate: it reports the existing Plan with a one-line summary and suggests re-flow, without re-reading Tasks", async () => {
  const { store, deps } = harness({ tasks: [makeTask("t1", "Draft the memo")] });
  const first = await planDay(deps, {});
  assert.ok(first.ok);

  let readTasksCalled = false;
  const second = await planDay(
    { ...deps, readTasks: async () => { readTasksCalled = true; return []; } },
    {},
  );

  assert.ok(second.ok);
  if (!second.ok) return;
  assert.match(second.value.reply, /already have a Plan/i);
  assert.match(second.value.reply, /I'm behind/i);
  assert.equal(readTasksCalled, false, "an already-built day never re-reads Notion Tasks");
  void store;
});

// ============================================================================
// Idempotence with the 6am cron path, and the dead-man's-switch
// ============================================================================

test("after /plan today, the 6am cron's own runMorningRitual no-ops for the SAME day and sends no second notification", async () => {
  const { store, deps } = harness({ tasks: [makeTask("t1", "Draft the memo")] });
  const onDemand = await planDay(deps, {});
  assert.ok(onDemand.ok);

  const notifications: PlanNotification[] = [];
  const cronOutcome = await runMorningRitual({
    store,
    readTasks: async () => [makeTask("t1", "Draft the memo")],
    readCalendarEvents: async () => [],
    sendNotification: async (n) => {
      notifications.push(n);
    },
    now: () => new Date(NOW_ISO),
    timeZone: "UTC",
  });

  assert.ok(cronOutcome.ok);
  if (!cronOutcome.ok) return;
  assert.equal(cronOutcome.value.status, "already-ran");
  assert.deepEqual(notifications, [], "no second Pushover push for the same host-TZ day");
});

test("an on-demand /plan run never touches the dead-man's-switch RitualInvocation marker", async () => {
  const { store, deps } = harness({ tasks: [makeTask("t1", "Draft the memo")] });
  await planDay(deps, {});
  assert.equal(getRitualInvocation(store, "morning"), undefined, "planDay must never fake a cron invocation");
});

// ============================================================================
// nothing-to-plan / nothing-fits / missing Time Budget
// ============================================================================

test("nothing-to-plan: every Task is missing a required field — planDay reports the combined prompt and attaches it as an open question, without persisting a Plan", async () => {
  const { store, deps } = harness({ tasks: [incompleteTask("t1", "Draft the memo")] });

  const result = await planDay(deps, {});

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.ok(result.value.question, "the Data-Completeness question is surfaced");
  assert.equal(getPlan(store, TODAY), undefined, "nothing-to-plan never persists a Plan");
  assert.equal(getRitualRun(store, MORNING_RITUAL_ID), undefined, "nothing-to-plan never writes the ran-today marker — a later /plan today can still succeed");
});

test("a Task missing a field alongside a complete Task: planDay still plans what it can and attaches the open question for the rest (gate what you can, prompt for the rest)", async () => {
  const { deps } = harness({
    tasks: [makeTask("t1", "Draft the memo"), incompleteTask("t2", "Incomplete Task")],
  });

  const result = await planDay(deps, {});

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.ok(result.value.question, "the Data-Completeness question for the incomplete Task is still surfaced alongside the Plan");
});

test("nothing-fits: the Time Budget is too small for any Task — planDay reports plainly and writes nothing, so a later /plan today can still succeed", async () => {
  const { store, deps } = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 240 })], declareBudgetMinutes: 5 });

  const result = await planDay(deps, {});

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Time Budget/i);
  assert.equal(getPlan(store, TODAY), undefined);
  assert.equal(getRitualRun(store, MORNING_RITUAL_ID), undefined);
});

test("no Time Budget declared at all: planDay fails honestly rather than fabricating one", async () => {
  const { deps } = harness({ tasks: [makeTask("t1", "Draft the memo")], declareBudgetMinutes: 0 });

  const result = await planDay(deps, {});

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /Time Budget/i);
});

// ============================================================================
// The needs-data notification fires from /plan exactly as from the 6am cron (Story 9.4)
// ============================================================================

test("planDay raises the identical needs-data notification when deps.connection is wired and a Task is missing a Required field", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const incomplete: Task = {
    id: "t2",
    title: "Renew the passport",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    area: "Errands",
    status: "not-started",
    // dueDate and estimatedDurationMinutes deliberately absent
  };
  const { deps } = harness({ store, tasks: [makeTask("t1", "Draft the memo"), incomplete] });

  const result = await planDay({ ...deps, connection }, {});
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);

  const needsData = listUnreadNotifications(connection).filter((n) => n.kind === "needs-data");
  assert.equal(needsData.length, 1);
  assert.equal(needsData[0]!.title, "1 Task needs data to be placed");
  assert.equal(needsData[0]!.deepLink, "chat:/sandbox");
});

test("planDay raises no needs-data notification, and never throws, when deps.connection is omitted (today's default — no test in this file predating 9.4 sets it)", async () => {
  const { deps } = harness({ tasks: [makeTask("t1", "Draft the memo")] });
  const result = await planDay(deps, {});
  assert.ok(result.ok);
});

test("planDayForChangeSet reports built only when it created a Plan", async () => {
  const fresh = harness({ tasks: [makeTask("t1", "Draft the memo")] });
  const built = await planDayForChangeSet(fresh.deps, {});
  assert.ok(built.ok && built.value.built);
  const again = await planDayForChangeSet(fresh.deps, {});
  assert.ok(again.ok && !again.value.built, "a Plan already exists");
  const tight = harness({ tasks: [makeTask("t1", "Draft the memo", { estimatedDurationMinutes: 240 })], declareBudgetMinutes: 5 });
  const none = await planDayForChangeSet(tight.deps, {});
  assert.ok(none.ok && !none.value.built, "nothing fit");
});

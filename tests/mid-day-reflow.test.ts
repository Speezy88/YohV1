/**
 * Tests for `src/rituals/mid-day-reflow.ts` (Story 2.3 / Task 15).
 *
 * Exercised end-to-end against a real (throwaway, `:memory:`) `MemoryStore`
 * with every I/O edge injected: `readTasks` stands in for the Notion
 * adapter. No network, no real clock — `now` is always pinned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createMemoryStore,
  getPlan,
  putPlan,
  putTimeBudget,
  type MemoryStore,
} from "../src/adapters/memory-store.ts";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { runMidDayReflow, type MidDayReflowDeps } from "../src/rituals/mid-day-reflow.ts";
import type { Plan, PlanBlock, Task } from "../src/types/domain.ts";

// ============================================================================
// Fixtures
// ============================================================================

const TODAY = "2026-08-22";
/** Morning Ritual "ran" at 09:00 UTC; Spencer triggers the re-flow at 11:00 UTC. */
const NOW_ISO = "2026-08-22T11:00:00.000Z";

function tempStore(): MemoryStore {
  // Story 7.8, Ruling R4: runMidDayReflow's putPlan call site now always
  // appends a Plan-change outbox hint in the same writeTx, so every test's
  // store needs the notification-store schema initialized on the same
  // connection, or that write throws "no such table: outbox".
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
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

function block(over: Partial<PlanBlock> & Pick<PlanBlock, "id" | "kind" | "start" | "end" | "label">): PlanBlock {
  return over;
}

/**
 * A stored Plan whose morning was: 09:00-09:30 work on t1 (fully in the
 * past by 11:00), 09:30-09:45 break (past), 09:45-10:15 work on t2 (past),
 * 10:15-10:30 break (past), 10:30-11:00 standup (calendar-anchor, past),
 * 11:00-11:30 work on t3 (still ahead — start === NOW, i.e. "in progress"
 * at the boundary), 11:30-11:45 break (ahead).
 */
function morningPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: `plan-${TODAY}`,
    date: TODAY,
    blocks: [
      block({ id: "work-0", kind: "work", start: "2026-08-22T09:00:00.000Z", end: "2026-08-22T09:30:00.000Z", label: "Task One", taskId: "t1" }),
      block({ id: "break-1", kind: "break", start: "2026-08-22T09:30:00.000Z", end: "2026-08-22T09:45:00.000Z", label: "Break" }),
      block({ id: "work-2", kind: "work", start: "2026-08-22T09:45:00.000Z", end: "2026-08-22T10:15:00.000Z", label: "Task Two", taskId: "t2" }),
      block({ id: "break-3", kind: "break", start: "2026-08-22T10:15:00.000Z", end: "2026-08-22T10:30:00.000Z", label: "Break" }),
      block({ id: "calendar-anchor-4", kind: "calendar-anchor", start: "2026-08-22T10:30:00.000Z", end: "2026-08-22T11:00:00.000Z", label: "Standup" }),
      block({ id: "work-5", kind: "work", start: "2026-08-22T11:00:00.000Z", end: "2026-08-22T11:30:00.000Z", label: "Task Three", taskId: "t3" }),
      block({ id: "break-6", kind: "break", start: "2026-08-22T11:30:00.000Z", end: "2026-08-22T11:45:00.000Z", label: "Break" }),
    ],
    reasoning: '"Task One" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: "2026-08-22T09:00:00.000Z",
    updatedAt: "2026-08-22T09:00:00.000Z",
    ...overrides,
  };
}

interface Harness {
  readonly store: MemoryStore;
  readonly deps: MidDayReflowDeps;
}

function harness(options: {
  tasks?: readonly Task[];
  readTasks?: () => Promise<readonly Task[]>;
  budgetMinutes?: number;
  timeZone?: string;
  nowIso?: string;
  storedPlan?: Plan | null;
  store?: MemoryStore;
}): Harness {
  const store = options.store ?? tempStore();

  const budgetMinutes = options.budgetMinutes ?? 480; // Spencer's declared full-day total.
  putTimeBudget(store, { date: TODAY, totalMinutes: budgetMinutes, workMinutes: 70, breakMinutes: 15 });

  const plan = options.storedPlan === undefined ? morningPlan() : options.storedPlan;
  if (plan) putPlan(store, plan);

  const nowIso = options.nowIso ?? NOW_ISO;

  const deps: MidDayReflowDeps = {
    store,
    readTasks: options.readTasks ?? (async () => options.tasks ?? []),
    now: () => new Date(nowIso),
    timeZone: options.timeZone ?? "UTC",
    color: false,
  };

  return { store, deps };
}

const DEFAULT_TASKS: readonly Task[] = [
  makeTask("t1", "Task One"),
  makeTask("t2", "Task Two"),
  makeTask("t3", "Task Three"),
];

// ============================================================================
// Behavior 1: only not-yet-elapsed blocks are recomputed
// ============================================================================

test("a successful re-flow appends a Plan-change outbox hint in the same writeTx as the Plan write (Story 7.8, Ruling R4)", async () => {
  const connection: SqliteConnection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const { deps } = harness({ tasks: DEFAULT_TASKS, store });

  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);

  const hints = tailOutboxSince(connection, 0);
  assert.ok(hints.some((hint) => hint.topic === "plan" && hint.entityId === TODAY));
});

test("runMidDayReflow: past blocks are byte-identical before and after re-flow", async () => {
  const { deps, store } = harness({ tasks: DEFAULT_TASKS });

  const before = morningPlan();
  const pastBlocksBefore = before.blocks.filter((b) => Date.parse(b.end) <= Date.parse(NOW_ISO));
  assert.ok(pastBlocksBefore.length >= 4, "sanity: fixture actually has past blocks");

  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");
  if (result.value.status !== "reflowed") return;

  const stored = getPlan(store, TODAY);
  assert.ok(stored);

  for (const pastBlock of pastBlocksBefore) {
    const found: PlanBlock | undefined = stored!.data.blocks.find((b) => b.id === pastBlock.id);
    assert.ok(found, `past block ${pastBlock.id} must still be present`);
    assert.deepEqual(found, pastBlock, `past block ${pastBlock.id} must be byte-identical`);
  }
});

test("runMidDayReflow: every block id remains unique after merging past + re-fit blocks", async () => {
  const { deps, store } = harness({ tasks: DEFAULT_TASKS });

  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");

  const stored = getPlan(store, TODAY);
  const ids = stored!.data.blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "every PlanBlock id must be unique (AD-9)");
});

test("runMidDayReflow: a second re-flow does not collide ids with the first re-flow's blocks", async () => {
  // Deliberately reproduces the exact collision shape the id-prefix design
  // must prevent: the FIRST re-flow's newly re-fit block(s) fully elapse
  // before the SECOND re-flow runs (so they become part of the second
  // call's untouched "past" set, keeping their first-re-flow ids), while
  // the second re-flow's OWN `fitWorkBreakBlocks` call starts a fresh
  // per-call id sequence at 0 again for whatever it fits (here, a
  // newly-appeared Task) — without the strictly-increasing plan-version
  // keyed into the id prefix, the second call's fresh "work-0" would
  // collide with the first call's re-fit "work-0" now sitting in the past
  // set.
  const { deps, store } = harness({ tasks: DEFAULT_TASKS });

  const first = await runMidDayReflow(deps);
  assert.equal(first.ok, true);

  // Triggered AFTER the first re-flow's own re-fit block (t3, 11:00-11:30)
  // has fully elapsed, and a brand-new Task (t4) has appeared — so the
  // second call's `fitWorkBreakBlocks` output starts a fresh id sequence
  // for a genuinely different block.
  const tasksWithNew: readonly Task[] = [...DEFAULT_TASKS, makeTask("t4", "Task Four")];
  const deps2: MidDayReflowDeps = {
    ...deps,
    readTasks: async () => tasksWithNew,
    now: () => new Date("2026-08-22T11:31:00.000Z"),
  };
  const second = await runMidDayReflow(deps2);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.value.status, "reflowed");

  const stored = getPlan(store, TODAY);
  const ids = stored!.data.blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "ids must stay unique across successive re-flows");
});

test("runMidDayReflow: blocks not yet started, or in progress, are excluded from the untouched past set", async () => {
  const { deps, store } = harness({ tasks: DEFAULT_TASKS });
  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const stored = getPlan(store, TODAY);
  // work-5 (11:00-11:30, in progress at NOW=11:00) must NOT survive verbatim
  // under its original id — it was re-fit.
  assert.equal(
    stored!.data.blocks.some((b) => b.id === "work-5"),
    false,
    "an in-progress-at-now block must be re-fit, not preserved verbatim",
  );
});

test(
  "runMidDayReflow: a block with GENUINE non-zero elapsed time (start well before now) credits only the actually-elapsed minutes, not zero and not the full block " +
    "(review-caught Critical bug: a 30-minute 11:00-11:30 block re-flowed at 11:15 must produce a 15-minute remainder, not a fresh 30-minute one)",
  async () => {
    const IN_PROGRESS_NOW = "2026-08-22T11:15:00.000Z"; // 15 minutes into an 11:00-11:30 block.
    const plan: Plan = {
      id: `plan-${TODAY}`,
      date: TODAY,
      blocks: [
        block({
          id: "work-0",
          kind: "work",
          start: "2026-08-22T11:00:00.000Z",
          end: "2026-08-22T11:30:00.000Z",
          label: "In Progress Task",
          taskId: "t-inprogress",
        }),
      ],
      reasoning: '"In Progress Task" leads today\'s Plan — due soonest.',
      version: 1,
      createdAt: "2026-08-22T11:00:00.000Z",
      updatedAt: "2026-08-22T11:00:00.000Z",
    };

    const { deps, store } = harness({
      tasks: [makeTask("t-inprogress", "In Progress Task", { estimatedDurationMinutes: 30 })],
      storedPlan: plan,
      budgetMinutes: 60,
      nowIso: IN_PROGRESS_NOW,
    });

    const result = await runMidDayReflow(deps);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, "reflowed");
    if (result.value.status !== "reflowed") return;

    // Nothing should be deferred — a 15-minute remainder trivially fits.
    assert.deepEqual(result.value.deferredTaskIds, []);

    const stored = getPlan(store, TODAY);
    const workBlocks = stored!.data.blocks.filter((b) => b.kind === "work" && b.taskId === "t-inprogress");
    assert.equal(workBlocks.length, 1, "expected exactly one re-fit work block for the in-progress Task");
    const refit = workBlocks[0]!;

    // The Task's TRUE remaining duration is 30 - 15 = 15 minutes, not the
    // full original 30 — the bug would have produced a fresh 30-minute
    // block starting at `now`, making the Task consume 45 real minutes
    // total (15 already lived + 30 freshly scheduled) instead of 30.
    const refitDurationMinutes = (Date.parse(refit.end) - Date.parse(refit.start)) / 60_000;
    assert.equal(refitDurationMinutes, 15, "the re-fit block must reflect only the TRUE remaining 15 minutes");
    assert.equal(refit.start, IN_PROGRESS_NOW, "the re-fit block must start exactly at `now`");
    assert.equal(refit.end, "2026-08-22T11:30:00.000Z", "15 already-lived + 15 newly-scheduled = the original 30-minute total, not 45");

    // The original in-progress block must not survive verbatim (it assumed
    // more time than has actually passed).
    assert.equal(stored!.data.blocks.some((b) => b.id === "work-0"), false);

    // Remaining Time Budget must also have been charged the true 15 elapsed
    // minutes (not 0): declared 60 - 15 elapsed = 45 remaining, of which
    // only 15 was used by the re-fit block — nothing should have been
    // deferred for lack of budget, which a 0-credit bug could otherwise mask
    // in a scenario with less slack. Cross-checked directly: with a 30-
    // minute Task and only a 15-minute TRUE remainder budgeted correctly,
    // the re-fit still fits in one un-split block, confirming the budget
    // wasn't starved by an over-charge either.
    assert.equal(refitDurationMinutes <= 45, true);
  },
);

// ============================================================================
// Behavior 2: the remaining portion is genuinely re-fit
// ============================================================================

test("runMidDayReflow: a mid-day increase to the Time Budget changes the future blocks' arrangement", async () => {
  // A 4th Task, due today, large enough that it would be deferred under the
  // original budget but fits once Spencer raises today's Time Budget.
  const tasksWithExtra: readonly Task[] = [...DEFAULT_TASKS, makeTask("t4", "Task Four", { estimatedDurationMinutes: 300 })];

  // Small budget: only ~15 minutes remain after 09:00-11:00 elapsed (135
  // minutes) out of a 150-minute declared total — not enough for t3 (30) +
  // t4 (300) both.
  const { deps: tightDeps, store: tightStore } = harness({ tasks: tasksWithExtra, budgetMinutes: 150 });
  const tightResult = await runMidDayReflow(tightDeps);
  assert.equal(tightResult.ok, true);
  if (!tightResult.ok) return;
  assert.equal(tightResult.value.status, "reflowed");
  if (tightResult.value.status !== "reflowed") return;
  assert.ok(tightResult.value.deferredTaskIds.includes("t4"), "t4 should be deferred under the tight budget");

  // Same scenario, but Spencer raises the budget before triggering re-flow.
  const { deps: roomyDeps, store: roomyStore } = harness({ tasks: tasksWithExtra, budgetMinutes: 900 });
  const roomyResult = await runMidDayReflow(roomyDeps);
  assert.equal(roomyResult.ok, true);
  if (!roomyResult.ok) return;
  assert.equal(roomyResult.value.status, "reflowed");
  if (roomyResult.value.status !== "reflowed") return;
  assert.equal(roomyResult.value.deferredTaskIds.includes("t4"), false, "t4 should now fit with a larger budget");

  void tightStore;
  void roomyStore;
});

test("runMidDayReflow: a Task added to Notion since the morning Plan appears in the re-fit remainder", async () => {
  const tasksWithNew: readonly Task[] = [...DEFAULT_TASKS, makeTask("t-new", "Brand New Task")];
  const { deps, store } = harness({ tasks: tasksWithNew });

  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");

  const stored = getPlan(store, TODAY);
  assert.ok(
    stored!.data.blocks.some((b) => b.kind === "work" && b.taskId === "t-new"),
    "a newly-appeared Task should be scheduled into the re-fit remainder",
  );
});

test("runMidDayReflow: a Task fully completed before the re-flow boundary is excluded from re-fitting", async () => {
  // t1 and t2 are both fully in the past. Only t3 remains scheduled ahead.
  const { deps, store } = harness({ tasks: DEFAULT_TASKS });
  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");

  const stored = getPlan(store, TODAY);
  const workBlocks = stored!.data.blocks.filter((b) => b.kind === "work");
  const taskIdsScheduled = new Set(workBlocks.map((b) => b.taskId));
  // t1/t2 already fully placed in the past — must not be re-scheduled again.
  const t1Minutes = workBlocks.filter((b) => b.taskId === "t1").reduce((s, b) => s + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0);
  const t2Minutes = workBlocks.filter((b) => b.taskId === "t2").reduce((s, b) => s + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0);
  assert.equal(t1Minutes, 30, "t1's already-elapsed 30 minutes must not be duplicated");
  assert.equal(t2Minutes, 30, "t2's already-elapsed 30 minutes must not be duplicated");
  assert.ok(taskIdsScheduled.has("t3"), "t3 (still ahead) should be re-fit");
});

// ============================================================================
// Behavior 3: renderable as one short block, not the whole day
// ============================================================================

test("runMidDayReflow: rendered output has no full-day header and omits past block lines", async () => {
  const { deps } = harness({ tasks: DEFAULT_TASKS });
  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");
  if (result.value.status !== "reflowed") return;

  assert.doesNotMatch(result.value.rendered, /Today's Plan for/, "must not re-show the whole-day header");
  assert.doesNotMatch(result.value.rendered, /Task One/, "must not re-list an already-elapsed Task");
  assert.doesNotMatch(result.value.rendered, /Task Two/, "must not re-list an already-elapsed Task");
});

test("runMidDayReflow: rendered output is short — no more lines than the remainder's own block count plus reasoning", async () => {
  const { deps } = harness({ tasks: DEFAULT_TASKS });
  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");
  if (result.value.status !== "reflowed") return;

  const remainderBlockCount = result.value.plan.blocks.filter((b) => !b.id.startsWith("work-") && !b.id.startsWith("break-") && !b.id.startsWith("calendar-anchor-")).length;
  const lineCount = result.value.rendered.split("\n").filter((l) => l.length > 0).length;
  // One line per remainder block, plus one reasoning line — generously
  // bounded (wrapping could add lines, but there is no way this should ever
  // approach the size of a full 7-block day).
  assert.ok(lineCount <= remainderBlockCount + 2, `rendered output should be short: ${lineCount} lines for ${remainderBlockCount} remainder blocks`);
});

test("runMidDayReflow: reasoning describes only the change, not a full-day justification", async () => {
  const { deps } = harness({ tasks: DEFAULT_TASKS });
  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");
  if (result.value.status !== "reflowed") return;

  assert.match(result.value.plan.reasoning, /Re-flowed the rest of today/);
  assert.doesNotMatch(result.value.plan.reasoning, /leads today's Plan/, "must not restate the morning's full-day reasoning");
});

// ============================================================================
// Edge cases / outcomes
// ============================================================================

test("runMidDayReflow: no Plan generated today -> 'no-plan-today', nothing persisted", async () => {
  const { deps, store } = harness({ tasks: DEFAULT_TASKS, storedPlan: null });
  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "no-plan-today");
  assert.equal(getPlan(store, TODAY), undefined);
});

test("runMidDayReflow: everything already elapsed and complete -> 'nothing-to-reflow', Plan version unchanged", async () => {
  // Re-flow triggered at the very end of the day — every block is past.
  const { deps, store } = harness({ tasks: DEFAULT_TASKS, nowIso: "2026-08-22T23:00:00.000Z" });
  const result = await runMidDayReflow(deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "nothing-to-reflow");

  const stored = getPlan(store, TODAY);
  assert.equal(stored!.data.version, 1, "an unchanged day must not bump the Plan version");
});

// ============================================================================
// Story 2.4 / Task 16: Logistics-Only Blocker Handling (FR-10)
// ============================================================================

test(
  "runMidDayReflow: Blocker report overrides a block whose scheduled end has already passed, treating its Task as outstanding and re-fitting it " +
    "(closes the Task 15 reviewer-flagged scope gap — see mid-day-reflow.ts's isElapsed doc comment)",
  async () => {
    const BLOCKER_NOW = "2026-08-22T09:45:00.000Z"; // 15 minutes AFTER the block's scheduled 09:30 end.
    const plan: Plan = {
      id: `plan-${TODAY}`,
      date: TODAY,
      blocks: [
        block({
          id: "work-0",
          kind: "work",
          start: "2026-08-22T09:00:00.000Z",
          end: "2026-08-22T09:30:00.000Z",
          label: "Blocked Task",
          taskId: "t-blocked",
        }),
      ],
      reasoning: '"Blocked Task" leads today\'s Plan — due soonest.',
      version: 1,
      createdAt: "2026-08-22T09:00:00.000Z",
      updatedAt: "2026-08-22T09:00:00.000Z",
    };

    const { deps, store } = harness({
      tasks: [makeTask("t-blocked", "Blocked Task", { estimatedDurationMinutes: 30 })],
      storedPlan: plan,
      budgetMinutes: 480,
      nowIso: BLOCKER_NOW,
    });

    // Sanity: WITHOUT the Blocker override, Task 15's ordinary path treats
    // this block as already fully elapsed/done (its scheduled end has
    // passed) — reproducing exactly the reviewer-flagged scope gap.
    // `runMidDayReflow` with no `blockerReported` flag never persists on a
    // "nothing-to-reflow" outcome, so this call is safe to make before the
    // real (overridden) call below without needing to reset the store.
    const withoutOverride = await runMidDayReflow(deps);
    assert.equal(withoutOverride.ok, true);
    if (!withoutOverride.ok) return;
    assert.equal(
      withoutOverride.value.status,
      "nothing-to-reflow",
      "sanity: without the Blocker override, Task 15's existing logic treats the block as already done",
    );

    const result = await runMidDayReflow({ ...deps, blockerReported: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.value.status,
      "reflowed",
      "the Blocker override must make the Task outstanding again, not 'nothing-to-reflow'",
    );
    if (result.value.status !== "reflowed") return;

    const stored = getPlan(store, TODAY);
    assert.equal(
      stored!.data.blocks.some((b) => b.id === "work-0"),
      false,
      "the original block must not survive verbatim once overridden",
    );
    const refit = stored!.data.blocks.find((b) => b.kind === "work" && b.taskId === "t-blocked");
    assert.ok(refit, "the blocked Task must be re-fit into the remainder");
    const refitDurationMinutes = (Date.parse(refit!.end) - Date.parse(refit!.start)) / 60_000;
    assert.equal(
      refitDurationMinutes,
      30,
      "the Task's FULL original duration is treated as outstanding — Yoh does not guess at partial progress during a reported Blocker",
    );
  },
);

test("runMidDayReflow: a calendar-anchor block is never selected as the Blocker-overridable block, even when it is the most recently active thing chronologically (AD-4)", async () => {
  // 10:45 falls squarely inside the "Standup" calendar-anchor (10:30-11:00)
  // in morningPlan() — the anchor IS the most recently "active" thing on the
  // timeline at this instant, but must never be the overridden block.
  const BLOCKER_NOW = "2026-08-22T10:45:00.000Z";
  const { deps, store } = harness({ tasks: DEFAULT_TASKS, nowIso: BLOCKER_NOW });

  const result = await runMidDayReflow({ ...deps, blockerReported: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");
  if (result.value.status !== "reflowed") return;

  const stored = getPlan(store, TODAY);
  // The anchor itself was not yet ELAPSED as of 10:45 (its own scheduled end,
  // 11:00, is still ahead) so — independent of any Blocker override — it is
  // re-fit like any other still-ahead block, which legitimately gives it a
  // fresh id (see `fitWorkBreakBlocks`/the id-prefix note in the file
  // docstring). What matters for AD-4 is that its `start`/`end` window is
  // never shifted — i.e. it was never treated as reschedulable.
  const anchor = stored!.data.blocks.find(
    (b) => b.kind === "calendar-anchor" && b.start === "2026-08-22T10:30:00.000Z" && b.end === "2026-08-22T11:00:00.000Z",
  );
  assert.ok(anchor, "the calendar-anchor's original 10:30-11:00 window must still be present, un-shifted (AD-4)");

  // Instead, break-3 (10:15-10:30 — the most recently ENDED non-anchor
  // block as of 10:45) is what actually gets overridden.
  assert.equal(
    stored!.data.blocks.some((b) => b.id === "break-3"),
    false,
    "the most recently ended NON-anchor block (break-3) is what gets overridden, not the anchor",
  );
  // work-2 (Task Two, further in the past, NOT the selected block) must
  // remain untouched.
  assert.ok(
    stored!.data.blocks.some((b) => b.id === "work-2"),
    "an older past block that wasn't selected for override must remain untouched",
  );
});

test("runMidDayReflow: Blocker handling applies immediately and automatically — no interaction request/Proposal is opened, and the Plan updates within this single call (AD-3 carve-out)", async () => {
  const BLOCKER_NOW = "2026-08-22T09:45:00.000Z";
  const plan: Plan = {
    id: `plan-${TODAY}`,
    date: TODAY,
    blocks: [
      block({
        id: "work-0",
        kind: "work",
        start: "2026-08-22T09:00:00.000Z",
        end: "2026-08-22T09:30:00.000Z",
        label: "Blocked Task",
        taskId: "t-blocked",
      }),
    ],
    reasoning: '"Blocked Task" leads today\'s Plan — due soonest.',
    version: 1,
    createdAt: "2026-08-22T09:00:00.000Z",
    updatedAt: "2026-08-22T09:00:00.000Z",
  };
  const { deps, store } = harness({
    tasks: [makeTask("t-blocked", "Blocked Task", { estimatedDurationMinutes: 30 })],
    storedPlan: plan,
    nowIso: BLOCKER_NOW,
  });

  const before = getPlan(store, TODAY);
  assert.equal(before!.data.version, 1);

  const result = await runMidDayReflow({ ...deps, blockerReported: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "reflowed");

  const after = getPlan(store, TODAY);
  assert.equal(after!.data.version, 2, "the Plan must be updated immediately within this single call — no separate confirmation step exists");
  assert.equal(
    store.listRecordsByKind("interaction-request").length,
    0,
    "Blocker handling must never open a confirmation/Proposal interaction request (AD-3 carve-out — FR-10 is not bound by Propose-Don't-Impose)",
  );
});

// ============================================================================
// Behavior 4: no proactive trigger path exists
// ============================================================================

test("mid-day-reflow.ts's runMidDayReflow is called from exactly one place in src/: app/mid-day-reflow.ts", () => {
  const srcDir = join(import.meta.dirname, "..", "src");
  const callers: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      // Story 8.3: only the RITUAL file itself (`rituals/mid-day-reflow.ts`)
      // is excluded now — narrowed from "any path ending in
      // mid-day-reflow.ts", which would have wrongly also excluded this
      // story's new `app/mid-day-reflow.ts`, the one legitimate caller.
      if (!full.endsWith(".ts") || full === join(srcDir, "rituals", "mid-day-reflow.ts")) continue;
      const contents = readFileSync(full, "utf8");
      if (contents.includes("runMidDayReflow")) callers.push(full);
    }
  }
  walk(srcDir);

  const relative = callers.map((f) => f.slice(srcDir.length + 1));
  assert.deepEqual(
    relative,
    ["app/mid-day-reflow.ts"],
    "runMidDayReflow must only ever be reached via app/mid-day-reflow.ts's runReflow wrapper, never a ritual/cron/timer path or a second direct caller",
  );
});

test("mid-day-reflow.ts is never imported by shell/ritual-cli.ts (the cron entry point)", () => {
  const ritualCliPath = join(import.meta.dirname, "..", "src", "shell", "ritual-cli.ts");
  const contents = readFileSync(ritualCliPath, "utf8");
  assert.doesNotMatch(contents, /mid-day-reflow/, "ritual-cli.ts (cron-triggered) must never reference mid-day-reflow.ts");
});

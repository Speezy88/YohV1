/**
 * Tests for `src/app/tasks-view.ts` (Task 6B, FR-43): the Tasks page's
 * list — every Task (completed included), grouped Overdue / Today / This
 * week / Later / No date by default, or by Area or Status, filtered by a
 * search query, each row carrying its missing fields. "Today" is
 * 2026-09-27 in America/Los_Angeles, while the UTC date is already the
 * 28th, so a UTC-based bucket would be caught.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { listTasks, type TasksViewDeps } from "../src/app/tasks-view.ts";
import { taskMissingFields } from "../src/core/planning-field-value.ts";
import type { Task, TaskFieldOptions } from "../src/types/domain.ts";

const NOW = new Date("2026-09-28T03:00:00.000Z"); // 8pm on the 27th in Los Angeles
const STAMP = "2026-09-01T00:00:00.000Z";

function task(id: string, fields: Partial<Task> = {}): Task {
  return { id, title: id, createdAt: STAMP, updatedAt: STAMP, ...fields };
}

const OPTIONS: TaskFieldOptions = {
  area: ["Bio", "Math"],
  energy: [
    { value: "high", label: "Deep" },
    { value: "low", label: "low" },
  ],
  status: [
    { value: "not-started", label: "Nothing" },
    { value: "in-progress", label: "In Progress" },
    { value: "completed", label: "Completed" },
  ],
};

const COMPLETE = { estimatedDurationMinutes: 30, area: "Bio", energy: "low", status: "not-started" } as const;

const TASKS: Task[] = [
  task("overdue", { ...COMPLETE, dueDate: "2026-09-25" }),
  task("done-late", { ...COMPLETE, dueDate: "2026-09-20", status: "completed" }),
  task("today-b", { ...COMPLETE, dueDate: "2026-09-27", title: "B today" }),
  task("today-done", { ...COMPLETE, dueDate: "2026-09-27", status: "completed", title: "A done today" }),
  task("week", { ...COMPLETE, dueDate: "2026-10-03", area: "Math" }),
  task("later", { ...COMPLETE, dueDate: "2026-10-04" }),
  task("nodate", { title: "College essay brainstorm", area: "Math" }),
];

const OPEN_COUNT = TASKS.filter((t) => t.status !== "completed").length;

function deps(overrides: Partial<TasksViewDeps> = {}): TasksViewDeps {
  return {
    readTasks: async () => TASKS,
    readFieldOptions: async () => OPTIONS,
    now: () => NOW,
    timeZone: "America/Los_Angeles",
    ...overrides,
  };
}

test("default grouping is Due: Overdue, Today, This week, Later, No date, with completed Tasks left out", async () => {
  const result = await listTasks(deps(), {});
  assert.ok(result.ok);
  assert.equal(result.value.today, "2026-09-27");
  assert.equal(result.value.groupBy, "due");
  assert.deepEqual(
    result.value.groups.map((g) => [g.key, g.label, g.tone, g.tasks.map((t) => t.id)]),
    [
      ["overdue", "Overdue", "danger", ["overdue"]],
      ["today", "Today", "accent", ["today-b"]],
      ["this-week", "This week", "neutral", ["week"]],
      ["later", "Later", "neutral", ["later"]],
      ["no-date", "No date", "neutral", ["nodate"]],
    ],
  );
});

test("completed Tasks are left out of every grouping, and total counts only the open ones", async () => {
  for (const groupBy of ["due", "area", "status", "priority"] as const) {
    const result = await listTasks(deps(), { groupBy });
    assert.ok(result.ok);
    const ids = result.value.groups.flatMap((g) => g.tasks.map((t) => t.id));
    assert.equal(result.value.total, OPEN_COUNT, groupBy);
    assert.equal(ids.length, OPEN_COUNT, groupBy);
    assert.equal(ids.includes("done-late") || ids.includes("today-done"), false, groupBy);
  }
});

test("empty groups are omitted", async () => {
  const result = await listTasks(deps({ readTasks: async () => [task("only", { dueDate: "2026-09-27" })] }), {});
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.groups.map((g) => g.key),
    ["today"],
  );
});

test("rows carry their missing planning fields and an overdue flag", async () => {
  const result = await listTasks(deps(), {});
  assert.ok(result.ok);
  const rows = result.value.groups.flatMap((g) => g.tasks);
  assert.deepEqual(rows.find((t) => t.id === "nodate")?.missing, ["estimatedDurationMinutes", "dueDate", "status", "energy"]);
  assert.deepEqual(rows.find((t) => t.id === "overdue")?.missing, []);
  assert.equal(rows.find((t) => t.id === "overdue")?.overdue, true);
});

test("groupBy area: one group per Area, alphabetical, 'No area' last", async () => {
  const result = await listTasks(deps({ readTasks: async () => [task("x", { area: "Math" }), task("y"), task("z", { area: "Bio" })] }), { groupBy: "area" });
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.groups.map((g) => [g.label, g.tasks.map((t) => t.id)]),
    [
      ["Bio", ["z"]],
      ["Math", ["x"]],
      ["No area", ["y"]],
    ],
  );
});

test("groupBy status: labelled with the live Notion option names, in working order", async () => {
  const result = await listTasks(
    deps({ readTasks: async () => [task("c", { status: "completed" }), task("n", { status: "not-started" }), task("p", { status: "in-progress" }), task("u")] }),
    { groupBy: "status" },
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.groups.map((g) => [g.label, g.tasks.map((t) => t.id)]),
    [
      ["Nothing", ["n"]],
      ["In Progress", ["p"]],
      ["No status", ["u"]],
    ],
  );
});

test("groupBy priority: ordered High -> Medium -> Low -> 'No priority', by the LIVE option's own order (Task 7), not a hardcoded enum", async () => {
  const result = await listTasks(
    deps({
      readTasks: async () => [
        task("low", { priority: "🟢 Low" }),
        task("none"),
        task("high", { priority: "🔴 High" }),
        task("medium", { priority: "🟡 Medium" }),
      ],
      readFieldOptions: async () => ({ ...OPTIONS, priority: ["🔴 High", "🟡 Medium", "🟢 Low"] }),
    }),
    { groupBy: "priority" },
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.groups.map((g) => [g.label, g.tasks.map((t) => t.id)]),
    [
      ["🔴 High", ["high"]],
      ["🟡 Medium", ["medium"]],
      ["🟢 Low", ["low"]],
      ["No priority", ["none"]],
    ],
  );
});

test("groupBy priority: the ordering follows the LIVE option list's index even when it disagrees with High/Medium/Low or alphabetical order", async () => {
  const result = await listTasks(
    deps({
      readTasks: async () => [
        task("low", { priority: "🟢 Low" }),
        task("high", { priority: "🔴 High" }),
        task("medium", { priority: "🟡 Medium" }),
      ],
      // Reversed live order — Low first, High last. If the code were
      // hardcoding High->Medium->Low (or sorting alphabetically) this
      // assertion would fail.
      readFieldOptions: async () => ({ ...OPTIONS, priority: ["🟢 Low", "🟡 Medium", "🔴 High"] }),
    }),
    { groupBy: "priority" },
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.groups.map((g) => g.label),
    ["🟢 Low", "🟡 Medium", "🔴 High"],
  );
});

test("Priority is never a missing planning field: a Task with no Priority still carries an empty `missing` list", async () => {
  const bare = task("bare", { ...COMPLETE, dueDate: "2026-09-27" });
  const result = await listTasks(deps({ readTasks: async () => [bare] }), {});
  assert.ok(result.ok);
  const item = result.value.groups[0]?.tasks[0];
  assert.ok(item);
  assert.equal(item.priority, undefined);
  assert.deepEqual(item.missing, []); // every OTHER planning field is present; priority is simply not part of this list at all
  assert.ok(!(item.missing as readonly string[]).includes("priority"));

  assert.deepEqual(taskMissingFields(bare), []);
});

test("query filters by title or Area, case-insensitively; total still counts every open Task", async () => {
  const byTitle = await listTasks(deps(), { query: "  COLLEGE " });
  assert.ok(byTitle.ok);
  assert.deepEqual(
    byTitle.value.groups.flatMap((g) => g.tasks.map((t) => t.id)),
    ["nodate"],
  );
  assert.equal(byTitle.value.total, OPEN_COUNT);
  assert.equal(byTitle.value.query, "COLLEGE");
  const byArea = await listTasks(deps(), { query: "math" });
  assert.ok(byArea.ok);
  assert.deepEqual(byArea.value.groups.flatMap((g) => g.tasks.map((t) => t.id)).sort(), ["nodate", "week"]);
});

test("the live options are passed through for the inline selects", async () => {
  const result = await listTasks(deps(), {});
  assert.ok(result.ok);
  assert.deepEqual(result.value.options, OPTIONS);
});

test("an options read failure still lists the Tasks, with fallback options built from what's known", async () => {
  const result = await listTasks(
    deps({
      readFieldOptions: async () => {
        throw new Error("boom");
      },
    }),
    {},
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value.options.area, ["Bio", "Math"]);
  assert.deepEqual(
    result.value.options.energy.map((o) => o.value),
    ["high", "medium", "low"],
  );
});


test("a Notion read failure is an honest, plain error naming Notion", async () => {
  const result = await listTasks(
    deps({
      readTasks: async () => {
        throw new Error("notion-adapter: socket hang up");
      },
    }),
    {},
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.equal(result.error.message, "I couldn't reach Notion right now; nothing was changed.");
});

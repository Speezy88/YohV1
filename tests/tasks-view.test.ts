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
import { countTasksMissingData, listTasks, type TasksViewDeps } from "../src/app/tasks-view.ts";
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

function deps(overrides: Partial<TasksViewDeps> = {}): TasksViewDeps {
  return {
    readTasks: async () => TASKS,
    readFieldOptions: async () => OPTIONS,
    now: () => NOW,
    timeZone: "America/Los_Angeles",
    ...overrides,
  };
}

test("default grouping is Due: Overdue, Today, This week, Later, No date, then completed past-due Tasks last", async () => {
  const result = await listTasks(deps(), {});
  assert.ok(result.ok);
  assert.equal(result.value.today, "2026-09-27");
  assert.equal(result.value.groupBy, "due");
  assert.deepEqual(
    result.value.groups.map((g) => [g.key, g.label, g.tone, g.tasks.map((t) => t.id)]),
    [
      ["overdue", "Overdue", "danger", ["overdue"]],
      ["today", "Today", "accent", ["today-b", "today-done"]],
      ["this-week", "This week", "neutral", ["week"]],
      ["later", "Later", "neutral", ["later"]],
      ["no-date", "No date", "neutral", ["nodate"]],
      ["done-earlier", "Done earlier", "neutral", ["done-late"]],
    ],
  );
});

test("every Task is listed, completed ones included (FR-43), and total counts them all", async () => {
  const result = await listTasks(deps(), {});
  assert.ok(result.ok);
  assert.equal(result.value.total, TASKS.length);
  assert.equal(
    result.value.groups.reduce((n, g) => n + g.tasks.length, 0),
    TASKS.length,
  );
});

test("empty groups are omitted", async () => {
  const result = await listTasks(deps({ readTasks: async () => [task("only", { dueDate: "2026-09-27" })] }), {});
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.groups.map((g) => g.key),
    ["today"],
  );
});

test("rows carry their missing planning fields (none for a completed Task) and an overdue flag", async () => {
  const result = await listTasks(deps(), {});
  assert.ok(result.ok);
  const rows = result.value.groups.flatMap((g) => g.tasks);
  assert.deepEqual(rows.find((t) => t.id === "nodate")?.missing, ["estimatedDurationMinutes", "dueDate", "status", "energy"]);
  assert.deepEqual(rows.find((t) => t.id === "overdue")?.missing, []);
  assert.equal(rows.find((t) => t.id === "overdue")?.overdue, true);
  assert.equal(rows.find((t) => t.id === "done-late")?.overdue, false);
  assert.deepEqual(rows.find((t) => t.id === "done-late")?.missing, []);
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
      ["Completed", ["c"]],
      ["No status", ["u"]],
    ],
  );
});

test("query filters by title or Area, case-insensitively; total still counts everything", async () => {
  const byTitle = await listTasks(deps(), { query: "  COLLEGE " });
  assert.ok(byTitle.ok);
  assert.deepEqual(
    byTitle.value.groups.flatMap((g) => g.tasks.map((t) => t.id)),
    ["nodate"],
  );
  assert.equal(byTitle.value.total, TASKS.length);
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

test("countTasksMissingData counts open Tasks with at least one missing planning field, excluding completed ones (real-use fixes plan, Task 2 chip)", async () => {
  const result = await countTasksMissingData({ readTasks: async () => TASKS }, {});
  assert.ok(result.ok);
  // Only "nodate" is both open and missing something — every other Task
  // above is either fully filled in (`COMPLETE`) or Completed (`done-late`,
  // `today-done`), which `taskMissingFields` always reports as [].
  assert.equal(result.value.count, 1);
});

test("countTasksMissingData never counts a Completed Task, even with undefined fields", async () => {
  const result = await countTasksMissingData({ readTasks: async () => [task("done-bare", { status: "completed" })] }, {});
  assert.ok(result.ok);
  assert.equal(result.value.count, 0);
});

test("countTasksMissingData is an honest, plain error naming Notion on a read failure", async () => {
  const result = await countTasksMissingData(
    {
      readTasks: async () => {
        throw new Error("notion-adapter: socket hang up");
      },
    },
    {},
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.equal(result.error.message, "I couldn't reach Notion right now; nothing was changed.");
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

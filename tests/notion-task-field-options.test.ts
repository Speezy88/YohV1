/**
 * Task 6B: `notion-adapter.ts`'s `readTaskFieldOptions` (the Tasks page's
 * live select options) and the read-side Status mapping it shares with
 * `readNotionTasks` — Spencer's live "Nothing" option reads back as
 * `"not-started"`, not as a missing Status.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readNotionTasks, readTaskFieldOptions } from "../src/adapters/notion-adapter.ts";
import { createFakeNotionTasksDb } from "./fakes/fake-notion-tasks-db.ts";

const CONFIG = { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds" };

test("readTaskFieldOptions lists the live Area options and maps live Energy/Status names onto Meeseek's enums", async () => {
  const db = createFakeNotionTasksDb();
  const options = await readTaskFieldOptions(db.client, CONFIG);
  assert.deepEqual(options.area, ["School", "Bio", "Math", "Errands", "Personal"]);
  assert.deepEqual(options.energy, [
    { value: "high", label: "Deep" },
    { value: "medium", label: "medium" },
    { value: "low", label: "low" },
  ]);
  assert.deepEqual(options.status, [
    { value: "not-started", label: "Nothing" },
    { value: "in-progress", label: "In Progress" },
    { value: "completed", label: "Completed" },
  ]);
  assert.deepEqual(options.priority, ["🔴 High", "🟡 Medium", "🟢 Low"]);
});

test("readTaskFieldOptions leaves out a live option that maps onto no known enum value", async () => {
  const db = createFakeNotionTasksDb({ statusOptions: ["Nothing", "Blocked", "Completed"], energyOptions: ["Deep", "Zen"] });
  const options = await readTaskFieldOptions(db.client, CONFIG);
  assert.deepEqual(
    options.status.map((o) => o.value),
    ["not-started", "completed"],
  );
  assert.deepEqual(
    options.energy.map((o) => o.value),
    ["high"],
  );
});

test("readNotionTasks reads Spencer's live 'Nothing' Status as not-started (it used to read as missing)", async () => {
  const db = createFakeNotionTasksDb({ seed: [{ id: "t1", title: "Calc set", status: "Nothing" }, { id: "t2", title: "Essay", status: "In Progress" }] });
  const { tasks } = await readNotionTasks(db.client, CONFIG);
  assert.equal(tasks.find((t) => t.id === "t1")?.status, "not-started");
  assert.equal(tasks.find((t) => t.id === "t2")?.status, "in-progress");
});

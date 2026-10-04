import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChangeSet, type ApplyChangeSetDeps } from "../src/app/apply-change-set.ts";
import type { ChangeSetItem, Result, YohError } from "../src/types/domain.ts";

const TZ = "America/New_York";
const ok = <T>(value: T): Result<T, YohError> => ({ ok: true, value });

function fakeDeps(overrides: Partial<ApplyChangeSetDeps> = {}) {
  const log: string[] = [];
  const deps: ApplyChangeSetDeps = {
    timeZone: TZ,
    now: () => new Date("2026-10-03T16:00:00.000Z"),
    applyCalendarEdit: async (p) => { log.push(`calendar:${p.suggested.kind}`); return ok({ eventId: "e", calendarId: "primary" }); },
    createPage: async (_db, props) => { log.push(`create:${props["title"]}`); return ok({ pageId: "p" }); },
    editTaskField: async (id, field) => { log.push(`field:${id}:${field}`); return ok({ receipt: "Due Date set to Mon, Oct 5." }); },
    renameTask: async (id, title) => { log.push(`rename:${id}:${title}`); return ok({ receipt: `Renamed to "${title}".` }); },
    completeTask: async (id) => { log.push(`complete:${id}`); return ok(undefined); },
    deleteTask: async (id) => { log.push(`delete:${id}`); return ok({ receipt: "It's in Notion's Trash if you want it back." }); },
    planDay: async () => { log.push("plan"); return ok({ reply: "2 Tasks scheduled across 5 blocks.", built: true }); },
    refitPlan: async () => { log.push("refit"); return ok({ reply: "Moved 2 blocks." }); },
    ...overrides,
  };
  return { deps, log };
}

const workout: ChangeSetItem = { kind: "create-event", title: "Workout", start: "2026-10-03T17:10:00.000Z", end: "2026-10-03T18:50:00.000Z" };
const dinner: ChangeSetItem = { kind: "create-event", title: "Dinner", start: "2026-10-03T22:00:00.000Z", end: "2026-10-03T23:00:00.000Z" };

test("a delete-task item goes through deleteTask and its receipt says where the Task went", async () => {
  const { deps, log } = fakeDeps();
  const result = await applyChangeSet(deps, { changeSet: { items: [{ kind: "delete-task", taskId: "t-uc", label: "UC Supplements" }] } });
  assert.equal(result.ok, true);
  assert.deepEqual(log, ["delete:t-uc"]);
  if (result.ok) assert.deepEqual(result.value.results.map((r) => [r.ok, r.text]), [[true, 'Deleted the Task "UC Supplements". It\'s in Notion\'s Trash if you want it back.']]);
});

test("a failed delete-task names Notion and changes nothing else", async () => {
  const { deps } = fakeDeps({ deleteTask: async () => ({ ok: false, error: { kind: "unreachable", message: "x" } }) });
  const result = await applyChangeSet(deps, { changeSet: { items: [{ kind: "delete-task", taskId: "t-uc", label: "UC Supplements" }] } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.results[0]!.ok, false);
    assert.match(result.value.results[0]!.text, /^Couldn't delete the Task "UC Supplements": .*Notion/);
  }
});

test("applies every item, with the Plan step last, and returns one receipt each", async () => {
  const { deps, log } = fakeDeps();
  const result = await applyChangeSet(deps, { changeSet: { items: [{ kind: "plan-day" }, workout, dinner] } });
  assert.equal(result.ok, true);
  assert.deepEqual(log, ["calendar:create", "calendar:create", "plan"]);
  if (result.ok) {
    assert.deepEqual(result.value.results.map((r) => r.ok), [true, true, true]);
    assert.equal(result.value.results[0]!.text, 'Added "Workout" on Sat, Oct 3, 1:10 PM–2:50 PM.');
    assert.equal(result.value.results[2]!.text, "Built today's Plan. 2 Tasks scheduled across 5 blocks.");
  }
});

test("a plan-day that built nothing is a failed item carrying its own message", async () => {
  const reply = "Nothing fit today's Time Budget — every Task got deferred.";
  const { deps } = fakeDeps({ planDay: async () => ok({ reply, built: false }) });
  const result = await applyChangeSet(deps, { changeSet: { items: [{ kind: "plan-day" }] } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.results[0]!.ok, false);
  assert.match(result.value.results[0]!.text, /Nothing fit today's Time Budget/);
  assert.doesNotMatch(result.value.results[0]!.text, /Built today's Plan/);
});

test("a failed item does not stop the rest, and reports plain copy", async () => {
  const { deps, log } = fakeDeps({
    applyCalendarEdit: async (p) =>
      p.suggested.kind === "move"
        ? { ok: false, error: { kind: "stale-proposal", message: "calendar-adapter: event changed" } }
        : ok({ eventId: "e", calendarId: "primary" }),
  });
  const move: ChangeSetItem = { kind: "move-event", eventId: "e1", label: "Dentist", etag: "v1", newStart: "2026-10-03T19:00:00.000Z", newEnd: "2026-10-03T20:00:00.000Z" };
  const result = await applyChangeSet(deps, { changeSet: { items: [move, workout, { kind: "complete-task", taskId: "t1", label: "Lab report" }] } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.results.map((r) => r.ok), [false, true, true]);
  assert.match(result.value.results[0]!.text, /^Couldn't move "Dentist"/);
  assert.doesNotMatch(result.value.results[0]!.text, /calendar-adapter/);
  assert.deepEqual(log, ["complete:t1"]); // the overridden applyCalendarEdit does not log
});

test("a thrown dependency becomes a failed item, not a thrown error", async () => {
  const { deps } = fakeDeps({ createPage: async () => { throw new Error("socket hang up"); } });
  const result = await applyChangeSet(deps, { changeSet: { items: [{ kind: "create-task", properties: { title: "Read ch. 4" } }] } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.results[0]!.ok, false);
    assert.doesNotMatch(result.value.results[0]!.text, /socket hang up/);
  }
});

test("move, resize and delete pass the staged etag as the proposal version", async () => {
  const versions: string[] = [];
  const { deps } = fakeDeps({ applyCalendarEdit: async (p) => { versions.push(`${p.suggested.kind}:${p.entityVersion}`); return ok({ eventId: "e", calendarId: "primary" }); } });
  await applyChangeSet(deps, {
    changeSet: {
      items: [
        { kind: "resize-event", eventId: "e1", label: "A", etag: "v1", newEnd: "2026-10-03T20:00:00.000Z" },
        { kind: "delete-event", eventId: "e2", label: "B", etag: "v2" },
      ],
    },
  });
  assert.deepEqual(versions, ["resize:v1", "delete:v2"]);
});

test("an empty change set is a validation error", async () => {
  const { deps } = fakeDeps();
  const result = await applyChangeSet(deps, { changeSet: { items: [] } });
  assert.equal(result.ok, false);
});

test("a malformed change set is rejected before any write", async () => {
  const bad: unknown[] = [
    [workout, { kind: "nope" }, { kind: "complete-task", taskId: "t1", label: "Lab" }],
    [workout, null, { kind: "complete-task", taskId: "t1", label: "Lab" }],
    [workout, { kind: "move-event", eventId: "e1", label: "Dentist", etag: "v1", newEnd: "2026-10-03T20:00:00.000Z" }],
  ];
  for (const items of bad) {
    const { deps, log } = fakeDeps();
    const result = await applyChangeSet(deps, { changeSet: { items: items as never } });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, "validation");
      assert.equal(result.error.message, "That change set is no longer valid, so nothing was changed. Ask again.");
    }
    assert.deepEqual(log, []);
  }
});

test("the refit receipt is past tense", async () => {
  const { deps } = fakeDeps();
  const result = await applyChangeSet(deps, { changeSet: { items: [{ kind: "refit-plan" }] } });
  assert.equal(result.ok && result.value.results[0]!.text, "Re-fitted the rest of today's Plan. Moved 2 blocks.");
});

test("block edits each re-fit with their own request, after other writes and before a whole-Plan step", async () => {
  const requests: unknown[] = [];
  const { deps, log } = fakeDeps({ refitPlan: async (request) => { requests.push(request); return ok({ reply: "Moved 1 block." }); } });
  const items: ChangeSetItem[] = [
    { kind: "refit-plan" },
    { kind: "move-block", subject: { kind: "task", taskId: "t1" }, label: "Draft", newStart: "2026-10-03T19:00:00.000Z" },
    { kind: "move-block", subject: { kind: "routine", routineId: "r1" }, label: "Commute", newStart: "2026-10-03T21:00:00.000Z" },
    { kind: "resize-block", taskId: "t1", label: "Draft", durationMinutes: 90 },
    { kind: "remove-block", taskId: "t2", label: "Stats" },
    workout,
  ];
  const result = await applyChangeSet(deps, { changeSet: { items } });
  assert.equal(result.ok, true);
  assert.deepEqual(log, ["calendar:create"]);
  assert.deepEqual(requests, [
    { kind: "pin-task", taskId: "t1", newStart: "2026-10-03T19:00:00.000Z" },
    { kind: "pin-routine", routineId: "r1", newStart: "2026-10-03T21:00:00.000Z" },
    { kind: "resize-task", taskId: "t1", durationMinutes: 90 },
    { kind: "drop-task", taskId: "t2" },
    undefined,
  ]);
  if (result.ok) {
    assert.deepEqual(result.value.results.map((r) => r.text).slice(1, 5), [
      'Moved "Draft" to 3:00 PM in today\'s Plan. Moved 1 block.',
      'Moved "Commute" to 5:00 PM in today\'s Plan. Moved 1 block.',
      'Gave "Draft" 90 min in today\'s Plan. Moved 1 block.',
      'Dropped "Stats" from today\'s Plan. Moved 1 block.',
    ]);
  }
});

test("a block edit that can't be honored fails on its own line and the rest still apply", async () => {
  const { deps } = fakeDeps({
    refitPlan: async (request) => (request?.kind === "resize-task" ? { ok: false, error: { kind: "validation", message: '"Draft" can\'t go there: it overlaps Dentist.' } } : ok({ reply: "Moved 1 block." })),
  });
  const items: ChangeSetItem[] = [
    { kind: "resize-block", taskId: "t1", label: "Draft", durationMinutes: 90 },
    { kind: "remove-block", taskId: "t2", label: "Stats" },
  ];
  const result = await applyChangeSet(deps, { changeSet: { items } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.results.map((r) => r.ok), [false, true]);
    assert.match(result.value.results[0]!.text, /^Couldn't give "Draft" 90 min in today's Plan: /);
  }
});

test("a malformed block edit invalidates the change set", async () => {
  const { deps, log } = fakeDeps();
  for (const bad of [
    { kind: "move-block", subject: { kind: "task" }, label: "Draft", newStart: "2026-10-03T19:00:00.000Z" },
    { kind: "resize-block", taskId: "t1", label: "Draft", durationMinutes: 0 },
    { kind: "remove-block", label: "Stats" },
  ]) {
    const result = await applyChangeSet(deps, { changeSet: { items: [bad as unknown as ChangeSetItem] } });
    assert.equal(result.ok, false);
  }
  assert.deepEqual(log, []);
});

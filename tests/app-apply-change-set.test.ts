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
    planDay: async () => { log.push("plan"); return ok({ reply: "2 Tasks scheduled across 5 blocks." }); },
    refitPlan: async () => { log.push("refit"); return ok({ reply: "Moved 2 blocks." }); },
    ...overrides,
  };
  return { deps, log };
}

const workout: ChangeSetItem = { kind: "create-event", title: "Workout", start: "2026-10-03T17:10:00.000Z", end: "2026-10-03T18:50:00.000Z" };
const dinner: ChangeSetItem = { kind: "create-event", title: "Dinner", start: "2026-10-03T22:00:00.000Z", end: "2026-10-03T23:00:00.000Z" };

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

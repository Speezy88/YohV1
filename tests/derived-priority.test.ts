/**
 * Tests for `src/core/derived-priority.ts` (Story 1.7 / Task 7, FR-2).
 *
 * Per AD-2/AD-8, this is a pure `core/*.ts` function: no I/O, no
 * module-level state, `Result<T, YohError>`, never throws. These tests
 * exercise it purely in-process with hand-built `CompleteTask` fixtures —
 * no `MemoryStore` or any adapter involved. `today` is always passed in
 * explicitly (AD-2 — never read from the system clock internally).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderByDerivedPriority,
  REFERENCE_MINUTES_PER_DAY,
  SECONDARY_FACTOR_WEIGHT,
} from "../src/core/derived-priority.ts";
import type { CompleteTask, Energy } from "../src/types/domain.ts";

const NOW = "2026-08-22T12:00:00.000Z";
const TODAY = "2026-08-22";

function makeCompleteTask(
  id: string,
  overrides: Partial<Omit<CompleteTask, "id" | "title" | "createdAt" | "updatedAt">> & { title?: string } = {},
): CompleteTask {
  return {
    id,
    title: overrides.title ?? `Task ${id}`,
    estimatedDurationMinutes: 60,
    area: "Work",
    dueDate: "2026-08-25",
    status: "not-started",
    energy: "medium" as Energy,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ============================================================================
// AC1: same Estimated Duration and Area, different Due Dates -> closer first
// ============================================================================

test("AC1: two CompleteTasks with identical duration and area order by closer Due Date first", () => {
  const closer = makeCompleteTask("closer", { dueDate: "2026-08-23", estimatedDurationMinutes: 60, area: "Work" });
  const farther = makeCompleteTask("farther", { dueDate: "2026-08-27", estimatedDurationMinutes: 60, area: "Work" });

  const result = orderByDerivedPriority([farther, closer], TODAY);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.map((t) => t.id),
    ["closer", "farther"],
  );
});

// ============================================================================
// AC2: closer Due Date + much larger Estimated Duration is NOT automatically
// ranked ahead of a smaller, later-due Task — duration weighs into the
// primary axis.
//
// Worked example (see derived-priority.ts's docstring for the formula):
//   primaryScore = daysUntilDue * REFERENCE_MINUTES_PER_DAY + estimatedDurationMinutes
//
//   Task A: due in 1 day, duration 600 min -> 1*480 + 600 = 1080
//   Task B: due in 2 days, duration 15 min -> 2*480 + 15  =  975
//
//   975 < 1080, so B (smaller, later-due) is ordered FIRST despite being
//   due later, because A's much larger duration outweighs its due-date
//   proximity advantage.
// ============================================================================

test("AC2: a closer-due Task with a much larger duration is not automatically ranked ahead of a smaller, later-due Task", () => {
  const closerButHuge = makeCompleteTask("closer-huge", {
    dueDate: "2026-08-23", // 1 day out from TODAY
    estimatedDurationMinutes: 600,
  });
  const laterButTiny = makeCompleteTask("later-tiny", {
    dueDate: "2026-08-24", // 2 days out from TODAY
    estimatedDurationMinutes: 15,
  });

  const result = orderByDerivedPriority([closerButHuge, laterButTiny], TODAY);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The smaller, later-due Task is ordered FIRST -- proof that duration
  // materially weighs into the primary axis rather than proximity alone
  // deciding the order.
  assert.deepEqual(
    result.value.map((t) => t.id),
    ["later-tiny", "closer-huge"],
  );
});

test("AC2 (sanity): with equal duration, naive due-date-only ordering would have ranked closer-huge first -- confirming the flip above is duration's doing, not a bug", () => {
  const closer = makeCompleteTask("closer-equal-dur", { dueDate: "2026-08-23", estimatedDurationMinutes: 60 });
  const later = makeCompleteTask("later-equal-dur", { dueDate: "2026-08-24", estimatedDurationMinutes: 60 });

  const result = orderByDerivedPriority([closer, later], TODAY);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.map((t) => t.id),
    ["closer-equal-dur", "later-equal-dur"],
  );
});

// ============================================================================
// AC3: two CompleteTasks tied on the primary axis -> Area/Energy-fit/
// difficulty (even-split weights) break the tie.
//
// Worked example:
//   Task A: due in 2 days, duration 100 min -> 2*480 + 100 = 1060
//   Task B: due in 1 day,  duration 580 min -> 1*480 + 580 = 1060  (tied!)
//
//   The difficulty sub-score is directionally consistent with the primary
//   axis (longer duration is a cost, never a bonus -- see
//   derived-priority.ts's docstring), so all three secondary factors favor
//   A here: area "Alpha" < "Zeta" alphabetically, energy "high" ranks above
//   "low", and A's shorter duration ranks as less "difficult" (a lower,
//   earlier-sorting cost) -- so A breaks the tie and is ordered first,
//   despite B being due one day sooner.
// ============================================================================

test("AC3: two CompleteTasks tied on the primary axis are ordered by the secondary (Area/Energy/difficulty) tie-break", () => {
  const taskA = makeCompleteTask("tie-a", {
    dueDate: "2026-08-24", // 2 days out
    estimatedDurationMinutes: 100,
    area: "Alpha",
    energy: "high",
  });
  const taskB = makeCompleteTask("tie-b", {
    dueDate: "2026-08-23", // 1 day out
    estimatedDurationMinutes: 580,
    area: "Zeta",
    energy: "low",
  });

  const result = orderByDerivedPriority([taskA, taskB], TODAY);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.map((t) => t.id),
    ["tie-a", "tie-b"],
  );
});

test("SECONDARY_FACTOR_WEIGHT is documented as an even split (1/3) across Area/Energy fit/difficulty", () => {
  assert.equal(SECONDARY_FACTOR_WEIGHT, 1 / 3);
});

test("REFERENCE_MINUTES_PER_DAY is exported for transparency/tuning", () => {
  assert.equal(typeof REFERENCE_MINUTES_PER_DAY, "number");
  assert.ok(REFERENCE_MINUTES_PER_DAY > 0);
});

// ============================================================================
// AC4: no manual-priority-setting path exists
// ============================================================================

test("AC4: the module's public surface exposes no manual-priority-setting function or parameter", async () => {
  const mod = await import("../src/core/derived-priority.ts");
  const exportedNames = Object.keys(mod).sort();

  // Every export is either the ordering function itself or a documented,
  // read-only tuning constant -- nothing that lets a caller directly set a
  // Task's position/priority.
  assert.deepEqual(exportedNames, ["REFERENCE_MINUTES_PER_DAY", "SECONDARY_FACTOR_WEIGHT", "orderByDerivedPriority"]);

  for (const name of exportedNames) {
    assert.doesNotMatch(name.toLowerCase(), /setpriority|manualpriority|overridepriority|setposition/);
  }

  // orderByDerivedPriority accepts (tasks, today, bumpLevels?) -- no
  // "priority" or "position" parameter slot exists to manually set.
  assert.equal(typeof mod.orderByDerivedPriority, "function");
  assert.equal(mod.orderByDerivedPriority.length, 3); // tasks, today, bumpLevels (optional params still count toward Function.length)
});

// ============================================================================
// Slip-Bump seam: an optional taskId -> bump level lookup, defaulting to
// "no bump" (Task 17/Story 2.5 will wire up real bump computation later).
// ============================================================================

test("bump seam: omitting bumpLevels entirely behaves identically to passing an empty map (no bump)", () => {
  const a = makeCompleteTask("bump-a", { dueDate: "2026-08-23", estimatedDurationMinutes: 60 });
  const b = makeCompleteTask("bump-b", { dueDate: "2026-08-24", estimatedDurationMinutes: 60 });

  const withoutArg = orderByDerivedPriority([a, b], TODAY);
  const withEmptyMap = orderByDerivedPriority([a, b], TODAY, {});

  assert.equal(withoutArg.ok, true);
  assert.equal(withEmptyMap.ok, true);
  if (!withoutArg.ok || !withEmptyMap.ok) return;
  assert.deepEqual(
    withoutArg.value.map((t) => t.id),
    withEmptyMap.value.map((t) => t.id),
  );
});

test("bump seam: a bumped Task can be pulled ahead of a Task it would otherwise lose to", () => {
  const closer = makeCompleteTask("no-bump", { dueDate: "2026-08-23", estimatedDurationMinutes: 60 }); // 1 day out
  const farther = makeCompleteTask("bumped", { dueDate: "2026-08-27", estimatedDurationMinutes: 60 }); // 5 days out

  const noBump = orderByDerivedPriority([closer, farther], TODAY);
  assert.equal(noBump.ok, true);
  if (!noBump.ok) return;
  assert.deepEqual(
    noBump.value.map((t) => t.id),
    ["no-bump", "bumped"],
  );

  // A large enough bump level on "bumped" pulls it ahead of "no-bump".
  const withBump = orderByDerivedPriority([closer, farther], TODAY, { bumped: 10 });
  assert.equal(withBump.ok, true);
  if (!withBump.ok) return;
  assert.deepEqual(
    withBump.value.map((t) => t.id),
    ["bumped", "no-bump"],
  );
});

// ============================================================================
// Validation / never-throws
// ============================================================================

test("rejects a malformed 'today' date", () => {
  const a = makeCompleteTask("a");
  const result = orderByDerivedPriority([a], "not-a-date");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("rejects a Task with a malformed dueDate", () => {
  const a = makeCompleteTask("a", { dueDate: "not-a-date" });
  const result = orderByDerivedPriority([a], TODAY);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("rejects two CompleteTasks sharing the same id", () => {
  const a = makeCompleteTask("dup");
  const b = makeCompleteTask("dup");
  const result = orderByDerivedPriority([a, b], TODAY);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("rejects a negative bump level", () => {
  const a = makeCompleteTask("a");
  const result = orderByDerivedPriority([a], TODAY, { a: -5 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("an empty candidate set produces an empty ordered result", () => {
  const result = orderByDerivedPriority([], TODAY);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, []);
});

test("never throws, even on wildly invalid input", () => {
  assert.doesNotThrow(() => {
    orderByDerivedPriority([makeCompleteTask("a", { dueDate: "" })], "");
  });
});

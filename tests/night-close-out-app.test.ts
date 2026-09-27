/**
 * Tests for `src/app/night-close-out.ts` (Story 8.7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getOpenInteractionRequest, putPlan } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { NIGHT_CLOSE_OUT_REQUEST_ID } from "../src/rituals/night-ritual.ts";
import { startNightCloseOut, type NightCloseOutDeps } from "../src/app/night-close-out.ts";
import type { Plan } from "../src/types/domain.ts";

const TODAY = "2026-09-26";

function planWithTasks(): Plan {
  return {
    id: `plan-${TODAY}`,
    date: TODAY,
    blocks: [
      { id: "work-0", kind: "work", start: `${TODAY}T13:00:00.000Z`, end: `${TODAY}T14:00:00.000Z`, label: "Draft the memo", taskId: "t1" },
      { id: "work-1", kind: "work", start: `${TODAY}T14:00:00.000Z`, end: `${TODAY}T14:30:00.000Z`, label: "Email the professor", taskId: "t2" },
    ],
    reasoning: "x",
    version: 1,
    createdAt: `${TODAY}T12:00:00.000Z`,
    updatedAt: `${TODAY}T12:00:00.000Z`,
  };
}

function tempDeps(overrides: Partial<NightCloseOutDeps> = {}): NightCloseOutDeps {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return {
    store: createMemoryStore(connection),
    now: () => new Date(`${TODAY}T22:00:00.000Z`),
    timeZone: "UTC",
    getCompletedTaskIdsToday: () => new Set(),
    session: { recentMessages: [], lastSearchAnswer: undefined },
    ...overrides,
  };
}

test("no Plan yet today: says so plainly, opens nothing", async () => {
  const deps = tempDeps();
  const result = await startNightCloseOut(deps, {});
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /No Plan/);
  assert.equal(result.value.question, undefined);
});

test("nothing to close out (every Task already completed today): says so, opens nothing", async () => {
  const deps = tempDeps({ getCompletedTaskIdsToday: () => new Set(["t1", "t2"]) });
  putPlan(deps.store, planWithTasks());
  const result = await startNightCloseOut(deps, {});
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.match(result.value.reply, /Nothing to close out/);
});

test("builds a fresh close-out request and returns its first question, excluding a Task completed today (FR-41)", async () => {
  const deps = tempDeps({ getCompletedTaskIdsToday: () => new Set(["t2"]) });
  putPlan(deps.store, planWithTasks());
  const result = await startNightCloseOut(deps, {});
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.value.question, "the first question is returned");
  assert.match(result.value.question!.text, /Draft the memo/);
  assert.doesNotMatch(result.value.question!.text, /Email the professor/, "a Task completed today is excluded");
});

test("reuses an already-open request for today instead of duplicating it", async () => {
  const deps = tempDeps();
  putPlan(deps.store, planWithTasks());
  const first = await startNightCloseOut(deps, {});
  assert.ok(first.ok && first.value.question);
  const before = getOpenInteractionRequest(deps.store, NIGHT_CLOSE_OUT_REQUEST_ID)!;

  const second = await startNightCloseOut(deps, {});
  assert.ok(second.ok);
  const after = getOpenInteractionRequest(deps.store, NIGHT_CLOSE_OUT_REQUEST_ID)!;
  assert.equal(after.version, before.version, "the same request is reused, not replaced");
});

// --- Review Focus #5: a thrown getCompletedTaskIdsToday must not crash the turn ---
test("a thrown getCompletedTaskIdsToday is caught — /night proceeds as if nothing was completed today, never blocking the close-out", async () => {
  const deps = tempDeps({
    getCompletedTaskIdsToday: () => {
      throw new Error("sqlite: database is locked");
    },
  });
  putPlan(deps.store, planWithTasks());
  const result = await startNightCloseOut(deps, {});
  assert.ok(result.ok, `expected success despite the thrown read, got ${JSON.stringify(result)}`);
  if (!result.ok) return;
  assert.ok(result.value.question, "both Tasks are named — neither was excluded, since the completed-today read failed closed (empty set)");
});

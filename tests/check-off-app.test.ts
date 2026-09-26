/**
 * Tests for `src/app/check-off.ts` (Story 7.10; AD-16, AD-20, AD-23,
 * Ruling R7). Real throwaway `:memory:` SQLite for every store; Notion is
 * `tests/fakes/fake-notion-status-client.ts` driven through the real
 * Status-only `setTaskStatus`; the Task lookup is an injected fake.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { getPendingCheckOff, initPlanStateStoreSchema, UNDO_WINDOW_MS } from "../src/adapters/plan-state-store.ts";
import { initNotificationStoreSchema, listUnreadNotifications, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { initCompletionLogSchema, listCompletedTaskIdsOnDate } from "../src/adapters/completion-log.ts";
import { createMemoryStore, putPlan } from "../src/adapters/memory-store.ts";
import type { LogEntry } from "../src/adapters/logger.ts";
import {
  CHECK_OFF_COMMIT_TICK_MS,
  CHECK_OFF_NOTION_RETRY_MS,
  checkOff,
  commitDueCheckOffs,
  holdCheckOff,
  releaseCheckOff,
  undoCheckOff,
  type CheckOffDeps,
} from "../src/app/check-off.ts";
import type { Task } from "../src/types/domain.ts";
import { createFakeNotionStatusClient } from "./fakes/fake-notion-status-client.ts";

const T0 = "2026-09-25T18:00:00.000Z";
const at = (ms: number): Date => new Date(Date.parse(T0) + ms);

interface CompletionRow {
  task_id: string;
  task_name: string;
  area: string | null;
  due_date: string | null;
  estimated_minutes: number | null;
  completed_at: string;
  source: string;
}

function setup(options: { lookupTask?: CheckOffDeps["lookupTask"] } = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initPlanStateStoreSchema(connection.db);
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  const store = createMemoryStore(connection);
  putPlan(store, {
    id: "plan-2026-09-25",
    date: "2026-09-25",
    blocks: [{ id: "b1", kind: "work", start: "2026-09-25T17:00:00.000Z", end: "2026-09-25T19:00:00.000Z", taskId: "t1", label: "Draft the memo" }],
    reasoning: "",
    version: 1,
    createdAt: T0,
    updatedAt: T0,
  });
  const notion = createFakeNotionStatusClient();
  const lookups: string[] = [];
  const logs: LogEntry[] = [];
  let clock = at(0);
  const deps: CheckOffDeps = {
    connection,
    store,
    timeZone: "UTC",
    notionClient: notion.client,
    notionStatusConfig: { tasksDataSourceId: "tasks-ds" },
    lookupTask:
      options.lookupTask ??
      (async (id: string): Promise<Task | undefined> => {
        lookups.push(id);
        return { id, title: "Draft the memo (live)", area: "Work", dueDate: "2026-09-26", estimatedDurationMinutes: 30, createdAt: T0, updatedAt: T0 };
      }),
    now: () => clock,
    log: (e) => logs.push(e),
  };
  return {
    connection,
    notion,
    lookups,
    logs,
    deps,
    setClock: (d: Date) => {
      clock = d;
    },
    completions: () => connection.db.prepare("SELECT * FROM completions ORDER BY id").all() as CompletionRow[],
  };
}

async function checkedOff(env: ReturnType<typeof setup>, taskId = "t1") {
  const result = await checkOff(env.deps, { taskId });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

// ---------------------------------------------------------------------------
// checkOff
// ---------------------------------------------------------------------------

test("constants: one commit tick (~1s) and a Notion retry backoff, both exported once", () => {
  assert.equal(CHECK_OFF_COMMIT_TICK_MS, 1000);
  assert.ok(CHECK_OFF_NOTION_RETRY_MS >= 10 * CHECK_OFF_COMMIT_TICK_MS, "retrying a down Notion every tick would hammer its rate limit");
});

test("checkOff records a pending completion: completedAt = the click instant, commitAt = + UNDO_WINDOW_MS, returned to the client", async () => {
  const env = setup();
  const value = await checkedOff(env);
  assert.equal(value.taskId, "t1");
  assert.equal(value.commitAt, at(UNDO_WINDOW_MS).toISOString());
  assert.equal(value.asOf, T0);
  assert.equal(value.held, false);
  const pending = getPendingCheckOff(env.connection, value.id);
  assert.equal(pending?.completedAt, T0);
  assert.equal(pending?.taskName, "Draft the memo", "named from today's Plan row, with no Notion round trip");
  assert.equal(env.lookups.length, 0, "the click path never waits on Notion (NFR-Latency)");
  assert.equal(env.completions().length, 0, "nothing reaches the Completion Log inside the undo window");
  assert.equal(env.notion.attempts(), 0, "nothing reaches Notion inside the undo window");
  env.connection.close();
});

test("checkOff rejects a missing taskId as a validation error", async () => {
  const env = setup();
  const result = await checkOff(env.deps, { taskId: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "validation");
  env.connection.close();
});

test("checkOff on a Task that already has an undoable pending record returns that record instead of a second one", async () => {
  const env = setup();
  const first = await checkedOff(env);
  env.setClock(at(1_000));
  const second = await checkedOff(env);
  assert.equal(second.id, first.id);
  assert.equal(second.commitAt, first.commitAt);
  env.connection.close();
});

test("checkOff falls back to the Task id as its name when the Task isn't on today's Plan (never blocks)", async () => {
  const env = setup();
  const value = await checkedOff(env, "t-unplanned");
  assert.equal(getPendingCheckOff(env.connection, value.id)?.taskName, "t-unplanned");
  env.connection.close();
});

test("several check-offs in quick succession each get their own pending record and commit independently", async () => {
  const env = setup();
  const a = await checkedOff(env, "t1");
  env.setClock(at(500));
  const b = await checkedOff(env, "t2");
  assert.notEqual(a.id, b.id);

  env.setClock(at(UNDO_WINDOW_MS)); // a is due, b (0.5s later) is not
  await commitDueCheckOffs(env.deps, {});
  assert.deepEqual(env.completions().map((c) => c.task_id), ["t1"]);
  env.setClock(at(UNDO_WINDOW_MS + 500));
  await commitDueCheckOffs(env.deps, {});
  assert.deepEqual(env.completions().map((c) => c.task_id), ["t1", "t2"]);
  env.connection.close();
});

// ---------------------------------------------------------------------------
// undo / hold / release
// ---------------------------------------------------------------------------

test("undoCheckOff before commit deletes the pending record; nothing reaches the Completion Log or Notion, ever", async () => {
  const env = setup();
  const value = await checkedOff(env);
  env.setClock(at(2_000));
  const result = await undoCheckOff(env.deps, { id: value.id });
  assert.deepEqual(result, { ok: true, value: { id: value.id } });
  assert.equal(getPendingCheckOff(env.connection, value.id), undefined);

  env.setClock(at(60_000));
  await commitDueCheckOffs(env.deps, {});
  assert.equal(env.completions().length, 0);
  assert.equal(env.notion.attempts(), 0);
  env.connection.close();
});

test("undoCheckOff after commit is a conflict; the log entry stands (Notion synced or still owed)", async () => {
  const env = setup();
  const synced = await checkedOff(env, "t1");
  env.setClock(at(UNDO_WINDOW_MS));
  await commitDueCheckOffs(env.deps, {});
  const owed = await checkedOff(env, "t2");
  env.notion.setFailing(true);
  env.setClock(at(2 * UNDO_WINDOW_MS));
  await commitDueCheckOffs(env.deps, {});

  for (const id of [synced.id, owed.id]) {
    const result = await undoCheckOff(env.deps, { id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "conflict");
  }
  assert.equal(env.completions().length, 2);
  env.connection.close();
});

test("undoCheckOff of an unknown id is a conflict (no longer pending), and changes nothing", async () => {
  const env = setup();
  const result = await undoCheckOff(env.deps, { id: "nope" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "conflict");
  env.connection.close();
});

test("hold pauses the window (never commits while held); release resumes it with exactly the time it had left", async () => {
  const env = setup();
  const value = await checkedOff(env); // commitAt T0+5s
  env.setClock(at(2_000));
  const held = await holdCheckOff(env.deps, { id: value.id });
  assert.equal(held.ok && held.value.held, true);

  env.setClock(at(30_000));
  await commitDueCheckOffs(env.deps, {});
  assert.equal(env.completions().length, 0, "a held record never commits");

  const released = await releaseCheckOff(env.deps, { id: value.id });
  assert.equal(released.ok, true);
  if (!released.ok) return;
  assert.equal(released.value.held, false);
  assert.equal(released.value.commitAt, at(33_000).toISOString(), "3s were left at the hold; 3s are left after release");
  assert.equal(released.value.asOf, at(30_000).toISOString());

  env.setClock(at(33_000));
  await commitDueCheckOffs(env.deps, {});
  assert.equal(env.completions().length, 1);
  env.connection.close();
});

test("hold/release of a record that is no longer pending is a conflict", async () => {
  const env = setup();
  const value = await checkedOff(env);
  env.setClock(at(UNDO_WINDOW_MS));
  await commitDueCheckOffs(env.deps, {});
  const held = await holdCheckOff(env.deps, { id: value.id });
  assert.equal(held.ok, false);
  const released = await releaseCheckOff(env.deps, { id: "nope" });
  assert.equal(released.ok, false);
  env.connection.close();
});

// ---------------------------------------------------------------------------
// commitDueCheckOffs
// ---------------------------------------------------------------------------

test("commit order is fixed: recordCompletion (source 'check-off') is durable BEFORE setTaskStatus(completed) is attempted", async () => {
  const env = setup();
  await checkedOff(env);
  let logHadEntryAtNotionWrite: boolean | undefined;
  env.notion.onBeforeUpdate((taskId) => {
    logHadEntryAtNotionWrite = listCompletedTaskIdsOnDate(env.connection, "2026-09-25", "UTC").has(taskId);
  });
  env.setClock(at(UNDO_WINDOW_MS));
  const result = await commitDueCheckOffs(env.deps, {});
  assert.deepEqual(result, { ok: true, value: { committed: 1, notionSynced: 1, notionFailed: 0 } });
  assert.equal(logHadEntryAtNotionWrite, true);
  assert.deepEqual(env.notion.writes, [{ taskId: "t1", status: "Completed" }], "a Status-only write of the live 'Completed' option");
  env.connection.close();
});

test("the log entry snapshots area/dueDate/estimatedMinutes from the live Task lookup (Ruling R7), with completedAt = the click instant", async () => {
  const env = setup();
  const value = await checkedOff(env);
  env.setClock(at(UNDO_WINDOW_MS + 700));
  await commitDueCheckOffs(env.deps, {});
  assert.deepEqual(env.completions(), [
    {
      ...env.completions()[0]!,
      task_id: "t1",
      task_name: "Draft the memo (live)",
      area: "Work",
      due_date: "2026-09-26",
      estimated_minutes: 30,
      completed_at: T0,
      source: "check-off",
    },
  ]);
  assert.equal(getPendingCheckOff(env.connection, value.id), undefined, "fully in sync — nothing left pending");
  env.connection.close();
});

test("a Task lookup failure never blocks the commit: nulls for the three fields, the Plan label as the name, and a logged error", async () => {
  const env = setup({
    lookupTask: async () => {
      throw new Error("notion read down");
    },
  });
  await checkedOff(env);
  env.setClock(at(UNDO_WINDOW_MS));
  await commitDueCheckOffs(env.deps, {});
  const [row] = env.completions();
  assert.equal(row?.task_name, "Draft the memo");
  assert.equal(row?.area, null);
  assert.equal(row?.due_date, null);
  assert.equal(row?.estimated_minutes, null);
  assert.ok(env.logs.some((e) => e.event === "check-off.lookup-failed" && e.level === "error"));
  env.connection.close();
});

test("a commit appends one 'plan' outbox hint (Home re-fetches and shows the Task done)", async () => {
  const env = setup();
  await checkedOff(env);
  assert.equal(tailOutboxSince(env.connection, 0).length, 0, "a pending check-off changes nothing Home's server view shows");
  env.setClock(at(UNDO_WINDOW_MS));
  await commitDueCheckOffs(env.deps, {});
  assert.deepEqual(
    tailOutboxSince(env.connection, 0).map((h) => ({ topic: h.topic, entityId: h.entityId })),
    [{ topic: "plan", entityId: "t1" }],
  );
  env.connection.close();
});

test("a Notion failure keeps the log entry, marks the sync pending, and raises exactly one operational notification", async () => {
  const env = setup();
  const value = await checkedOff(env);
  env.notion.setFailing(true);
  env.setClock(at(UNDO_WINDOW_MS));
  const result = await commitDueCheckOffs(env.deps, {});
  assert.deepEqual(result, { ok: true, value: { committed: 1, notionSynced: 0, notionFailed: 1 } });

  assert.equal(env.completions().length, 1, "the log is never rolled back");
  const pending = getPendingCheckOff(env.connection, value.id);
  assert.equal(pending?.notionSyncPending, true);
  const [notification, ...rest] = listUnreadNotifications(env.connection);
  assert.equal(rest.length, 0);
  assert.equal(notification?.kind, "operational");
  assert.equal(notification?.body, "Couldn't update Notion for Draft the memo (live) — retrying");
  assert.equal(notification?.deepLink, null);
  assert.ok(env.logs.some((e) => e.event === "check-off.notion-sync-failed" && e.level === "error"));

  // Later sweeps before the retry time don't touch Notion; a failed retry adds no second notification and never re-runs recordCompletion.
  env.setClock(at(UNDO_WINDOW_MS + 1_000));
  await commitDueCheckOffs(env.deps, {});
  assert.equal(env.notion.attempts(), 1);
  env.setClock(at(UNDO_WINDOW_MS + CHECK_OFF_NOTION_RETRY_MS));
  await commitDueCheckOffs(env.deps, {});
  assert.equal(env.notion.attempts(), 2);
  assert.equal(listUnreadNotifications(env.connection).length, 1);
  assert.equal(env.completions().length, 1);
  env.connection.close();
});

test("the retry sweep writes Notion once it recovers, without re-running recordCompletion, then forgets the record", async () => {
  const env = setup();
  const value = await checkedOff(env);
  env.notion.setFailing(true);
  env.setClock(at(UNDO_WINDOW_MS));
  await commitDueCheckOffs(env.deps, {});

  env.notion.setFailing(false);
  env.setClock(at(UNDO_WINDOW_MS + CHECK_OFF_NOTION_RETRY_MS));
  const result = await commitDueCheckOffs(env.deps, {});
  assert.deepEqual(result, { ok: true, value: { committed: 0, notionSynced: 1, notionFailed: 0 } });
  assert.deepEqual(env.notion.writes, [{ taskId: "t1", status: "Completed" }]);
  assert.equal(env.completions().length, 1);
  assert.equal(getPendingCheckOff(env.connection, value.id), undefined);
  env.connection.close();
});

test("the startup sweep commits a record left overdue by a previous process (the tab is long gone)", async () => {
  const env = setup();
  await checkedOff(env);
  // A fresh process an hour later: same database, nothing else in memory.
  env.setClock(at(3_600_000));
  const result = await commitDueCheckOffs(env.deps, {});
  assert.equal(result.ok && result.value.committed, 1);
  assert.equal(env.completions()[0]?.completed_at, T0, "completedAt stays the click instant, never the commit time");
  env.connection.close();
});

test("two overlapping sweeps never double-record a completion", async () => {
  const env = setup();
  await checkedOff(env);
  env.setClock(at(UNDO_WINDOW_MS));
  await Promise.all([commitDueCheckOffs(env.deps, {}), commitDueCheckOffs(env.deps, {})]);
  assert.equal(env.completions().length, 1);
  assert.equal(env.notion.writes.length, 1);
  env.connection.close();
});

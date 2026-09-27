/**
 * Tests for `src/app/why-prioritized.ts` (Story 8.3).
 *
 * Moved+adapted from `tests/chat-cli.test.ts`'s why-prioritized `runChatCli`
 * integration tests, now calling `explainPriority` directly, plus a new
 * test pinning the compelled `readTasks` failure -> clean `Result` path
 * (Review Focus #3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, recordSlip, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { explainPriority } from "../src/app/why-prioritized.ts";
import type { Task } from "../src/types/domain.ts";

const NOW = "2026-08-22T12:00:00.000Z";

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

function makeTask(id: string, title: string): Task {
  return {
    id,
    title,
    createdAt: NOW,
    updatedAt: NOW,
    estimatedDurationMinutes: 30,
    area: "Work",
    dueDate: "2026-08-23",
    status: "not-started",
    energy: "medium",
  } as Task;
}

test("explainPriority shows a Task's Slip-Bump lineage — consecutive-slip count and current bump level (UX-DR19)", async () => {
  const store = tempStore();
  recordSlip(store, "t1", "2026-08-20");
  recordSlip(store, "t1", "2026-08-21");
  const tasks: Task[] = [makeTask("t1", "Draft the memo")];

  const result = await explainPriority({ store, readTasks: async () => tasks }, { taskName: "Draft the memo" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.match(result.value.reply, /2/);
  assert.match(result.value.reply, /2026-08-21/);
  assert.doesNotMatch(result.value.reply, /\bcap\b/i);
  store.close();
});

test("explainPriority reports a Task at the Slip-Bump cap distinctly", async () => {
  const store = tempStore();
  recordSlip(store, "t1", "2026-08-19");
  recordSlip(store, "t1", "2026-08-20");
  recordSlip(store, "t1", "2026-08-21");
  recordSlip(store, "t1", "2026-08-22"); // 4th consecutive slip -- still pinned at the cap of 3.
  const tasks: Task[] = [makeTask("t1", "Draft the memo")];

  const result = await explainPriority({ store, readTasks: async () => tasks }, { taskName: "Draft the memo" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /\bcap\b/i);
  store.close();
});

test("explainPriority for a Task with no slip history says plainly that no Slip-Bump applies", async () => {
  const store = tempStore();
  const tasks: Task[] = [makeTask("t1", "Draft the memo")];
  const result = await explainPriority({ store, readTasks: async () => tasks }, { taskName: "Draft the memo" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.match(result.value.reply, /hasn'?t slipped|no slip-bump|never slipped/i);
  store.close();
});

test("explainPriority for an unknown Task name says it couldn't find that Task", async () => {
  const store = tempStore();
  const tasks: Task[] = [makeTask("t1", "Draft the memo")];
  const result = await explainPriority({ store, readTasks: async () => tasks }, { taskName: "Some Other Task" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /couldn'?t find/i);
  store.close();
});

// Review Focus #3 (compelled fix): today's chat-cli.ts (pre-Epic-8) called
// `readTasks()` with NO try/catch on this path — a real Notion failure would
// throw out of runChatCli's whole loop. app/*.ts must catch adapter throws
// (AD-8) and convert them to Result.
test("explainPriority returns a clean Result, never a rejection, when readTasks throws", async () => {
  const store = tempStore();
  const result = await explainPriority(
    {
      store,
      readTasks: async () => {
        throw new Error("notion down");
      },
    },
    { taskName: "Draft the memo" },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.match(result.error.message, /notion down/);
  store.close();
});

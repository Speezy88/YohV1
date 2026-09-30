/**
 * Tests for `src/adapters/completion-log.ts` (Story 7.9, AD-10/AD-23).
 *
 * Controller ruling R7 (see the per-story plan's "Open questions for
 * controller" section): `RecordCompletionInput` keeps all seven AD-23 keys
 * REQUIRED — `area`/`dueDate`/`estimatedMinutes` are `string | null` /
 * `IsoDate | null` / `number | null`, never optional keys. Every call site
 * must state what it snapshotted (`null` when a field is genuinely absent),
 * rather than silently omitting it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import {
  initCompletionLogSchema,
  listCompletedTaskIdsOnDate,
  recordCompletion,
  recordCompletionInTx,
  recordSlipEventInTx,
  listSlipEvents,
  listPlannedCheckOffs,
  type RecordCompletionInput,
} from "../src/adapters/completion-log.ts";

function tempStore() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initCompletionLogSchema(connection.db);
  return connection;
}

test("initCompletionLogSchema is idempotent", () => {
  const connection = tempStore();
  initCompletionLogSchema(connection.db);
  connection.close();
});

test("recordCompletion snapshots every provided field, with source distinguishing check-off from close-out", () => {
  const connection = tempStore();
  recordCompletion(connection, {
    taskId: "t1",
    taskName: "Draft the memo",
    area: "Work",
    dueDate: "2026-09-25",
    estimatedMinutes: 30,
    completedAt: "2026-09-25T18:00:00.000Z",
    source: "check-off",
  });

  const row = connection.db.prepare("SELECT * FROM completions").get() as Record<string, unknown>;
  assert.equal(row["task_id"], "t1");
  assert.equal(row["task_name"], "Draft the memo");
  assert.equal(row["area"], "Work");
  assert.equal(row["due_date"], "2026-09-25");
  assert.equal(row["estimated_minutes"], 30);
  assert.equal(row["source"], "check-off");
  connection.close();
});

test("recordCompletion records null for area/dueDate/estimatedMinutes when the caller explicitly states they weren't snapshotted (R7: fields are required-but-nullable, never silently omitted)", () => {
  const connection = tempStore();
  recordCompletion(connection, {
    taskId: "t2",
    taskName: "Call the dentist",
    area: null,
    dueDate: null,
    estimatedMinutes: null,
    completedAt: "2026-09-25T23:00:00.000Z",
    source: "close-out",
  });
  const row = connection.db.prepare("SELECT * FROM completions").get() as Record<string, unknown>;
  assert.equal(row["area"], null);
  assert.equal(row["due_date"], null);
  assert.equal(row["estimated_minutes"], null);
  connection.close();
});

test("R7: RecordCompletionInput requires area/dueDate/estimatedMinutes to be stated (null or a value) — a call site cannot silently omit them", () => {
  const connection = tempStore();
  // @ts-expect-error area/dueDate/estimatedMinutes are required keys under R7 — omitting them entirely must not type-check.
  const bogus: RecordCompletionInput = {
    taskId: "t3",
    taskName: "Missing fields",
    completedAt: "2026-09-25T23:00:00.000Z",
    source: "close-out",
  };
  assert.ok(bogus);
  connection.close();
});

test("the entry survives independently of Notion — completion-log.ts never imports a Notion adapter/SDK or a Notion client type (deviation from the per-story plan's own doesNotMatch(/notion/i) test, which would also fail against the plan's own sample implementation since its docstring prose itself says 'Notion' — see task-9-report.md)", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "adapters", "completion-log.ts"), "utf8");
  assert.doesNotMatch(source, /from\s+["'].*notion/i, "no import path may reference a Notion adapter or SDK");
  assert.doesNotMatch(source, /@notionhq/i, "no direct dependency on the Notion SDK");
});

test("listCompletedTaskIdsOnDate finds a Task completed earlier the same local day", () => {
  const connection = tempStore();
  const timeZone = "America/New_York"; // UTC-4 in September (EDT)
  recordCompletion(connection, {
    taskId: "t1",
    taskName: "Draft the memo",
    area: null,
    dueDate: null,
    estimatedMinutes: null,
    completedAt: "2026-09-25T14:00:00.000Z", // 10:00 EDT on 2026-09-25
    source: "check-off",
  });

  const completedToday = listCompletedTaskIdsOnDate(connection, "2026-09-25", timeZone);
  assert.ok(completedToday.has("t1"));
  connection.close();
});

test("listCompletedTaskIdsOnDate excludes a completion whose LOCAL date differs from the query date, even if the UTC date matches", () => {
  const connection = tempStore();
  const timeZone = "America/New_York";
  recordCompletion(connection, {
    taskId: "t1",
    taskName: "Late-night Task",
    area: null,
    dueDate: null,
    estimatedMinutes: null,
    completedAt: "2026-09-26T02:00:00.000Z", // 22:00 EDT on 2026-09-25 — UTC date is the 26th, local date is the 25th
    source: "close-out",
  });

  assert.ok(listCompletedTaskIdsOnDate(connection, "2026-09-25", timeZone).has("t1"), "the LOCAL date (25th) must match, not the UTC date (26th)");
  assert.ok(!listCompletedTaskIdsOnDate(connection, "2026-09-26", timeZone).has("t1"));
  connection.close();
});

test("only completion-log.ts inserts into the completions table (AD-23: no other function writes completions)", () => {
  const srcDir = join(import.meta.dirname, "..", "src");
  const offenders: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts") || full.endsWith("completion-log.ts")) continue;
      const contents = readFileSync(full, "utf8");
      if (/INSERT INTO completions/i.test(contents)) offenders.push(full);
    }
  }
  walk(srcDir);
  assert.deepEqual(offenders, []);
});

test("CompletionSource union is closed to 'check-off' | 'close-out'", () => {
  const bogus: RecordCompletionInput = {
    taskId: "t",
    taskName: "n",
    area: null,
    dueDate: null,
    estimatedMinutes: null,
    completedAt: "2026-01-01T00:00:00.000Z",
    // @ts-expect-error "manual" is not a member of the closed CompletionSource union (AD-23)
    source: "manual",
  };
  assert.ok(bogus);
});

test("recordCompletionInTx inserts within a caller-provided transaction (cross-owner writeTx usage)", () => {
  const connection = tempStore();
  connection.writeTx((db) => {
    recordCompletionInTx(db, {
      taskId: "t9",
      taskName: "Cross-owner write",
      area: "Health",
      dueDate: "2026-09-30",
      estimatedMinutes: 15,
      completedAt: "2026-09-25T12:00:00.000Z",
      source: "check-off",
    });
  });
  const row = connection.db.prepare("SELECT * FROM completions WHERE task_id = 't9'").get() as Record<string, unknown>;
  assert.equal(row["task_name"], "Cross-owner write");
  connection.close();
});

test("Story 13.2: initCompletionLogSchema adds nullable planned_start/planned_end to an old table, idempotently, without touching existing rows", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  connection.db.exec(`
    CREATE TABLE completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, task_name TEXT NOT NULL, area TEXT,
      due_date TEXT, estimated_minutes INTEGER, completed_at TEXT NOT NULL, source TEXT NOT NULL
    );
    INSERT INTO completions (task_id, task_name, completed_at, source) VALUES ('old', 'Old one', '2026-09-01T10:00:00.000Z', 'check-off');
  `);
  initCompletionLogSchema(connection.db);
  initCompletionLogSchema(connection.db);
  const cols = (connection.db.prepare("PRAGMA table_info(completions)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("planned_start") && cols.includes("planned_end"));
  const row = connection.db.prepare("SELECT * FROM completions").get() as Record<string, unknown>;
  assert.equal(row["task_id"], "old");
  assert.equal(row["planned_start"], null);
  assert.equal(row["planned_end"], null);
  connection.close();
});

test("Story 13.2: recordCompletion stores planned times when given, null when omitted", () => {
  const connection = tempStore();
  const base = { taskName: "n", area: null, dueDate: null, estimatedMinutes: null, completedAt: "2026-09-25T18:00:00.000Z", source: "check-off" } as const;
  recordCompletion(connection, { ...base, taskId: "a", plannedStart: "2026-09-25T09:00:00.000Z", plannedEnd: "2026-09-25T10:00:00.000Z" });
  recordCompletion(connection, { ...base, taskId: "b" });
  const rows = connection.db.prepare("SELECT task_id, planned_start, planned_end FROM completions ORDER BY id").all() as Record<string, unknown>[];
  assert.deepEqual(rows[0], { task_id: "a", planned_start: "2026-09-25T09:00:00.000Z", planned_end: "2026-09-25T10:00:00.000Z" });
  assert.deepEqual(rows[1], { task_id: "b", planned_start: null, planned_end: null });
  connection.close();
});

test("Story 13.2: recordSlipEventInTx appends {taskId, area, date} once per task and date", () => {
  const connection = tempStore();
  connection.writeTx((db) => {
    recordSlipEventInTx(db, { taskId: "t1", area: "Work", date: "2026-09-25" });
    recordSlipEventInTx(db, { taskId: "t1", area: "Work", date: "2026-09-25" });
    recordSlipEventInTx(db, { taskId: "t1", area: null, date: "2026-09-26" });
  });
  assert.deepEqual(listSlipEvents(connection), [
    { taskId: "t1", area: "Work", date: "2026-09-25" },
    { taskId: "t1", area: null, date: "2026-09-26" },
  ]);
  connection.close();
});

test("listPlannedCheckOffs returns only check-offs with a planned window, since the given instant", () => {
  const connection = tempStore();
  const base = { taskName: "T", area: "History", dueDate: null, estimatedMinutes: 60 } as const;
  recordCompletion(connection, { ...base, taskId: "a", completedAt: "2026-09-20T15:00:00.000Z", source: "check-off", plannedStart: "2026-09-20T13:00:00.000Z", plannedEnd: "2026-09-20T14:00:00.000Z" });
  recordCompletion(connection, { ...base, taskId: "b", completedAt: "2026-09-20T15:00:00.000Z", source: "close-out", plannedStart: "2026-09-20T13:00:00.000Z", plannedEnd: "2026-09-20T14:00:00.000Z" });
  recordCompletion(connection, { ...base, taskId: "c", completedAt: "2026-09-20T15:00:00.000Z", source: "check-off" });
  recordCompletion(connection, { ...base, taskId: "d", completedAt: "2026-07-01T15:00:00.000Z", source: "check-off", plannedStart: "2026-07-01T13:00:00.000Z", plannedEnd: "2026-07-01T14:00:00.000Z" });
  assert.deepEqual(listPlannedCheckOffs(connection, "2026-09-01T00:00:00.000Z"), [
    { taskId: "a", area: "History", plannedEnd: "2026-09-20T14:00:00.000Z", completedAt: "2026-09-20T15:00:00.000Z" },
  ]);
  connection.close();
});

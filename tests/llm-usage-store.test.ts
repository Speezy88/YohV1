/**
 * Tests for `src/adapters/llm-usage-store.ts` (real-use fixes plan, Task 9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initLlmUsageStoreSchema, listLlmUsage, recordLlmUsage, type LlmUsageRecord } from "../src/adapters/llm-usage-store.ts";

function freshConnection() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initLlmUsageStoreSchema(connection.db);
  return connection;
}

test("initLlmUsageStoreSchema is idempotent — calling it twice never throws", () => {
  const connection = freshConnection();
  assert.doesNotThrow(() => initLlmUsageStoreSchema(connection.db));
  connection.close();
});

test("recordLlmUsage + listLlmUsage round-trips every field exactly", () => {
  const connection = freshConnection();
  const record: LlmUsageRecord = {
    at: "2026-09-27T12:00:00.000Z",
    model: "claude-haiku-4-5-20251001",
    purpose: "answer",
    inputTokens: 120,
    outputTokens: 40,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 90,
  };
  recordLlmUsage(connection, record);
  const rows = listLlmUsage(connection);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], record);
  connection.close();
});

test("listLlmUsage returns rows in insertion (oldest-first) order", () => {
  const connection = freshConnection();
  const base = { model: "claude-haiku-4-5-20251001", inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } as const;
  recordLlmUsage(connection, { ...base, at: "2026-09-27T09:00:00.000Z", purpose: "classify" });
  recordLlmUsage(connection, { ...base, at: "2026-09-27T10:00:00.000Z", purpose: "answer" });
  recordLlmUsage(connection, { ...base, at: "2026-09-27T11:00:00.000Z", purpose: "capture" });
  const rows = listLlmUsage(connection);
  assert.deepEqual(rows.map((r) => r.purpose), ["classify", "answer", "capture"]);
  connection.close();
});

test("recordLlmUsage accepts every LlmUsagePurpose value", () => {
  const connection = freshConnection();
  const purposes = ["classify", "capture", "answer", "draft-notion", "draft-calendar", "suggest-field"] as const;
  for (const purpose of purposes) {
    recordLlmUsage(connection, {
      at: "2026-09-27T00:00:00.000Z",
      model: "claude-sonnet-5",
      purpose,
      inputTokens: 1,
      outputTokens: 1,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  }
  const rows = listLlmUsage(connection);
  assert.deepEqual(
    rows.map((r) => r.purpose),
    purposes,
  );
  connection.close();
});

test("recordLlmUsage throws on a genuine SQLite failure (e.g. a closed connection) — callers are expected to catch this", () => {
  const connection = freshConnection();
  connection.close();
  assert.throws(() =>
    recordLlmUsage(connection, {
      at: "2026-09-27T00:00:00.000Z",
      model: "claude-sonnet-5",
      purpose: "answer",
      inputTokens: 1,
      outputTokens: 1,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }),
  );
});

test("listLlmUsage returns an empty array for a fresh store with no recorded rows", () => {
  const connection = freshConnection();
  assert.deepEqual(listLlmUsage(connection), []);
  connection.close();
});

/** Tests for `src/adapters/rating-store.ts` (Story 13.11). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRatingStore, initRatingStoreSchema } from "../src/adapters/rating-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";

function setup() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initRatingStoreSchema(connection.db);
  return createRatingStore(connection);
}
const at = "2026-09-30T14:00:00.000Z";
const day = { today: "2026-09-30", at };

test("openPrompt counts prompts per day and clears extraPromptDue on the second", () => {
  const s = setup();
  s.openPrompt({ promptId: "a", ...day });
  assert.deepEqual([s.getState().openPromptId, s.getState().promptsShownOnLastDate], ["a", 1]);
  assert.deepEqual(s.answer({ promptId: "a", score: 1, ...day }), { ok: true });
  assert.equal(s.getState().extraPromptDue, true);
  assert.equal(s.getState().openPromptId, undefined);
  s.openPrompt({ promptId: "b", ...day });
  assert.deepEqual([s.getState().promptsShownOnLastDate, s.getState().extraPromptDue], [2, false]);
  s.answer({ promptId: "b", score: 3, ...day });
  s.openPrompt({ promptId: "c", today: "2026-10-01", at });
  assert.equal(s.getState().promptsShownOnLastDate, 1);
});

test("answer resets consecutive dismissals; repeats are refused; a 1 accepts one note afterwards", () => {
  const s = setup();
  s.openPrompt({ promptId: "a", ...day });
  s.dismissOpen(day);
  assert.equal(s.getState().consecutiveDismissals, 1);
  s.openPrompt({ promptId: "b", today: "2026-10-01", at });
  assert.deepEqual(s.answer({ promptId: "nope", score: 2, ...day }), { ok: false, reason: "unknown-prompt" });
  s.answer({ promptId: "b", score: 1, today: "2026-10-01", at });
  assert.equal(s.getState().consecutiveDismissals, 0);
  assert.deepEqual(s.answer({ promptId: "b", score: 1, note: "too wordy", today: "2026-10-01", at }), { ok: true });
  assert.deepEqual(s.answer({ promptId: "b", score: 1, note: "again", today: "2026-10-01", at }), { ok: false, reason: "already-answered" });
  assert.deepEqual(s.answer({ promptId: "b", score: 2, today: "2026-10-01", at }), { ok: false, reason: "already-answered" });
  assert.deepEqual(s.dismiss({ promptId: "b", today: "2026-10-01", at }), { ok: false, reason: "already-answered" });
});

test("three dismissals in a row pause for a week and reset the counter", () => {
  const s = setup();
  for (const [i, d] of ["2026-09-28", "2026-09-29", "2026-09-30"].entries()) {
    s.openPrompt({ promptId: `p${i}`, today: d, at });
    assert.deepEqual(s.dismiss({ promptId: `p${i}`, today: d, at }), { ok: true });
  }
  assert.deepEqual([s.getState().pausedUntil, s.getState().consecutiveDismissals], ["2026-10-07", 0]);
  assert.equal(s.dismissOpen(day), false);
  s.clearAll();
  assert.equal(s.getState().pausedUntil, undefined);
});

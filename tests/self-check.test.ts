/**
 * Tests for `src/rituals/self-check.ts` (Story 4.3 / Task 24, FR-17, AD-6).
 *
 * The one-shot, OS-cron-triggered `self-check` half (`runSelfCheckRitual`,
 * AD-5) is tested separately from the pure interval-computation helpers
 * (`computeSelfCheckIntervalDays`/`scheduleNextSelfCheck`/`isSelfCheckDueNow`)
 * and the answer-processing half `chat-cli.ts` calls
 * (`applySelfCheckAnswer`). No network, no real clock, no real randomness:
 * every I/O edge and the RNG are injected, `now` is always pinned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryStore, getOpenInteractionRequest, getSelfCheckState, putSelfCheckState, type MemoryStore } from "../src/adapters/memory-store.ts";
import { computeEscalation } from "../src/core/escalate-under-strain.ts";
import {
  applySelfCheckAnswer,
  computeSelfCheckIntervalDays,
  isSelfCheckDueNow,
  isValidSelfCheckScore,
  runSelfCheckRitual,
  scheduleNextSelfCheck,
  SELF_CHECK_CURVE,
  SELF_CHECK_DEFAULT_INTERVAL_DAYS,
  SELF_CHECK_LOW_SCORE_THRESHOLD,
  SELF_CHECK_REQUEST_ID,
  type SelfCheckRitualDeps,
} from "../src/rituals/self-check.ts";
import type { SelfCheckRequestDetail } from "../src/rituals/self-check.ts";

const NOW_ISO = "2026-08-22T15:00:00.000Z"; // 15:00 UTC
const TODAY = "2026-08-22";

function tempStore(): MemoryStore {
  return createMemoryStore({ databasePath: ":memory:" });
}

function fixedRandom(value: number): () => number {
  return () => value;
}

function deps(store: MemoryStore, overrides: Partial<SelfCheckRitualDeps> = {}): SelfCheckRitualDeps {
  return {
    store,
    now: () => new Date(NOW_ISO),
    timeZone: "UTC",
    random: fixedRandom(0.5),
    ...overrides,
  };
}

// ============================================================================
// 1. Cold start — no prior check-in exists
// ============================================================================

test("cold start: no SelfCheckState exists yet -> initializes a schedule and is a no-op for today (no request opened)", async () => {
  const store = tempStore();
  const result = await runSelfCheckRitual(deps(store));

  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.status, "initialized");

  // No interaction request was opened on the very first day.
  assert.equal(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), undefined);

  // A schedule now exists, due some days in the future — not today.
  const state = getSelfCheckState(store);
  assert.ok(state, "expected a schedule to have been initialized");
  assert.ok(state.data.nextDueDate > TODAY, "the first-ever due date must be in the future, not today");
  assert.equal(state.data.lastCheckInDate, undefined, "cold start writes no fake 'already checked in' history");
});

// ============================================================================
// 2. Today isn't due -> genuine no-op
// ============================================================================

test("today isn't due yet: no-op — no interaction request, and no store write at all", async () => {
  const store = tempStore();
  const initial = putSelfCheckState(store, { nextDueDate: "2026-08-26", nextDueMinuteOfDay: 600 });

  const result = await runSelfCheckRitual(deps(store));
  assert.ok(result.ok);
  assert.equal(result.value.status, "not-due");

  assert.equal(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), undefined, "no request should be opened");

  const stateAfter = getSelfCheckState(store);
  assert.equal(stateAfter?.version, initial.version, "no marker/write of any kind — the stored schedule must be untouched");
});

// ============================================================================
// 3. Today IS due -> interaction request persisted, ritual exits without waiting
// ============================================================================

test("today is due: persists an open interaction request naming both required fields, and never reads stdin", async () => {
  const store = tempStore();
  putSelfCheckState(store, { nextDueDate: TODAY, nextDueMinuteOfDay: 0 }); // due any time today

  const result = await runSelfCheckRitual(deps(store));
  assert.ok(result.ok);
  assert.equal(result.value.status, "prompted");

  const request = getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID);
  assert.ok(request, "expected an open self-check interaction request");
  assert.equal(request.data.requestKind, "self-check");
  assert.match(request.data.promptText, /number/i);
  assert.match(request.data.promptText, /reason/i);

  const detail = request.data.detail as SelfCheckRequestDetail;
  assert.equal(detail.date, TODAY);
});

test("today is due, but the randomized target time hasn't arrived yet -> not due", async () => {
  const store = tempStore();
  putSelfCheckState(store, { nextDueDate: TODAY, nextDueMinuteOfDay: 20 * 60 }); // 20:00 local

  // now is 15:00 UTC/local — before the randomized 20:00 target.
  const result = await runSelfCheckRitual(deps(store));
  assert.ok(result.ok);
  assert.equal(result.value.status, "not-due");
  assert.equal(getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID), undefined);
});

test("a second trigger the same day, after the request is already open, does not duplicate it", async () => {
  const store = tempStore();
  putSelfCheckState(store, { nextDueDate: TODAY, nextDueMinuteOfDay: 0 });

  const first = await runSelfCheckRitual(deps(store));
  assert.ok(first.ok);
  assert.equal(first.value.status, "prompted");
  const firstRequest = getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID);

  const second = await runSelfCheckRitual(deps(store));
  assert.ok(second.ok);
  assert.equal(second.value.status, "already-open");

  const secondRequest = getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID);
  assert.deepEqual(secondRequest, firstRequest, "the request must not be re-persisted/replaced");
});

test("AD-5: self-check.ts never waits for input — it reads no stdin at all", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "rituals", "self-check.ts"), "utf8");
  assert.doesNotMatch(source, /node:readline/, "a one-shot cron entry point must not open a readline interface");
  assert.doesNotMatch(source, /process\.stdin/, "a one-shot cron entry point must not read stdin");
});

// ============================================================================
// 4. isValidSelfCheckScore
// ============================================================================

test("isValidSelfCheckScore: accepts whole numbers 1-10, rejects everything else", () => {
  for (const score of [1, 2, 5, 10]) {
    assert.equal(isValidSelfCheckScore(score), true, `${score} should be valid`);
  }
  for (const score of [0, -1, 11, 3.5, NaN, Infinity]) {
    assert.equal(isValidSelfCheckScore(score), false, `${score} should be invalid`);
  }
});

// ============================================================================
// 5. A low score genuinely shortens the NEXT interval, via the REAL
//    computeEscalation call and this file's own curve — worked example.
// ============================================================================

test("SELF_CHECK_CURVE: a single low score reaches this curve's cap immediately (AD-6, not a trend)", () => {
  // Worked arithmetic for this file's own curve, via the REAL shared
  // computeEscalation — not a parallel/hand-rolled calculation.
  const notLow = computeEscalation(0, SELF_CHECK_CURVE);
  const low = computeEscalation(1, SELF_CHECK_CURVE);

  assert.deepEqual(notLow, { value: 0, atCap: false });
  assert.deepEqual(low, { value: SELF_CHECK_CURVE.cap, atCap: true });
});

test("computeSelfCheckIntervalDays: a score below the threshold shortens the interval below the default ~4 days", () => {
  assert.ok(SELF_CHECK_LOW_SCORE_THRESHOLD > 1, "sanity: there must be at least one score value that counts as low");

  const lowScore = SELF_CHECK_LOW_SCORE_THRESHOLD - 1;
  const interval = computeSelfCheckIntervalDays(lowScore);

  assert.ok(interval < SELF_CHECK_DEFAULT_INTERVAL_DAYS, `expected a shortened interval for a low score of ${lowScore}, got ${interval}`);

  // Worked numeric example, spelled out so a future tuning change is forced
  // to consciously re-examine this test rather than silently drift: default
  // 4 days, curve cap 2 -> a single low score shortens the interval to 4-2=2.
  const level = computeEscalation(1, SELF_CHECK_CURVE);
  assert.equal(interval, SELF_CHECK_DEFAULT_INTERVAL_DAYS - level.value);
  assert.equal(interval, 2, "concrete worked number for this file's chosen curve/default");
});

test("scheduleNextSelfCheck: a low score schedules the next due date genuinely closer than the default interval would", () => {
  const defaultSchedule = scheduleNextSelfCheck({ today: TODAY, score: 9, random: fixedRandom(0) });
  const lowScoreSchedule = scheduleNextSelfCheck({ today: TODAY, score: 1, random: fixedRandom(0) });

  assert.equal(defaultSchedule.nextDueDate, "2026-08-26", "default ~4-day interval");
  assert.equal(lowScoreSchedule.nextDueDate, "2026-08-24", "shortened interval: 4 - 2 = 2 days");
  assert.ok(lowScoreSchedule.nextDueDate < defaultSchedule.nextDueDate);
});

// ============================================================================
// 6. A normal/high score computes the standard ~4-day interval
// ============================================================================

test("computeSelfCheckIntervalDays: a score at/above the threshold computes the standard default interval", () => {
  for (const score of [SELF_CHECK_LOW_SCORE_THRESHOLD, SELF_CHECK_LOW_SCORE_THRESHOLD + 1, 7, 10]) {
    assert.equal(computeSelfCheckIntervalDays(score), SELF_CHECK_DEFAULT_INTERVAL_DAYS, `score ${score} should not shorten the interval`);
  }
});

test("computeSelfCheckIntervalDays: no score yet (cold start) computes the standard default interval", () => {
  assert.equal(computeSelfCheckIntervalDays(undefined), SELF_CHECK_DEFAULT_INTERVAL_DAYS);
});

// ============================================================================
// isSelfCheckDueNow — the pure due-check the ritual itself is built on
// ============================================================================

test("isSelfCheckDueNow: undefined state (cold start) is never due", () => {
  assert.equal(isSelfCheckDueNow(undefined, TODAY, 0), false);
});

test("isSelfCheckDueNow: a future due date is not due", () => {
  assert.equal(isSelfCheckDueNow({ nextDueDate: "2026-08-26", nextDueMinuteOfDay: 0 }, TODAY, 1439), false);
});

test("isSelfCheckDueNow: today's due date, before the randomized target time, is not due yet", () => {
  assert.equal(isSelfCheckDueNow({ nextDueDate: TODAY, nextDueMinuteOfDay: 600 }, TODAY, 599), false);
});

test("isSelfCheckDueNow: today's due date, at/after the randomized target time, is due", () => {
  assert.equal(isSelfCheckDueNow({ nextDueDate: TODAY, nextDueMinuteOfDay: 600 }, TODAY, 600), true);
  assert.equal(isSelfCheckDueNow({ nextDueDate: TODAY, nextDueMinuteOfDay: 600 }, TODAY, 900), true);
});

test("isSelfCheckDueNow: an overdue due date (a missed run) is due regardless of time-of-day", () => {
  assert.equal(isSelfCheckDueNow({ nextDueDate: "2026-08-18", nextDueMinuteOfDay: 1439 }, TODAY, 0), true);
});

// ============================================================================
// applySelfCheckAnswer — the answer-processing half chat-cli.ts calls
// ============================================================================

test("applySelfCheckAnswer: persists the score/reason and computes the next schedule via the REAL curve", () => {
  const store = tempStore();
  const result = applySelfCheckAnswer(store, { today: TODAY, score: 2, reason: "felt behind all week", random: fixedRandom(0) });

  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert.equal(result.value.data.lastCheckInDate, TODAY);
  assert.equal(result.value.data.lastScore, 2);
  assert.equal(result.value.data.lastReason, "felt behind all week");
  assert.equal(result.value.data.nextDueDate, "2026-08-24", "a low score (2) shortens the interval to 2 days");

  const stored = getSelfCheckState(store);
  assert.equal(stored?.data.lastScore, 2);
});

test("applySelfCheckAnswer: a normal score schedules the standard ~4-day interval", () => {
  const store = tempStore();
  const result = applySelfCheckAnswer(store, { today: TODAY, score: 8, reason: "going well", random: fixedRandom(0) });
  assert.ok(result.ok);
  assert.equal(result.value.data.nextDueDate, "2026-08-26");
});

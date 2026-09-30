/** Tests for `src/core/rating-schedule.ts` (Story 13.11). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideRatingPrompt,
  pausedUntilAfterDismissals,
  RATING_PROMPT_PROBABILITY,
  type RatingState,
} from "../src/core/rating-schedule.ts";

const fresh: RatingState = { promptsShownOnLastDate: 0, consecutiveDismissals: 0, extraPromptDue: false };
const ctx = { substantive: true, today: "2026-09-30", draw: 0 };

test("prompts on a substantive turn when the draw is under the probability", () => {
  assert.equal(decideRatingPrompt(fresh, ctx), true);
  assert.equal(decideRatingPrompt(fresh, { ...ctx, draw: RATING_PROMPT_PROBABILITY }), false);
  assert.equal(decideRatingPrompt(fresh, { ...ctx, substantive: false }), false);
});

test("one prompt a day, plus one extra only when extraPromptDue", () => {
  const shown: RatingState = { ...fresh, lastPromptDate: "2026-09-30", promptsShownOnLastDate: 1 };
  assert.equal(decideRatingPrompt(shown, ctx), false);
  assert.equal(decideRatingPrompt({ ...shown, extraPromptDue: true }, ctx), true);
  assert.equal(decideRatingPrompt({ ...shown, promptsShownOnLastDate: 2, extraPromptDue: true }, ctx), false);
  assert.equal(decideRatingPrompt(shown, { ...ctx, today: "2026-10-01" }), true);
});

test("no prompt while one is open or while paused", () => {
  assert.equal(decideRatingPrompt({ ...fresh, openPromptId: "p" }, ctx), false);
  assert.equal(decideRatingPrompt({ ...fresh, pausedUntil: "2026-10-07" }, ctx), false);
  assert.equal(decideRatingPrompt({ ...fresh, pausedUntil: "2026-09-30" }, ctx), true);
});

test("pause is seven days out", () => {
  assert.equal(pausedUntilAfterDismissals("2026-09-28"), "2026-10-05");
});

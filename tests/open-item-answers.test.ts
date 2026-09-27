/**
 * Tests for `src/core/open-item-answers.ts` (Story 8.1) — moved verbatim
 * from `tests/chat-cli.test.ts` (`parseNightCloseOutAnswer`/`isSkipAnswer`/
 * `parseSelfCheckAnswer`/`parseProposalAnswer`), same behavior.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSkipAnswer, parseNightCloseOutAnswer, parseProposalAnswer, parseSelfCheckAnswer } from "../src/core/open-item-answers.ts";

test("parseNightCloseOutAnswer recognizes completed/slipped synonyms, rejects anything else", () => {
  assert.equal(parseNightCloseOutAnswer("completed"), "completed");
  assert.equal(parseNightCloseOutAnswer("complete"), "completed");
  assert.equal(parseNightCloseOutAnswer("Done"), "completed");
  assert.equal(parseNightCloseOutAnswer("finished"), "completed");
  assert.equal(parseNightCloseOutAnswer("slipped"), "slipped");
  assert.equal(parseNightCloseOutAnswer("missed"), "slipped");
  assert.equal(parseNightCloseOutAnswer("didn't finish"), "slipped");
  assert.equal(parseNightCloseOutAnswer("didn't do it"), "slipped");
  assert.equal(parseNightCloseOutAnswer("not done"), "slipped");
  assert.equal(parseNightCloseOutAnswer("huh?"), undefined);
  assert.equal(parseNightCloseOutAnswer(""), undefined);
});

test("isSkipAnswer recognizes only the literal 'skip' (case-insensitive)", () => {
  assert.equal(isSkipAnswer("skip"), true);
  assert.equal(isSkipAnswer("SKIP"), true);
  assert.equal(isSkipAnswer("  skip  "), true);
  assert.equal(isSkipAnswer("skip it"), false);
  assert.equal(isSkipAnswer("completed"), false);
});

test("parseSelfCheckAnswer: accepts a valid score + reason, rejects a bare number", () => {
  assert.deepEqual(parseSelfCheckAnswer("7 feeling good"), { score: 7, reason: "feeling good" });
  assert.deepEqual(parseSelfCheckAnswer("10 everything is on track"), { score: 10, reason: "everything is on track" });
  assert.equal(parseSelfCheckAnswer("7"), undefined);
  assert.equal(parseSelfCheckAnswer("7 "), undefined);
  assert.equal(parseSelfCheckAnswer("not a number at all"), undefined);
  assert.equal(parseSelfCheckAnswer("11 out of range"), undefined);
  assert.equal(parseSelfCheckAnswer("0 out of range"), undefined);
});

test("parseProposalAnswer recognizes common yes/no variants and rejects anything else", () => {
  for (const yes of ["y", "yes", "yeah", "yep", "confirm", "apply", "YES"]) {
    assert.equal(parseProposalAnswer(yes), true, `expected "${yes}" to parse as yes`);
  }
  for (const no of ["n", "no", "nope", "dismiss", "decline", "NO"]) {
    assert.equal(parseProposalAnswer(no), false, `expected "${no}" to parse as no`);
  }
  for (const unclear of ["banana", "maybe", ""]) {
    assert.equal(parseProposalAnswer(unclear), undefined, `expected "${unclear}" to be unrecognized`);
  }
});

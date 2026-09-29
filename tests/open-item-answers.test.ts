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

test("Task 6 addendum: parseNightCloseOutAnswer tolerates natural free-text phrasing, same two statuses", () => {
  assert.equal(parseNightCloseOutAnswer("I finished it"), "completed");
  assert.equal(parseNightCloseOutAnswer("done!"), "completed");
  assert.equal(parseNightCloseOutAnswer("yes done"), "completed");
  assert.equal(parseNightCloseOutAnswer("didn't get to it"), "slipped");
  assert.equal(parseNightCloseOutAnswer("nope"), "slipped");
});

// I3 (final-review): a bare "not"/"missed" ANYWHERE in the reply used to
// read as slipped, even when it wasn't attached to the completion word —
// so "done, not bad" wrote Status = Slipped to real Notion. Negation now
// only counts when it attaches to the completion word, or the reply is
// only a slip word.
test("I3 (final-review): an unattached 'not'/'missed' next to a completion word still reads as completed", () => {
  assert.equal(parseNightCloseOutAnswer("done, not bad"), "completed");
  assert.equal(parseNightCloseOutAnswer("finished it, not too hard"), "completed");
  assert.equal(parseNightCloseOutAnswer("completed, missed the bonus question though"), "completed");
});

test("I3 (final-review): attached negation and stands-alone slip words still read as slipped", () => {
  assert.equal(parseNightCloseOutAnswer("not done"), "slipped");
  assert.equal(parseNightCloseOutAnswer("not finished"), "slipped");
  assert.equal(parseNightCloseOutAnswer("didn't finish"), "slipped");
  assert.equal(parseNightCloseOutAnswer("didn't do it"), "slipped");
  assert.equal(parseNightCloseOutAnswer("missed"), "slipped");
  assert.equal(parseNightCloseOutAnswer("nope"), "slipped");
  assert.equal(parseNightCloseOutAnswer("no"), "slipped");
  assert.equal(parseNightCloseOutAnswer("slipped"), "slipped");
});

// Task 9: a completion word followed by a partial clause ("but not",
// "except", "apart from", "other than", "besides") is slipped — the Task
// stays open — distinct from I3's "done, not bad"/"completed, missed the
// bonus question though", which have no such connector and stay completed.
test("Task 9: a completion word followed by a partial clause reads as slipped", () => {
  assert.equal(parseNightCloseOutAnswer("done but not the reading"), "slipped");
  assert.equal(parseNightCloseOutAnswer("done except the reading"), "slipped");
  assert.equal(parseNightCloseOutAnswer("finished apart from problem 3"), "slipped");
  assert.equal(parseNightCloseOutAnswer("completed other than the last question"), "slipped");
  assert.equal(parseNightCloseOutAnswer("done besides the essay"), "slipped");
});

test("Task 9: I3's completed cases still stand — no partial-clause connector present", () => {
  assert.equal(parseNightCloseOutAnswer("done, not bad"), "completed");
  assert.equal(parseNightCloseOutAnswer("completed, missed the bonus question though"), "completed");
});

test("isSkipAnswer recognizes only the literal 'skip' (case-insensitive)", () => {
  assert.equal(isSkipAnswer("skip"), true);
  assert.equal(isSkipAnswer("SKIP"), true);
  assert.equal(isSkipAnswer("  skip  "), true);
  assert.equal(isSkipAnswer("skip it"), false);
  assert.equal(isSkipAnswer("completed"), false);
});

test("parseSelfCheckAnswer: accepts a valid score + reason", () => {
  assert.deepEqual(parseSelfCheckAnswer("7 feeling good"), { score: 7, reason: "feeling good" });
  assert.deepEqual(parseSelfCheckAnswer("10 everything is on track"), { score: 10, reason: "everything is on track" });
  assert.equal(parseSelfCheckAnswer("not a number at all"), undefined);
  assert.equal(parseSelfCheckAnswer("11 out of range"), undefined);
  assert.equal(parseSelfCheckAnswer("0 out of range"), undefined);
});

// Task 6 (Spencer: "the waiting on you questions do not go away when they
// are answered" — traced to this parser's old strict "number<space>reason"
// shape). Every example from the task brief, plus the no-number rejection.
test("Task 6: parseSelfCheckAnswer accepts natural replies — score required, reason optional", () => {
  assert.deepEqual(parseSelfCheckAnswer("7"), { score: 7, reason: "" });
  assert.deepEqual(parseSelfCheckAnswer("7/10"), { score: 7, reason: "" });
  assert.deepEqual(parseSelfCheckAnswer("7 out of 10"), { score: 7, reason: "" });
  assert.deepEqual(parseSelfCheckAnswer("7, feeling good"), { score: 7, reason: "feeling good" });
  assert.deepEqual(parseSelfCheckAnswer("7 - tired but ok"), { score: 7, reason: "tired but ok" });
  assert.deepEqual(parseSelfCheckAnswer("seven"), { score: 7, reason: "" });
  assert.deepEqual(parseSelfCheckAnswer("i'd say a 6. slept badly"), { score: 6, reason: "slept badly" });
  assert.deepEqual(parseSelfCheckAnswer("8!"), { score: 8, reason: "" });
});

test("Task 6: parseSelfCheckAnswer rejects a reply with no 1-10 number at all", () => {
  assert.equal(parseSelfCheckAnswer("not a number at all"), undefined);
  assert.equal(parseSelfCheckAnswer(""), undefined);
  assert.equal(parseSelfCheckAnswer("eleven"), undefined);
});

// M2 (final-review): a digit anywhere in the reply is preferred over a
// spelled-out number word, and the LAST standalone 1-10 digit wins when
// several are present — the misread cases the review verified.
test("M2 (final-review): a digit is preferred over a spelled-out number word when both are present", () => {
  assert.deepEqual(parseSelfCheckAnswer("had one rough class, but 7"), { score: 7, reason: "" });
  assert.deepEqual(parseSelfCheckAnswer("two tests today, feeling like a 6"), { score: 6, reason: "" });
});

test("M2 (final-review): the LAST standalone 1-10 digit wins when several are present", () => {
  assert.deepEqual(parseSelfCheckAnswer("3 hours of sleep, 5"), { score: 5, reason: "" });
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

test("parseProposalAnswer accepts approve and discard", () => {
  assert.equal(parseProposalAnswer("approve"), true);
  assert.equal(parseProposalAnswer("Discard"), false);
});

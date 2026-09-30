/**
 * Tests for `src/core/open-item-answers.ts` (Story 8.1) — moved verbatim
 * from `tests/chat-cli.test.ts` (`parseNightCloseOutAnswer`/`isSkipAnswer`/
 * `parseProposalAnswer`), same behavior.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSkipAnswer, parseNightCloseOutAnswer, parseProposalAnswer } from "../src/core/open-item-answers.ts";

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

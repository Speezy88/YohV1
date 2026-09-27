/**
 * Tests for `src/core/event-title.ts` (displaying Calendar event titles in chat replies,
 * with the same untitled-detection rule as web/src/lib/labels.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayEventTitle } from "../src/core/event-title.ts";

test("displayEventTitle returns the title when it's a normal non-empty title", () => {
  assert.equal(displayEventTitle("Dentist"), "Dentist");
  assert.equal(displayEventTitle("Team Meeting"), "Team Meeting");
  assert.equal(displayEventTitle("Project Review"), "Project Review");
});

test("displayEventTitle returns '(No title)' for a blank title", () => {
  assert.equal(displayEventTitle(""), "(No title)");
});

test("displayEventTitle returns '(No title)' for a title with only whitespace", () => {
  assert.equal(displayEventTitle("  "), "(No title)");
  assert.equal(displayEventTitle("\t\t"), "(No title)");
  assert.equal(displayEventTitle("\n"), "(No title)");
});

test("displayEventTitle returns '(No title)' for a title with only punctuation", () => {
  assert.equal(displayEventTitle(","), "(No title)");
  assert.equal(displayEventTitle("..."), "(No title)");
  assert.equal(displayEventTitle("-"), "(No title)");
  assert.equal(displayEventTitle("---"), "(No title)");
  assert.equal(displayEventTitle("!!!"), "(No title)");
});

test("displayEventTitle returns '(No title)' for a title with only punctuation and whitespace", () => {
  assert.equal(displayEventTitle(", , ,"), "(No title)");
  assert.equal(displayEventTitle("  ...  "), "(No title)");
  assert.equal(displayEventTitle(" - - - "), "(No title)");
  assert.equal(displayEventTitle("\n...\n"), "(No title)");
});

test("displayEventTitle preserves titles that contain punctuation but also have real content", () => {
  assert.equal(displayEventTitle("Project - Review"), "Project - Review");
  assert.equal(displayEventTitle("Team Meeting!"), "Team Meeting!");
  assert.equal(displayEventTitle("1:1 Sync"), "1:1 Sync");
  assert.equal(displayEventTitle("TODO: Review"), "TODO: Review");
});

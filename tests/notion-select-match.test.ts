/**
 * Tests for `src/adapters/notion-select-match.ts` (FR-24, AD-12): resolves
 * a typed answer to one of a `select` property's REAL, currently-existing
 * Notion options — never a raw/invented value. A pure string-matching
 * function (no I/O, no module-level state) that lives in `adapters/`
 * rather than `core/` per AD-1 — see that file's own doc comment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closestOption } from "../src/adapters/notion-select-match.ts";

test("returns the candidate unchanged on an exact match", () => {
  assert.equal(closestOption("Finance", ["Finance", "Health", "Work"]), "Finance");
});

test("matches case- and whitespace-insensitively, returning the candidate's real casing", () => {
  assert.equal(closestOption("  finance ", ["Finance", "Health", "Work"]), "Finance");
});

test("corrects a small typo to the nearest real option", () => {
  assert.equal(closestOption("Financ", ["Finance", "Health", "Work"]), "Finance");
});

test("returns undefined when no option is a close enough match", () => {
  assert.equal(closestOption("Astronomy", ["Finance", "Health", "Work"]), undefined);
});

test("returns undefined on an ambiguous tie between two equally-close options", () => {
  // "Cat" is edit-distance 1 from both "Bat" (substitute C->B) and "Car"
  // (substitute t->r) — a genuine tie, not a preference to guess between.
  assert.equal(closestOption("Cat", ["Bat", "Car"]), undefined);
});

test("returns undefined for an empty candidate list", () => {
  assert.equal(closestOption("Finance", []), undefined);
});

test("returns undefined for a blank input", () => {
  assert.equal(closestOption("   ", ["Finance", "Health"]), undefined);
});

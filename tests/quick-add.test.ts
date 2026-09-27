/**
 * Tests for `src/core/quick-add.ts` (Task 6B): the Tasks page's inline
 * quick-add parser. Anchored to a fixed instant in a fixed zone so every
 * relative date is deterministic: 2026-09-27 (a Sunday) in UTC.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchAreaTag, parseQuickAdd, type QuickAddContext } from "../src/core/quick-add.ts";

const CTX: QuickAddContext = { now: new Date("2026-09-27T15:00:00.000Z"), timeZone: "UTC" };

test("the brief's own example: due fri, 90m, high are all read off the end; the rest is the title", () => {
  const parsed = parseQuickAdd("Lab report due fri 90m high", CTX);
  assert.equal(parsed.title, "Lab report");
  assert.deepEqual(parsed.fields, { dueDate: "2026-10-02", estimatedDurationMinutes: 90, energy: "high" });
});

test("#tag anywhere sets Area and leaves the title", () => {
  const parsed = parseQuickAdd("Lab report draft due fri 90m high #bio", CTX);
  assert.equal(parsed.title, "Lab report draft");
  assert.equal(parsed.fields.area, "bio");
  assert.equal(parsed.fields.dueDate, "2026-10-02");
});

test("#tag in the middle of the title is still Area", () => {
  const parsed = parseQuickAdd("Read #bio chapter 7", CTX);
  assert.equal(parsed.title, "Read chapter 7");
  assert.equal(parsed.fields.area, "bio");
});

test("the Playwright line: 'Test task due tomorrow 30m'", () => {
  const parsed = parseQuickAdd("Test task due tomorrow 30m", CTX);
  assert.equal(parsed.title, "Test task");
  assert.deepEqual(parsed.fields, { dueDate: "2026-09-28", estimatedDurationMinutes: 30 });
});

test("a plain title with no tokens is left exactly as typed", () => {
  const parsed = parseQuickAdd("  Email Mr. Alvarez about the lab ", CTX);
  assert.equal(parsed.title, "Email Mr. Alvarez about the lab");
  assert.deepEqual(parsed.fields, {});
  assert.deepEqual(parsed.tokens, []);
});

test("nothing is guessed from the middle: 'Low tide walk' keeps 'Low' in the title", () => {
  const parsed = parseQuickAdd("Low tide walk", CTX);
  assert.equal(parsed.title, "Low tide walk");
  assert.deepEqual(parsed.fields, {});
});

test("an unrecognized trailing word stops the scan — earlier recognizable words stay in the title", () => {
  const parsed = parseQuickAdd("Call about friday plans", CTX);
  assert.equal(parsed.title, "Call about friday plans");
  assert.deepEqual(parsed.fields, {});
});

test("durations: 45m, 45min, 1h, 1.5h, 1h30m, and '20 min' as two words", () => {
  assert.equal(parseQuickAdd("A 45m", CTX).fields.estimatedDurationMinutes, 45);
  assert.equal(parseQuickAdd("A 45min", CTX).fields.estimatedDurationMinutes, 45);
  assert.equal(parseQuickAdd("A 1h", CTX).fields.estimatedDurationMinutes, 60);
  assert.equal(parseQuickAdd("A 1.5h", CTX).fields.estimatedDurationMinutes, 90);
  assert.equal(parseQuickAdd("A 1h30m", CTX).fields.estimatedDurationMinutes, 90);
  const twoWords = parseQuickAdd("Return books 20 min", CTX);
  assert.equal(twoWords.title, "Return books");
  assert.equal(twoWords.fields.estimatedDurationMinutes, 20);
});

test("a zero duration is not a duration (parsePlanningFieldValue rejects it) and stays in the title", () => {
  const parsed = parseQuickAdd("Nap 0m", CTX);
  assert.equal(parsed.title, "Nap 0m");
  assert.equal(parsed.fields.estimatedDurationMinutes, undefined);
});

test("multi-word dates: 'next week friday', 'Oct 3', '10/3', and an ISO date", () => {
  assert.equal(parseQuickAdd("Essay next week friday", CTX).fields.dueDate, "2026-10-09");
  const oct = parseQuickAdd("Essay by Oct 3", CTX);
  assert.equal(oct.title, "Essay");
  assert.equal(oct.fields.dueDate, "2026-10-03");
  assert.equal(parseQuickAdd("Essay 10/3", CTX).fields.dueDate, "2026-10-03");
  assert.equal(parseQuickAdd("Essay 2026-11-02", CTX).fields.dueDate, "2026-11-02");
});

test("a time-of-day clause is never silently dropped: 'tomorrow at 5' is left in the title", () => {
  const parsed = parseQuickAdd("Call mom tomorrow at 5", CTX);
  assert.equal(parsed.fields.dueDate, undefined);
  assert.equal(parsed.title, "Call mom tomorrow at 5");
});

test("'Call mom 5pm' keeps '5pm' in the title and sets no duration (a clock time is not minutes)", () => {
  const parsed = parseQuickAdd("Call mom 5pm", CTX);
  assert.equal(parsed.title, "Call mom 5pm");
  assert.equal(parsed.fields.estimatedDurationMinutes, undefined);
  assert.deepEqual(parsed.fields, {});
});

test("a line that is ONLY tokens keeps the whole line as the title (a title is required)", () => {
  const parsed = parseQuickAdd("tomorrow 30m", CTX);
  assert.equal(parsed.title, "tomorrow 30m");
  assert.deepEqual(parsed.fields, {});
});

test("a second duration stops the scan — the first one read wins, the other stays in the title", () => {
  const parsed = parseQuickAdd("Run 5k 30m 45m", CTX);
  assert.equal(parsed.fields.estimatedDurationMinutes, 45);
  assert.equal(parsed.title, "Run 5k 30m");
});

test("resolveArea maps a #tag onto a real option; an unmatched #tag stays in the title and is reported", () => {
  const resolveArea = (raw: string): string | undefined => (raw.toLowerCase().startsWith("bio") ? "AP Bio" : undefined);
  const matched = parseQuickAdd("Lab #bio", { ...CTX, resolveArea });
  assert.equal(matched.fields.area, "AP Bio");
  assert.equal(matched.title, "Lab");
  const unmatched = parseQuickAdd("Lab #chem", { ...CTX, resolveArea });
  assert.equal(unmatched.fields.area, undefined);
  assert.equal(unmatched.title, "Lab #chem");
  assert.deepEqual(unmatched.unmatchedAreas, ["chem"]);
});

test("tokens list what was read, in reading order, with the raw text each came from", () => {
  const parsed = parseQuickAdd("Lab report due fri 90m high #bio", CTX);
  assert.deepEqual(
    parsed.tokens.map((t) => [t.field, t.raw]),
    [
      ["area", "#bio"],
      ["dueDate", "due fri"],
      ["estimatedDurationMinutes", "90m"],
      ["energy", "high"],
    ],
  );
});

test("matchAreaTag: exact name, then the ONE option the tag prefixes (whole name or any word); ambiguous is undefined", () => {
  const areas = ["Manatee", "School/ACT/College Apps", "Personal Goals", "Side Projects/Business", "Reading/Learning", "AP Bio"];
  assert.equal(matchAreaTag("manatee", areas), "Manatee");
  assert.equal(matchAreaTag("bio", areas), "AP Bio");
  assert.equal(matchAreaTag("school", areas), "School/ACT/College Apps");
  assert.equal(matchAreaTag("side-projects", areas), "Side Projects/Business");
  assert.equal(matchAreaTag("read", areas), "Reading/Learning");
  assert.equal(matchAreaTag("p", areas), undefined, "Personal Goals and Side Projects both have a word starting with p");
  assert.equal(matchAreaTag("chem", areas), undefined);
});

test("an unmatched #tag at the end never blocks reading the tokens before it", () => {
  const parsed = parseQuickAdd("Lab 30m #chem", { ...CTX, resolveArea: () => undefined });
  assert.equal(parsed.title, "Lab #chem");
  assert.equal(parsed.fields.estimatedDurationMinutes, 30);
});

test("energy words: med is medium; case-insensitive", () => {
  assert.equal(parseQuickAdd("Stretch MED", CTX).fields.energy, "medium");
  assert.equal(parseQuickAdd("Stretch Low", CTX).fields.energy, "low");
});

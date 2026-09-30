import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFiling, MEMORY_FILING_TIMEOUT_MS } from "../src/core/memory-filing.ts";
import type { MemoryCandidate } from "../src/types/domain.ts";

const now = new Date("2026-09-29T12:00:00Z");
const c = (o: Partial<MemoryCandidate>): MemoryCandidate => ({ folder: "about-you", text: "I run at 6", origin: "stated", ...o });

test("timeout constant", () => assert.equal(MEMORY_FILING_TIMEOUT_MS, 8000));

test("keeps at most two", () => {
  const r = validateFiling([c({ text: "a" }), c({ text: "b" }), c({ text: "c" })], { now });
  assert.equal(r.accepted.length, 2);
});

test("forceStated sets origin stated", () => {
  const r = validateFiling([c({ origin: "inferred", folder: "feedback", scope: "plans" })], { now, forceStated: true });
  assert.equal(r.accepted[0]?.origin, "stated");
});

test("inferred in stated-only folders dropped; sensitive inferred dropped", () => {
  const r = validateFiling([c({ origin: "inferred", folder: "planning-preferences" }), c({ origin: "inferred", sensitive: "health" }), c({ origin: "inferred", text: "fine" })], { now });
  assert.deepEqual(r.accepted.map((x) => x.text), ["fine"]);
  assert.equal(r.dropped.length, 2);
});

test("empty, long, and bad expiry dropped", () => {
  const r = validateFiling([c({ text: "  " }), c({ text: "x".repeat(281) }), c({ expiresOn: "2026-09-01" }), c({ expiresOn: "tomorrow" }), c({ expiresOn: "2026-10-01", text: "ok" })], { now });
  assert.deepEqual(r.accepted.map((x) => x.text), ["ok"]);
  assert.equal(r.dropped.length, 4);
});

test("feedback without scope keeps narrowest scope", () => {
  const r = validateFiling([c({ folder: "feedback" })], { now });
  assert.equal(r.accepted[0]?.scope, "this kind of request");
});

test("forceFolder overrides folder", () => {
  const r = validateFiling([c({})], { now, forceFolder: "ideas-notes" });
  assert.equal(r.accepted[0]?.folder, "ideas-notes");
});

test("ruleChange kept only when valid and in planning-preferences", () => {
  const good = validateFiling([c({ folder: "planning-preferences", ruleChange: { key: "schoolDayWorkStart", value: "16:00" } })], { now });
  assert.ok(good.accepted[0]?.ruleChange);
  const bad = validateFiling([c({ folder: "planning-preferences", ruleChange: { key: "schoolDayWorkStart", value: "banana" } })], { now });
  assert.equal(bad.accepted.length, 1);
  assert.equal(bad.accepted[0]?.ruleChange, undefined);
  const wrong = validateFiling([c({ folder: "about-you", ruleChange: { key: "schoolDayWorkStart", value: "16:00" } })], { now });
  assert.equal(wrong.accepted[0]?.ruleChange, undefined);
});

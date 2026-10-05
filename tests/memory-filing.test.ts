import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFiling, MEMORY_FILING_TIMEOUT_MS, isTrivialTurn, planFilingActions, candidateRejection, normalizeMemoryText } from "../src/core/memory-filing.ts";
import type { MemoryCandidate } from "../src/types/domain.ts";

const TZ = "America/New_York";
const now = new Date("2026-09-29T12:00:00Z");
const c = (o: Partial<MemoryCandidate>): MemoryCandidate => ({ folder: "about-you", text: "I run at 6", origin: "stated", ...o });

test("timeout constant", () => assert.equal(MEMORY_FILING_TIMEOUT_MS, 8000));

test("keeps at most two", () => {
  const r = validateFiling([c({ text: "a" }), c({ text: "b" }), c({ text: "c" })], { now, timeZone: TZ });
  assert.equal(r.accepted.length, 2);
});

test("forceStated sets origin stated", () => {
  const r = validateFiling([c({ origin: "inferred", folder: "feedback", scope: "plans" })], { now, timeZone: TZ, forceStated: true });
  assert.equal(r.accepted[0]?.origin, "stated");
});

test("inferred in stated-only folders dropped; sensitive inferred dropped", () => {
  const r = validateFiling([c({ origin: "inferred", folder: "planning-preferences" }), c({ origin: "inferred", sensitive: "health" }), c({ origin: "inferred", text: "fine" })], { now, timeZone: TZ });
  assert.deepEqual(r.accepted.map((x) => x.text), ["fine"]);
  assert.equal(r.dropped.length, 2);
});

test("empty, long, and bad expiry dropped", () => {
  const r = validateFiling([c({ text: "  " }), c({ text: "x".repeat(281) }), c({ expiresOn: "2026-09-01" }), c({ expiresOn: "tomorrow" }), c({ expiresOn: "2026-10-01", text: "ok" })], { now, timeZone: TZ });
  assert.deepEqual(r.accepted.map((x) => x.text), ["ok"]);
  assert.equal(r.dropped.length, 4);
});

test("feedback without scope keeps narrowest scope", () => {
  const r = validateFiling([c({ folder: "feedback" })], { now, timeZone: TZ });
  assert.equal(r.accepted[0]?.scope, "this kind of request");
});

test("forceFolder overrides folder", () => {
  const r = validateFiling([c({})], { now, timeZone: TZ, forceFolder: "ideas-notes" });
  assert.equal(r.accepted[0]?.folder, "ideas-notes");
});

test("ruleChange kept only when valid and in planning-preferences", () => {
  const good = validateFiling([c({ folder: "planning-preferences", ruleChange: { key: "schoolDayWorkStart", value: "16:00" } })], { now, timeZone: TZ });
  assert.ok(good.accepted[0]?.ruleChange);
  const bad = validateFiling([c({ folder: "planning-preferences", ruleChange: { key: "schoolDayWorkStart", value: "banana" } })], { now, timeZone: TZ });
  assert.equal(bad.accepted.length, 1);
  assert.equal(bad.accepted[0]?.ruleChange, undefined);
  const wrong = validateFiling([c({ folder: "about-you", ruleChange: { key: "schoolDayWorkStart", value: "16:00" } })], { now, timeZone: TZ });
  assert.equal(wrong.accepted[0]?.ruleChange, undefined);
});

test("expiry compares against the local date, not UTC (late evening)", () => {
  // 2026-09-30T02:00Z is still 2026-09-29 evening in New York.
  const late = new Date("2026-09-30T02:00:00Z");
  const r = validateFiling([c({ text: "today ok", expiresOn: "2026-09-29" }), c({ text: "past", expiresOn: "2026-09-28" })], { now: late, timeZone: TZ });
  assert.deepEqual(r.accepted.map((x) => x.text), ["today ok"]);
});

// ---- Story 13.5 ----
const flags = { handledDeterministically: false, isStructuredAnswer: false };

test("isTrivialTurn: short, acknowledgement, flagged", () => {
  for (const t of ["ok thanks", "yes", "sounds good, thank you", "Thanks so much, Meeseek!", "ok, that works for me", "Got it, thank you very much"]) {
    assert.equal(isTrivialTurn(t, flags), true, t);
  }
  assert.equal(isTrivialTurn("I have chemistry club every Tuesday after school", flags), false);
  assert.equal(isTrivialTurn("Ok but I actually start work at 2:30 on school days", flags), false);
  assert.equal(isTrivialTurn("Move the long run to Saturday morning please", { ...flags, handledDeterministically: true }), true);
  assert.equal(isTrivialTurn("Move the long run to Saturday morning please", { ...flags, isStructuredAnswer: true }), true);
});

test("planFilingActions: restate/contradict a current item supersedes; unknown or non-current inserts; one action per id", () => {
  const item = (id: string, status: "current" | "superseded") => ({ id, status }) as never;
  const cur = [item("a", "current"), item("b", "superseded")];
  const plan = planFilingActions(
    [c({ text: "1", restatesId: "a" }), c({ text: "2", contradictsId: "a" }), c({ text: "3", restatesId: "b" }), c({ text: "4", contradictsId: "zzz" }), c({ text: "5" })],
    cur,
  );
  assert.deepEqual(plan.map((p) => [p.kind, p.targetId]), [["supersede", "a"], ["insert", undefined], ["insert", undefined], ["insert", undefined], ["insert", undefined]]);
});

test("candidateRejection names the reason and has no per-turn limit", () => {
  const today = "2026-09-29";
  assert.equal(candidateRejection(c({}), today), undefined);
  assert.equal(candidateRejection(c({ text: "   " }), today), "empty");
  assert.equal(candidateRejection(c({ text: "x".repeat(281) }), today), "too-long");
  assert.equal(candidateRejection(c({ origin: "inferred", folder: "feedback" }), today), "inferred-in-stated-only-folder");
  assert.equal(candidateRejection(c({ origin: "inferred", sensitive: "health" }), today), "sensitive-inferred");
  assert.equal(candidateRejection(c({ expiresOn: "2026-09-01" }), today), "bad-expiry");
  const many = Array.from({ length: 10 }, (_, i) => c({ text: `fact ${i}` }));
  assert.equal(many.filter((x) => candidateRejection(x, today) === undefined).length, 10);
});

test("normalizeMemoryText ignores case, spacing and trailing punctuation", () => {
  assert.equal(normalizeMemoryText("  Likes  COFFEE. "), "likes coffee");
  assert.equal(normalizeMemoryText("Likes coffee"), normalizeMemoryText("likes coffee!?"));
});

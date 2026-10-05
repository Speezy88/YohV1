import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPatterns, describePattern, patternKey } from "../src/core/pattern-detect.ts";

const TODAY = "2026-09-30";
const over = (date: string, overrunMinutes: number, area = "History") => ({ area: area as never, date, overrunMinutes });

test("area-overrun: 5 overruns over 20 days propose padding = median rounded to 5", () => {
  const overruns = [
    over("2026-09-03", 22),
    over("2026-09-10", 31),
    over("2026-09-14", 28),
    over("2026-09-18", 40),
    over("2026-09-23", 33),
  ];
  const out = detectPatterns({ slips: [], overruns, today: TODAY });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.kind, "area-overrun");
  assert.equal(out[0]?.area, "History");
  assert.equal(out[0]?.occurrences, 5);
  assert.equal(out[0]?.firstSeen, "2026-09-03");
  assert.equal(out[0]?.lastSeen, "2026-09-23");
  assert.equal(out[0]?.paddingMinutes, 30);
  assert.deepEqual(out[0]?.sampleDates, ["2026-09-03", "2026-09-10", "2026-09-14", "2026-09-18", "2026-09-23"]);
});

test("a single day of overruns proposes nothing", () => {
  const overruns = [1, 2, 3, 4, 5].map(() => over("2026-09-20", 30));
  assert.deepEqual(detectPatterns({ slips: [], overruns, today: TODAY }), []);
});

test("fewer than 4 occurrences, or a span under 14 days, proposes nothing", () => {
  assert.deepEqual(detectPatterns({ slips: [], overruns: [over("2026-09-01", 30), over("2026-09-10", 30), over("2026-09-20", 30)], today: TODAY }), []);
  assert.deepEqual(detectPatterns({ slips: [], overruns: ["09-10", "09-12", "09-15", "09-20"].map((d) => over(`2026-${d}`, 30)), today: TODAY }), []);
});

test("today and dates older than 42 days are ignored; non-positive overruns do not count", () => {
  const overruns = [over("2026-08-01", 30), over("2026-09-10", 30), over("2026-09-15", 0), over("2026-09-20", 30), over("2026-09-25", 30), over("2026-09-30", 30)];
  assert.deepEqual(detectPatterns({ slips: [], overruns, today: TODAY }), []);
});

test("padding is at least 5 and capped at 120", () => {
  const small = ["09-01", "09-08", "09-15", "09-20"].map((d) => over(`2026-${d}`, 1));
  assert.equal(detectPatterns({ slips: [], overruns: small, today: TODAY })[0]?.paddingMinutes, 5);
  const big = ["09-01", "09-08", "09-15", "09-20"].map((d) => over(`2026-${d}`, 300));
  assert.equal(detectPatterns({ slips: [], overruns: big, today: TODAY })[0]?.paddingMinutes, 120);
});

test("area-slips: no padding; grouped per area; sorted by occurrences then area", () => {
  const dates = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-20"];
  const slips = [
    ...dates.map((date) => ({ area: "Work" as never, date })),
    ...[...dates, "2026-09-22"].map((date) => ({ area: "History" as never, date })),
  ];
  const out = detectPatterns({ slips, overruns: [], today: TODAY });
  assert.deepEqual(out.map((p) => [p.kind, p.area, p.occurrences]), [["area-slips", "History", 5], ["area-slips", "Work", 4]]);
  assert.equal(out[0]?.paddingMinutes, undefined);
});

test("sampleDates: at most 5, evenly spread, oldest first", () => {
  const dates = ["09-01", "09-03", "09-05", "09-07", "09-09", "09-11", "09-13", "09-15", "09-17", "09-19"];
  const out = detectPatterns({ slips: dates.map((d) => ({ area: "Work" as never, date: `2026-${d}` })), overruns: [], today: TODAY });
  const s = out[0]?.sampleDates ?? [];
  assert.equal(s.length, 5);
  assert.equal(s[0], "2026-09-01");
  assert.equal(s[4], "2026-09-19");
});

test("skip and after: skipped keys are not proposed; only observations after `after` count", () => {
  const overruns = ["09-01", "09-08", "09-15", "09-20"].map((d) => over(`2026-${d}`, 30));
  assert.deepEqual(detectPatterns({ slips: [], overruns, today: TODAY, skip: new Set([patternKey("area-overrun", "History" as never)]) }), []);
  assert.deepEqual(detectPatterns({ slips: [], overruns, today: TODAY, after: new Map([[patternKey("area-overrun", "History" as never), "2026-09-08"]]) }), []);
});

test("describePattern copy", () => {
  const p = { kind: "area-overrun" as const, area: "History" as never, occurrences: 5, firstSeen: "2026-09-03", lastSeen: "2026-09-23", sampleDates: ["2026-09-03", "2026-09-10"], paddingMinutes: 30 };
  const d = describePattern(p);
  assert.equal(d.headline, "Meeseek noticed History Tasks run about 30 min over.");
  assert.equal(d.evidence, "5 times since Sep 3: Sep 3, Sep 10");
  assert.equal(d.question, "Plan for that?");
  const s = describePattern({ kind: "area-slips", area: p.area, occurrences: 5, firstSeen: p.firstSeen, lastSeen: p.lastSeen, sampleDates: p.sampleDates });
  assert.equal(s.headline, "Meeseek noticed History Tasks keep slipping to the next day.");
  assert.equal(s.question, "Remember that?");
});

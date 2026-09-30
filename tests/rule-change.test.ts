import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeRuleChange,
  formatClock12,
  formatRuleValue,
  ruleChangeConfirmedCopy,
  ruleChangeDeclinedCopy,
  ruleChangeEntityId,
  ruleChangeProposalId,
  ruleChangeRequestId,
  ruleValuesEqual,
} from "../src/core/rule-change.ts";
import { isOlderThanDays } from "../src/core/proposal-ttl.ts";
import { currentRuleValue, defaultPlanningSettings, validateProposedRuleValue } from "../src/core/planning-settings.ts";

const school = { key: "schoolDayWorkStart", value: "14:30", previous: "15:15", memoryItemId: "m1" } as const;

test("describeRuleChange reads the school-day example", () => {
  assert.equal(describeRuleChange(school), "Change school-day work start from 3:15 PM to 2:30 PM?");
  assert.equal(ruleChangeConfirmedCopy(school), "Changed school-day work start to 2:30 PM. Revert it on the Memory page.");
  assert.equal(ruleChangeDeclinedCopy(school), "Kept 3:15 PM. Your preference stays saved, marked declined.");
});

test("window and padding copy", () => {
  const lunch = { key: "lunchWindow", value: { start: "11:00", end: "11:40" }, previous: { start: "10:55", end: "11:35" }, memoryItemId: "m" } as const;
  assert.equal(describeRuleChange(lunch), "Change lunch from 10:55 AM-11:35 AM to 11:00 AM-11:40 AM?");
  const pad = { key: "areaDurationPadding", value: { area: "Home", minutes: 15 }, previous: { area: "Home", minutes: 10 }, memoryItemId: "m" } as const;
  assert.equal(describeRuleChange(pad), "Plan 15 extra minutes for Home Tasks (now 10)?");
  assert.equal(formatRuleValue("areaDurationPadding", pad.value), "15 min");
  assert.equal(formatClock12("00:05"), "12:05 AM");
  assert.equal(formatClock12("12:00"), "12:00 PM");
});

test("ids and equality", () => {
  assert.equal(ruleChangeEntityId("lunchWindow"), "lunchWindow");
  assert.equal(ruleChangeEntityId("areaDurationPadding", "Home"), "areaDurationPadding:Home");
  assert.equal(ruleChangeProposalId("x"), "rule-change-x");
  assert.equal(ruleChangeRequestId("x"), "proposal:rule-change-x");
  assert.ok(ruleValuesEqual({ start: "a", end: "b" }, { start: "a", end: "b" }));
  assert.ok(!ruleValuesEqual("a", "b"));
});

test("isOlderThanDays", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  assert.ok(isOlderThanDays("2026-09-22T11:59:00Z", now, 7));
  assert.ok(!isOlderThanDays("2026-09-22T12:01:00Z", now, 7));
});

test("currentRuleValue and overlap validation", () => {
  const s = defaultPlanningSettings();
  assert.equal(currentRuleValue(s, "schoolDayWorkStart"), "15:15");
  assert.deepEqual(currentRuleValue(s, "areaDurationPadding", "Home"), { area: "Home", minutes: 0 });
  const lunch = currentRuleValue(s, "lunchWindow") as { start: string; end: string };
  const community = currentRuleValue(s, "communityWindow") as { start: string; end: string };
  assert.ok(validateProposedRuleValue(s, "lunchWindow", lunch).ok);
  const bad = validateProposedRuleValue(s, "lunchWindow", { start: community.start, end: community.end });
  assert.equal(bad.ok, false);
});

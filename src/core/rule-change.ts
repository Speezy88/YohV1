/**
 * Rule-change proposals (Story 13.8, AD-29): ids, value equality and copy for
 * "Change school-day work start from 3:15 PM to 2:30 PM?". Pure.
 */
import type { Area, RuleChange, RuleSettingKey, RuleSettingValue } from "../types/domain.ts";

export function ruleChangeEntityId(key: RuleSettingKey, area?: Area): string {
  return key === "areaDurationPadding" && area !== undefined ? `areaDurationPadding:${area}` : key;
}

export function ruleChangeProposalId(itemId: string): string {
  return `rule-change-${itemId}`;
}

export function ruleChangeRequestId(itemId: string): string {
  return `proposal:${ruleChangeProposalId(itemId)}`;
}

export function ruleValuesEqual(a: RuleSettingValue, b: RuleSettingValue): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if ("start" in a && "start" in b) return a.start === b.start && a.end === b.end;
  if ("area" in a && "area" in b) return a.area === b.area && a.minutes === b.minutes;
  return false;
}

/** "15:15" -> "3:15 PM". */
export function formatClock12(clock: string): string {
  const [h, m] = clock.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function ruleLabel(key: RuleSettingKey, area?: Area): string {
  switch (key) {
    case "schoolDayWorkStart":
      return "school-day work start";
    case "otherDayWorkStart":
      return "other-day work start";
    case "lunchWindow":
      return "lunch";
    case "communityWindow":
      return "community time";
    case "areaDurationPadding":
      return `${area ?? "Area"} duration padding`;
  }
}

/** "3:15 PM" | "10:55 AM-11:35 AM" | "30 min". */
export function formatRuleValue(key: RuleSettingKey, value: RuleSettingValue): string {
  if (typeof value === "string") return formatClock12(value);
  if ("start" in value) return `${formatClock12(value.start)}-${formatClock12(value.end)}`;
  void key;
  return `${value.minutes} min`;
}

function paddingArea(change: RuleChange): Area | undefined {
  return typeof change.value === "object" && "area" in change.value ? change.value.area : undefined;
}

export function describeRuleChange(change: RuleChange): string {
  if (change.key === "areaDurationPadding") {
    const now = change.previous as { minutes: number };
    const next = change.value as { area: Area; minutes: number };
    return `Plan ${next.minutes} extra minutes for ${next.area} Tasks (now ${now.minutes})?`;
  }
  return `Change ${ruleLabel(change.key)} from ${formatRuleValue(change.key, change.previous)} to ${formatRuleValue(change.key, change.value)}?`;
}

export function ruleChangeConfirmedCopy(change: RuleChange): string {
  if (change.key === "areaDurationPadding") {
    const next = change.value as { area: Area; minutes: number };
    return `Now planning ${next.minutes} extra minutes for ${next.area} Tasks. Revert it on the Memory page.`;
  }
  return `Changed ${ruleLabel(change.key, paddingArea(change))} to ${formatRuleValue(change.key, change.value)}. Revert it on the Memory page.`;
}

export function ruleChangeDeclinedCopy(change: RuleChange): string {
  if (change.key === "areaDurationPadding") {
    const now = change.previous as { area: Area; minutes: number };
    return `Kept ${now.minutes} extra minutes for ${now.area} Tasks. Your preference stays saved, marked declined.`;
  }
  return `Kept ${formatRuleValue(change.key, change.previous)}. Your preference stays saved, marked declined.`;
}

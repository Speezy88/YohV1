/**
 * src/core/routine-commands.ts
 *
 * Epic 10 (10.3, R8): pure parser and formatter for Routine declarations in
 * chat — "my commute is 3:00–3:30 on weekdays", "change my commute to 3:15",
 * "remove my commute routine", "what are my routines". No I/O.
 *
 * Bare times follow R8: 1–7 -> PM, 8–11 -> AM, 12 -> noon.
 */

import { resolveClockMinutes } from "./local-time.ts";
export type RoutineDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const ROUTINE_DAYS: readonly RoutineDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAYS: readonly RoutineDay[] = ["mon", "tue", "wed", "thu", "fri"];
const WEEKENDS: readonly RoutineDay[] = ["sat", "sun"];

/** A stored Routine. `startMinutes` is minutes after local midnight. */
export interface Routine {
  readonly id: string;
  readonly label: string;
  readonly days: readonly RoutineDay[];
  readonly startMinutes: number;
  readonly durationMinutes: number;
}

export type RoutineCommand =
  | { readonly kind: "add"; readonly label: string; readonly days: readonly RoutineDay[]; readonly startMinutes: number; readonly durationMinutes: number }
  | {
      readonly kind: "change";
      readonly label: string;
      readonly days?: readonly RoutineDay[];
      readonly startMinutes?: number;
      readonly durationMinutes?: number;
      /** The line said "routine" — so it is a routine request even when no such routine exists. */
      readonly explicit: boolean;
    }
  | { readonly kind: "remove"; readonly label: string }
  | { readonly kind: "list" };

/** Deterministic id for a label — one routine per normalized label. */
export function routineIdForLabel(label: string): string {
  return `routine-${normalizeRoutineLabel(label).replace(/\s+/g, "-")}`;
}

function normalizeRoutineLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const DAY_NAMES: Readonly<Record<string, RoutineDay>> = {
  mon: "mon", monday: "mon", mondays: "mon",
  tue: "tue", tues: "tue", tuesday: "tue", tuesdays: "tue",
  wed: "wed", weds: "wed", wednesday: "wed", wednesdays: "wed",
  thu: "thu", thur: "thu", thurs: "thu", thursday: "thu", thursdays: "thu",
  fri: "fri", friday: "fri", fridays: "fri",
  sat: "sat", saturday: "sat", saturdays: "sat",
  sun: "sun", sunday: "sun", sundays: "sun",
};

/** Parses a days phrase ("weekdays", "every day", "mondays and wednesdays"); undefined when any part is unrecognized. */
function parseRoutineDays(phrase: string): readonly RoutineDay[] | undefined {
  let text = phrase.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/^on\s+/, "");
  if (/^(?:every\s*day|everyday|daily|each day)$/.test(text)) return ROUTINE_DAYS;
  text = text.replace(/^(?:every|each)\s+/, "");
  if (/^weekdays?$/.test(text)) return WEEKDAYS;
  if (/^weekends?$/.test(text)) return WEEKENDS;
  const parts = text.split(/\s*(?:,|&|\band\b|\/)\s*/).filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  const found = new Set<RoutineDay>();
  for (const part of parts) {
    const day = DAY_NAMES[part];
    if (!day) return undefined;
    found.add(day);
  }
  return ROUTINE_DAYS.filter((d) => found.has(d));
}

function formatRoutineDays(days: readonly RoutineDay[]): string {
  const set = new Set(days);
  if (set.size === 7) return "every day";
  if (set.size === 5 && WEEKDAYS.every((d) => set.has(d))) return "weekdays";
  if (set.size === 2 && WEEKENDS.every((d) => set.has(d))) return "weekends";
  const names: Readonly<Record<RoutineDay, string>> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  return ROUTINE_DAYS.filter((d) => set.has(d)).map((d) => names[d]).join(", ");
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

interface ParsedTime {
  readonly hour: number;
  readonly minute: number;
  readonly meridiem?: "am" | "pm";
}

const TIME_SOURCE = String.raw`(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?`;

function toTime(h: string | undefined, m: string | undefined, mer: string | undefined): ParsedTime | undefined {
  if (h === undefined) return undefined;
  const hour = Number(h);
  const minute = m === undefined ? 0 : Number(m);
  if (minute > 59 || hour > 23) return undefined;
  const meridiem = mer ? (mer.toLowerCase().startsWith("a") ? "am" : "pm") : undefined;
  if (meridiem && (hour < 1 || hour > 12)) return undefined;
  return { hour, minute, ...(meridiem ? { meridiem } : {}) };
}

function resolveMinutes(t: ParsedTime, inherited?: "am" | "pm"): number {
  return resolveClockMinutes(t.hour, t.minute, t.meridiem ?? inherited);
}

function resolveRange(start: ParsedTime, end: ParsedTime): { startMinutes: number; durationMinutes: number } | undefined {
  const startMinutes = resolveMinutes(start, end.meridiem);
  let endMinutes = resolveMinutes(end);
  if (endMinutes <= startMinutes && !end.meridiem && endMinutes + 720 > startMinutes) endMinutes += 720;
  if (endMinutes <= startMinutes || endMinutes > 24 * 60) return undefined;
  return { startMinutes, durationMinutes: endMinutes - startMinutes };
}

function formatClock(minutes: number): { text: string; meridiem: "AM" | "PM" } {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const meridiem = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: `${h12}:${String(m).padStart(2, "0")}`, meridiem };
}

/** "3:00–3:30 PM", or "11:30 AM–1:00 PM" across noon. */
function formatRoutineTimeRange(startMinutes: number, durationMinutes: number): string {
  const start = formatClock(startMinutes);
  const end = formatClock(startMinutes + durationMinutes);
  return start.meridiem === end.meridiem ? `${start.text}–${end.text} ${end.meridiem}` : `${start.text} ${start.meridiem}–${end.text} ${end.meridiem}`;
}

/** "weekdays, 3:00–3:30 PM" — the receipt/list body. */
export function describeRoutine(routine: Pick<Routine, "days" | "startMinutes" | "durationMinutes">): string {
  return `${formatRoutineDays(routine.days)}, ${formatRoutineTimeRange(routine.startMinutes, routine.durationMinutes)}`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const LABEL = String.raw`([a-z][a-z' ]{0,38}?)`;
const RANGE = String.raw`${TIME_SOURCE}\s*(?:-|–|—|to|until)\s*${TIME_SOURCE}`;
const NOT_LABELS = /^(?:plan|day|my plan|the plan|budget|time budget|schedule)$/;

function cleanLabel(raw: string): string | undefined {
  const label = raw.trim().replace(/^(?:my|the)\s+/i, "").replace(/\s+routine$/i, "").trim();
  if (label.length === 0 || label.split(/\s+/).length > 4 || NOT_LABELS.test(label.toLowerCase())) return undefined;
  return label;
}

function stripTrailingDays(rest: string): { readonly days?: readonly RoutineDay[]; readonly ok: boolean } {
  const phrase = rest.trim().replace(/[.!]+$/, "");
  if (phrase === "") return { ok: true };
  const days = parseRoutineDays(phrase);
  return days ? { days, ok: true } : { ok: false };
}

export function parseRoutineCommand(line: string): RoutineCommand | undefined {
  const text = line.trim().replace(/[’]/g, "'").replace(/\s+/g, " ");
  if (text.length === 0 || text.startsWith("/")) return undefined;

  if (/^(?:what(?:'s| is| are)|show|list|view)\s+(?:me\s+)?(?:all\s+)?(?:of\s+)?(?:my|the)?\s*routines?\s*\??$/i.test(text) || /^my routines\??$/i.test(text)) {
    return { kind: "list" };
  }

  const remove = new RegExp(String.raw`^(?:please\s+)?(?:remove|delete|drop|cancel|clear)\s+(?:my|the)\s+${LABEL}\s+routine\s*[.!]?$`, "i").exec(text);
  if (remove) {
    const label = cleanLabel(remove[1] ?? "");
    return label ? { kind: "remove", label } : undefined;
  }

  const change = new RegExp(String.raw`^(?:please\s+)?(?:change|move|update|set|make)\s+(?:my|the)\s+${LABEL}(\s+routine)?\s+to\s+(.+?)[.!]?$`, "i").exec(text);
  if (change) {
    const label = cleanLabel(change[1] ?? "");
    if (!label) return undefined;
    const explicit = Boolean(change[2]);
    const tail = (change[3] ?? "").trim();
    const withRange = new RegExp(`^${RANGE}(?:\\s+(?:on|every)\\s+(.+))?$`, "i").exec(tail);
    if (withRange) {
      const start = toTime(withRange[1], withRange[2], withRange[3]);
      const end = toTime(withRange[4], withRange[5], withRange[6]);
      const range = start && end ? resolveRange(start, end) : undefined;
      const days = withRange[7] ? parseRoutineDays(withRange[7]) : undefined;
      if (!range || (withRange[7] && !days)) return undefined;
      return { kind: "change", label, ...range, ...(days ? { days } : {}), explicit };
    }
    const withStart = new RegExp(`^${TIME_SOURCE}(?:\\s+(?:on|every)\\s+(.+))?$`, "i").exec(tail);
    if (withStart) {
      const start = toTime(withStart[1], withStart[2], withStart[3]);
      const days = withStart[4] ? parseRoutineDays(withStart[4]) : undefined;
      if (!start || (withStart[4] && !days)) return undefined;
      return { kind: "change", label, startMinutes: resolveMinutes(start), ...(days ? { days } : {}), explicit };
    }
    const onlyDays = parseRoutineDays(tail.replace(/^on\s+/i, ""));
    if (onlyDays) return { kind: "change", label, days: onlyDays, explicit };
    return undefined;
  }

  const add = new RegExp(String.raw`^(?:my|the)?\s*${LABEL}\s+(?:is|runs|are)\s+(?:from\s+)?${RANGE}(.*)$`, "i").exec(text);
  if (add) {
    const label = cleanLabel(add[1] ?? "");
    if (!label) return undefined;
    const start = toTime(add[2], add[3], add[4]);
    const end = toTime(add[5], add[6], add[7]);
    const range = start && end ? resolveRange(start, end) : undefined;
    if (!range) return undefined;
    const tail = stripTrailingDays((add[8] ?? "").replace(/^\s*,?\s*/, ""));
    if (!tail.ok) return undefined;
    return { kind: "add", label, days: tail.days ?? ROUTINE_DAYS, ...range };
  }
  return undefined;
}

/**
 * Planning settings (Story 13.7, AD-29): the ONE value every planning
 * pipeline (morning, reshuffle, re-flow) reads its rules from — work-start
 * times, the two protected school windows, per-Area duration padding.
 * Pure. The built-in defaults come from the `core/school-day.ts` constants,
 * read only here and only inside function bodies (school-day.ts imports this
 * file too, so nothing may touch the other module at load time).
 */
import type { Area, CompleteTask, Result, RuleSettingKey, YohError } from "../types/domain.ts";
import { SCHOOL_PROTECTED_WINDOWS, WORK_START_TIMES, type ProtectedWindowSpec } from "./school-day.ts";

export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}

export interface PlanningSettings {
  readonly workStart: { readonly schoolDay: ClockTime; readonly otherDay: ClockTime };
  /** Lunch, then community time, in that order. */
  readonly protectedWindows: readonly ProtectedWindowSpec[];
  /** Minutes added to a Task's estimate, by Area; an absent Area is 0. */
  readonly areaDurationPadding: Readonly<Record<Area, number>>;
}

export interface PlanningDefaults {
  readonly workStart: PlanningSettings["workStart"];
  readonly protectedWindows: readonly ProtectedWindowSpec[];
}

export type RuleSettingValue = string | { readonly start: string; readonly end: string } | { readonly area: Area; readonly minutes: number };

export interface SettingOverrides {
  schoolDayWorkStart?: string;
  otherDayWorkStart?: string;
  lunchWindow?: { start: string; end: string };
  communityWindow?: { start: string; end: string };
  areaDurationPadding?: Readonly<Record<Area, number>>;
}

/** Ruling G1: Yoh never places its own work before 09:00; the ceiling keeps a start inside the day. */
const WORK_START_MIN_MINUTES = 9 * 60;
const WORK_START_MAX_MINUTES = 21 * 60;
const WINDOW_MIN_LENGTH = 5;
const WINDOW_MAX_LENGTH = 180;
const PADDING_MAX_MINUTES = 120;
const STEP_MINUTES = 5;

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseClock(value: unknown): ClockTime | undefined {
  if (typeof value !== "string") return undefined;
  const m = CLOCK_RE.exec(value);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : undefined;
}

function toMinutes(t: ClockTime): number {
  return t.hour * 60 + t.minute;
}

function invalid(message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: { kind: "validation", message, detail } };
}

export function validateRuleValue(key: RuleSettingKey, value: unknown): Result<RuleSettingValue, YohError> {
  switch (key) {
    case "schoolDayWorkStart":
    case "otherDayWorkStart": {
      const t = parseClock(value);
      if (!t) return invalid(`${key} must be a time like "15:20"`, { key, value });
      const minutes = toMinutes(t);
      if (minutes % STEP_MINUTES !== 0) return invalid(`${key} must be on a 5-minute step`, { key, value });
      if (minutes < WORK_START_MIN_MINUTES || minutes > WORK_START_MAX_MINUTES) {
        return invalid(`${key} must be between 09:00 and 21:00`, { key, value });
      }
      return { ok: true, value: value as string };
    }
    case "lunchWindow":
    case "communityWindow": {
      const v = value as { start?: unknown; end?: unknown } | null;
      const start = v && typeof v === "object" ? parseClock(v.start) : undefined;
      const end = v && typeof v === "object" ? parseClock(v.end) : undefined;
      if (!start || !end) return invalid(`${key} needs a start and end like "11:00"`, { key, value });
      const length = toMinutes(end) - toMinutes(start);
      if (length < WINDOW_MIN_LENGTH || length > WINDOW_MAX_LENGTH) {
        return invalid(`${key} must start before it ends and run 5 to 180 minutes`, { key, value });
      }
      return { ok: true, value: { start: v!.start as string, end: v!.end as string } };
    }
    case "areaDurationPadding": {
      const v = value as { area?: unknown; minutes?: unknown } | null;
      if (!v || typeof v !== "object" || typeof v.area !== "string" || v.area.trim() === "") {
        return invalid("areaDurationPadding needs an Area", { key, value });
      }
      const minutes = v.minutes;
      if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0 || minutes > PADDING_MAX_MINUTES || minutes % STEP_MINUTES !== 0) {
        return invalid("areaDurationPadding minutes must be 0 to 120 in steps of 5", { key, value });
      }
      return { ok: true, value: { area: v.area.trim(), minutes } };
    }
    default:
      return invalid(`unknown rule setting "${String(key)}"`, { key });
  }
}

function applyWindow(defaults: readonly ProtectedWindowSpec[], key: string, override: { start: string; end: string } | undefined): readonly ProtectedWindowSpec[] {
  if (!override) return defaults;
  const start = parseClock(override.start);
  const end = parseClock(override.end);
  if (!start || !end) return defaults;
  return defaults.map((w) => (w.key === key ? { ...w, startHour: start.hour, startMinute: start.minute, endHour: end.hour, endMinute: end.minute } : w));
}

export function resolvePlanningSettings(defaults: PlanningDefaults, overrides: SettingOverrides): PlanningSettings {
  const school = parseClock(overrides.schoolDayWorkStart) ?? defaults.workStart.schoolDay;
  const other = parseClock(overrides.otherDayWorkStart) ?? defaults.workStart.otherDay;
  let windows = applyWindow(defaults.protectedWindows, "lunch", overrides.lunchWindow);
  windows = applyWindow(windows, "community", overrides.communityWindow);
  return {
    workStart: { schoolDay: school, otherDay: other },
    protectedWindows: windows,
    areaDurationPadding: { ...(overrides.areaDurationPadding ?? {}) },
  };
}

export function builtInPlanningDefaults(): PlanningDefaults {
  return {
    workStart: { schoolDay: { ...WORK_START_TIMES.schoolDay }, otherDay: { ...WORK_START_TIMES.otherDay } },
    protectedWindows: SCHOOL_PROTECTED_WINDOWS,
  };
}

export function defaultPlanningSettings(): PlanningSettings {
  return resolvePlanningSettings(builtInPlanningDefaults(), {});
}

/** Adds each Area's padding to the estimate of Tasks whose Area is set; anything else is unchanged. */
export function applyAreaPadding(tasks: readonly CompleteTask[], settings: PlanningSettings): CompleteTask[] {
  return tasks.map((task) => {
    if (task.area.kind !== "set") return task;
    const pad = settings.areaDurationPadding[task.area.value] ?? 0;
    return pad > 0 ? { ...task, estimatedDurationMinutes: task.estimatedDurationMinutes + pad } : task;
  });
}

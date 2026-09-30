/** Pattern detection (Story 13.13): pure. Finds per-Area slip and overrun patterns in stored observations. */
import type { Area, IsoDate, PatternKind, PatternProposal } from "../types/domain.ts";

export const PATTERN_MIN_OCCURRENCES = 4;
export const PATTERN_MIN_SPAN_DAYS = 14;
export const PATTERN_WINDOW_DAYS = 42;
export const PATTERN_QUIET_DAYS = 30;

const MAX_SAMPLES = 5;
const MAX_PADDING_MINUTES = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DetectInput {
  readonly slips: readonly { area: Area; date: IsoDate }[];
  readonly overruns: readonly { area: Area; date: IsoDate; overrunMinutes: number }[];
  readonly today: IsoDate;
  /** Keys (`${kind}::${area}`) never to propose. */
  readonly skip?: ReadonlySet<string>;
  /** Per key, only observations dated after this date count. */
  readonly after?: ReadonlyMap<string, IsoDate>;
}

export function patternKey(kind: PatternKind, area: Area): string {
  return `${kind}::${area}`;
}

function dayNumber(date: IsoDate): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function spread(dates: readonly IsoDate[]): IsoDate[] {
  if (dates.length <= MAX_SAMPLES) return [...dates];
  const out: IsoDate[] = [];
  for (let i = 0; i < MAX_SAMPLES; i += 1) out.push(dates[Math.round((i * (dates.length - 1)) / (MAX_SAMPLES - 1))] as IsoDate);
  return out;
}

interface Obs {
  area: Area;
  date: IsoDate;
  overrun?: number;
}

export function detectPatterns(input: DetectInput): PatternProposal[] {
  const today = dayNumber(input.today);
  const inWindow = (date: IsoDate): boolean => {
    const d = dayNumber(date);
    return d >= today - PATTERN_WINDOW_DAYS && d <= today - 1;
  };
  const groups = new Map<string, { kind: PatternKind; area: Area; obs: Obs[] }>();
  const add = (kind: PatternKind, o: Obs): void => {
    const key = patternKey(kind, o.area);
    if (input.skip?.has(key)) return;
    if (!inWindow(o.date)) return;
    const after = input.after?.get(key);
    if (after !== undefined && o.date <= after) return;
    const g = groups.get(key) ?? { kind, area: o.area, obs: [] };
    g.obs.push(o);
    groups.set(key, g);
  };
  for (const s of input.slips) add("area-slips", { area: s.area, date: s.date });
  for (const o of input.overruns) if (o.overrunMinutes > 0) add("area-overrun", { area: o.area, date: o.date, overrun: o.overrunMinutes });

  const out: PatternProposal[] = [];
  for (const g of groups.values()) {
    const obs = [...g.obs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (obs.length < PATTERN_MIN_OCCURRENCES) continue;
    const firstSeen = (obs[0] as Obs).date;
    const lastSeen = (obs[obs.length - 1] as Obs).date;
    if (dayNumber(lastSeen) - dayNumber(firstSeen) < PATTERN_MIN_SPAN_DAYS) continue;
    const proposal: PatternProposal = {
      kind: g.kind,
      area: g.area,
      occurrences: obs.length,
      firstSeen,
      lastSeen,
      sampleDates: spread(obs.map((o) => o.date)),
      ...(g.kind === "area-overrun"
        ? { paddingMinutes: Math.min(MAX_PADDING_MINUTES, Math.max(5, Math.round(median(obs.map((o) => o.overrun as number)) / 5) * 5)) }
        : {}),
    };
    out.push(proposal);
  }
  return out.sort((a, b) => b.occurrences - a.occurrences || (a.area < b.area ? -1 : a.area > b.area ? 1 : 0) || (a.kind < b.kind ? -1 : 1));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(date: IsoDate): string {
  const [, m, d] = date.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

export function describePattern(p: PatternProposal): { headline: string; evidence: string; question: string } {
  const evidence = `${p.occurrences} times since ${shortDate(p.firstSeen)}: ${p.sampleDates.map(shortDate).join(", ")}`;
  if (p.kind === "area-overrun") {
    return { headline: `Yoh noticed ${p.area} Tasks run about ${p.paddingMinutes ?? 0} min over.`, evidence, question: "Plan for that?" };
  }
  return { headline: `Yoh noticed ${p.area} Tasks keep slipping to the next day.`, evidence, question: "Remember that?" };
}

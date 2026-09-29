/**
 * src/core/plan-edit-commands.ts
 *
 * Epic 10 (T7, R9): pure parsing and deterministic resolution of chat plan
 * edits ("work on X instead of Y", "move X after lunch", "move X to 4",
 * "drop X today", "unpin X"). Names resolve by case-insensitive substring
 * against today's Plan blocks, then open Tasks; never a guess, never an LLM.
 */
import type { ExternalId, IsoDate, IsoDateTime, PlanBlock, ReshuffleRequest } from "../types/domain.ts";

export type PlanEditWhen = { readonly kind: "after-lunch" } | { readonly kind: "time"; readonly minutes: number };

export interface PlanEditCommand {
  readonly kind: "swap" | "move" | "drop" | "unpin";
  /** The name the edit acts on (for a swap: the Task to work on). */
  readonly targetText: string;
  /** Swap only: the Task to take out. */
  readonly otherText?: string;
  /** Move only. */
  readonly when?: PlanEditWhen;
}

const ARTICLE_RE = /^(?:the|my|our|that|this)\s+/i;
const clean = (s: string): string => {
  let t = s.trim().replace(/[.!?]+$/, "").trim();
  while (ARTICLE_RE.test(t)) t = t.replace(ARTICLE_RE, "");
  return t.trim();
};

/** R8 bare times: 1-7 -> PM, 8-11 -> AM, 12 -> noon. */
function parseClock(text: string): number | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(text.trim());
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (minute > 59 || hour > 23) return undefined;
  if (m[3]) {
    if (hour < 1 || hour > 12) return undefined;
    return (hour % 12) * 60 + (m[3].toLowerCase() === "p" ? 720 : 0) + minute;
  }
  if (hour === 0 || hour >= 13) return hour * 60 + minute;
  if (hour === 12) return 720 + minute;
  return hour >= 8 ? hour * 60 + minute : (hour + 12) * 60 + minute;
}

function parseWhen(text: string): PlanEditWhen | undefined {
  const t = text.trim().replace(/[.!?]+$/, "").toLowerCase();
  if (/^(?:after\s+)?lunch$/.test(t)) return { kind: "after-lunch" };
  if (t === "noon") return { kind: "time", minutes: 720 };
  const minutes = parseClock(t.replace(/^at\s+/, ""));
  return minutes === undefined ? undefined : { kind: "time", minutes };
}

const SWAP_INSTEAD_RE = /\b(?:work\s+(?:on|in)|do|study|focus\s+on|start)\s+(.+?)\s+instead\s+of\s+(.+)$/i;
const SWAP_FOR_RE = /^(?:please\s+)?swap\s+(.+?)\s+(?:for|with)\s+(.+)$/i;
const MOVE_RE = /^(?:please\s+)?move\s+(.+?)\s+(?:to|until|at)\s+(.+)$/i;
const MOVE_AFTER_LUNCH_RE = /^(?:please\s+)?move\s+(.+?)\s+(after\s+lunch)$/i;
const DROP_RE = /^(?:please\s+)?(?:drop|skip)\s+(.+?)\s+(?:today|for\s+today|from\s+(?:(?:my|the|today'?s)\s+)*plan(?:\s+today)?)$/i;
const UNPIN_RE = /^(?:please\s+)?unpin\s+(.+)$/i;

export function parsePlanEditCommand(line: string): PlanEditCommand | undefined {
  const text = line.trim().replace(/[’]/g, "'");
  let m = SWAP_INSTEAD_RE.exec(text);
  if (m) {
    const target = clean(m[1]!);
    const other = clean(m[2]!);
    if (target && other) return { kind: "swap", targetText: target, otherText: other };
  }
  m = SWAP_FOR_RE.exec(text);
  if (m) {
    const other = clean(m[1]!);
    const target = clean(m[2]!);
    if (target && other) return { kind: "swap", targetText: target, otherText: other };
  }
  m = MOVE_AFTER_LUNCH_RE.exec(text) ?? MOVE_RE.exec(text);
  if (m) {
    const when = parseWhen(m[2]!);
    const target = clean(m[1]!);
    if (when && target) return { kind: "move", targetText: target, when };
  }
  m = DROP_RE.exec(text);
  if (m && clean(m[1]!)) return { kind: "drop", targetText: clean(m[1]!) };
  m = UNPIN_RE.exec(text);
  if (m && clean(m[1]!)) return { kind: "unpin", targetText: clean(m[1]!) };
  return undefined;
}

export interface PlanEditContext {
  readonly date: IsoDate;
  readonly timeZone: string;
  readonly nowMs: number;
  readonly blocks: readonly PlanBlock[];
  /** Open Tasks to resolve against when the Plan has no match. */
  readonly tasks: readonly { readonly id: ExternalId; readonly title: string }[];
  /** End of the Lunch protected window on a school day; absent otherwise (then "after lunch" is 13:00). */
  readonly lunchEnd?: IsoDateTime;
}

export type PlanEditResolution =
  | { readonly kind: "request"; readonly request: ReshuffleRequest }
  | { readonly kind: "reply"; readonly reply: string }
  /** Not a Plan edit after all (e.g. "move my 3pm meeting to 4"): let later routes handle the line. */
  | { readonly kind: "pass" };

interface Candidate { readonly id: ExternalId; readonly title: string }

function distinct(items: readonly Candidate[]): Candidate[] {
  const seen = new Set<ExternalId>();
  const out: Candidate[] = [];
  for (const c of items) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
  return out;
}

const matches = (title: string, text: string): boolean => title.toLowerCase().includes(text.toLowerCase());

function planCandidates(ctx: PlanEditContext, text: string): Candidate[] {
  return distinct(
    ctx.blocks.filter((b) => b.kind === "work" && b.taskId !== undefined && matches(b.label, text)).map((b) => ({ id: b.taskId!, title: b.label })),
  );
}

type Lookup = { readonly ok: true; readonly id: ExternalId } | { readonly ok: false; readonly reply: string };

function lookup(ctx: PlanEditContext, text: string, includeOpenTasks: boolean): Lookup {
  let found = planCandidates(ctx, text);
  if (found.length === 0 && includeOpenTasks) {
    found = distinct(ctx.tasks.filter((t) => matches(t.title, text)).map((t) => ({ id: t.id, title: t.title })));
  }
  if (found.length === 0) return { ok: false, reply: `I couldn't find ${text} in today's Plan.` };
  if (found.length > 1) {
    const titles = found.slice(0, 3).map((c) => `"${c.title}"`).join(", ");
    const more = found.length > 3 ? ", and more" : "";
    return { ok: false, reply: `Which one do you mean: ${titles}${more}? Say the fuller name.` };
  }
  return { ok: true, id: found[0]!.id };
}

const zoneOffsetMinutes = (ms: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000) / 60_000;
};

/** The instant at `minutes` past local midnight on `date` in `timeZone` (DST-safe fixed-point). */
export function localMinutesToIso(date: IsoDate, minutes: number, timeZone: string): IsoDateTime {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, 0, 0, 0) + minutes * 60_000;
  let offset = zoneOffsetMinutes(wall, timeZone);
  for (let i = 0; i < 4; i++) {
    const next = zoneOffsetMinutes(wall - offset * 60_000, timeZone);
    if (next === offset) break;
    offset = next;
  }
  return new Date(wall - offset * 60_000).toISOString();
}

export function resolvePlanEdit(command: PlanEditCommand, ctx: PlanEditContext): PlanEditResolution {
  switch (command.kind) {
    case "move": {
      // Work blocks only: a calendar event or routine of that name is a calendar edit, not a Plan edit.
      const found = planCandidates(ctx, command.targetText);
      if (found.length === 0) return { kind: "pass" };
      if (found.length > 1) {
        const r = lookup(ctx, command.targetText, false);
        if (!r.ok) return { kind: "reply", reply: r.reply };
      }
      const taskId = found[0]!.id;
      const own = ctx.blocks.filter((b) => b.kind === "work" && b.taskId === taskId);
      const block = own.find((b) => Date.parse(b.start) >= ctx.nowMs) ?? own[0]!;
      const when = command.when!;
      const newStart =
        when.kind === "time"
          ? localMinutesToIso(ctx.date, when.minutes, ctx.timeZone)
          : ctx.lunchEnd ?? localMinutesToIso(ctx.date, 13 * 60, ctx.timeZone);
      return { kind: "request", request: { kind: "move-block", planBlockId: block.id, newStart } };
    }
    case "drop": {
      const r = lookup(ctx, command.targetText, true);
      return r.ok ? { kind: "request", request: { kind: "drop-task", taskId: r.id } } : { kind: "reply", reply: r.reply };
    }
    case "unpin": {
      const r = lookup(ctx, command.targetText, true);
      return r.ok ? { kind: "request", request: { kind: "unpin-task", taskId: r.id } } : { kind: "reply", reply: r.reply };
    }
    case "swap": {
      const remove = lookup(ctx, command.otherText!, false);
      if (!remove.ok) return { kind: "reply", reply: remove.reply };
      const add = lookup(ctx, command.targetText, true);
      if (!add.ok) return { kind: "reply", reply: add.reply };
      if (add.id === remove.id) return { kind: "reply", reply: "Those are the same Task, so there's nothing to swap." };
      return { kind: "request", request: { kind: "swap", addTaskId: add.id, removeTaskId: remove.id } };
    }
  }
}

/** Shown when a line reads as a Plan edit but isn't one of the supported forms. */
export const PLAN_EDIT_HOW_TO_REPLY =
  "I can change today's Plan from a line like \"work on X instead of Y\", \"move X after lunch\", \"move X to 4\", \"drop X today\" or \"unpin X\". Say it that way and I'll show you the change before applying it.";

/**
 * src/core/reshuffle-preview.ts
 *
 * Pure helpers for the reshuffle preview: diffing the stored day against a
 * proposed one, the calendar-version hash, the one-line summary, and the
 * proposal's time-to-live.
 */
import type { IsoDateTime, PlanBlock } from "../types/domain.ts";

/** How long an open reshuffle preview stays approvable. */
export const RESHUFFLE_PROPOSAL_TTL_MINUTES = 10;

export interface PlanBlockDiff {
  readonly movedBlockIds: readonly string[];
  readonly unchangedBlockIds: readonly string[];
}

/**
 * Work blocks are matched by Task (the nth block of a Task against the nth
 * block it had before). A proposed work block is unchanged when its match has
 * the same start and end; otherwise, or when it has no match, it moved.
 * Breaks and calendar anchors are never reported.
 */
export function diffPlanBlocks(old: readonly PlanBlock[], proposed: readonly PlanBlock[]): PlanBlockDiff {
  const oldByKey = new Map<string, PlanBlock>();
  const counts = new Map<string, number>();
  const keyFor = (b: PlanBlock, seen: Map<string, number>): string | undefined => {
    if (b.kind !== "work" || b.taskId === undefined) return undefined;
    const n = seen.get(b.taskId) ?? 0;
    seen.set(b.taskId, n + 1);
    return `${b.taskId}#${n}`;
  };
  for (const b of [...old].sort((a, c) => Date.parse(a.start) - Date.parse(c.start))) {
    const key = keyFor(b, counts);
    if (key !== undefined) oldByKey.set(key, b);
  }
  const movedBlockIds: string[] = [];
  const unchangedBlockIds: string[] = [];
  const seenProposed = new Map<string, number>();
  for (const b of [...proposed].sort((a, c) => Date.parse(a.start) - Date.parse(c.start))) {
    const key = keyFor(b, seenProposed);
    if (key === undefined) continue;
    const before = oldByKey.get(key);
    if (before !== undefined && Date.parse(before.start) === Date.parse(b.start) && Date.parse(before.end) === Date.parse(b.end)) {
      unchangedBlockIds.push(b.id);
    } else {
      movedBlockIds.push(b.id);
    }
  }
  return { movedBlockIds, unchangedBlockIds };
}

/** A stable hash over `id|start|end` of each event, order-independent. Titles are ignored. */
export function calendarVersionHash(events: readonly { readonly id: string; readonly start: IsoDateTime; readonly end: IsoDateTime }[]): string {
  const text = events
    .map((e) => `${e.id}|${Date.parse(e.start)}|${Date.parse(e.end)}`)
    .sort()
    .join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface ReshuffleSummaryInput {
  readonly movedTitles: readonly string[];
  readonly deferredTitles: readonly string[];
  readonly needsDataCount: number;
  readonly rejectedReason?: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One line naming the moves and the deferred Tasks. */
export function buildReshuffleSummary(input: ReshuffleSummaryInput): string {
  if (input.rejectedReason !== undefined) return input.rejectedReason;
  const parts: string[] = [];
  if (input.movedTitles.length > 0) {
    const shown = input.movedTitles.slice(0, 3).join(", ");
    const rest = input.movedTitles.length - 3;
    parts.push(`Moves ${plural(input.movedTitles.length, "block")} (${shown}${rest > 0 ? `, +${rest} more` : ""})`);
  } else {
    parts.push("Nothing moves");
  }
  if (input.deferredTitles.length > 0) {
    parts.push(`defers ${input.deferredTitles.slice(0, 3).join(", ")}${input.deferredTitles.length > 3 ? `, +${input.deferredTitles.length - 3} more` : ""}`);
  }
  if (input.needsDataCount > 0) {
    parts.push(`${plural(input.needsDataCount, "Task")} left out until they have a duration or due date`);
  }
  return `${parts.join("; ")}.`;
}

/** True once a preview created at `createdAt` is older than its TTL as of `now`. */
export function isProposalExpired(createdAt: IsoDateTime, now: Date): boolean {
  return now.getTime() - Date.parse(createdAt) >= RESHUFFLE_PROPOSAL_TTL_MINUTES * 60_000;
}

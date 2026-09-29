/**
 * src/core/reshuffle-preview.ts
 *
 * Pure helpers for the reshuffle preview: diffing the stored day against a
 * proposed one, the calendar-version hash, the one-line summary, and the
 * proposal's time-to-live.
 */
import { toOwnedBlock } from "./calendar-blocks.ts";
import type { HomeCalendarBlock, ReshufflePreviewView } from "../types/api.ts";
import type { IsoDateTime, PlanBlock, Proposal, ReshufflePreview, ReshuffleRequest } from "../types/domain.ts";

/** How long an open reshuffle preview stays approvable. */
export const RESHUFFLE_PROPOSAL_TTL_MINUTES = 10;

export interface PlanBlockDiff {
  readonly movedBlockIds: readonly string[];
  readonly unchangedBlockIds: readonly string[];
}

/**
 * Work blocks (by Task) and routine blocks (by Routine) are matched (the nth block of a Task against the nth
 * block it had before). A proposed work block is unchanged when its match has
 * the same start and end; otherwise, or when it has no match, it moved.
 * Breaks and calendar anchors are never reported.
 */
export function diffPlanBlocks(old: readonly PlanBlock[], proposed: readonly PlanBlock[]): PlanBlockDiff {
  const oldByKey = new Map<string, PlanBlock>();
  const counts = new Map<string, number>();
  const keyFor = (b: PlanBlock, seen: Map<string, number>): string | undefined => {
    const subject = b.kind === "work" ? b.taskId : b.kind === "routine" ? (b.routineId === undefined ? undefined : `routine:${b.routineId}`) : undefined;
    if (subject === undefined) return undefined;
    const n = seen.get(subject) ?? 0;
    seen.set(subject, n + 1);
    return `${subject}#${n}`;
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
  /** Routines that fit nowhere today. */
  readonly unplacedRoutineLabels?: readonly string[];
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
  const unplaced = (input.unplacedRoutineLabels ?? []).map((label) => `Couldn't fit ${label} today.`);
  return [`${parts.join("; ")}.`, ...unplaced].join(" ");
}

/** True once a preview created at `createdAt` is older than its TTL as of `now`. */
export function isProposalExpired(createdAt: IsoDateTime, now: Date): boolean {
  return now.getTime() - Date.parse(createdAt) >= RESHUFFLE_PROPOSAL_TTL_MINUTES * 60_000;
}

/** The request id `openProposal` gives a proposal's interaction request. */
export function reshuffleRequestId(proposalId: string): string {
  return `proposal:${proposalId}`;
}

/**
 * The wire view of an open reshuffle proposal: the proposed Yoh-owned blocks
 * (flagged `moved`) layered with the live fixed events, in start order.
 */
export function toReshufflePreviewView(
  proposal: Proposal<ReshufflePreview>,
  fixedBlocks: readonly HomeCalendarBlock[],
  nowMs: number,
): ReshufflePreviewView {
  const preview = proposal.suggested;
  const moved = new Set(preview.movedBlockIds);
  const owned = preview.blocks
    .filter((b): b is PlanBlock & { kind: "work" | "break" | "routine" } => b.kind === "work" || b.kind === "break" || b.kind === "routine")
    .map((b) => ({ ...toOwnedBlock(b, false, nowMs), moved: moved.has(b.id) }));
  const fixed = fixedBlocks.map((b) => ({ ...b, moved: false }));
  const blocks = [...owned, ...fixed].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return {
    proposalId: proposal.id,
    requestId: reshuffleRequestId(proposal.id),
    date: preview.date,
    summary: preview.summary,
    blocks,
    deferredTaskIds: preview.deferredTaskIds,
    needsDataTaskIds: preview.needsDataTaskIds,
    unplacedRoutineLabels: preview.unplacedRoutineLabels,
    ...(preview.rejectedReason !== undefined ? { rejectedReason: preview.rejectedReason } : {}),
    expiresAt: new Date(Date.parse(proposal.createdAt) + RESHUFFLE_PROPOSAL_TTL_MINUTES * 60_000).toISOString(),
  };
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isIsoInstant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

/** Validates an untrusted JSON body as a `ReshuffleRequest`; `undefined` when it isn't one. */
export function parseReshuffleRequest(value: unknown): ReshuffleRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  switch (v["kind"]) {
    case "reflow-now":
      return { kind: "reflow-now" };
    case "move-block":
      return nonEmpty(v["planBlockId"]) && isIsoInstant(v["newStart"]) ? { kind: "move-block", planBlockId: v["planBlockId"], newStart: v["newStart"] } : undefined;
    case "pin-task":
      return nonEmpty(v["taskId"]) && isIsoInstant(v["newStart"]) ? { kind: "pin-task", taskId: v["taskId"], newStart: v["newStart"] } : undefined;
    case "unpin-task":
      return nonEmpty(v["taskId"]) ? { kind: "unpin-task", taskId: v["taskId"] } : undefined;
    case "drop-task":
      return nonEmpty(v["taskId"]) ? { kind: "drop-task", taskId: v["taskId"] } : undefined;
    case "swap":
      return nonEmpty(v["addTaskId"]) && nonEmpty(v["removeTaskId"]) ? { kind: "swap", addTaskId: v["addTaskId"], removeTaskId: v["removeTaskId"] } : undefined;
    default:
      return undefined;
  }
}

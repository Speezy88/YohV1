/**
 * src/core/routine-placement.ts
 *
 * Epic 10 (10.3, R8): places a day's Routines. Pure — no I/O, no clock.
 * A Routine occupies time like an anchor but does NOT consume the Time Budget.
 * It sits at its declared time (or its pin start), else the nearest free slot
 * of the same length (5-minute steps) inside the day; a Routine that fits
 * nowhere is reported by label, never dropped silently. A Routine whose
 * declared time is already past at fit start is skipped silently.
 */
import type { PlanBlock } from "../types/domain.ts";

const STEP_MS = 5 * 60_000;
const MINUTE_MS = 60_000;

/** A Routine resolved onto one day: absolute start instant and length. */
export interface DayRoutine {
  readonly id: string;
  readonly label: string;
  readonly startMs: number;
  readonly durationMinutes: number;
  /** Where the stored Plan already had this Routine (still in the future); wanted over `startMs`, under a pin. */
  readonly storedStartMs?: number;
  /** Set when Spencer pinned this Routine for today; overrides everything. */
  readonly pinnedStartMs?: number;
}

export interface PlaceRoutinesInput {
  readonly routines: readonly DayRoutine[];
  /** Spans already taken: anchors, protected windows, pinned Tasks. */
  readonly fixed: readonly { readonly startMs: number; readonly endMs: number }[];
  readonly nowMs: number;
  /** End of the day (exclusive): a routine may not run past it. */
  readonly dayEndMs: number;
  readonly idPrefix: string;
}

export interface PlaceRoutinesOutput {
  readonly blocks: readonly PlanBlock[];
  readonly unplacedLabels: readonly string[];
}

interface Span {
  readonly startMs: number;
  readonly endMs: number;
}

const overlaps = (a: Span, b: Span): boolean => a.startMs < b.endMs && b.startMs < a.endMs;

export function placeRoutines(input: PlaceRoutinesInput): PlaceRoutinesOutput {
  const busy: Span[] = input.fixed.map((f) => ({ startMs: f.startMs, endMs: f.endMs }));
  const blocks: PlanBlock[] = [];
  const unplacedLabels: string[] = [];
  // Pinned routines claim their time first, then the rest by declared time.
  const ordered = [...input.routines].sort(
    (a, b) => Number(b.pinnedStartMs !== undefined) - Number(a.pinnedStartMs !== undefined) || a.startMs - b.startMs,
  );
  for (const r of ordered) {
    const wantedMs = r.pinnedStartMs ?? r.storedStartMs ?? r.startMs;
    const lengthMs = r.durationMinutes * MINUTE_MS;
    // Wanted time already over: skip silently.
    if (wantedMs + lengthMs <= input.nowMs) continue;
    const free = (startMs: number): boolean => {
      const span = { startMs, endMs: startMs + lengthMs };
      return span.endMs <= input.dayEndMs && !busy.some((b) => overlaps(span, b));
    };
    let chosen: number | undefined;
    if (wantedMs < input.nowMs) {
      // Wanted start already passed but not the end: it stays there if that span is free, else it is skipped.
      if (free(wantedMs)) chosen = wantedMs;
    } else {
      for (let delta = 0; delta <= input.dayEndMs - input.nowMs; delta += STEP_MS) {
        if (wantedMs - delta >= input.nowMs && free(wantedMs - delta)) chosen = wantedMs - delta;
        else if (free(wantedMs + delta)) chosen = wantedMs + delta;
        if (chosen !== undefined) break;
      }
    }
    if (chosen === undefined) {
      unplacedLabels.push(r.label);
      continue;
    }
    busy.push({ startMs: chosen, endMs: chosen + lengthMs });
    blocks.push({
      id: `${input.idPrefix}-routine-${r.id}`,
      kind: "routine",
      routineId: r.id,
      label: r.label,
      start: new Date(chosen).toISOString(),
      end: new Date(chosen + lengthMs).toISOString(),
      ...(r.pinnedStartMs !== undefined ? { pinned: true as const } : {}),
    });
  }
  return { blocks: blocks.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), unplacedLabels };
}

/** The reasoning line with a note naming Routines that found no slot. Unchanged when none. */
export function appendUnplacedRoutines(reasoning: string, unplacedLabels: readonly string[]): string {
  if (unplacedLabels.length === 0) return reasoning;
  const note = `I couldn't fit ${unplacedLabels.join(", ")} into today.`;
  return reasoning.length > 0 ? `${reasoning} ${note}` : note;
}

/**
 * src/app/time-budget.ts
 *
 * Story 8.3 (AD-16, C3). Moved from `shell/chat-cli.ts`'s `declareTimeBudget`
 * (the thin validate-then-persist wiring) and `formatMinutesForDisplay` (the
 * confirmation-line formatter) — logic unchanged, now returning a `Result`
 * instead of writing to `io` directly. `app/chat-turn.ts` is the one caller;
 * it wraps `receipt` into a `ChatTurnResponse` (C3 pins this file's own
 * return shape as `Result<{receipt: string}>`, distinct from the other four
 * Task-4 capability files, which each already return a `ChatTurnResponse`
 * directly).
 */
import { putTimeBudget, type MemoryStore } from "../adapters/memory-store.ts";
import { errorCopy } from "../core/error-copy.ts";
import { shapeDeclaredTimeBudget } from "../core/time-budget.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface TimeBudgetDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  readonly now: () => Date;
}

export interface DeclareTimeBudgetInput {
  readonly totalMinutes: number;
}

export interface DeclareTimeBudgetOutput {
  readonly receipt: string;
}

/** Formats a minute count for the confirmation line, e.g. `360` -> `"360 minutes (6h)"`. Moved verbatim from chat-cli.ts's private helper. */
function formatMinutesForDisplay(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  const hoursLabel = Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}h`;
  return `${totalMinutes} minutes (${hoursLabel})`;
}

/**
 * Runs the pure validate/shape step (`core/time-budget.ts`'s
 * `shapeDeclaredTimeBudget`) and, only on success, persists the result as
 * today's Time Budget in `memory-store.ts` (`putTimeBudget`) — the actual
 * I/O `time-budget.ts` itself is forbidden from doing (AD-2). `today` is
 * computed from the injected `now`/`timeZone` rather than read from the real
 * clock directly, so this stays trivially testable with a fixed date.
 */
export async function declareTimeBudget(
  deps: TimeBudgetDeps,
  input: DeclareTimeBudgetInput,
): Promise<Result<DeclareTimeBudgetOutput, YohError>> {
  const today = localIsoDate(deps.now(), deps.timeZone);
  const shaped = shapeDeclaredTimeBudget({ totalMinutes: input.totalMinutes, date: today });
  if (!shaped.ok) {
    return { ok: false, error: { kind: "validation", message: `I couldn't set that Time Budget — ${errorCopy(shaped.error)}` } };
  }
  putTimeBudget(deps.store, shaped.value);
  return {
    ok: true,
    value: { receipt: `Got it — today's Time Budget is set to ${formatMinutesForDisplay(shaped.value.totalMinutes)}.` },
  };
}

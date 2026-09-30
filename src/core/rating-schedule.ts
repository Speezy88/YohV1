/**
 * Rating schedule (Story 13.11, FR-60): pure decision for showing the occasional
 * "How is Yoh doing?" prompt. Randomness is injected (`draw` in [0,1)).
 */
import type { IsoDate } from "../types/domain.ts";

export const RATING_PROMPT_PROBABILITY = 0.35;
export const RATING_DISMISSALS_TO_PAUSE = 3;
export const RATING_PAUSE_DAYS = 7;

export interface RatingState {
  readonly lastPromptDate?: IsoDate;
  readonly promptsShownOnLastDate: number;
  readonly consecutiveDismissals: number;
  readonly pausedUntil?: IsoDate;
  readonly extraPromptDue: boolean;
  readonly openPromptId?: string;
}

export function decideRatingPrompt(
  state: RatingState,
  ctx: { readonly substantive: boolean; readonly today: IsoDate; readonly draw: number },
): boolean {
  if (!ctx.substantive) return false;
  if (state.openPromptId !== undefined) return false;
  if (state.pausedUntil !== undefined && ctx.today < state.pausedUntil) return false;
  const shownToday = state.lastPromptDate === ctx.today ? state.promptsShownOnLastDate : 0;
  const allowed = shownToday === 0 || (shownToday === 1 && state.extraPromptDue);
  if (!allowed) return false;
  return ctx.draw < RATING_PROMPT_PROBABILITY;
}

/** `today` plus `RATING_PAUSE_DAYS` days. */
export function pausedUntilAfterDismissals(today: IsoDate): IsoDate {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + RATING_PAUSE_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Day-scale expiry for proposals that wait for an answer (AD-29). Pure. */
import type { IsoDateTime } from "../types/domain.ts";

export const RULE_PROPOSAL_TTL_DAYS = 7;
/** A Pattern proposal unanswered this long is withdrawn and treated as declined (Story 13.13). */
export const PATTERN_PROPOSAL_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** True once `createdAt` is more than `days` whole days before `now`; an unparseable timestamp is not expired. */
export function isOlderThanDays(createdAt: IsoDateTime, now: Date, days: number): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return now.getTime() - created > days * DAY_MS;
}

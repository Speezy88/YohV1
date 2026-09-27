/**
 * src/app/plan-view.ts
 *
 * Story 8.3 (AD-16). Moved from `shell/chat-cli.ts`'s `showPlanCommand` —
 * looks up today's stored Plan (`getPlan`) and, if one exists, renders it via
 * `renderPlan`, the exact same pure renderer `rituals/morning-ritual.ts`
 * uses to build the Morning Ritual's own notification, so what this shows
 * can never drift from what the real notification showed.
 *
 * Renders with `color: false` — `ChatTurnResponse.reply` is pinned ANSI-free
 * (C2), so the on-demand Plan-view command loses its accent-header/muted-
 * reasoning terminal color as a result: same content, same wrapping, no
 * color escapes (accepted per this story's plan — the CLI itself retires in
 * Story 8.9).
 */
import { getPlan, type MemoryStore } from "../adapters/memory-store.ts";
import { localIsoDate, renderPlan } from "../rituals/ritual-shared.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface PlanViewDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  readonly now: () => Date;
}

/**
 * If no Plan has been generated yet today (the Morning Ritual hasn't run,
 * or it ran but produced `nothing-to-plan`/`nothing-fits`), this says so
 * plainly rather than fabricating one or failing silently.
 */
export async function showPlan(
  deps: PlanViewDeps,
  _input: Record<string, never>,
): Promise<Result<ChatTurnResponse, YohError>> {
  const today = localIsoDate(deps.now(), deps.timeZone);
  const stored = getPlan(deps.store, today);
  if (!stored) {
    return { ok: true, value: { reply: "No Plan has been generated for today yet.", receipts: [] } };
  }
  return { ok: true, value: { reply: renderPlan(stored.data, { color: false }), receipts: [] } };
}

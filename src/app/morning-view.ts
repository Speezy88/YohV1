/**
 * src/app/morning-view.ts
 *
 * Story 8.7 (FR-1, FR-42): `/morning`'s read-only view — today's already-
 * generated Plan (never regenerated), its reasoning line, and every open
 * item (`app/surface-open-items.ts`'s `surfaceOpenItems`, which builds
 * FR-25 suggestions lazily). This file structurally cannot call Notion,
 * Calendar, Pushover, or plan generation: `MorningViewDeps` names none of
 * them, so doing so is a compile error, not just an untested path — pinned
 * by this file's own test suite enumerating the deps object's keys.
 */
import { getPlan, type MemoryStore } from "../adapters/memory-store.ts";
import { localIsoDate, renderPlan } from "../rituals/ritual-shared.ts";
import { offerPattern } from "./pattern-offer.ts";
import { surfaceOpenItems, type SurfaceOpenItemsDeps } from "./surface-open-items.ts";
import type { MorningViewResponse, OpenItemQuestion } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface MorningViewDeps extends SurfaceOpenItemsDeps {
  readonly store: MemoryStore;
  readonly now: () => Date;
  readonly timeZone: string;
}

/** `/morning`'s entry point (C3): reads only, never a push, never a regeneration (FR-1, FR-42). */
export async function morningView(deps: MorningViewDeps, _input: Record<string, never>): Promise<Result<MorningViewResponse, YohError>> {
  const today = localIsoDate(deps.now(), deps.timeZone);
  const stored = getPlan(deps.store, today);

  const openItemsResult = await surfaceOpenItems(deps, {});
  if (!openItemsResult.ok) return openItemsResult;

  // Story 13.13: the day's one Pattern question, if any. A failure or absence changes nothing.
  let patternQuestion: OpenItemQuestion | undefined;
  if (deps.memoryItems) {
    const offered = await offerPattern({ memoryItems: deps.memoryItems, store: deps.store, now: deps.now, timeZone: deps.timeZone }, {});
    if (offered.ok) patternQuestion = offered.value.question;
  }
  const extra = patternQuestion ? { patternQuestion } : {};

  if (!stored) {
    return { ok: true, value: { today, plan: undefined, openItems: openItemsResult.value.items, ...extra } };
  }

  // Split fields per `MorningViewResponse.plan`'s shape: `renderPlan`
  // normally appends `plan.reasoning` inline, so it's blanked here and the
  // real value is threaded through separately, rather than re-implementing
  // block-list rendering a second time. `includeHeader: false` — the
  // response's own `today` field already carries the date.
  const text = renderPlan({ ...stored.data, reasoning: "" }, { color: false, includeHeader: false });
  return {
    ok: true,
    value: { today, plan: { text, reasoning: stored.data.reasoning }, openItems: openItemsResult.value.items, ...extra },
  };
}

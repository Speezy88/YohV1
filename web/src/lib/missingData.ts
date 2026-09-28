/**
 * web/src/lib/missingData.ts
 *
 * Real-use fixes plan, Task 2 (Spencer: "get rid of the 'waiting on you'
 * section in the chat. maybe just add a 'x tasks missing data' in the top
 * right") introduced the Chat header chip. Story 9.4 (chunk B) re-points it
 * to the sandbox queue, the ONE computed source shared with the needs-data
 * notification (AD-11): `useMissingDataCount` now fetches
 * `GET /api/sandbox/count` (`app/sandbox-queue.ts`'s own item list, via
 * `NeedsDataCountResponse`) instead of the Tasks-view "any missing field"
 * rule, and refetches on a `tasks`/`plan` hint from the shared event bus
 * exactly as before — a sandbox save already raises the `tasks` topic
 * (`app/sandbox-submit.ts`), so a session's Save/Skip keeps this current.
 *
 * `openMissingData` is the chip's ONE click handler: it now opens Chat with
 * `/sandbox` already running (`openChatWithCommand`, `chatPanel.ts`) instead
 * of navigating to the Tasks page's "Missing data" filter — the chip lives
 * inside the (already open) Chat panel, so this just runs the command in
 * place.
 */
import { useEffect, useState } from "react";
import { apiClient } from "./apiClient.ts";
import { onHint } from "./eventBus.ts";
import { openChatWithCommand } from "./chatPanel.ts";

/** Hint topics that can change the sandbox queue count — same topics `lib/tasks.ts`'s list hook refetches on; a sandbox save/skip itself raises the `tasks` topic (`app/sandbox-submit.ts`), so it's covered without a bespoke topic. */
const REFETCH_TOPICS = new Set(["tasks", "plan"]);

export type MissingDataCountState = { readonly status: "loading" } | { readonly status: "loaded"; readonly count: number } | { readonly status: "error" };

async function fetchMissingDataCount(): Promise<MissingDataCountState> {
  try {
    const res = await apiClient.api.sandbox.count.$get();
    const result = (await res.json()) as { ok: true; value: { count: number } } | { ok: false; error: { message: string } };
    return result.ok ? { status: "loaded", count: result.value.count } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** Fetches once on mount, then refetches on a `tasks`/`plan` hint. A fetch failure quietly hides the chip (`missingDataChipLabel` treats anything but a loaded, positive count as "don't show it") rather than showing a stale or wrong number. */
export function useMissingDataCount(): MissingDataCountState {
  const [state, setState] = useState<MissingDataCountState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const next = await fetchMissingDataCount();
      if (!cancelled) setState(next);
    };
    void load();
    return onHint((hint) => {
      if (REFETCH_TOPICS.has(hint.topic)) void load();
    });
  }, []);

  return state;
}

/** The chip's own label — tabular numerals, `undefined` (hidden) at 0 or while loading/errored. */
export function missingDataChipLabel(state: MissingDataCountState): string | undefined {
  if (state.status !== "loaded" || state.count <= 0) return undefined;
  return `${state.count} need data`;
}

/** The chip's ONE click handler: runs `/sandbox` in the (already open) Chat panel it lives in. */
export function openMissingData(): void {
  openChatWithCommand("/sandbox");
}

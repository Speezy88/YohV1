/**
 * web/src/lib/missingData.ts
 *
 * Real-use fixes plan, Task 2 (Spencer: "get rid of the 'waiting on you'
 * section in the chat. maybe just add a 'x tasks missing data' in the top
 * right"). `useMissingDataCount` fetches the Chat header chip's count from
 * `GET /api/tasks/missing-count` — the server's own `taskMissingFields` rule
 * (`app/tasks-view.ts`), the SAME one the Tasks page's row-level "Add time /
 * Add energy…" badges already use, never re-derived here — and refetches on
 * a `tasks`/`plan` hint from the shared event bus, mirroring `lib/tasks.ts`'s
 * own `useTasksList`.
 *
 * `openMissingData` is the chip's ONE click handler: closes Chat, arms the
 * Tasks page's "Missing data" filter (`missingDataFilter.ts`), and switches
 * to Tasks. Epic 9 will re-point the chip at `/sandbox` instead — a one-line
 * change to this function's body, nowhere else.
 */
import { useEffect, useState } from "react";
import { apiClient } from "./apiClient.ts";
import { onHint } from "./eventBus.ts";
import { closeChatPanel } from "./chatPanel.ts";
import { setMissingDataFilterActive } from "./missingDataFilter.ts";
import { PAGES, type PageNavigation } from "./pages.ts";

const TASKS_PAGE_INDEX = PAGES.findIndex((p) => p.id === "tasks");

/** Hint topics that can change how many Tasks are missing data — same topics `lib/tasks.ts`'s list hook refetches on. */
const REFETCH_TOPICS = new Set(["tasks", "plan"]);

export type MissingDataCountState = { readonly status: "loading" } | { readonly status: "loaded"; readonly count: number } | { readonly status: "error" };

async function fetchMissingDataCount(): Promise<MissingDataCountState> {
  try {
    const res = await apiClient.api.tasks["missing-count"].$get();
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

/** The chip's own label — singular at 1, `undefined` (hidden) at 0 or while loading/errored. */
export function missingDataChipLabel(state: MissingDataCountState): string | undefined {
  if (state.status !== "loaded" || state.count <= 0) return undefined;
  return `${state.count} task${state.count === 1 ? "" : "s"} missing data`;
}

/**
 * The chip's ONE click handler. Closing Chat first (rather than after
 * navigating) matches every other Chat-closing action in this codebase
 * (Esc, the backdrop, Close) — Tasks then arrives already in the
 * foreground, filtered, with nothing left dimmed behind it.
 */
export function openMissingData(nav: Pick<PageNavigation, "goTo"> | undefined): void {
  closeChatPanel();
  setMissingDataFilterActive(true);
  nav?.goTo(TASKS_PAGE_INDEX);
}

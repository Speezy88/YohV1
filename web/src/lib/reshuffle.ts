/**
 * web/src/lib/reshuffle.ts
 *
 * Clients for `POST /api/plan/reshuffle` (+ `/approve`, `/discard`) and the
 * small module store Home's preview card reads. The open preview itself
 * arrives on `HomeViewResponse.reshuffle`; this store adds only what Home
 * doesn't carry: a freshly requested or recomputed preview shown before the
 * next Home fetch lands, the in-flight flag, and a visible error or notice.
 */
import { useSyncExternalStore } from "react";
import { apiClient } from "./apiClient.ts";
import { refetchHomeView } from "./homeView.ts";
import type { ReshuffleRequest } from "../../../src/types/domain.ts";
import type { ReshufflePreviewView } from "../../../src/types/api.ts";

interface ReshuffleState {
  readonly override: ReshufflePreviewView | undefined;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly notice: string | undefined;
}

const INITIAL: ReshuffleState = { override: undefined, busy: false, error: undefined, notice: undefined };
let state: ReshuffleState = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<ReshuffleState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const GENERIC_ERROR = "Couldn't update the preview. Try again.";
const CALENDAR_FAILED = "Couldn't update your calendar";
const RECOMPUTED_NOTICE = "Your day changed, so here is a fresh preview.";

/** The view Home renders: the open preview (a just-made override wins over Home's last fetch) plus the store's flags. */
export interface ReshuffleView {
  readonly preview: ReshufflePreviewView | undefined;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly notice: string | undefined;
}

export function useReshuffle(fromHome: ReshufflePreviewView | undefined): ReshuffleView {
  const s = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => state,
  );
  return { preview: s.override ?? fromHome, busy: s.busy, error: s.error, notice: s.notice };
}

/** After Home has refetched it is authoritative again: drop the local override. */
async function settle(): Promise<void> {
  await refetchHomeView();
  set({ override: undefined, busy: false });
}

/** Asks for a preview (for example, unpinning a Task). The result shows at once, then Home refetches. */
export async function requestReshuffle(request: ReshuffleRequest): Promise<void> {
  set({ busy: true, error: undefined, notice: undefined });
  try {
    const res = await apiClient.api.plan.reshuffle.$post({ json: request as never });
    const result = await res.json();
    if (!result.ok) {
      set({ busy: false, error: result.error.message });
      return;
    }
    set({ override: result.value.preview });
    await settle();
  } catch {
    set({ busy: false, error: GENERIC_ERROR });
  }
}

export async function approveReshuffle(proposalId: string): Promise<void> {
  set({ busy: true, error: undefined, notice: undefined });
  try {
    const res = await apiClient.api.plan.reshuffle.approve.$post({ json: { proposalId } });
    const result = await res.json();
    if (!result.ok) {
      set({ busy: false, error: result.error.message });
      await refetchHomeView();
      return;
    }
    if (result.value.status === "recomputed") {
      set({ override: result.value.preview, notice: RECOMPUTED_NOTICE });
    } else if (result.value.calendarFailedBlockIds.length > 0) {
      set({ error: CALENDAR_FAILED });
    }
    await settle();
  } catch {
    set({ busy: false, error: GENERIC_ERROR });
  }
}

export async function discardReshuffle(proposalId: string): Promise<void> {
  set({ busy: true, error: undefined, notice: undefined });
  try {
    const res = await apiClient.api.plan.reshuffle.discard.$post({ json: { proposalId } });
    const result = await res.json();
    if (!result.ok) {
      set({ busy: false, error: result.error.message });
      return;
    }
    await settle();
  } catch {
    set({ busy: false, error: GENERIC_ERROR });
  }
}

/** Test-only: clears module-level state between tests. */
export function __resetReshuffleForTests(): void {
  state = INITIAL;
}

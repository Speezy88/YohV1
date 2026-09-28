/**
 * web/src/lib/sandbox.ts
 *
 * Story 9.2: the `/sandbox` session's own client-held bookkeeping —
 * `useSyncExternalStore`, the `chatStore.ts`/`chatPanel.ts` shape family.
 * `card` is the currently pending card (its OWN rendering lives as a
 * `"sandbox-card"` `StreamEntry` in `chatStore.ts` — this store tracks it
 * only so `saveCard`/`skipCard` know which Task and exclude list to send);
 * `exclude` accumulates BOTH saved and skipped taskIds this session
 * (deliberate: also guards against Notion read-after-write staleness
 * reintroducing a just-saved Task at the top of the very next
 * `sandboxQueue` call); `outcomes` accumulates this session's save results,
 * consumed by Story 9.3's `finishSandbox()`.
 *
 * `startSandbox` is called by `chatStore.ts`'s `send()` when a
 * `ChatTurnResponse` carries `sandboxCard` — the ONLY entry point into a
 * session (controller ruling (a): the first card always arrives through
 * `chatTurn`'s own dispatch).
 */
import { useSyncExternalStore } from "react";
import { appendStreamEntry, updateStreamEntry } from "./chatStore.ts";
import { requestSandboxSave, requestSandboxSkip } from "./sandboxClient.ts";
import type { SandboxCardView } from "../../../src/types/api.ts";

interface SandboxOutcomeRecord {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly ok: boolean;
}

export interface SandboxSessionState {
  readonly card: SandboxCardView | undefined;
  readonly exclude: readonly string[];
  readonly outcomes: readonly SandboxOutcomeRecord[];
}

const EMPTY: SandboxSessionState = { card: undefined, exclude: [], outcomes: [] };
let state: SandboxSessionState = EMPTY;
/** Internal-only: which chatStore entry the CURRENT `state.card` corresponds to. Exactly one is ever pending at a time. */
let entryId: string | undefined;
const listeners = new Set<() => void>();

function set(next: SandboxSessionState): void {
  state = next;
  listeners.forEach((l) => l());
}
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
function snapshot(): SandboxSessionState {
  return state;
}

export function useSandboxSession(): SandboxSessionState {
  return useSyncExternalStore(subscribe, snapshot);
}

export function startSandbox(card: SandboxCardView): void {
  entryId = appendStreamEntry({ kind: "sandbox-card", view: card, status: "pending" });
  set({ card, exclude: [], outcomes: [] });
}

function settleAndAdvance(next: SandboxCardView | undefined, patch: { status: "saved" | "skipped" | "failed"; receipt?: string }): void {
  if (entryId) updateStreamEntry(entryId, patch);
  entryId = next ? appendStreamEntry({ kind: "sandbox-card", view: next, status: "pending" }) : undefined;
}

export async function saveCard(input: { dueDate: string; estimatedDurationMinutes: string; area?: string; energy?: string }): Promise<void> {
  const card = state.card;
  if (!card) return;
  const result = await requestSandboxSave(card.taskId, { ...input, exclude: state.exclude });
  if (!result.ok) {
    // FR-38: an unresolvable value re-prompts on THIS card — it stays
    // pending, never advances, never counts as an outcome. The card's own
    // component renders `result`'s message inline (SandboxCard.tsx, later
    // chunk).
    return;
  }
  settleAndAdvance(result.value.next, { status: "saved", receipt: result.value.receipt });
  set({
    card: result.value.next,
    exclude: [...state.exclude, card.taskId],
    outcomes: [...state.outcomes, { taskId: card.taskId, taskTitle: card.taskTitle, ok: true }],
  });
  if (!result.value.next) await finishSandbox();
}

export async function skipCard(): Promise<void> {
  const card = state.card;
  if (!card) return;
  const result = await requestSandboxSkip(card.taskId, { exclude: state.exclude });
  const next = result.ok ? result.value.next : state.card; // a network hiccup on skip leaves the card in place — nothing was written either way
  if (result.ok) {
    settleAndAdvance(next, { status: "skipped" });
    set({ card: next, exclude: [...state.exclude, card.taskId], outcomes: state.outcomes });
    if (!next) await finishSandbox();
  }
}

/**
 * Story 9.2 scope: a quiet reset — matches the "all-skip session ends
 * quietly, no Finale, no server round trip, no notification" ruling for
 * the zero-saves case, and is the placeholder every OTHER case (>=1 save)
 * falls back to until Story 9.3 replaces this body with the real `POST
 * /api/sandbox/finish` call, the Finale bar `StreamEntry`, and the reward
 * chime. Never throws; safe to call unconditionally.
 */
export async function finishSandbox(): Promise<void> {
  entryId = undefined;
  set(EMPTY);
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetSandboxForTests(): void {
  entryId = undefined;
  state = EMPTY;
}

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
import { requestSandboxSave, requestSandboxSkip, requestSandboxFinish } from "./sandboxClient.ts";
import { playSandboxCompleteChime } from "./sandboxSound.ts";
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
/**
 * Internal-only: the current card's most recent save attempt, if it failed
 * and hasn't been superseded yet. Fix round 1: `outcomes` otherwise never
 * contains a failure (a failed save returns early without recording
 * anything, and a skip on an untouched card records nothing either) — a
 * `sandbox-failed` Finale would be unreachable from the UI. Recorded as an
 * `ok:false` outcome only once the card is actually let go via a successful
 * `skipCard` on the SAME card; a later successful `saveCard` on the same
 * card clears it instead, so a retry-then-succeed session never leaves a
 * stray failure behind (one outcome per task).
 */
let lastFailedCard: { taskId: string; taskTitle: string } | undefined;
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
  lastFailedCard = undefined;
  set({ card, exclude: [], outcomes: [] });
}

function settleAndAdvance(next: SandboxCardView | undefined, patch: { status: "saved" | "skipped" | "failed"; receipt?: string }): void {
  if (entryId) updateStreamEntry(entryId, patch);
  entryId = next ? appendStreamEntry({ kind: "sandbox-card", view: next, status: "pending" }) : undefined;
}

export type SaveCardOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

export async function saveCard(input: { dueDate: string; estimatedDurationMinutes: string; area?: string; energy?: string }): Promise<SaveCardOutcome> {
  const card = state.card;
  if (!card) return { ok: true };
  const result = await requestSandboxSave(card.taskId, { ...input, exclude: state.exclude });
  if (!result.ok) {
    // FR-38: an unresolvable value re-prompts on THIS card — it stays
    // pending, never advances. Fix round 1: remembered (not yet an outcome)
    // so that if Spencer then skips this same card instead of retrying, the
    // session doesn't quietly forget the failure — see `lastFailedCard`.
    lastFailedCard = { taskId: card.taskId, taskTitle: card.taskTitle };
    return { ok: false, message: result.message };
  }
  // A successful save on this card supersedes any earlier failed attempt on
  // it — only one outcome per task, and it's the latest one.
  lastFailedCard = undefined;
  settleAndAdvance(result.value.next, { status: "saved", receipt: result.value.receipt });
  set({
    card: result.value.next,
    exclude: [...state.exclude, card.taskId],
    outcomes: [...state.outcomes, { taskId: card.taskId, taskTitle: card.taskTitle, ok: true }],
  });
  if (!result.value.next) await finishSandbox();
  return { ok: true };
}

export async function skipCard(): Promise<void> {
  const card = state.card;
  if (!card) return;
  const result = await requestSandboxSkip(card.taskId, { exclude: state.exclude });
  const next = result.ok ? result.value.next : state.card; // a network hiccup on skip leaves the card in place — nothing was written either way
  if (result.ok) {
    settleAndAdvance(next, { status: "skipped" });
    // Fix round 1: skipping past a card whose LAST save attempt failed is
    // how a failure actually reaches `outcomes` — it never gets recorded at
    // the moment of the failed save itself (FR-38 re-prompts in place).
    const failedThisCard = lastFailedCard?.taskId === card.taskId;
    lastFailedCard = undefined;
    set({
      card: next,
      exclude: [...state.exclude, card.taskId],
      outcomes: failedThisCard ? [...state.outcomes, { taskId: card.taskId, taskTitle: card.taskTitle, ok: false }] : state.outcomes,
    });
    if (!next) await finishSandbox();
  }
}

/**
 * Story 9.3: how long the Finale's loading bar stays up at minimum, so a
 * near-instant response (the common case — every card write already
 * settled before the client advanced past it, Task 2) never flashes
 * illegibly. Waits only for whatever time REMAINS after the request
 * settles, never a flat delay stacked on top of an already-slow response
 * (Review Focus #3).
 */
export const SANDBOX_FINALE_MIN_DURATION_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Called automatically the instant the (exclude-adjusted) queue empties —
 * `saveCard`/`skipCard`'s own tail above, never a separate click (FR-38).
 * Ruling (a): a session that saved NOTHING this round (zero outcomes,
 * however many cards were skipped) ends quietly — no Finale, no server
 * call, no notification, no chime — since "Saved 0 Tasks" is never a
 * sentence Spencer should see. Otherwise, appends a pending Finale entry,
 * waits for `POST /api/sandbox/finish` to settle (at least
 * `SANDBOX_FINALE_MIN_DURATION_MS` total), resolves the entry with the
 * server's outcome, and plays the reward chime once when at least one
 * card saved this session. Never throws; safe to call unconditionally.
 */
export async function finishSandbox(): Promise<void> {
  const outcomes = state.outcomes;
  entryId = undefined;
  lastFailedCard = undefined;
  if (outcomes.length === 0) {
    appendStreamEntry({
      kind: "message",
      message: { id: `sandbox-finale-${Date.now()}`, role: "assistant", text: "Nothing more to place this round.", receipts: [], status: "done" },
    });
    set(EMPTY);
    return;
  }

  const finaleId = appendStreamEntry({ kind: "sandbox-finale", status: "pending" });
  const startedAt = Date.now();
  const result = await requestSandboxFinish(outcomes);
  const elapsed = Date.now() - startedAt;
  if (elapsed < SANDBOX_FINALE_MIN_DURATION_MS) await sleep(SANDBOX_FINALE_MIN_DURATION_MS - elapsed);

  if (result.ok) {
    updateStreamEntry(finaleId, { status: "done", savedCount: result.value.savedCount, failedTitles: result.value.failedTitles });
    if (result.value.savedCount >= 1) playSandboxCompleteChime();
  } else {
    // AD-17: the request itself failed (never reached the server, or the
    // server rejected it outright) — the client must NOT invent its own
    // savedCount/failedTitles from local state. `summaryFailed` says only
    // that the summary couldn't be confirmed; no chime either.
    updateStreamEntry(finaleId, { status: "done", summaryFailed: true });
  }
  set(EMPTY);
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetSandboxForTests(): void {
  entryId = undefined;
  lastFailedCard = undefined;
  state = EMPTY;
}

/** Test-only: seeds this session's accumulated outcomes without driving a full save/skip sequence. Never called from production code. */
export function __setSandboxOutcomesForTests(outcomes: readonly SandboxOutcomeRecord[]): void {
  state = { ...state, outcomes };
}

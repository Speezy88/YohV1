/**
 * web/src/lib/checkOff.ts
 *
 * Story 7.10: the four check-off calls, over the typed Hono RPC client
 * (`apiClient.api[...]` — the site-root base, per Story 7.7's double-`/api`
 * fix). Every call resolves to an outcome and never throws: a rejected
 * request (network down) and an `{ok: false}` envelope both come back as
 * `{ok: false, message}`, so a caller always has a failure to render
 * (UX-DR48). The undo window is never declared here — the server's
 * `commitAt`/`asOf` pair is the only source (AD-20).
 */
import { apiClient } from "./apiClient.ts";
import type { PendingCheckOffResponse, UndoCheckOffResponse } from "../../../src/types/api.ts";

export type CheckOffOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

async function settle<T>(request: () => Promise<{ json(): Promise<unknown> }>): Promise<CheckOffOutcome<T>> {
  try {
    const res = await request();
    const result = (await res.json()) as { ok: true; value: T } | { ok: false; error: { message: string } };
    return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message };
  } catch {
    // Task 6 (polish-5): a thrown fetch (network down, DNS failure, etc.) has
    // no message worth showing Spencer — `err.message` here is a browser/
    // fetch implementation detail, not something actionable. Mirrors
    // `sandboxClient.ts`'s identical catch verbatim.
    return { ok: false, message: "Couldn't reach Meeseek — try again." };
  }
}

export function requestCheckOff(taskId: string): Promise<CheckOffOutcome<PendingCheckOffResponse>> {
  return settle(() => apiClient.api["check-off"].$post({ json: { taskId } }));
}

export function requestUndo(id: string): Promise<CheckOffOutcome<UndoCheckOffResponse>> {
  return settle(() => apiClient.api["check-off"][":id"].undo.$post({ param: { id } }));
}

export function requestHold(id: string): Promise<CheckOffOutcome<PendingCheckOffResponse>> {
  return settle(() => apiClient.api["check-off"][":id"].hold.$post({ param: { id } }));
}

export function requestRelease(id: string): Promise<CheckOffOutcome<PendingCheckOffResponse>> {
  return settle(() => apiClient.api["check-off"][":id"].release.$post({ param: { id } }));
}

/** How long, from now, the Undo Toast stays up: the server's own `commitAt - asOf`, so a skewed browser clock can't change it. */
export function remainingMs(pending: Pick<PendingCheckOffResponse, "commitAt" | "asOf">): number {
  return Math.max(0, Date.parse(pending.commitAt) - Date.parse(pending.asOf));
}

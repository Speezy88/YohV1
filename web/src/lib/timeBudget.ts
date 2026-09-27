/**
 * web/src/lib/timeBudget.ts — Task 6A.
 *
 * The one call `TimeBudgetWidget.tsx`'s click-to-edit makes: `POST
 * /api/time-budget`, over the existing `app/time-budget.ts` `declareTimeBudget`
 * (server-side). Mirrors `checkOff.ts`'s never-throws outcome convention so
 * the widget always has a failure to render (UX-DR48).
 */
import { apiClient } from "./apiClient.ts";

export type TimeBudgetOutcome = { readonly ok: true; readonly receipt: string } | { readonly ok: false; readonly message: string };

export async function requestSetTimeBudget(totalMinutes: number): Promise<TimeBudgetOutcome> {
  try {
    const res = await apiClient.api["time-budget"].$post({ json: { totalMinutes } });
    const result = (await res.json()) as { ok: true; value: { receipt: string } } | { ok: false; error: { message: string } };
    return result.ok ? { ok: true, receipt: result.value.receipt } : { ok: false, message: result.error.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

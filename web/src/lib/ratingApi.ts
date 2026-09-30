/**
 * web/src/lib/ratingApi.ts
 *
 * Story 13.11: the web side of the "How is Yoh doing?" rating. `submitRating`
 * calls `POST /api/rating` and always resolves to an outcome, never throws.
 */
import { apiClient } from "./apiClient.ts";
import type { RatingRequest, RememberedReceipt } from "../../../src/types/api.ts";

export type RatingOutcome =
  | { readonly status: "ok"; readonly receipt?: RememberedReceipt }
  /** The server says the prompt is no longer open (already answered or dismissed): nothing more to do. */
  | { readonly status: "closed" }
  /** The request failed; the prompt stays so Spencer can try again. */
  | { readonly status: "failed" };

export async function submitRating(request: RatingRequest): Promise<RatingOutcome> {
  try {
    const res = await apiClient.api.rating.$post({ json: request });
    const result = await res.json();
    if (result.ok) return result.value.receipt ? { status: "ok", receipt: result.value.receipt } : { status: "ok" };
    if (result.error.kind === "conflict") return { status: "closed" };
    return { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

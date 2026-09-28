/**
 * src/core/sandbox-card-view.ts
 *
 * Story 9.2: the shared "first item -> wire view" step every `/sandbox`
 * caller needs identically (`app/chat-turn.ts`'s `/sandbox` dispatch, and
 * `shell/server.ts`'s three routes). The per-story plan's own text places
 * this next to `sandboxQueue` in `app/sandbox-queue.ts` ("not in E5's own
 * list, but explicitly allowed"); moved here instead because it is a plain,
 * pure, synchronous mapper — `tests/layering-rules.test.ts`'s AD-16 rule
 * requires every `app/*.ts` exported function to be `(deps, input) =>
 * Promise<Result<Output, YohError>>`, which this helper (one argument, no
 * `Result`, not async) cannot satisfy without inventing a fake `deps`
 * parameter. `core/` importing a type from `types/api.ts` (not just
 * `types/domain.ts`) already has precedent (`core/calendar-blocks.ts`,
 * `core/open-item-questions.ts`), so this stays a legal `core/` -> `types/`
 * edge. Typed structurally against `SandboxCardView` (minus `remaining`)
 * rather than importing `app/sandbox-queue.ts`'s `SandboxQueueItem` — `core/`
 * may import only `types/` and `core/` (AD-1), never `app/`.
 */
import type { SandboxCardOptions, SandboxCardView } from "../types/api.ts";

/**
 * `remaining` is what the card itself shows as "N remaining" — the queue's
 * length AFTER this card (E7). `options` (Task 5, polish-5) is the SAME
 * `SandboxCardOptions` for every card in a given queue read — it describes
 * the workspace's live Area/Energy schema, not anything per-Task — so every
 * caller passes it straight through from its own `sandboxQueue` read.
 *
 * Picks the `SandboxCardView` fields explicitly rather than spreading `first`
 * — the caller's own item type (`SandboxQueueItem`) carries extra fields
 * (e.g. `missingFields`) that must never leak onto the wire shape.
 */
export function firstCardView<T extends Omit<SandboxCardView, "remaining" | "options">>(
  items: readonly T[],
  options: SandboxCardOptions,
): SandboxCardView | undefined {
  const [first, ...rest] = items;
  if (!first) return undefined;
  return {
    taskId: first.taskId,
    taskTitle: first.taskTitle,
    ...(first.dueDate !== undefined ? { dueDate: first.dueDate } : {}),
    ...(first.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: first.estimatedDurationMinutes } : {}),
    ...(first.area !== undefined ? { area: first.area } : {}),
    ...(first.energy !== undefined ? { energy: first.energy } : {}),
    remaining: rest.length,
    options,
  };
}

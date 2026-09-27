/**
 * web/src/lib/commands.ts
 *
 * Story 8.7: fetches the command registry once from `GET /api/commands`
 * and caches it — the registry is effectively static within a page session
 * (a new entry lands only when a later epic ships and the server
 * restarts), so unlike `homeView.ts`'s `topic:"plan"` re-fetch, there's no
 * `eventBus.ts` hint to listen for here.
 */
import { apiClient } from "./apiClient.ts";
import type { CommandDescriptor } from "../../../src/types/api.ts";

let cached: readonly CommandDescriptor[] | undefined;
let inflight: Promise<readonly CommandDescriptor[]> | undefined;

/** Fetches the registry once and caches it; concurrent callers before the first response share one in-flight request. A failed fetch resolves to an empty list rather than throwing — the Command Palette then shows "No matching command" for every query rather than crashing. */
export async function fetchCommands(): Promise<readonly CommandDescriptor[]> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await apiClient.api.commands.$get();
        const result = await res.json();
        cached = result.ok ? result.value.commands : [];
      } catch {
        cached = [];
      } finally {
        inflight = undefined;
      }
      return cached;
    })();
  }
  return inflight;
}

/** Case-insensitive prefix match against `name` (every command starts with "/") — UX-DR38: "filters as Spencer types." */
export function filterCommands(commands: readonly CommandDescriptor[], query: string): readonly CommandDescriptor[] {
  const q = query.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(q));
}

/** Test-only: clears the module-level cache between tests. Never called from production code. */
export function __resetCommandsForTests(): void {
  cached = undefined;
  inflight = undefined;
}

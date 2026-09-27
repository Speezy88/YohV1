/**
 * src/app/research-list.ts
 *
 * Task 6C (FR-43, UX-DR43): the Research Hub page's one read — the most
 * recent Research Vault items, newest first, computed server-side (AD-17)
 * so `web/` never re-derives ordering or a limit itself. Read-only: nothing
 * here writes. The async `/research` job queue and the richer "latest
 * output up front" Research Box body are Story 11.2/Epic 11's job — this
 * only lists what's already in the vault.
 */
import type { LogEntry } from "../adapters/logger.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import type { ResearchListItem, ResearchListResponse } from "../types/api.ts";
import type { ResearchVaultRecord, Result, YohError } from "../types/domain.ts";

export interface ResearchListDeps {
  /** A live Notion read of the whole Research Vault (`readResearchVault`, bound). May throw (AD-8). */
  readonly readResearchVault: () => Promise<readonly ResearchVaultRecord[]>;
  readonly log?: (entry: LogEntry) => void;
}

/** How many rows the page shows — "recent" per the brief, not the whole vault. */
const RESEARCH_LIST_LIMIT = 20;

/** Most recent Date first; undated rows sort last (a row with no Date is neither newer nor older than one that has it — pushing it to the end reads better than pretending it's oldest via string-sort quirks). Ties break by title so the order is stable. */
function compareRecords(a: ResearchVaultRecord, b: ResearchVaultRecord): number {
  if (a.date !== b.date) {
    if (a.date === undefined) return 1;
    if (b.date === undefined) return -1;
    return a.date < b.date ? 1 : -1;
  }
  return a.title.localeCompare(b.title);
}

function toItem(record: ResearchVaultRecord): ResearchListItem {
  return {
    id: record.id,
    title: record.title,
    ...(record.date !== undefined ? { date: record.date } : {}),
    sourceCount: record.sourceCount,
    url: record.url,
  };
}

export async function listResearch(deps: ResearchListDeps, _input: Record<string, never>): Promise<Result<ResearchListResponse, YohError>> {
  let records: readonly ResearchVaultRecord[];
  try {
    records = await deps.readResearchVault();
  } catch (err) {
    deps.log?.({ level: "error", event: "research-list.read-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }

  const items = [...records].sort(compareRecords).slice(0, RESEARCH_LIST_LIMIT).map(toItem);
  return { ok: true, value: { items } };
}

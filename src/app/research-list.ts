/**
 * src/app/research-list.ts
 *
 * Task 6C (FR-43, UX-DR43): the Research Hub page's one read — the most
 * recent Research Vault items, newest first, computed server-side (AD-17)
 * so `web/` never re-derives ordering or a limit itself. Story 11.2 adds
 * paging (`pages` x 20 rows plus `hasMore`) and one document's body.
 * Read-only: nothing here writes.
 */
import type { LogEntry } from "../adapters/logger.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { parsePageCount } from "../core/research-paging.ts";
import type { ResearchDocumentResponse, ResearchListItem, ResearchListResponse } from "../types/api.ts";
import type { ResearchVaultRecord, Result, YohError } from "../types/domain.ts";

export interface ResearchListDeps {
  /** A live Notion read of the whole Research Vault (`readResearchVault`, bound). May throw (AD-8). */
  readonly readResearchVault: () => Promise<readonly ResearchVaultRecord[]>;
  readonly log?: (entry: LogEntry) => void;
}

/** How many rows one "page" of the library holds (E11-R1). */
export const RESEARCH_PAGE_SIZE = 20;

/** `listResearch`'s input: the raw `pages` query value (missing, non-integer or below 1 means 1). */
export interface ResearchListInput {
  readonly pages?: string | number | undefined;
}

/** `getResearchDocument`'s input: the document id; missing or unknown means the most recent one (E11-R2). */
export interface ResearchDocumentInput {
  readonly id?: string | undefined;
}

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

async function readVault(deps: ResearchListDeps, event: string): Promise<{ ok: true; records: readonly ResearchVaultRecord[] } | { ok: false; error: YohError }> {
  try {
    return { ok: true, records: await deps.readResearchVault() };
  } catch (err) {
    deps.log?.({ level: "error", event, detail: { message: err instanceof Error ? err.message : String(err) } });
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Notion" }) } };
  }
}

export async function listResearch(deps: ResearchListDeps, input: ResearchListInput): Promise<Result<ResearchListResponse, YohError>> {
  const read = await readVault(deps, "research-list.read-failed");
  if (!read.ok) return read;
  const sorted = [...read.records].sort(compareRecords);
  const limit = parsePageCount(input.pages) * RESEARCH_PAGE_SIZE;
  return { ok: true, value: { items: sorted.slice(0, limit).map(toItem), hasMore: sorted.length > limit } };
}

export async function getResearchDocument(deps: ResearchListDeps, input: ResearchDocumentInput): Promise<Result<ResearchDocumentResponse, YohError>> {
  const read = await readVault(deps, "research-document.read-failed");
  if (!read.ok) return read;
  const sorted = [...read.records].sort(compareRecords);
  const record = (input.id ? sorted.find((r) => r.id === input.id) : undefined) ?? sorted[0];
  if (!record) return { ok: true, value: {} };
  return {
    ok: true,
    value: {
      document: {
        id: record.id,
        title: record.title,
        ...(record.date !== undefined ? { date: record.date } : {}),
        body: record.keyFindings,
        sources: [...record.sources],
        url: record.url,
      },
    },
  };
}

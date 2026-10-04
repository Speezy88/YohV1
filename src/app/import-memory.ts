/** `POST /api/memory/import`: files reviewed candidates from a Claude export as memory items, or reports what it would file. */
import type { MemoryItemStore, NewMemoryItem } from "../adapters/memory-item-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { localIsoDate } from "../core/local-time.ts";
import { ALWAYS_LOADED_CAP } from "../core/memory-context.ts";
import { candidateRejection, NARROWEST_FEEDBACK_SCOPE, normalizeMemoryText } from "../core/memory-filing.ts";
import { ALWAYS_LOADED_FOLDERS, STATED_ONLY_FOLDERS } from "../core/memory-folders.ts";
import { importBatchTag, type ImportCandidate } from "../core/memory-import.ts";
import type { ImportMemoryLine, ImportMemoryResponse } from "../types/api.ts";
import type { MemoryCandidate, Result, YohError } from "../types/domain.ts";

export interface ImportMemoryDeps {
  readonly memoryItems: MemoryItemStore;
  readonly now: () => Date;
  readonly timeZone: string;
}

export interface ImportMemoryInput {
  readonly candidates: readonly ImportCandidate[];
  readonly dryRun: boolean;
}

export async function importMemory(deps: ImportMemoryDeps, input: ImportMemoryInput): Promise<Result<ImportMemoryResponse, YohError>> {
  if (input.candidates.length === 0) return { ok: false, error: { kind: "validation", message: "The file has no lines to import." } };
  try {
    const now = deps.now();
    const today = localIsoDate(now, deps.timeZone);
    const batchTag = importBatchTag("claude", today);
    const current = deps.memoryItems.listItems({ status: ["current"] });
    // What Spencer told Yoh directly wins: a match is skipped, never superseded.
    const seen = new Set(current.map((i) => normalizeMemoryText(i.text)));
    const filed: ImportMemoryLine[] = [];
    const skippedDuplicate: ImportMemoryLine[] = [];
    const rejected: (ImportMemoryLine & { reason: string })[] = [];
    const rows: NewMemoryItem[] = [];
    for (const c of input.candidates) {
      const line: ImportMemoryLine = { line: c.line, folder: c.folder, text: c.text };
      // Spencer approved each line by hand, so the cases the filing rules reserve for his own words count as stated.
      const origin = STATED_ONLY_FOLDERS.includes(c.folder) || c.sensitive !== undefined ? "stated" : "inferred";
      const candidate: MemoryCandidate = { folder: c.folder, text: c.text, origin, ...(c.sensitive !== undefined ? { sensitive: c.sensitive } : {}) };
      const reason = candidateRejection(candidate, today);
      if (reason !== undefined) {
        rejected.push({ ...line, reason });
        continue;
      }
      const key = normalizeMemoryText(c.text);
      if (seen.has(key)) {
        skippedDuplicate.push(line);
        continue;
      }
      seen.add(key);
      filed.push(line);
      rows.push({
        folder: c.folder,
        text: c.text,
        origin,
        ...(c.folder === "feedback" ? { scope: NARROWEST_FEEDBACK_SCOPE } : {}),
        sourceTurnId: batchTag,
        at: now.toISOString(),
      });
    }
    const alwaysNow = current.filter((i) => ALWAYS_LOADED_FOLDERS.includes(i.folder)).length;
    const alwaysNew = rows.filter((r) => ALWAYS_LOADED_FOLDERS.includes(r.folder)).length;
    const over = alwaysNow + alwaysNew - ALWAYS_LOADED_CAP;
    if (alwaysNew > 0 && over > 0) {
      const message = `This import would put ${alwaysNow + alwaysNew} items in the always-loaded folders, and the limit is ${ALWAYS_LOADED_CAP}. Cut ${over} ${over === 1 ? "line" : "lines"} from Feedback, Planning preferences, Corrections, About you or Patterns and send it again.`;
      return { ok: false, error: { kind: "validation", message } };
    }
    if (!input.dryRun) deps.memoryItems.insertMany(rows);
    return {
      ok: true,
      value: {
        dryRun: input.dryRun,
        batchTag,
        counts: { filed: filed.length, skippedDuplicate: skippedDuplicate.length, rejected: rejected.length },
        filed,
        skippedDuplicate,
        rejected,
      },
    };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  }
}

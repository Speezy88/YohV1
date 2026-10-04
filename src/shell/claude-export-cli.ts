/**
 * One-shot: a Claude data export → a candidates file Spencer reviews before
 * `POST /api/memory/import`. Run on the Mac. Opens no Yoh database; writes
 * only the output file and its cache directory.
 *
 *   node --env-file=.env src/shell/claude-export-cli.ts <export-dir> --out <file> [--yes]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractExportCandidates, type ExportExtraction, type ExportSourceKind } from "../adapters/claude-export-llm.ts";
import { CLAUDE_CHAT_MODEL_FAST, createAnthropicMessagesClient, loadLlmAdapterConfigFromEnv, type AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import {
  batchConversations,
  batchDistilled,
  estimateExtractCostUsd,
  EXPORT_COST_CONFIRM_USD,
  mergeCandidates,
  readConversations,
  readProjects,
  readSavedMemory,
  type ExtractedCandidate,
} from "../core/claude-export.ts";
import { costForRows, type LlmUsageCostRow } from "../core/llm-cost.ts";
import { ALWAYS_LOADED_CAP } from "../core/memory-context.ts";
import { ALWAYS_LOADED_FOLDERS } from "../core/memory-folders.ts";
import { renderMemoryImport } from "../core/memory-import.ts";

export interface ExtractOptions {
  readonly exportDir: string;
  readonly outPath: string;
  /** Go ahead even when the estimate is over `EXPORT_COST_CONFIRM_USD`. */
  readonly yes: boolean;
  readonly client: AnthropicMessagesClient;
  readonly print: (line: string) => void;
}

interface Call {
  readonly kind: ExportSourceKind;
  readonly text: string;
}

/**
 * Every JSON document of one export category. Covers the single-folder
 * layout (`<dir>/<category>.json`) and the per-category zips
 * (`<dir>/<category>/<category>.json`, or one file per item under
 * `<dir>/<category>/<category>/`). Invalid JSON throws.
 */
function readCategory(exportDir: string, category: string): unknown[] {
  const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8")) as unknown;
  const out: unknown[] = [];
  for (const file of [join(exportDir, `${category}.json`), join(exportDir, category, `${category}.json`)]) {
    if (existsSync(file)) out.push(read(file));
  }
  for (const dir of [join(exportDir, category), join(exportDir, category, category)]) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith(".json") && name !== `${category}.json`) out.push(read(join(dir, name)));
    }
  }
  return out;
}

export async function runClaudeExportExtract(o: ExtractOptions): Promise<number> {
  const category = (name: string): unknown[] => {
    const docs = readCategory(o.exportDir, name);
    if (docs.length === 0) o.print(`${name}: not found, skipped.`);
    return docs;
  };
  const distilled = [...category("memories").flatMap(readSavedMemory), ...category("projects").flatMap(readProjects)];
  const read = category("conversations").map(readConversations);
  const conversations = read.flatMap((r) => r.conversations);
  const skipped = read.reduce((n, r) => n + r.skipped, 0);
  o.print(`Found ${distilled.length} saved-memory and project sources and ${conversations.length} conversations (${skipped} skipped: no messages from you).`);

  const calls: Call[] = [
    ...batchDistilled(distilled).map((text) => ({ kind: "distilled" as const, text })),
    ...batchConversations(conversations).map((text) => ({ kind: "conversations" as const, text })),
  ];
  if (calls.length === 0) {
    o.print("Nothing to extract. Check that the folder is an unzipped Claude export.");
    return 1;
  }

  const cacheDir = `${o.outPath}.cache`;
  const cachePath = (c: Call): string => join(cacheDir, `${createHash("sha256").update(`${c.kind}\0${c.text}`).digest("hex")}.json`);
  const uncached = calls.filter((c) => !existsSync(cachePath(c)));
  const estimate = estimateExtractCostUsd(uncached.map((c) => c.text), CLAUDE_CHAT_MODEL_FAST);
  o.print(`${calls.length} calls, ${calls.length - uncached.length} already cached. Estimated cost: $${estimate.toFixed(2)}.`);
  if (estimate > EXPORT_COST_CONFIRM_USD && !o.yes) {
    o.print(`That is over $${EXPORT_COST_CONFIRM_USD}. Run again with --yes to go ahead.`);
    return 2;
  }

  mkdirSync(cacheDir, { recursive: true });
  const candidates: ExtractedCandidate[] = [];
  const usage: LlmUsageCostRow[] = [];
  let failed = 0;
  for (const [i, call] of calls.entries()) {
    const path = cachePath(call);
    if (existsSync(path)) {
      candidates.push(...((JSON.parse(readFileSync(path, "utf8")) as { candidates: ExtractedCandidate[] }).candidates));
      continue;
    }
    let result: ExportExtraction;
    try {
      result = await extractExportCandidates(o.client, call.kind, call.text);
    } catch {
      // The raw error may hold request details; the count is enough to act on.
      failed++;
      o.print(`Call ${i + 1} of ${calls.length} could not reach Claude.`);
      continue;
    }
    usage.push(result.usage);
    if (result.candidates === undefined) {
      failed++;
      o.print(`Call ${i + 1} of ${calls.length} returned no readable list.`);
      continue;
    }
    writeFileSync(path, JSON.stringify({ candidates: result.candidates, usage: result.usage }));
    candidates.push(...result.candidates);
  }

  const merged = mergeCandidates(candidates);
  const always = merged.filter((c) => ALWAYS_LOADED_FOLDERS.includes(c.folder)).length;
  writeFileSync(
    o.outPath,
    renderMemoryImport(merged, [
      "Delete the lines you do not want, reword freely, and move lines between headings.",
      "Each line is one memory item of at most 280 characters. The date and [sensitive] marker are optional.",
      `Always-loaded folders: ${always} lines here (Feedback, Planning preferences, Corrections, About you). Yoh loads at most ${ALWAYS_LOADED_CAP} in total, counting what it already holds.`,
    ]),
  );
  o.print(`Wrote ${merged.length} candidates (from ${candidates.length} before merging) to ${o.outPath}.`);
  o.print(`Actual cost: $${costForRows(usage).toFixed(2)}.`);
  if (failed > 0) {
    o.print(`${failed} of ${calls.length} calls failed. Run the same command again to retry only those.`);
    return 3;
  }
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const print = (line: string): void => void process.stdout.write(`${line}\n`);
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const exportDir = argv.find((a, i) => !a.startsWith("--") && i !== outIndex + 1);
  if (!exportDir || !outPath) {
    print("Usage: node --env-file=.env src/shell/claude-export-cli.ts <export-dir> --out <file> [--yes]");
    return 64;
  }
  try {
    const client = createAnthropicMessagesClient(loadLlmAdapterConfigFromEnv());
    return await runClaudeExportExtract({ exportDir, outPath, yes: argv.includes("--yes"), client, print });
  } catch (error) {
    process.stderr.write(`claude-export-cli: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
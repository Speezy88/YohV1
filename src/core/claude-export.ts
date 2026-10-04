/** Claude data export → extraction inputs and merged candidates. Pure: the caller reads the files and calls the model. */
import { costForRow } from "./llm-cost.ts";
import { normalizeMemoryText } from "./memory-filing.ts";
import { isMemoryFolder, MEMORY_FOLDERS_IN_ORDER, MEMORY_ITEM_MAX_CHARS } from "./memory-folders.ts";
import type { RenderCandidate } from "./memory-import.ts";

/** A longer message is almost always pasted material, not a statement about Spencer. */
export const EXPORT_MESSAGE_MAX_CHARS = 4000;
/** Characters of conversation text per model call (about 15k tokens). */
export const EXPORT_BATCH_MAX_CHARS = 60_000;
/** Characters of distilled text per model call. Distilled text is dense; smaller inputs keep each reply inside the output budget. */
export const EXPORT_DISTILLED_BATCH_MAX_CHARS = 20_000;
/** Word-set overlap at which two candidates in one folder count as the same fact. */
export const EXPORT_NEAR_DUPLICATE_JACCARD = 0.8;
/** An estimate above this needs an explicit yes. */
export const EXPORT_COST_CONFIRM_USD = 5;

const CHARS_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 500;
const EXPECTED_OUTPUT_TOKENS = 400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ExportConversation {
  /** Day of the conversation's last update. */
  readonly date: string;
  readonly humanMessages: readonly string[];
}

/** A source another assistant or Spencer already distilled: saved memory, project instructions. */
export interface ExportDistilled {
  readonly label: string;
  readonly text: string;
}

export interface ExtractedCandidate extends RenderCandidate {
  /** 1 = saved memory and project instructions; 2 = conversations. */
  readonly stage: 1 | 2;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function messageText(m: Record<string, unknown>): string {
  const direct = str(m["text"]).trim();
  if (direct !== "") return direct;
  const content: unknown[] = Array.isArray(m["content"]) ? m["content"] : [];
  return content
    .filter(isRecord)
    .filter((b) => b["type"] === "text")
    .map((b) => str(b["text"]))
    .join("\n")
    .trim();
}

/** Only Spencer's own messages are kept. A conversation with none, or with no usable date, is counted as skipped. */
export function readConversations(json: unknown): { conversations: ExportConversation[]; skipped: number } {
  if (!Array.isArray(json)) return { conversations: [], skipped: 0 };
  const conversations: ExportConversation[] = [];
  let skipped = 0;
  for (const raw of json as unknown[]) {
    if (!isRecord(raw)) {
      skipped++;
      continue;
    }
    const messages: unknown[] = Array.isArray(raw["chat_messages"]) ? raw["chat_messages"] : [];
    const humanMessages = messages
      .filter(isRecord)
      .filter((m) => m["sender"] === "human")
      .map(messageText)
      .filter((t) => t !== "")
      .map((t) => t.slice(0, EXPORT_MESSAGE_MAX_CHARS));
    const date = (str(raw["updated_at"]) || str(raw["created_at"])).slice(0, 10);
    if (humanMessages.length === 0 || !ISO_DATE.test(date)) {
      skipped++;
      continue;
    }
    conversations.push({ date, humanMessages });
  }
  return { conversations, skipped };
}

export function readProjects(json: unknown): ExportDistilled[] {
  const entries: unknown[] = Array.isArray(json) ? json : isRecord(json) ? [json] : [];
  return entries
    .filter(isRecord)
    .map((p) => ({ label: `Project instructions: ${str(p["name"]).trim() || "Untitled"}`, text: str(p["prompt_template"]).trim() }))
    .filter((d) => d.text !== "");
}

export function readSavedMemory(json: unknown): ExportDistilled[] {
  const entries: unknown[] = Array.isArray(json) ? json : isRecord(json) ? [json] : [];
  const out: ExportDistilled[] = [];
  for (const e of entries.filter(isRecord)) {
    const main = str(e["conversations_memory"]).trim();
    if (main !== "") out.push({ label: "Claude's saved memory", text: main });
    const perProject = isRecord(e["project_memories"]) ? e["project_memories"] : {};
    for (const v of Object.values(perProject)) {
      const text = str(v).trim();
      if (text !== "") out.push({ label: "Claude's saved project memory", text });
    }
    const files: unknown[] = Array.isArray(e["memory_files"]) ? e["memory_files"] : [];
    for (const f of files.filter(isRecord)) {
      const text = str(f["content"]).trim();
      if (text !== "") out.push({ label: `Claude's memory file: ${str(f["path"]).trim() || "untitled"}`, text });
    }
  }
  return out;
}

export function renderDistilled(sources: readonly ExportDistilled[]): string {
  return sources.map((s) => `### ${s.label}\n${s.text}`).join("\n\n");
}

/** Packs distilled sources into model inputs of about `maxChars`. A source longer than that is split, each part under its own heading. */
export function batchDistilled(sources: readonly ExportDistilled[], maxChars: number = EXPORT_BATCH_MAX_CHARS): string[] {
  const batches: string[] = [];
  let current = "";
  for (const s of sources) {
    for (let at = 0; at < s.text.length; at += maxChars) {
      const block = `### ${s.label}\n${s.text.slice(at, at + maxChars)}`;
      if (current !== "" && current.length + block.length + 2 > maxChars) {
        batches.push(current);
        current = "";
      }
      current = current === "" ? block : `${current}\n\n${block}`;
    }
  }
  if (current !== "") batches.push(current);
  return batches;
}

/** Packs conversations into model inputs of about `maxChars`. A conversation larger than that is split, each part under its own heading. */
export function batchConversations(conversations: readonly ExportConversation[], maxChars: number = EXPORT_BATCH_MAX_CHARS): string[] {
  const batches: string[] = [];
  let current = "";
  const add = (block: string): void => {
    if (current !== "" && current.length + block.length + 2 > maxChars) {
      batches.push(current);
      current = "";
    }
    current = current === "" ? block : `${current}\n\n${block}`;
  };
  for (const c of conversations) {
    const heading = `### Conversation (${c.date})`;
    let block = heading;
    for (const m of c.humanMessages) {
      const line = `- ${m.replace(/\s+/g, " ")}`;
      if (block !== heading && block.length + line.length + 1 > maxChars) {
        add(block);
        block = heading;
      }
      block = `${block}\n${line}`;
    }
    add(block);
  }
  if (current !== "") batches.push(current);
  return batches;
}

/** The model's JSON array → candidates. Undefined when the reply holds no JSON array, so the caller can retry instead of caching an empty result. */
export function parseExtractedCandidates(modelText: string, stage: 1 | 2): ExtractedCandidate[] | undefined {
  const start = modelText.indexOf("[");
  if (start < 0) return undefined;
  const end = modelText.lastIndexOf("]");
  const tryParse = (json: string): unknown => {
    try {
      return JSON.parse(json);
    } catch {
      return undefined;
    }
  };
  let raw = end > start ? tryParse(modelText.slice(start, end + 1)) : undefined;
  if (raw === undefined) {
    // A reply cut off at the output limit: keep the elements that finished.
    const lastBrace = modelText.lastIndexOf("}");
    raw = lastBrace > start ? tryParse(`${modelText.slice(start, lastBrace + 1)}]`) : undefined;
  }
  if (!Array.isArray(raw)) return undefined;
  const out: ExtractedCandidate[] = [];
  for (const e of raw as unknown[]) {
    if (!isRecord(e)) continue;
    const folder = e["folder"];
    if (!isMemoryFolder(folder) || folder === "patterns") continue;
    const text = str(e["text"]).replace(/\s+/g, " ").trim();
    if (text === "" || text.length > MEMORY_ITEM_MAX_CHARS) continue;
    const s = e["sensitive"];
    const date = str(e["date"]);
    out.push({
      folder,
      text,
      stage,
      ...(s === "health" || s === "emotion" || s === "finance" ? { sensitive: s } : {}),
      ...(ISO_DATE.test(date) ? { sourceDate: date } : {}),
    });
  }
  return out;
}

function wordSet(text: string): Set<string> {
  return new Set(
    normalizeMemoryText(text)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function nearDuplicate(a: { key: string; words: Set<string> }, b: { key: string; words: Set<string> }): boolean {
  if (a.key === b.key) return true;
  if (a.words.size === 0 || b.words.size === 0) return false;
  let shared = 0;
  for (const w of a.words) if (b.words.has(w)) shared++;
  return shared / (a.words.size + b.words.size - shared) >= EXPORT_NEAR_DUPLICATE_JACCARD;
}

/** Collapses near-duplicates within a folder. Stage 1 wins over stage 2; within a stage the newest source date wins. Output is in folder order. */
export function mergeCandidates(candidates: readonly ExtractedCandidate[]): ExtractedCandidate[] {
  const preferred = [...candidates].sort((a, b) => a.stage - b.stage || (b.sourceDate ?? "").localeCompare(a.sourceDate ?? ""));
  const kept: { candidate: ExtractedCandidate; key: string; words: Set<string> }[] = [];
  for (const candidate of preferred) {
    const entry = { candidate, key: normalizeMemoryText(candidate.text), words: wordSet(candidate.text) };
    if (kept.some((k) => k.candidate.folder === candidate.folder && nearDuplicate(k, entry))) continue;
    kept.push(entry);
  }
  return MEMORY_FOLDERS_IN_ORDER.flatMap((folder) => kept.filter((k) => k.candidate.folder === folder).map((k) => k.candidate));
}

/** Dollars for the calls still to make, from their input sizes. An estimate: real usage is reported after the run. */
export function estimateExtractCostUsd(callTexts: readonly string[], model: string): number {
  if (callTexts.length === 0) return 0;
  const inputTokens = callTexts.reduce((n, t) => n + Math.ceil(t.length / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS, 0);
  return costForRow({ model, inputTokens, outputTokens: callTexts.length * EXPECTED_OUTPUT_TOKENS, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
}

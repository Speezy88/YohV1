/** Memory import: the batch tag, and the reviewed candidates file in both directions. Pure. */
import type { MemoryCandidate, MemoryFolder } from "../types/domain.ts";
import { MEMORY_FOLDERS_IN_ORDER, memoryFolderLabel } from "./memory-folders.ts";

/** `source_turn_id` values with this prefix name an import batch, not a chat turn. */
export const IMPORT_TAG_PREFIX = "import:";

export function importBatchTag(source: string, date: string): string {
  return `${IMPORT_TAG_PREFIX}${source}-${date}`;
}

export function isImportTag(sourceTurnId: string): boolean {
  return sourceTurnId.startsWith(IMPORT_TAG_PREFIX);
}

export type MemorySensitivity = NonNullable<MemoryCandidate["sensitive"]>;

export interface ImportCandidate {
  /** 1-based line in the file, for the report. */
  readonly line: number;
  readonly folder: MemoryFolder;
  readonly text: string;
  readonly sensitive?: MemorySensitivity;
}

export interface ImportProblem {
  readonly line: number;
  readonly reason: string;
}

export interface ParsedImport {
  readonly candidates: readonly ImportCandidate[];
  readonly problems: readonly ImportProblem[];
}

export interface RenderCandidate {
  readonly folder: MemoryFolder;
  readonly text: string;
  readonly sensitive?: MemorySensitivity;
  /** The day of the conversation the fact came from. */
  readonly sourceDate?: string;
}

const HEADING = /^##\s+(.+?)\s*$/;
const ITEM = /^[-*]\s*(.*)$/;
const SENSITIVE_SUFFIX = /\s*\[sensitive:(health|emotion|finance)\]\s*$/i;
const DATE_SUFFIX = /\s*\(\d{4}-\d{2}-\d{2}\)\s*$/;

function folderForHeading(heading: string): MemoryFolder | undefined {
  const wanted = heading.toLowerCase();
  return MEMORY_FOLDERS_IN_ORDER.find((f) => f === wanted || memoryFolderLabel(f).toLowerCase() === wanted);
}

/** Reads the reviewed file. Lines under an unknown heading are dropped; the heading itself is the reported problem. */
export function parseMemoryImport(fileText: string): ParsedImport {
  const candidates: ImportCandidate[] = [];
  const problems: ImportProblem[] = [];
  let folder: MemoryFolder | undefined;
  let headingSeen = false;
  fileText
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = index + 1;
      const text = raw.trim();
      if (text === "" || text.startsWith(">") || /^#(\s|$)/.test(text)) return;
      const heading = HEADING.exec(text);
      if (heading) {
        const name = heading[1] as string;
        headingSeen = true;
        folder = folderForHeading(name);
        if (!folder) problems.push({ line, reason: `unknown folder heading "${name}"` });
        return;
      }
      const item = ITEM.exec(text);
      if (!item) {
        problems.push({ line, reason: "not a heading or a list line" });
        return;
      }
      if (!folder) {
        if (!headingSeen) problems.push({ line, reason: "list line before any folder heading" });
        return;
      }
      let body = item[1] as string;
      const sensitive = SENSITIVE_SUFFIX.exec(body);
      if (sensitive) body = body.slice(0, sensitive.index);
      const date = DATE_SUFFIX.exec(body);
      if (date) body = body.slice(0, date.index);
      body = body.trim();
      if (body === "") {
        problems.push({ line, reason: "empty list line" });
        return;
      }
      candidates.push({
        line,
        folder,
        text: body,
        ...(sensitive ? { sensitive: (sensitive[1] as string).toLowerCase() as MemorySensitivity } : {}),
      });
    });
  return { candidates, problems };
}

/** Writes the file `parseMemoryImport` reads: one heading per non-empty folder, in the folders' fixed order. */
export function renderMemoryImport(candidates: readonly RenderCandidate[], notes: readonly string[]): string {
  const out: string[] = ["# Memory import candidates", "", ...notes.map((n) => `> ${n}`)];
  for (const folder of MEMORY_FOLDERS_IN_ORDER) {
    const inFolder = candidates.filter((c) => c.folder === folder);
    if (inFolder.length === 0) continue;
    out.push("", `## ${memoryFolderLabel(folder)}`, "");
    for (const c of inFolder) {
      out.push(`- ${c.text}${c.sourceDate ? ` (${c.sourceDate})` : ""}${c.sensitive ? ` [sensitive:${c.sensitive}]` : ""}`);
    }
  }
  return `${out.join("\n")}\n`;
}

/** Memory folders (Story 13.3): the closed folder set, its PRD order, labels and load classes. Pure. */
import type { MemoryFolder, MemoryLoadClass } from "../types/domain.ts";

/** Longest memory item text, in characters. */
export const MEMORY_ITEM_MAX_CHARS = 280;

export const MEMORY_FOLDERS_IN_ORDER: readonly MemoryFolder[] = [
  "feedback",
  "planning-preferences",
  "corrections",
  "about-you",
  "patterns",
  "goals-projects",
  "decisions-commitments",
  "ideas-notes",
];

const LABELS: Record<MemoryFolder, string> = {
  feedback: "Feedback",
  "planning-preferences": "Planning preferences",
  corrections: "Corrections",
  "about-you": "About you",
  patterns: "Patterns",
  "goals-projects": "Goals & projects",
  "decisions-commitments": "Decisions & commitments",
  "ideas-notes": "Ideas & notes",
};

export function memoryFolderLabel(folder: MemoryFolder): string {
  return LABELS[folder];
}

export const ALWAYS_LOADED_FOLDERS: readonly MemoryFolder[] = ["feedback", "planning-preferences", "corrections", "about-you", "patterns"];

/** Folders whose items are only ever created from Spencer's typed words. */
export const STATED_ONLY_FOLDERS: readonly MemoryFolder[] = ["feedback", "planning-preferences"];

export function memoryLoadClass(folder: MemoryFolder): MemoryLoadClass {
  if (ALWAYS_LOADED_FOLDERS.includes(folder)) return "always";
  return folder === "ideas-notes" ? "on-ask" : "relevant";
}

export function isMemoryFolder(v: unknown): v is MemoryFolder {
  return typeof v === "string" && (MEMORY_FOLDERS_IN_ORDER as readonly string[]).includes(v);
}

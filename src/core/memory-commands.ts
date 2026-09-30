/** Memory command recognizer (Story 13.4). Pure; never calls an LLM. */

export type MemoryCommand =
  | { kind: "remember"; text: string }
  | { kind: "forget"; words: string }
  | { kind: "recall"; topic: string };

const IDIOM_FORGET = /^(it|about it|that it)$/i;

function forgetWords(words: string): MemoryCommand | undefined {
  const w = words.trim();
  if (IDIOM_FORGET.test(w.replace(/[.!?]+$/, ""))) return undefined;
  if (/^that[.!]?$/i.test(w)) return { kind: "forget", words: "" };
  return { kind: "forget", words: w };
}

export function recognizeMemoryCommand(line: string): MemoryCommand | undefined {
  const s = line.trim();
  const rem = /^remember(?:\s+that\s+|\s*:\s*)(.+)$/is.exec(s);
  if (rem && rem[1]!.trim().length > 0) return { kind: "remember", text: rem[1]!.trim() };
  const recall = /^what\s+do\s+you\s+remember\s+about\s+(.+)$/is.exec(s);
  if (recall) {
    const topic = recall[1]!.trim().replace(/\s*\?+$/, "").trim();
    return topic.length > 0 ? { kind: "recall", topic } : undefined;
  }
  const forget = /^forget\s+(.+)$/is.exec(s);
  if (forget) return forgetWords(forget[1]!);
  return undefined;
}

/** `/remember <text>` and `/forget [words]`; `name` may include the leading slash. */
export function parseSlashMemoryCommand(name: string, args: string): MemoryCommand | undefined {
  const n = name.replace(/^\//, "").toLowerCase();
  const a = args.trim();
  if (n === "remember") return a.length > 0 ? { kind: "remember", text: a } : undefined;
  if (n === "forget") return a.length === 0 ? { kind: "forget", words: "" } : forgetWords(a);
  return undefined;
}

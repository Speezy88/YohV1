/**
 * Task 8 (polish-6): stacking layers are defined once as --z-* tokens in
 * tokens.css; components use z-(--z-name), never a bare z-NN number, and the
 * chat panel, Ask Yoh pill and confetti no longer share one value.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

const tokens = readFileSync(join(SRC, "tokens.css"), "utf8");
const zToken = (name: string): number => Number(new RegExp(`--z-${name}:\\s*(\\d+)`).exec(tokens)?.[1]);

describe("z-index layers", () => {
  it("no component uses a bare numeric z-index utility", () => {
    const offenders = sourceFiles(SRC).filter((f) => /\bz-(\d+|\[\d+\])\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the chat panel, Ask Yoh pill and confetti sit on distinct layers in the right order", () => {
    const values = ["pill", "confetti", "chat-backdrop", "chat", "toast", "splash"].map(zToken);
    expect(values.every(Number.isFinite)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("the components use the tokens", () => {
    const read = (f: string): string => readFileSync(join(SRC, f), "utf8");
    expect(read("components/AskYohPill.tsx")).toContain("z-(--z-pill)");
    expect(read("components/Confetti.tsx")).toContain("z-(--z-confetti)");
    expect(read("components/ChatPanel.tsx")).toContain("z-(--z-chat)");
  });
});

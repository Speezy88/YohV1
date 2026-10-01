/**
 * Polish 6 (P6-R9/R10/R11): a source-scanning guard so spacing, type and
 * icon rules do not drift again. Scans every non-test .ts/.tsx under pages/,
 * components/ and lib/ (controlStyles.ts lives there) and reports the
 * offending file:line.
 */
import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./{pages,components,lib}/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const files = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path));

/** Stroke widths other than 1.8 that are justified, with the reason. */
const STROKE_ALLOW_LIST: Record<string, string> = {
  // The brand mark is drawn on a 192-unit viewBox and scaled to ~40px, so its
  // 16-unit stroke renders at roughly 3.3px; it is a logo, not a UI glyph.
  "./components/YohMark.tsx": "logo drawn on a 192 viewBox",
};

function offenders(pattern: RegExp, skip: (path: string, line: string) => boolean = () => false): string[] {
  const found: string[] = [];
  for (const [path, text] of files) {
    text.split("\n").forEach((line, i) => {
      if (skip(path, line)) return;
      if (pattern.test(line)) found.push(`${path}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return found;
}

describe("design consistency (P6-R9/R10/R11)", () => {
  it("uses no font-semibold or font-normal (only Figtree 500 and 700 ship)", () => {
    expect(offenders(/\bfont-(semibold|normal)\b/)).toEqual([]);
  });

  it("uses no off-scale spacing (-7 steps, -4.5 steps, -[18px])", () => {
    const klass = /(?<=[\s"'`:])-?(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|space-[xy])-(?:7|4\.5|\[18px\])(?=[\s"'`/]|$)/;
    expect(offenders(klass)).toEqual([]);
  });

  it("draws every stroked glyph at 1.8px", () => {
    const found: string[] = [];
    for (const [path, text] of files) {
      if (STROKE_ALLOW_LIST[path]) continue;
      text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/strokeWidth=(?:\{([^}]*)\}|"([^"]*)")/g)) {
          const value = (m[1] ?? m[2] ?? "").trim().replace(/^"|"$/g, "");
          if (value !== "1.8") found.push(`${path}:${i + 1}: strokeWidth=${value}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});

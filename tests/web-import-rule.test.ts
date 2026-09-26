/**
 * Story 7.5, AD-17: `web/` may `import type` from `src/types/` and nothing
 * else from `src/`. Scans every `.ts`/`.tsx` file under `web/src` and
 * `web/e2e` (not `web/node_modules`, not `web/dist`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_SRC_DIRS = [join(import.meta.dirname, "..", "web", "src"), join(import.meta.dirname, "..", "web", "e2e")];

function walk(dir: string, onFile: (path: string) => void): void {
  if (!statSync(dir, { throwIfNoEntry: false })) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, onFile);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) onFile(full);
  }
}

test("AD-17: every web/ import from src/ is `import type ... from \"…/src/types/...\"`", () => {
  const offenders: string[] = [];
  for (const dir of WEB_SRC_DIRS) {
    walk(dir, (file) => {
      const contents = readFileSync(file, "utf8");
      const importLines = contents.matchAll(/^import\s+(type\s+)?(?:[^;]*?)from\s+["']([^"']*\/src\/[^"']*)["'];?$/gm);
      for (const match of importLines) {
        const isTypeOnly = match[1] !== undefined;
        const specifier = match[2]!;
        const targetsTypes = /\/src\/types\//.test(specifier);
        if (!isTypeOnly || !targetsTypes) offenders.push(`${file}: ${match[0]}`);
      }
    });
  }
  assert.deepEqual(offenders, [], "web/ may only `import type ... from \"…/src/types/...\"` — no other src/ import is allowed (AD-17)");
});

test("detector: catches a bad (non-type) src/ import as a fixture", () => {
  const offenders: string[] = [];
  const fixture = `import { openSqliteConnection } from "../../src/adapters/sqlite.ts";\n`;
  const importLines = fixture.matchAll(/^import\s+(type\s+)?(?:[^;]*?)from\s+["']([^"']*\/src\/[^"']*)["'];?$/gm);
  for (const match of importLines) {
    const isTypeOnly = match[1] !== undefined;
    const specifier = match[2]!;
    const targetsTypes = /\/src\/types\//.test(specifier);
    if (!isTypeOnly || !targetsTypes) offenders.push(match[0]);
  }
  assert.deepEqual(offenders, [`import { openSqliteConnection } from "../../src/adapters/sqlite.ts";`]);
});

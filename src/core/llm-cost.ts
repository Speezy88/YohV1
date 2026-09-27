/**
 * src/core/llm-cost.ts
 *
 * Real-use fixes plan, Task 9 (AD-1/AD-2): the pure cost function over
 * `llm-usage-store.ts`'s recorded rows and this file's own price table —
 * what Epic 12's Desk ("Claude API spend this month") ultimately sums. Per
 * AD-1, `core/*.ts` imports only `types/` and other `core/*.ts` — never
 * `adapters/llm-usage-store.ts` — so `LlmUsageCostRow` below is this file's
 * OWN local shape, structurally compatible with (a superset match of)
 * `llm-usage-store.ts`'s `LlmUsageRecord` (which also carries `at` and
 * `purpose`, irrelevant to a dollar total) rather than an import of it. No
 * I/O, no module state: same rows in, same dollars out, every time.
 */

/** Dollars per million tokens, base input/output only. */
export interface LlmModelPrice {
  readonly input: number;
  readonly output: number;
}

/**
 * The ONE price-table export (Task 9). Keyed by a NORMALIZED model id (see
 * `normalizeModelId` below) so a dated snapshot id
 * (`"claude-haiku-4-5-20251001"`, the real value `llm-adapter.ts`'s
 * `CLAUDE_CHAT_MODEL_FAST` constant holds) and its bare family name both
 * resolve to the same row. Cache write/read are NOT separate table
 * entries — they're derived multipliers (`CACHE_WRITE_PRICE_MULTIPLIER` /
 * `CACHE_READ_PRICE_MULTIPLIER` below) over each model's own `input` price,
 * since Anthropic's published cache pricing applies the same 1.25x/0.1x
 * multipliers uniformly across every model.
 */
export const LLM_PRICE_PER_MILLION_TOKENS: Readonly<Record<string, LlmModelPrice>> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
};

/** A cache-creation (write) token costs 1.25x the model's base input price. */
export const CACHE_WRITE_PRICE_MULTIPLIER = 1.25;
/** A cache-read token costs 0.1x the model's base input price. */
export const CACHE_READ_PRICE_MULTIPLIER = 0.1;

/**
 * Strips a trailing dated-snapshot suffix (`-YYYYMMDD`) so a concrete model
 * id like `"claude-haiku-4-5-20251001"` resolves to the price table's
 * `"claude-haiku-4-5"` row. A model id with no such suffix (e.g. this
 * codebase's own `"claude-sonnet-5"`) passes through unchanged.
 */
export function normalizeModelId(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

/** The row shape `costForRow`/`costForRows` fold over — structurally satisfied by `llm-usage-store.ts`'s `LlmUsageRecord` (which carries additional `at`/`purpose` fields this function ignores). */
export interface LlmUsageCostRow {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Dollars for one usage row, against `prices` (defaults to
 * `LLM_PRICE_PER_MILLION_TOKENS`). Throws for a model with no price-table
 * entry (even after `normalizeModelId`) — every row this function is ever
 * handed comes from `llm-adapter.ts`'s own two known model constants, so an
 * unrecognized model signals a real bug (a new model wired into the
 * adapter with no matching price-table entry), not a runtime condition
 * worth silently ignoring or pricing as free.
 */
export function costForRow(row: LlmUsageCostRow, prices: Readonly<Record<string, LlmModelPrice>> = LLM_PRICE_PER_MILLION_TOKENS): number {
  const price = prices[normalizeModelId(row.model)];
  if (!price) {
    throw new Error(`llm-cost: no price-table entry for model "${row.model}" (normalized: "${normalizeModelId(row.model)}")`);
  }
  return (
    (row.inputTokens / TOKENS_PER_MILLION) * price.input +
    (row.outputTokens / TOKENS_PER_MILLION) * price.output +
    (row.cacheCreationInputTokens / TOKENS_PER_MILLION) * price.input * CACHE_WRITE_PRICE_MULTIPLIER +
    (row.cacheReadInputTokens / TOKENS_PER_MILLION) * price.input * CACHE_READ_PRICE_MULTIPLIER
  );
}

/**
 * Total dollars across `rows` — the pure aggregation Epic 12's Desk sums
 * over a month's worth of `llm-usage-store.ts` rows (that filtering-by-date
 * is the caller's job; this function itself has no notion of "this
 * month").
 */
export function costForRows(rows: readonly LlmUsageCostRow[], prices: Readonly<Record<string, LlmModelPrice>> = LLM_PRICE_PER_MILLION_TOKENS): number {
  return rows.reduce((sum, row) => sum + costForRow(row, prices), 0);
}

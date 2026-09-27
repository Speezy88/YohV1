/**
 * Tests for `src/core/llm-cost.ts` (real-use fixes plan, Task 9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  costForRow,
  costForRows,
  normalizeModelId,
  LLM_PRICE_PER_MILLION_TOKENS,
  CACHE_READ_PRICE_MULTIPLIER,
  CACHE_WRITE_PRICE_MULTIPLIER,
  type LlmUsageCostRow,
} from "../src/core/llm-cost.ts";

test("LLM_PRICE_PER_MILLION_TOKENS carries exactly the two prices Task 9 specifies", () => {
  assert.deepEqual(LLM_PRICE_PER_MILLION_TOKENS["claude-haiku-4-5"], { input: 1, output: 5 });
  assert.deepEqual(LLM_PRICE_PER_MILLION_TOKENS["claude-sonnet-5"], { input: 2, output: 10 });
});

test("normalizeModelId strips a trailing dated-snapshot suffix", () => {
  assert.equal(normalizeModelId("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
});

test("normalizeModelId passes a model id with no dated suffix through unchanged", () => {
  assert.equal(normalizeModelId("claude-sonnet-5"), "claude-sonnet-5");
});

test("costForRow computes plain input+output dollars for a fixed fixture (Haiku, no cache)", () => {
  const row: LlmUsageCostRow = {
    model: "claude-haiku-4-5-20251001",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  // 1,000,000 input tokens @ $1/M + 1,000,000 output tokens @ $5/M = $6.
  assert.equal(costForRow(row), 6);
});

test("costForRow computes plain input+output dollars for a fixed fixture (Sonnet, no cache)", () => {
  const row: LlmUsageCostRow = {
    model: "claude-sonnet-5",
    inputTokens: 500_000,
    outputTokens: 200_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  // 500,000 @ $2/M = $1; 200,000 @ $10/M = $2. Total $3.
  assert.equal(costForRow(row), 3);
});

test("costForRow applies the 1.25x cache-write and 0.1x cache-read multipliers over the model's OWN input price", () => {
  const row: LlmUsageCostRow = {
    model: "claude-haiku-4-5-20251001",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
  };
  // Haiku input price is $1/M: cache write = $1 * 1.25 = $1.25; cache read = $1 * 0.1 = $0.10. Total $1.35.
  assert.equal(costForRow(row), 1 * CACHE_WRITE_PRICE_MULTIPLIER + 1 * CACHE_READ_PRICE_MULTIPLIER);
  assert.equal(Math.round(costForRow(row) * 100) / 100, 1.35);
});

test("costForRow sums all four token categories for one row", () => {
  const row: LlmUsageCostRow = {
    model: "claude-sonnet-5",
    inputTokens: 100_000,
    outputTokens: 50_000,
    cacheCreationInputTokens: 20_000,
    cacheReadInputTokens: 300_000,
  };
  const expected =
    (100_000 / 1_000_000) * 2 +
    (50_000 / 1_000_000) * 10 +
    (20_000 / 1_000_000) * 2 * 1.25 +
    (300_000 / 1_000_000) * 2 * 0.1;
  assert.equal(costForRow(row), expected);
});

test("costForRow throws for a model with no price-table entry, even after normalization", () => {
  const row: LlmUsageCostRow = { model: "gpt-5", inputTokens: 100, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  assert.throws(() => costForRow(row), /no price-table entry/);
});

test("costForRows sums costForRow across a fixed multi-row, multi-model fixture", () => {
  const rows: readonly LlmUsageCostRow[] = [
    { model: "claude-haiku-4-5-20251001", inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, // $1
    { model: "claude-haiku-4-5-20251001", inputTokens: 0, outputTokens: 1_000_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, // $5
    { model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, // $2
  ];
  assert.equal(costForRows(rows), 8);
});

test("costForRows returns 0 for an empty fixture", () => {
  assert.equal(costForRows([]), 0);
});

test("costForRow/costForRows accept an overriding price table", () => {
  const row: LlmUsageCostRow = { model: "custom-model", inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  const customPrices = { "custom-model": { input: 3, output: 9 } };
  assert.equal(costForRow(row, customPrices), 3);
  assert.equal(costForRows([row], customPrices), 3);
});

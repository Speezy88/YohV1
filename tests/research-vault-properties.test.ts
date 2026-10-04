import { test } from "node:test";
import assert from "node:assert/strict";
import { researchVaultProperties } from "../src/core/research-vault-properties.ts";

test("researchVaultProperties builds the Research Vault property set", () => {
  assert.deepEqual(
    researchVaultProperties({ query: "best laptops", answer: "Get X.", citations: ["https://a", "https://b"], searchDate: "2026-10-04" }),
    { title: "best laptops", keyFindings: "Get X.", query: "best laptops", searchDate: "2026-10-04", sources: "https://a\nhttps://b" },
  );
});

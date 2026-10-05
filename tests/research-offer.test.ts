import assert from "node:assert/strict";
import { test } from "node:test";
import { parseResearchOffer } from "../src/core/research-offer.ts";
import { parseSearchIntent } from "../src/core/search-intent.ts";

const MATCHES: ReadonlyArray<readonly [string, string]> = [
  ["research the best budget laptops for college", "the best budget laptops for college"],
  ["Hey Meeseek, can you please research electric bikes", "electric bikes"],
  ["research", "research"],
  ["give me a deep dive on heat pumps", "give me a deep dive on heat pumps"],
  ["compare heat pumps with an in depth analysis", "compare heat pumps with an in depth analysis"],
  ["an in-depth look at index funds", "an in-depth look at index funds"],
  ["a comprehensive overview of the Roman economy", "a comprehensive overview of the Roman economy"],
  ["a thorough comparison of Rust and Go", "a thorough comparison of Rust and Go"],
  ["pros and cons of nuclear power", "pros and cons of nuclear power"],
  ["write a report on solid-state batteries", "write a report on solid-state batteries"],
  ["give me a report on the housing market", "give me a report on the housing market"],
  ["put together a report on 3D printing", "put together a report on 3D printing"],
  ["give me an in-depth look at fusion power", "give me an in-depth look at fusion power"],
  ["Research: best laptops", "best laptops"],
  ["  -- research best laptops", "best laptops"],
];

for (const [line, question] of MATCHES) {
  test(`parseResearchOffer offers for: ${line}`, () => {
    assert.deepEqual(parseResearchOffer(line), { question });
  });
}

const NEAR_MISSES: readonly string[] = [
  "research vault",
  "I need to research colleges",
  "remind me to research flights",
  "/research best laptops",
  "search: research the best laptops",
  "what's the weather today",
  "what's the latest AI news",
  "how tall is Mount Everest",
  "who won the game last night",
  "plan my day",
  "what should I work on",
  "research the schedule for tomorrow",
  "research my calendar",
  "write a report on my progress",
  "give me a detailed overview of my day",
  "I want an in-depth look at my week",
  "pros and cons of my plan",
  "a thorough analysis of the task list",
  "do my homework in depth",
  "give me a detailed breakdown of today",
  "give me a detailed overview of this week",
  "can you give me a thorough breakdown of tomorrow",
  "explain photosynthesis in depth",
  "we covered cells in depth in class today",
  "research hub is not loading",
  "research paper is finished",
  "research project is due",
  "",
  "   ",
];

for (const line of NEAR_MISSES) {
  test(`parseResearchOffer does not offer for: "${line}"`, () => {
    assert.equal(parseResearchOffer(line), undefined);
  });
}

test("plain factual search lines are still search-intent, not offers", () => {
  for (const line of ["what's the latest AI news", "search for the best hiking boots", "look up the capital of France"]) {
    assert.equal(parseResearchOffer(line), undefined);
    assert.ok(parseSearchIntent(line));
  }
});

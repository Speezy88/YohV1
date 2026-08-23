/**
 * Tests for `src/core/tone.ts` (Story 2.2 / Task 14, FR-18's
 * default/contextual half).
 *
 * Per the task brief, `tone.ts` is a pure classifier — it cannot call Claude
 * itself, so these tests assert on its classification output and the
 * *content* of the instruction strings it produces, never on actual
 * LLM-generated prose (no live Claude access here).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTone, buildToneSystemPrompt, resolveToneSystemPrompt, type ToneRegister } from "../src/core/tone.ts";

// ============================================================================
// classifyTone — casual/conversational vs. factual/intellectual
// ============================================================================

test("classifyTone: casual, conversational messages classify to the casual-peer register", () => {
  const casualMessages = [
    "hey, what's up",
    "hi there",
    "how's it going",
    "ugh, today was rough",
    "lol nice",
    "thanks, that helps",
    "I'm so tired today",
    "just checking in",
  ];
  for (const message of casualMessages) {
    assert.equal(classifyTone(message), "casual-peer", `expected "${message}" to classify as casual-peer`);
  }
});

test("classifyTone: factual or intellectual questions classify to the concise-educational register", () => {
  const factualMessages = [
    "What's the difference between TCP and UDP?",
    "Why does the sky appear blue?",
    "How does a hash table work?",
    "When did the Roman Empire fall?",
    "Explain quantum entanglement",
    "Define opportunity cost",
  ];
  for (const message of factualMessages) {
    assert.equal(
      classifyTone(message),
      "concise-educational",
      `expected "${message}" to classify as concise-educational`,
    );
  }
});

test("classifyTone: a social/small-talk question stays casual even though it's phrased as a question", () => {
  // "How are you" / "what's up" are WH-led and end in a question mark, but
  // they're social small talk, not a request for facts — the classifier
  // must not blindly treat every question-shaped message as factual.
  assert.equal(classifyTone("how are you?"), "casual-peer");
  assert.equal(classifyTone("what's up?"), "casual-peer");
});

test("classifyTone: defaults to the casual-peer register for ambiguous/ordinary conversational input", () => {
  assert.equal(classifyTone("sounds good, let's do that"), "casual-peer");
  assert.equal(classifyTone(""), "casual-peer");
});

// ============================================================================
// buildToneSystemPrompt — the instruction strings tone.ts hands
// llm-adapter.ts's `answerGeneralQuestion`
// ============================================================================

test("buildToneSystemPrompt: the casual and factual instructions differ meaningfully", () => {
  const casual = buildToneSystemPrompt("casual-peer");
  const factual = buildToneSystemPrompt("concise-educational");
  assert.notEqual(casual, factual);
  assert.ok(casual.length > 0);
  assert.ok(factual.length > 0);
});

test("buildToneSystemPrompt: the concise-educational instruction explicitly warns against the \"it's not just X, it's Y\" framing", () => {
  const factual = buildToneSystemPrompt("concise-educational");
  assert.match(factual, /it's not just/i);
});

test("buildToneSystemPrompt: the casual-peer instruction explicitly discourages repetitive/robotic delivery", () => {
  const casual = buildToneSystemPrompt("casual-peer");
  assert.match(casual, /repetitive/i);
  assert.match(casual, /robotic/i);
});

test("buildToneSystemPrompt: neither instruction reads as corporate/assistant boilerplate itself", () => {
  const casual = buildToneSystemPrompt("casual-peer");
  const factual = buildToneSystemPrompt("concise-educational");
  const bannedPhrases = [
    /i'?d be happy to/i,
    /as an ai language model/i,
    /great question/i,
    /i hope this helps/i,
    /certainly!/i,
  ];
  for (const banned of bannedPhrases) {
    assert.doesNotMatch(casual, banned, `casual instruction should not itself contain: ${banned}`);
    assert.doesNotMatch(factual, banned, `factual instruction should not itself contain: ${banned}`);
  }
});

test("buildToneSystemPrompt: both instructions instruct Claude to avoid corporate/assistant boilerplate phrasing", () => {
  const casual = buildToneSystemPrompt("casual-peer");
  const factual = buildToneSystemPrompt("concise-educational");
  assert.match(casual, /boilerplate/i);
  assert.match(factual, /boilerplate/i);
});

test("buildToneSystemPrompt: both instructions warn against unearned enthusiasm and filler preamble", () => {
  const casual = buildToneSystemPrompt("casual-peer");
  const factual = buildToneSystemPrompt("concise-educational");
  for (const instruction of [casual, factual]) {
    assert.match(instruction, /enthusiasm/i);
    assert.match(instruction, /preamble/i);
  }
});

test("buildToneSystemPrompt: exhaustively covers every ToneRegister value with a non-empty instruction", () => {
  const registers: readonly ToneRegister[] = ["casual-peer", "concise-educational"];
  for (const register of registers) {
    assert.ok(buildToneSystemPrompt(register).length > 0);
  }
});

// ============================================================================
// resolveToneSystemPrompt — the chat-cli.ts integration seam: classify, then
// build, in one call
// ============================================================================

test("resolveToneSystemPrompt: composes classifyTone + buildToneSystemPrompt for a casual message", () => {
  const instruction = resolveToneSystemPrompt("hey, what's up");
  assert.equal(instruction, buildToneSystemPrompt("casual-peer"));
});

test("resolveToneSystemPrompt: composes classifyTone + buildToneSystemPrompt for a factual question", () => {
  const instruction = resolveToneSystemPrompt("What's the difference between TCP and UDP?");
  assert.equal(instruction, buildToneSystemPrompt("concise-educational"));
});

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
import {
  classifyTone,
  buildToneSystemPrompt,
  resolveToneSystemPrompt,
  TONE_ESCALATION_CURVE,
  computeToneEscalationLevel,
  resolveEscalatedToneSystemPrompt,
  type ToneRegister,
} from "../src/core/tone.ts";

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

test("buildToneSystemPrompt: both instructions tell Claude about Yoh's real capabilities, so a capability question or an off-phrasing request isn't answered as a generic, tool-blind assistant", () => {
  const casual = buildToneSystemPrompt("casual-peer");
  const factual = buildToneSystemPrompt("concise-educational");
  for (const instruction of [casual, factual]) {
    assert.match(instruction, /notion/i);
    assert.match(instruction, /calendar/i);
    assert.match(instruction, /search/i);
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

// ============================================================================
// Tone escalation (Task 18 / Story 2.6, FR-19) — computeToneEscalationLevel
// and resolveEscalatedToneSystemPrompt. Per AD-6, tone.ts supplies its OWN
// EscalationCurve to escalate-under-strain.ts's shared computeEscalation,
// distinct from slip-bump.ts's own curve even though both consume the same
// Task strainCount input (a Task's current Slip-Bump level).
// ============================================================================

// ----------------------------------------------------------------------------
// (1) Determinism: identical strainCount -> identical escalation output,
// regardless of any other varying input. tone.ts has no clock/mood/randomness
// dependency, so this holds trivially for a pure function of strainCount
// alone — but we assert it explicitly per the brief's AC.
// ----------------------------------------------------------------------------

test("computeToneEscalationLevel: identical strainCount always produces an identical EscalationLevel (no hidden clock/mood dependency)", () => {
  for (const strainCount of [0, 1, 2, 3, 4, 10]) {
    const first = computeToneEscalationLevel(strainCount);
    const second = computeToneEscalationLevel(strainCount);
    assert.deepEqual(first, second);
  }
});

test("resolveEscalatedToneSystemPrompt: identical (register, strainCount) always produces an identical instruction string, called on 'different days'", () => {
  // Simulates "two days with identical slip history for a Task": nothing
  // about wall-clock time is ever passed in, so repeated calls with the same
  // inputs — however far apart in real time — must match exactly.
  for (const register of ["casual-peer", "concise-educational"] as const) {
    for (const strainCount of [0, 1, 2, 3, 4]) {
      const dayOne = resolveEscalatedToneSystemPrompt(register, strainCount);
      const dayTwo = resolveEscalatedToneSystemPrompt(register, strainCount);
      assert.equal(dayOne, dayTwo);
    }
  }
});

// ----------------------------------------------------------------------------
// (2) strainCount = 0 (no slip/strain signal) -> no elevated urgency
// language in the output; identical to the plain base instruction.
// ----------------------------------------------------------------------------

test("resolveEscalatedToneSystemPrompt: strainCount 0 (no slip/strain signal) produces exactly the base register instruction, with no elevated urgency language", () => {
  for (const register of ["casual-peer", "concise-educational"] as const) {
    const escalated = resolveEscalatedToneSystemPrompt(register, 0);
    const base = buildToneSystemPrompt(register);
    assert.equal(escalated, base, "strainCount 0 should produce exactly the unescalated base instruction");
    assert.doesNotMatch(escalated, /urgen/i);
    assert.doesNotMatch(escalated, /slipp/i);
  }
});

test("computeToneEscalationLevel: strainCount 0 produces value 0, not at cap", () => {
  assert.deepEqual(computeToneEscalationLevel(0), { value: 0, atCap: false });
});

// ----------------------------------------------------------------------------
// (3) Escalation genuinely rises with strainCount up to tone.ts's own cap,
// then plateaus — worked numeric example against TONE_ESCALATION_CURVE.
// ----------------------------------------------------------------------------

test("TONE_ESCALATION_CURVE: worked numbers show escalation rising with strainCount, then plateauing at tone.ts's own cap", () => {
  const at0 = computeToneEscalationLevel(0);
  const at1 = computeToneEscalationLevel(1);
  const at2 = computeToneEscalationLevel(2);
  const at3 = computeToneEscalationLevel(3);
  const at4 = computeToneEscalationLevel(4);

  // Strictly rising while below the cap.
  assert.ok(at0.value < at1.value, "value should rise from strainCount 0 to 1");
  assert.ok(at1.value < at2.value, "value should rise from strainCount 1 to 2");
  assert.equal(at0.atCap, false);
  assert.equal(at1.atCap, false);

  // Cap reached and held from here on (plateau).
  assert.equal(at2.value, TONE_ESCALATION_CURVE.cap);
  assert.equal(at2.atCap, true);
  assert.equal(at3.value, TONE_ESCALATION_CURVE.cap);
  assert.equal(at3.atCap, true);
  assert.equal(at4.value, TONE_ESCALATION_CURVE.cap);
  assert.equal(at4.atCap, true);

  // Concrete numbers this curve actually produces, spelled out so a future
  // tuning change is forced to consciously re-examine this test rather than
  // silently drift.
  assert.deepEqual(
    [at0.value, at1.value, at2.value, at3.value, at4.value],
    [0, 2, 4, 4, 4],
  );

  // Distinct from slip-bump.ts's own curve ({ cap: 3, step: 1 }) — AD-6.
  assert.notDeepEqual(TONE_ESCALATION_CURVE, { cap: 3, step: 1 });
});

test("computeToneEscalationLevel: value never exceeds TONE_ESCALATION_CURVE.cap for any strainCount", () => {
  for (const strainCount of [0, 1, 2, 3, 4, 5, 10, 100]) {
    const level = computeToneEscalationLevel(strainCount);
    assert.ok(level.value <= TONE_ESCALATION_CURVE.cap);
  }
});

// ----------------------------------------------------------------------------
// (4) The escalation-aware instruction content is verifiably different from
// the non-escalated base register's instruction — asserted on actual string
// content, not just "a string comes back".
// ----------------------------------------------------------------------------

test("resolveEscalatedToneSystemPrompt: a Task with strain (strainCount > 0) produces an instruction that differs from, and extends, the base register instruction", () => {
  for (const register of ["casual-peer", "concise-educational"] as const) {
    const base = buildToneSystemPrompt(register);
    const escalated = resolveEscalatedToneSystemPrompt(register, 1);
    assert.notEqual(escalated, base);
    assert.ok(escalated.includes(base), "escalated instruction should extend the base instruction, not replace it");
    assert.match(escalated, /slipp/i);
  }
});

test("resolveEscalatedToneSystemPrompt: at the escalation cap, the instruction reads distinctly more urgent than a below-cap escalation", () => {
  for (const register of ["casual-peer", "concise-educational"] as const) {
    const belowCap = resolveEscalatedToneSystemPrompt(register, 1); // value 2, not at cap
    const atCap = resolveEscalatedToneSystemPrompt(register, 2); // value 4, at cap
    assert.notEqual(belowCap, atCap);
    // The at-cap instruction should explicitly name repeated/urgent strain,
    // beyond the more measured below-cap phrasing.
    assert.match(atCap, /repeatedly|highest|now\b/i);
  }
});

test("resolveEscalatedToneSystemPrompt: exhaustively covers every ToneRegister at every escalation tier with a non-empty instruction", () => {
  const registers: readonly ToneRegister[] = ["casual-peer", "concise-educational"];
  for (const register of registers) {
    for (const strainCount of [0, 1, 2, 3]) {
      const instruction = resolveEscalatedToneSystemPrompt(register, strainCount);
      assert.ok(instruction.length > 0);
    }
  }
});

// ============================================================================
// CAPABILITIES_INSTRUCTION content (real-use fixes plan, Task 5): the
// general-chat capability list must accurately reflect what /plan (Task 1)
// and day-view (Task 5) actually add, and must never claim Yoh can delete or
// cancel a Calendar event (AD-13 — there is no delete variant anywhere in
// this codebase).
// ============================================================================

test("buildToneSystemPrompt's capability list says Yoh can build today's Plan on demand and read any day's Calendar (Tasks 1 and 5)", () => {
  const instruction = buildToneSystemPrompt("casual-peer");
  assert.match(instruction, /\/plan/);
  assert.match(instruction, /plan my day/i);
  assert.match(instruction, /read any day's calendar/i);
});

test("buildToneSystemPrompt's capability list never claims Yoh can delete or cancel a Calendar event", () => {
  const instruction = buildToneSystemPrompt("casual-peer");
  assert.doesNotMatch(instruction, /can\s+(?:delete|cancel)\s+(?:a\s+)?calendar/i);
  assert.match(instruction, /cannot delete or cancel a calendar event/i);
});

// ============================================================================
// Review fix: FR-42 says Yoh never claims a capability it doesn't have.
// Spencer may have no PERPLEXITY_API_KEY configured, so the capability text
// must depend on a threaded `webSearchAvailable` boolean rather than
// claiming web search unconditionally.
// ============================================================================

test("buildToneSystemPrompt claims web search when webSearchAvailable is true (the default, and every existing call site's unchanged behavior)", () => {
  const withDefault = buildToneSystemPrompt("casual-peer");
  const explicitTrue = buildToneSystemPrompt("casual-peer", true);
  assert.equal(withDefault, explicitTrue);
  assert.match(explicitTrue, /search the web/i);
  assert.doesNotMatch(explicitTrue, /isn't set up yet/i);
});

test("buildToneSystemPrompt never claims web search when webSearchAvailable is false, and says plainly it isn't set up", () => {
  const instruction = buildToneSystemPrompt("casual-peer", false);
  assert.doesNotMatch(instruction, /search the web/i);
  assert.match(instruction, /web search isn't set up yet \(it needs a perplexity key\)/i);
});

test("resolveToneSystemPrompt threads webSearchAvailable through to buildToneSystemPrompt", () => {
  const available = resolveToneSystemPrompt("hey, what's up", true);
  const unavailable = resolveToneSystemPrompt("hey, what's up", false);
  assert.equal(available, buildToneSystemPrompt("casual-peer", true));
  assert.equal(unavailable, buildToneSystemPrompt("casual-peer", false));
  assert.notEqual(available, unavailable);
});

// ============================================================================
// E15: capability text built from the command registry
// ============================================================================

import { COMMANDS } from "../src/app/commands.ts";

test("capabilities text lists every registry command, and a new entry needs no tone.ts edit", () => {
  const prompt = resolveToneSystemPrompt("hey", true, COMMANDS);
  for (const c of COMMANDS) assert.ok(prompt.includes(c.name), c.name);
  assert.match(prompt, /remember that/);
  const extra = resolveToneSystemPrompt("hey", true, [...COMMANDS, { name: "/zzz", description: "does zzz", example: "/zzz now" }]);
  assert.match(extra, /\/zzz \(does zzz\) for example "\/zzz now"/);
  assert.ok(extra.indexOf("/zzz") < extra.indexOf("You do NOT have"));
});

test("no commands leaves the prompt byte-identical to before", () => {
  assert.equal(resolveToneSystemPrompt("hey", true, []), resolveToneSystemPrompt("hey", true));
  assert.doesNotMatch(resolveToneSystemPrompt("hey"), /Slash commands you can run/);
});

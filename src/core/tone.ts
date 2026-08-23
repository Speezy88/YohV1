/**
 * src/core/tone.ts
 *
 * Default and Contextual Tone (Story 2.2 / Task 14, FR-18's
 * default/contextual half). Per AD-1/AD-2, this is a pure `core/*.ts`
 * module: no I/O, no module-level mutable state, same inputs always produce
 * the same outputs. It must NOT — and does not — call the Claude API itself;
 * that stays `adapters/llm-adapter.ts`'s job (AD-9). Its whole
 * responsibility is:
 *
 *  1. `classifyTone` — classify one incoming chat message into a
 *     `ToneRegister` (`"casual-peer"` default, or `"concise-educational"`
 *     for a factual/intellectual question).
 *  2. `buildToneSystemPrompt` — turn a `ToneRegister` into the system-prompt
 *     instruction string `answerGeneralQuestion` sends to Claude as its
 *     `systemPrompt` override (that function's own doc comment names this
 *     file as the expected source of that override — see
 *     `adapters/llm-adapter.ts`).
 *  3. `resolveToneSystemPrompt` — the one-call composition of the above two,
 *     which is what `shell/chat-cli.ts` actually calls: classify the line,
 *     then hand `answerGeneralQuestion` the resulting instruction as its
 *     third argument.
 *
 * Result<T, YohError> (AD-8): deliberately NOT used here. AD-8's contract is
 * for functions that can fail; `classifyTone` and `buildToneSystemPrompt`
 * are total functions over their inputs — every string (including "") maps
 * to exactly one of two registers, and every `ToneRegister` value maps to
 * exactly one instruction string. There is no failure mode to report, so
 * wrapping the return in `Result` would just be `{ ok: true, value }` at
 * every call site — ceremony with no payoff. If a later extension
 * introduces an actual failure mode (e.g. an escalation curve lookup that
 * can be out of range), that specific function should return `Result`, not
 * this whole file retroactively.
 *
 * ============================================================================
 * Classification heuristic (a documented, defensible starting value — not
 * dictated by the spine, same as FR-2's even-split weights or FR-11's slip
 * curve; there is no live Claude access in this environment to do
 * LLM-based classification even if that were the plan)
 * ============================================================================
 *
 * Casual/peer-level is the DEFAULT register (per the brief's own framing:
 * "Yoh talks like a competent peer by default, and switches to a plain
 * factual register for factual questions") — so classification only ever
 * escalates OUT of casual-peer when a message clearly reads as a request for
 * facts or an explanation of a concept; everything else, including
 * ambiguous or purely social input, stays casual-peer.
 *
 * Two ordered checks:
 *
 *  1. A small, explicit set of casual/social-small-talk patterns (greetings,
 *     "how are you"/"what's up"-style check-ins, casual reactions like
 *     "lol"/"nice"/"ugh", personal feeling statements like "I'm tired") is
 *     checked FIRST and, if matched, wins outright. This matters because
 *     some casual small talk is itself question-shaped ("how are you?",
 *     "what's up?") — without this first pass a naive "starts with a WH-word
 *     and ends in '?'" rule would misclassify ordinary social check-ins as
 *     factual questions, which is exactly the "AI-ey" over-eagerness this
 *     story exists to avoid.
 *
 *  2. Only if nothing casual matched, a message is classified
 *     `concise-educational` when it looks like a genuine request for facts
 *     or an explanation: it opens with a WH-word (what/why/how/when/where/
 *     who/which/whose/whom), an inverted auxiliary verb ending in "?" (e.g.
 *     "Is X true?", "Does Y work like Z?"), or an explicit
 *     explain/define/describe/clarify/summarize request.
 *
 * Anything matching neither check — including blank input — stays
 * `casual-peer`, per the "casual is the default" framing above.
 */

// ============================================================================
// ToneRegister
// ============================================================================

/**
 * The two registers this task covers (FR-18's default/contextual half).
 * Task 18 (Story 2.6, FR-19's Escalate-Under-Strain-driven urgency half) is
 * expected to extend this file additively once `core/escalate-under-strain.ts`
 * exists — most likely as a third register value here, or as a separate
 * "urgency modifier" this file's instruction-builder layers on top of one of
 * these two, applied after `buildToneSystemPrompt` rather than replacing it.
 * Nothing about that shape is guessed at here; this union stays exactly the
 * two values Task 14's acceptance criteria require.
 */
export type ToneRegister = "casual-peer" | "concise-educational";

// ============================================================================
// classifyTone
// ============================================================================

/**
 * Casual/social small talk, checked first and wins outright — see this
 * file's module doc comment for why this ordering matters (a question-shaped
 * social check-in like "how are you?" must not be misread as a factual
 * question).
 */
const CASUAL_PATTERNS: readonly RegExp[] = [
  /^(hey|hi+|hello+|yo|sup|hiya|howdy)\b/i, // greeting openers
  /how'?s it going\b/i,
  /what'?s up\b/i,
  /^how are you\b/i,
  /^how'?re you\b/i,
  /^(lol|lmao|haha+|nice|cool|ugh+|damn|wow|ok(ay)?|alright)\b/i, // casual reactions
  /^(thanks?( you)?|no worries|my bad|sorry)\b/i,
  /^just checking in\b/i,
  /^i'?m (so |really |kind of |a little |pretty )?(tired|exhausted|stressed|overwhelmed|frustrated|annoyed|bored|excited|happy|sad|done|beat)\b/i, // personal feeling statement
];

/**
 * A genuine request for facts or an explanation of a concept — only checked
 * once nothing in `CASUAL_PATTERNS` matched.
 */
const FACTUAL_QUESTION_PATTERNS: readonly RegExp[] = [
  /^(what|why|how|when|where|who|which|whose|whom)\b/i, // WH-led question
  /^(is|are|does|do|did|can|could|would|should|will)\b.*\?\s*$/i, // aux-inversion question ending in "?"
  /^(explain|define|describe|clarify|summarize)\b/i, // imperative factual/explanatory request
];

/**
 * Classifies one incoming chat message into a `ToneRegister`. Total over its
 * input — every string, including `""`, maps to exactly one register (see
 * this file's module doc comment for why no `Result` wrapper here). Never
 * calls the Claude API; purely a text-shape heuristic (see module doc
 * comment for the reasoning and its documented limits).
 */
export function classifyTone(message: string): ToneRegister {
  const trimmed = message.trim();
  if (CASUAL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "casual-peer";
  }
  if (FACTUAL_QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "concise-educational";
  }
  return "casual-peer"; // default per the brief's own framing.
}

// ============================================================================
// buildToneSystemPrompt
// ============================================================================

/**
 * Shared across both registers: the identity framing and the blanket
 * "never read as corporate/assistant-boilerplate" instruction the brief's
 * third Given/When/Then applies to every response regardless of register.
 * Deliberately describes what to avoid in the abstract (no unearned
 * enthusiasm, no filler preamble, no corporate/assistant-boilerplate
 * phrasing) rather than quoting specific banned example phrases verbatim —
 * naming e.g. "Great question!" as a literal banned string would make this
 * instruction itself contain that exact phrase, which is the opposite of
 * what it's asking for.
 */
const SHARED_BASE_INSTRUCTION =
  "You are Yoh, Spencer's personal daily-planning assistant, now answering a general chat message. " +
  "Speak like a real, competent peer — never like a customer-support bot or a generic AI assistant. " +
  "Never use corporate or assistant-boilerplate phrasing, never open with a filler preamble before " +
  "getting to your point, and never manufacture enthusiasm you don't actually have.";

/** Register-specific guidance for a casual, conversational message — the default register. */
const CASUAL_PEER_INSTRUCTION =
  `${SHARED_BASE_INSTRUCTION} This message reads as casual and conversational, so answer in Yoh's ` +
  "default casual, peer-level register: talk plainly and naturally, the way one competent friend " +
  "talks to another — contractions are fine, brevity is fine. Don't be repetitive or robotic, and " +
  "don't over-explain something simple just to sound thorough.";

/**
 * Register-specific guidance for a factual/intellectual question. Explicitly
 * names the "it's not just X, it's Y" rhetorical framing (per the brief's
 * second Given/When/Then) — an explicit callout, not just an abstract
 * "avoid rhetorical tics," since that specific framing is exactly what the
 * brief is guarding against.
 */
const CONCISE_EDUCATIONAL_INSTRUCTION =
  `${SHARED_BASE_INSTRUCTION} This message is a factual or intellectual question, so switch to a ` +
  "concise, educational register: answer directly and plainly, like a knowledgeable peer explaining " +
  "something, not a lecture. In particular, never use the \"it's not just X, it's Y\" rhetorical " +
  "framing (or similar false-contrast setups) — just state what's true.";

/**
 * Turns a `ToneRegister` into the system-prompt instruction string
 * `answerGeneralQuestion` (`adapters/llm-adapter.ts`) sends to Claude as its
 * `systemPrompt` override. Total over its input (every `ToneRegister` value
 * maps to exactly one non-empty instruction) — see this file's module doc
 * comment for why no `Result` wrapper.
 */
export function buildToneSystemPrompt(register: ToneRegister): string {
  switch (register) {
    case "casual-peer":
      return CASUAL_PEER_INSTRUCTION;
    case "concise-educational":
      return CONCISE_EDUCATIONAL_INSTRUCTION;
  }
}

// ============================================================================
// resolveToneSystemPrompt — the shell/chat-cli.ts integration seam
// ============================================================================

/**
 * Classifies `message` and returns its resulting tone instruction in one
 * call — this is what `shell/chat-cli.ts` actually calls before invoking
 * `answerGeneralQuestion`, passing this function's return value as that
 * function's third (`systemPrompt`) argument.
 */
export function resolveToneSystemPrompt(message: string): string {
  return buildToneSystemPrompt(classifyTone(message));
}

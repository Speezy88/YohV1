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
 *     which is what `app/general-question.ts`'s `answerQuestion` actually
 *     calls (Story 8.3: moved from `shell/chat-cli.ts`): classify the line,
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
 *
 * ============================================================================
 * Tone escalation (Task 18, Story 2.6, FR-19's Escalate-Under-Strain-driven
 * urgency half)
 * ============================================================================
 *
 * `computeToneEscalationLevel`/`resolveEscalatedToneSystemPrompt` below add
 * the escalation half of this same Tone capability, extending this file
 * additively per its own earlier note above. This does NOT touch
 * `classifyTone`/`buildToneSystemPrompt`/`resolveToneSystemPrompt` at all —
 * per AD-6, `tone.ts` supplies its own `EscalationCurve` to
 * `core/escalate-under-strain.ts`'s shared `computeEscalation`, distinct
 * from `slip-bump.ts`'s own curve even though both consume the same Task
 * `strainCount` input (a Task's current Slip-Bump level, per FR-19's AC).
 *
 * Where this connects (and where it deliberately does NOT, yet): FR-19's AC
 * is inherently about discussing a SPECIFIC Task with known slip/strain
 * history — "no slip/strain signal exists for a Task -> no elevated urgency
 * language appears [when discussing it]." A generic chat message handled by
 * `resolveToneSystemPrompt` has no notion of "which Task, if any, this
 * message is about," so escalation is NOT folded into that function — it
 * stays exactly as Task 14 built it, unescalated by construction (there is
 * no Task context to check in the first place), not by an ad-hoc special
 * case. `app/why-prioritized.ts`'s `explainPriority` (Story 8.3: moved from
 * `shell/chat-cli.ts`'s `whyPrioritizedCommand`) is the one place in this
 * codebase today that already resolves a specific Task's Slip-Bump level
 * (`computeSlipBumpLevel`) for a chat interaction — but it is a plain,
 * deterministic string-formatting reply that never calls Claude at all (no
 * `answerGeneralQuestion` / `systemPrompt` in its path), so there is nothing
 * for a "system-prompt addition" to attach to there without also turning it
 * into an LLM-backed command — a materially different, out-of-scope change
 * this task does not make. `resolveEscalatedToneSystemPrompt` is therefore
 * left as a tested, ready-to-use, but UNWIRED seam — the same choice
 * Task 17 made for its own end-to-end bridge — for a future caller that
 * discusses a specific Task with Claude and has that Task's current
 * Slip-Bump level on hand (e.g. a future LLM-backed "why is X prioritized"
 * follow-up, or Task 19's Night Ritual close-out).
 */

import type { CommandDescriptor } from "../types/api.ts";
import type { EscalationCurve, EscalationLevel } from "../types/domain.ts";
import { computeEscalation } from "./escalate-under-strain.ts";

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
 * Shared across both registers: identity, Spencer's own context, and the
 * voice rules that apply to every response regardless of register. Sourced
 * from `docs/SOUL.md` (the canonical persona reference) — keep the two in
 * sync if Yoh's voice changes; start at SOUL.md, then carry it here.
 *
 * Deliberately describes what to avoid in the abstract (no unearned
 * enthusiasm, no filler preamble, no corporate/assistant-boilerplate
 * phrasing) rather than quoting specific banned example phrases verbatim —
 * naming e.g. "Great question!" as a literal banned string would make this
 * instruction itself contain that exact phrase, which is the opposite of
 * what it's asking for.
 *
 * The contrast-framing ban (SOUL.md's "How Yoh Talks") lives here, in the
 * shared base, rather than only in the factual register below — SOUL.md
 * states it as a general rule, not one specific to explaining concepts.
 * Deliberately says nothing about slipping deadlines or urgency — that
 * stays exclusive to `resolveEscalatedToneSystemPrompt`'s additions below,
 * per this file's own AC that strainCount 0 produces the base instruction
 * with zero elevated-urgency language.
 */
/**
 * What Yoh can actually DO, in Spencer's own words, for the general-QA
 * fallback turn specifically (Task 15's root-cause fix — see this file's
 * module doc comment's cross-reference from `chat-cli.ts`, since retired;
 * Story 8.9). Without this, Claude answers a capability question (or a
 * request phrased outside every deterministic trigger's exact wording) as a
 * generic model with no knowledge of Yoh's real tool surface — observed
 * denying it could write to Notion at all, when `app/chat-turn.ts`'s
 * create-item path (`core/chat-commands.ts`'s `parseCreateItemCommand` ->
 * `app/create-item.ts`'s `draftItem`) does exactly that. Listed here, not
 * invented per-answer, so the claims stay truthful and in sync with what
 * `chatTurn` actually wires up; update this list when a new trigger is
 * added there.
 */
/**
 * Review fix (real-use fixes plan, Task 5 fix): FR-42 says Yoh never claims
 * a capability it doesn't have. Spencer may genuinely have no
 * `PERPLEXITY_API_KEY` configured (`shell/server.ts` derives this from the
 * env var, threads it as `ChatTurnDeps.webSearchAvailable` — see
 * `app/web-search.ts`'s `WebSearchDeps` — and `app/chat-turn.ts` forwards it
 * into `app/general-question.ts`'s `GeneralQuestionDeps`), so the
 * capability text can no longer be a fixed constant — it's built fresh per
 * call from this one boolean, the single source of truth for whether web
 * search is actually wired up right now. `webSearchAvailable = true`
 * reproduces the exact text this constant used to be, verbatim, so every
 * pre-existing call site that doesn't pass the flag (this file's own
 * `buildToneSystemPrompt`/`resolveToneSystemPrompt`/
 * `resolveEscalatedToneSystemPrompt` default it to `true`) is unaffected.
 */
function buildCapabilitiesInstruction(webSearchAvailable: boolean, commands: readonly CommandDescriptor[] = []): string {
  const intro =
    "Yoh (you) can actually do the following, for real, inside this same chat — when Spencer asks what you " +
    "can do, or asks for something one of these covers, say so accurately and, if his exact phrasing didn't " +
    "trigger it, tell him plainly how to phrase it rather than claiming you can't do it at all: manage his " +
    "Time Budget for the day; build today's Plan on demand (\"/plan\" or \"plan my day\") and show today's " +
    "Plan; read any day's Calendar — today, tomorrow, a weekday, or a specific date (e.g. \"what's happening " +
    "tomorrow\") — alongside that day's Plan if one has already been built; re-flow the rest of the day after " +
    "a Task runs long or a Blocker comes up; explain why a Task is prioritized today; create a new Task, " +
    "Project, or Research Vault entry directly in Notion (a confirm step shows the drafted fields before " +
    "anything is written); ";

  const searchAndCalendar = webSearchAvailable
    ? "search the web for a factual/current answer and optionally file the result to the Research Vault; and " +
      "move, resize, or create Calendar events (each shown for confirmation before it's written, never applied " +
      "silently). "
    : "move, resize, or create Calendar events (each shown for confirmation before it's written, never applied " +
      "silently). ";

  // E15: built from the command registry so a new entry needs no edit here.
  const commandsSection =
    commands.length === 0
      ? ""
      : "Slash commands you can run for Spencer in this chat: " +
        commands.map((c) => `${c.name} (${c.description}) for example "${c.example}"`).join("; ") +
        ". You file what Spencer tells you after chat turns, show a one-line Remembered receipt with Undo, and he can " +
        "say \"remember that ...\", \"forget ...\" or \"what do you remember about ...\". ";

  const limits = webSearchAvailable
    ? "You do NOT have a changelog or release notes about your own recent updates, and you CANNOT delete or " +
      "cancel a Calendar event (Spencer has to do that directly in Google Calendar) — say so plainly if asked, " +
      "rather than guessing or claiming otherwise."
    : "You do NOT have a changelog or release notes about your own recent updates, you CANNOT delete or " +
      "cancel a Calendar event (Spencer has to do that directly in Google Calendar), and web search isn't set " +
      "up yet (it needs a Perplexity key) — say so plainly if asked, rather than guessing or claiming otherwise.";

  return intro + searchAndCalendar + commandsSection + limits;
}

function buildSharedBaseInstruction(webSearchAvailable: boolean, commands: readonly CommandDescriptor[]): string {
  return (
    `${buildCapabilitiesInstruction(webSearchAvailable, commands)} You are Yoh, Spencer's personal daily-planning assistant, now answering a ` +
    "general chat message. " +
    "Spencer is a high school senior at Seattle Academy of Arts and Sciences (class of 2027) who also runs " +
    "sales and operations at Manatee Aquatic, co-founded the electrolyte beverage brand Obliterade with " +
    "Fred Hutch, founded and leads the SAAS Entrepreneurship Club, and is applying to college with a focus " +
    "on economics, PPE, or business — treat all of that as one person's real day, not separate contexts. " +
    "Speak like a sharp, well-liked chief of staff — never like a customer-support bot or a generic AI " +
    "assistant, and never manufacture enthusiasm you don't actually have. Never use corporate or " +
    "assistant-boilerplate phrasing, and never open with a filler preamble before getting to your point. " +
    "Prefer short sentences over long ones and plain words over impressive ones. Never use an em dash, in " +
    "any form (—, --, or a spaced hyphen used the same way) — use a period, a comma, or start a new " +
    "sentence instead. Don't lean on contrast framing as a crutch: no \"it's not just X, it's Y,\" no " +
    "\"this isn't about X, it's about Y,\" no reaching for a rejected alternative just to set up the real " +
    "point — state the point directly. A little humor is fine when it genuinely fits; never force it, and " +
    "if a line has to be cut for length, cut the joke before the substance. Never pretend to know " +
    "something you don't — say so plainly and offer to look it up. Never make a decision on Spencer's " +
    "behalf that he didn't ask you to make — recommend, don't decide for him."
  );
}

/** Register-specific guidance for a casual, conversational message — the default register. */
function buildCasualPeerInstruction(webSearchAvailable: boolean, commands: readonly CommandDescriptor[]): string {
  return (
    `${buildSharedBaseInstruction(webSearchAvailable, commands)} This message reads as casual and conversational, so answer in Yoh's ` +
    "default casual, peer-level register: talk plainly and naturally, the way one competent friend " +
    "talks to another — contractions are fine, brevity is fine. Don't be repetitive or robotic, and " +
    "don't over-explain something simple just to sound thorough."
  );
}

/**
 * Register-specific guidance for a factual/intellectual question. Explicitly
 * names the "it's not just X, it's Y" rhetorical framing (per the brief's
 * second Given/When/Then and SOUL.md's general contrast-framing ban, already
 * present in the shared base above) — an explicit callout here too, not just
 * an abstract "avoid rhetorical tics," since that specific framing is exactly
 * what the brief is guarding against and this register is most prone to it.
 */
function buildConciseEducationalInstruction(webSearchAvailable: boolean, commands: readonly CommandDescriptor[]): string {
  return (
    `${buildSharedBaseInstruction(webSearchAvailable, commands)} This message is a factual or intellectual question, so switch to a ` +
    "concise, educational register: answer directly and plainly, like a knowledgeable peer explaining " +
    "something, not a lecture. In particular, never use the \"it's not just X, it's Y\" rhetorical " +
    "framing (or similar false-contrast setups) — just state what's true."
  );
}

/**
 * Turns a `ToneRegister` into the system-prompt instruction string
 * `answerGeneralQuestion` (`adapters/llm-adapter.ts`) sends to Claude as its
 * `systemPrompt` override. Total over its input (every `ToneRegister` value
 * maps to exactly one non-empty instruction) — see this file's module doc
 * comment for why no `Result` wrapper.
 *
 * `webSearchAvailable` (review fix, real-use fixes plan Task 5) defaults to
 * `true` so every caller that predates this flag keeps its exact prior
 * output; `app/general-question.ts`'s `answerQuestion` is the one real
 * caller that always passes the actual, derived value (from
 * `ChatTurnDeps.webSearchAvailable`, ultimately `shell/server.ts`'s own
 * `Boolean(env["PERPLEXITY_API_KEY"])`).
 */
export function buildToneSystemPrompt(register: ToneRegister, webSearchAvailable: boolean = true, commands: readonly CommandDescriptor[] = []): string {
  switch (register) {
    case "casual-peer":
      return buildCasualPeerInstruction(webSearchAvailable, commands);
    case "concise-educational":
      return buildConciseEducationalInstruction(webSearchAvailable, commands);
  }
}

// ============================================================================
// resolveToneSystemPrompt — the app/general-question.ts integration seam
// (Story 8.3: originally shell/chat-cli.ts's own integration seam)
// ============================================================================

/**
 * Classifies `message` and returns its resulting tone instruction in one
 * call — this is what `app/general-question.ts`'s `answerQuestion` actually
 * calls before invoking `answerGeneralQuestion`, passing this function's
 * return value as that function's third (`systemPrompt`) argument.
 * `webSearchAvailable` (review fix) is forwarded to `buildToneSystemPrompt`
 * unchanged; see that function's own doc comment.
 */
export function resolveToneSystemPrompt(message: string, webSearchAvailable: boolean = true, commands: readonly CommandDescriptor[] = []): string {
  return buildToneSystemPrompt(classifyTone(message), webSearchAvailable, commands);
}

// ============================================================================
// Tone escalation (Task 18 / Story 2.6, FR-19) — see this file's module doc
// comment ("Tone escalation" section) for the full design rationale,
// including why this is left unwired into any real chat-turn call site.
// ============================================================================

/**
 * `tone.ts`'s own `EscalationCurve` (AD-6) — deliberately DISTINCT from
 * `slip-bump.ts`'s `{ cap: 3, step: 1 }` even though both consume the same
 * Task `strainCount` input (a Task's current Slip-Bump level, which is
 * itself already bounded to `[0, 3]` by `slip-bump.ts`'s own cap).
 *
 * `{ cap: 4, step: 2 }` — worked arithmetic (via
 * `escalate-under-strain.ts`'s `value = min(strainCount * step, cap)`):
 *
 *   strainCount 0 -> value 0,          atCap false   (no bump -> no escalation)
 *   strainCount 1 -> value 2,          atCap false   (first slip -> noticeable but measured)
 *   strainCount 2 -> value 4 (= cap),  atCap true    (full urgency reached)
 *   strainCount 3 -> value 4,          atCap true    (plateau — slip-bump's OWN cap)
 *   strainCount 4+-> value 4,          atCap true    (stays capped regardless)
 *
 * Reasoning for these specific numbers: because `strainCount` here is
 * already a bounded Slip-Bump level (never exceeds 3), Tone escalation is
 * deliberately calibrated to reach full urgency ONE STEP BEFORE that input
 * ceiling — by strainCount 2, not 3. This reflects that once the priority
 * engine has already meaningfully bumped a Task (2 out of its own max of
 * 3), the way Yoh TALKS about it should already be unmistakably urgent;
 * conversational tone doesn't need to keep ratcheting in lockstep with the
 * priority engine's own more measured curve, and there is no reason to
 * withhold full urgency in conversation until the Task has slipped the
 * absolute maximum tracked number of days. This produces a genuinely
 * rising-then-flat shape with two distinct pre-cap-adjacent values (0, 2)
 * before plateauing at 4 from strainCount 2 onward — small bump on the
 * first slip, full urgency by the second, same as `slip-bump.ts`'s own
 * curve is a documented, defensible starting value rather than one dictated
 * by the spine, freely tunable later once real usage exists to tune
 * against.
 */
export const TONE_ESCALATION_CURVE: EscalationCurve = { cap: 4, step: 2 };

/**
 * Computes a Task's Tone escalation level from its current Slip-Bump level
 * (`strainCount`, per FR-19's AC), via `escalate-under-strain.ts`'s shared
 * `computeEscalation` and this file's own `TONE_ESCALATION_CURVE`. Pure and
 * deterministic — same `strainCount` in, same `EscalationLevel` out, no
 * clock/randomness/session-mood dependency of any kind (this file's own AC:
 * "two days with identical slip history for a Task produce the identical
 * Tone escalation level, regardless of day of week or elapsed time").
 */
export function computeToneEscalationLevel(strainCount: number): EscalationLevel {
  return computeEscalation(strainCount, TONE_ESCALATION_CURVE);
}

/**
 * Escalation addition layered onto a base register's instruction once a
 * Task shows SOME strain but hasn't reached this file's escalation cap yet
 * (`0 < value < TONE_ESCALATION_CURVE.cap`) — a noticeably more direct nudge,
 * without yet reading as alarmed.
 */
const MODERATE_ESCALATION_ADDITION =
  "One more thing: this specific Task has slipped before and is showing early strain, so let a bit more " +
  "directness and urgency show through than usual — name plainly that it's slipping, and nudge toward " +
  "actually doing it, without sounding alarmed.";

/**
 * Escalation addition layered on once a Task's Tone escalation has reached
 * this file's cap (`atCap`) — unambiguous urgency, explicitly naming
 * repeated strain, still never robotic or harsh for its own sake.
 */
const HIGH_ESCALATION_ADDITION =
  "One more thing: this specific Task has slipped repeatedly and its tracked strain is at its highest " +
  "level, so be direct and unambiguous about the urgency — name plainly that it keeps slipping and that " +
  "it needs attention now, without being needlessly harsh or robotic about it.";

/**
 * Turns a base `ToneRegister` plus a Task's current Slip-Bump level
 * (`strainCount`) into an escalation-aware system-prompt instruction — the
 * function description in this task's own brief: "takes a strainCount ...
 * and a base ToneRegister, and produces an escalation-aware system-prompt
 * addition/modification." A future caller that is discussing a SPECIFIC
 * Task with Claude and has that Task's current Slip-Bump level on hand can
 * call this in place of `buildToneSystemPrompt`/`resolveToneSystemPrompt`
 * (see this file's module doc comment for why no existing call site is
 * wired to it yet).
 *
 * `strainCount <= 0` (no slip/strain signal for this Task, `computeEscalation`'s
 * own clamp for a negative/malformed count) returns EXACTLY the base
 * register's instruction, unmodified — per this file's own AC, "no
 * slip/strain signal exists for a Task -> no elevated urgency language
 * appears." Above zero, the base instruction is EXTENDED (never replaced)
 * with `MODERATE_ESCALATION_ADDITION` below this file's cap, or
 * `HIGH_ESCALATION_ADDITION` once `computeToneEscalationLevel` reports
 * `atCap` — both are appended, not substituted, so the base register's own
 * voice/register guidance always still applies even while escalated.
 */
export function resolveEscalatedToneSystemPrompt(
  register: ToneRegister,
  strainCount: number,
  webSearchAvailable: boolean = true,
  commands: readonly CommandDescriptor[] = [],
): string {
  const base = buildToneSystemPrompt(register, webSearchAvailable, commands);
  const level = computeToneEscalationLevel(strainCount);
  if (level.value <= 0) {
    return base;
  }
  const addition = level.atCap ? HIGH_ESCALATION_ADDITION : MODERATE_ESCALATION_ADDITION;
  return `${base} ${addition}`;
}

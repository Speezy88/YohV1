/**
 * src/adapters/llm-adapter.ts
 *
 * Owns Yoh's Claude API surface for `shell/chat-cli.ts`'s free-text chat
 * routing (Story 2.1 / Task 13, UX-DR9). Per the Architecture Spine's Stack
 * table this uses the official `@anthropic-ai/sdk`, never raw HTTP.
 *
 * ============================================================================
 * Intent-routing design (Task 13's own judgment call — the brief leaves the
 * exact mechanism open, only requiring that this story "wires the routing
 * scaffold" without dictating how classification happens)
 * ============================================================================
 *
 * `chat-cli.ts` already owns two cheap, deterministic, zero-API-call
 * recognizers: `parseTimeBudgetCommand` (Task 6) and `isPlanViewCommand`
 * (Task 11). Both remain exactly as they are — this file does not replace,
 * wrap, or duplicate their EXACT grammars, and `runChatCli`'s loop still
 * checks them first, unchanged, before ever reaching this file. Spending a
 * real Claude call to re-derive something a two-line regex already answers
 * for free would be pure waste on every single message Spencer types.
 *
 * What this file adds is the genuine "route free-text to an intent" piece
 * the brief asks for: `classifyChatIntent` is a pure, synchronous, local
 * classifier (no API call, no I/O) that labels ANY input — including
 * Time-Budget- and Plan-view-shaped text — with a `ChatIntent`. Its two
 * non-`general-qa` heuristics are deliberately LOOSER than `chat-cli.ts`'s
 * own grammars (existence-detection only, not exact parsing): `chat-cli.ts`
 * remains the sole owner and authority for whether a given line actually IS
 * a valid Time Budget/Plan-view command and what to do about it (AD-9 — one
 * capability, one home); this classifier exists so `llm-adapter.ts` itself
 * has a real, independently-testable routing surface, and so a rare line
 * this looser heuristic recognizes but `chat-cli.ts`'s stricter grammar
 * rejects (e.g. "time budget" with no amount) still gets labeled sensibly
 * rather than falling through unclassified. `adapters/*.ts` cannot import
 * from `shell/*.ts` (AD-1's layering runs the other way), so this is a small
 * intentional duplication of shape, not of behavior — documented here rather
 * than silently drifting.
 *
 * `ChatIntent` is a closed union today (`"time-budget" | "plan-view" |
 * "general-qa"`) but is meant to grow: Task 15 (Mid-Day Re-Flow) and Task 16
 * (Blocker reports) are expected to add their own members here rather than
 * fork a parallel type, per AD-9's "extend the shared type, never shadow it."
 *
 * `routeChatMessage` is the file's primary export (AD-9): it classifies,
 * then actually calls Claude for anything this file can itself answer.
 * Today that's every non-`general-qa` label too — not just `general-qa` —
 * because this task's third acceptance criterion is unconditional ("a
 * general/factual question with no matching specific intent must still get
 * a response... never an error/refusal"), and `chat-cli.ts`'s catch-all
 * branch only ever reaches this file after its own checks have already
 * ruled out a genuine Time Budget/Plan-view command. A `time-budget`/
 * `plan-view` label reaching `routeChatMessage` therefore only ever
 * represents that rare grammar-mismatch case above, not a real command Task
 * 15/16 will later intercept — those tasks are expected to add their own
 * branch in `runChatCli` BEFORE this file's classification (mirroring how
 * `parseTimeBudgetCommand`/`isPlanViewCommand` are checked first today), not
 * to change what `routeChatMessage` does with an intent it doesn't own a
 * real handler for.
 *
 * `answerGeneralQuestion` is the actual Claude call: model, system prompt,
 * and token cap are file-local constants today. `systemPrompt` is an
 * optional override parameter specifically so Task 14 (`core/tone.ts`) can
 * hand this file a Tone-governed instruction string without changing this
 * function's signature or the caller contract — `tone.ts` stays a pure
 * `core/*.ts` classifier per AD-1/AD-2 (it cannot call Claude itself) and
 * this file remains the only place that actually calls the API.
 *
 * Per AD-8, this file may throw on I/O failure rather than returning
 * `Result` itself — a transport-level SDK rejection propagates unchanged,
 * and an unexpected empty-text response is raised as a thrown `Error` too
 * (silently returning "" would look like a real, if empty, answer).
 * `shell/chat-cli.ts` catches either around its call site so one failed
 * Claude turn cannot crash the whole persistent REPL session — that is
 * ordinary shell-layer error handling, not the Result-conversion AD-8
 * reserves for `rituals/*.ts`.
 */
import Anthropic from "@anthropic-ai/sdk";

// ============================================================================
// Injectable Claude client — narrow structural interface, mirroring
// notification-adapter.ts's FetchLike seam. A real `new Anthropic(...)`
// instance satisfies this structurally (its `messages.create` returns
// `APIPromise<Message>`, itself a `Promise<Message>` subtype); tests inject
// a fake instead, since no live Claude API key is available in this
// environment.
// ============================================================================

export interface AnthropicMessagesClient {
  readonly messages: {
    readonly create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };
}

/** Builds the real injectable client from a loaded `LlmAdapterConfig`. */
export function createAnthropicMessagesClient(config: LlmAdapterConfig): AnthropicMessagesClient {
  return new Anthropic({ apiKey: config.apiKey });
}

// ============================================================================
// Config (AD-10: a static secret, loaded once from the environment)
// ============================================================================

export interface LlmAdapterConfig {
  readonly apiKey: string;
}

/**
 * Loads `LlmAdapterConfig` from `CLAUDE_API_KEY` (the exact name
 * `.env.example` documents), the same "throw rather than silently run with a
 * half-populated config" convention `notification-adapter.ts`'s
 * `loadPushoverConfigFromEnv` and `token-store.ts`'s
 * `loadGoogleOAuthConfigFromEnv` already use. Accepts an injectable `env` map
 * so tests never need to mutate real `process.env`.
 */
export function loadLlmAdapterConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LlmAdapterConfig {
  const apiKey = env["CLAUDE_API_KEY"];
  if (!apiKey) {
    throw new Error("llm-adapter: missing required environment variable CLAUDE_API_KEY");
  }
  return { apiKey };
}

// ============================================================================
// Intent classification — pure, local, no API call (see module docstring)
// ============================================================================

/**
 * The full set of chat intents `llm-adapter.ts` knows how to label.
 * `"general-qa"` is the catch-all this file itself answers via Claude;
 * `"time-budget"`/`"plan-view"` name intents `chat-cli.ts` already owns real
 * handlers for. Extend this union (never fork a parallel type, AD-9) as
 * later stories in this epic add their own intents — Mid-Day Re-Flow (Task
 * 15) and Blocker reports (Task 16) are the next two expected additions.
 */
export type ChatIntent = "time-budget" | "plan-view" | "general-qa";

/**
 * Loose, classification-only recognizer for Time-Budget-shaped input — see
 * the module docstring for why this is intentionally NOT the same grammar as
 * `chat-cli.ts`'s `parseTimeBudgetCommand` (that function still owns parsing
 * the actual amount/unit and remains the sole authority on whether a line is
 * a valid command). This only needs the leading phrase.
 */
const TIME_BUDGET_INTENT_RE = /^(?:set\s+|change\s+)?time\s*budget\b/i;

/**
 * Loose, classification-only recognizer for Plan-view-shaped input — mirrors
 * the phrasings `chat-cli.ts`'s `isPlanViewCommand` recognizes (a bare
 * "plan", "what's my plan", "show plan", etc.) for classification purposes
 * only; see the module docstring.
 */
const PLAN_VIEW_INTENT_RE =
  /^(?:what(?:'s|\s+is)\s+(?:my|today'?s)\s+plan|show(?:\s+me)?(?:\s+(?:my|today'?s))?\s+plan|plan)\??$/i;

/**
 * Classifies free-text `input` into a `ChatIntent`. Pure and synchronous —
 * makes no API call and does no I/O, so it's free to run on every message.
 * Anything that doesn't match one of the two loose recognizers above is
 * `"general-qa"`, per this story's acceptance criterion that an
 * unrecognized general/factual question always gets a real intent label
 * (never an error) rather than being left unclassified.
 */
export function classifyChatIntent(input: string): ChatIntent {
  const trimmed = input.trim();
  if (TIME_BUDGET_INTENT_RE.test(trimmed)) return "time-budget";
  if (PLAN_VIEW_INTENT_RE.test(trimmed)) return "plan-view";
  return "general-qa";
}

// ============================================================================
// Claude call — the real general Q&A response (AD-8: may throw on I/O failure)
// ============================================================================

/** Default Claude model for chat responses (per the `claude-api` skill's current defaults). */
export const CLAUDE_CHAT_MODEL: Anthropic.Model = "claude-opus-5";

const CLAUDE_CHAT_MAX_TOKENS = 1024;

/**
 * Default system prompt for the general Q&A path. Deliberately minimal —
 * Task 14 (`core/tone.ts`) is expected to hand `answerGeneralQuestion` a
 * richer, Tone-governed instruction via its `systemPrompt` parameter rather
 * than this file growing its own tone logic (AD-1/AD-2: tone classification
 * stays a pure `core/*.ts` concern).
 */
export const DEFAULT_GENERAL_QA_SYSTEM_PROMPT =
  "You are Yoh, Spencer's personal daily-planning assistant. Answer naturally and concisely.";

/**
 * Calls Claude once with `input` as the sole user turn and returns its text
 * response. Per AD-8, this throws rather than returning `Result` on any
 * failure: a transport/API-level rejection from the SDK propagates
 * unchanged, and a response that comes back with no text content at all is
 * raised as a thrown `Error` too (never silently returned as `""`, which
 * would read as a real if empty answer rather than something worth
 * investigating). `shell/chat-cli.ts` is the layer that catches either
 * around its call site so one failed turn doesn't crash the whole REPL
 * session.
 */
export async function answerGeneralQuestion(
  client: AnthropicMessagesClient,
  input: string,
  systemPrompt: string = DEFAULT_GENERAL_QA_SYSTEM_PROMPT,
): Promise<string> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL,
    max_tokens: CLAUDE_CHAT_MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: input }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (text.length === 0) {
    throw new Error("llm-adapter: Claude returned no text content for a general Q&A response");
  }
  return text;
}

// ============================================================================
// routeChatMessage — the primary export (AD-9): classify, then answer
// ============================================================================

export interface ChatRouteResult {
  readonly intent: ChatIntent;
  /** Claude's response text — always populated (see module docstring: this file answers every intent it's handed, not just `"general-qa"`, so a real response is guaranteed regardless of label). */
  readonly response: string;
}

/**
 * Classifies `input` (`classifyChatIntent`) and calls Claude for a real
 * response (`answerGeneralQuestion`) regardless of the resulting label — see
 * the module docstring for why: `chat-cli.ts`'s own deterministic checks
 * already run before this function is ever reached in the real REPL loop
 * (`runChatCli`), so by construction this only ever sees genuine
 * `"general-qa"` input in practice, plus the rare grammar-mismatch edge case
 * this file's looser classifier recognizes but `chat-cli.ts`'s stricter one
 * doesn't. Either way, Spencer gets a real answer, never a dead end.
 */
export async function routeChatMessage(client: AnthropicMessagesClient, input: string): Promise<ChatRouteResult> {
  const intent = classifyChatIntent(input);
  const response = await answerGeneralQuestion(client, input);
  return { intent, response };
}

/**
 * src/adapters/llm-adapter.ts
 *
 * Owns Yoh's Claude API surface for `shell/chat-cli.ts`'s free-text chat
 * routing (Story 2.1 / Task 13, UX-DR9). Per the Architecture Spine's Stack
 * table this uses the official `@anthropic-ai/sdk`, never raw HTTP.
 *
 * ============================================================================
 * Scope (post-review simplification)
 * ============================================================================
 *
 * `chat-cli.ts` already owns two cheap, deterministic, zero-API-call
 * recognizers: `parseTimeBudgetCommand` (Task 6) and `isPlanViewCommand`
 * (Task 11). `runChatCli`'s loop checks both first, unchanged, and only
 * reaches this file's catch-all branch once a line has failed both — so, by
 * construction, everything this file ever sees is a genuine general/factual
 * question. `answerGeneralQuestion` (this file's primary export, AD-9) is
 * therefore the whole of this file's job today: call Claude once and return
 * its text response.
 *
 * An earlier version of this file also exported a local `classifyChatIntent`
 * (labeling input as `"time-budget"` / `"plan-view"` / `"general-qa"`) and a
 * `routeChatMessage` wrapper that classified then always answered regardless
 * of the label. Code review (Task 13) flagged that classification as
 * speculative complexity: `chat-cli.ts`'s catch-all only ever read
 * `result.response`, never `result.intent`, and `routeChatMessage` called
 * Claude unconditionally either way — so the two non-`general-qa` labels
 * were computed but never actually changed anything, while duplicating (in
 * shape, not exact grammar) the same regexes `chat-cli.ts` already owns. Both
 * were removed rather than kept as unused scaffolding.
 *
 * Real intent classification/dispatch for Mid-Day Re-Flow (Task 15) and
 * Blocker reports (Task 16) is expected to be designed BY those tasks, not
 * pre-built here — most likely as their own dedicated checks in
 * `runChatCli`, ahead of this file's catch-all, mirroring how
 * `parseTimeBudgetCommand`/`isPlanViewCommand` already work. Whoever builds
 * Task 15/16 should design that dispatch mechanism then, against the real
 * requirements of those stories, rather than have it guessed at here.
 *
 * `answerGeneralQuestion`'s `systemPrompt` parameter is an optional override
 * specifically so Task 14 (`core/tone.ts`) can hand this file a
 * Tone-governed instruction string without changing this function's
 * signature or the caller contract — `tone.ts` stays a pure `core/*.ts`
 * classifier per AD-1/AD-2 (it cannot call Claude itself) and this file
 * remains the only place that actually calls the API. Task 14 update: this
 * seam is now wired up — `shell/chat-cli.ts`'s catch-all calls `tone.ts`'s
 * `resolveToneSystemPrompt(line)` and passes its result here as
 * `systemPrompt`, so `DEFAULT_GENERAL_QA_SYSTEM_PROMPT` below is only ever
 * used by a caller that doesn't supply an override (e.g. this file's own
 * unit tests).
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
// answerGeneralQuestion — the primary export (AD-9): the real Claude call
// (AD-8: may throw on I/O failure)
// ============================================================================

/** Default Claude model for chat responses (per the `claude-api` skill's current defaults). */
export const CLAUDE_CHAT_MODEL: Anthropic.Model = "claude-opus-5";

/**
 * A short chat-turn cap, not a "full response" budget — Spencer's questions
 * here are conversational REPL turns (UX-DR9), not long-form document
 * generation, so this stays well below the SDK's usual non-streaming
 * default rather than reserving room for output this path never produces.
 */
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

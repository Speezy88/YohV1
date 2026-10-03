/**
 * src/adapters/llm-adapter.ts
 *
 * Owns Yoh's Claude API surface for the free-text chat routing (Story 2.1 /
 * Task 13, UX-DR9) `app/general-question.ts`'s `answerQuestion` calls today
 * (Story 8.3: moved from `shell/chat-cli.ts`, since retired — Story 8.9).
 * Per the Architecture Spine's Stack table this uses the official
 * `@anthropic-ai/sdk`, never raw HTTP.
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
 * seam is now wired up — `app/general-question.ts`'s `answerQuestion`
 * (Story 8.3: originally `shell/chat-cli.ts`'s catch-all) calls `tone.ts`'s
 * `resolveToneSystemPrompt(line)` and passes its result here as
 * `systemPrompt`, so `DEFAULT_GENERAL_QA_SYSTEM_PROMPT` below is only ever
 * used by a caller that doesn't supply an override (e.g. this file's own
 * unit tests).
 *
 * Per AD-8, this file may throw on I/O failure rather than returning
 * `Result` itself — a transport-level SDK rejection propagates unchanged,
 * and an unexpected empty-text response is raised as a thrown `Error` too
 * (silently returning "" would look like a real, if empty, answer).
 * `app/general-question.ts`'s `answerQuestion` catches either around its
 * call site, converting it to a `Result` so one failed Claude turn cannot
 * crash the calling shell (Story 8.3: originally `shell/chat-cli.ts`
 * caught it directly to protect its own persistent REPL session, since
 * retired — Story 8.9) — that is ordinary shell-layer error handling, not
 * the Result-conversion AD-8 reserves for `rituals/*.ts`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { isValidIsoDateTime, normalizeIsoDateTime } from "./iso-datetime.ts";
import { writeStructuredLog } from "./logger.ts";
import { isMemoryFolder, MEMORY_FOLDERS_IN_ORDER } from "../core/memory-folders.ts";
import { formatAlwaysMemoryBlock, formatRelevantMemoryBlock, type MemoryContext } from "../core/memory-context.ts";
import { recordLlmUsage, type LlmUsagePurpose } from "./llm-usage-store.ts";
import type { ChatToolDefinition } from "../core/chat-tools.ts";
import type { SqliteConnection } from "./sqlite.ts";
import type {
  ChatIntent,
  ChatTurn,
  ExternalId,
  FieldValueSuggestion,
  MemoryCandidate,
  MemoryFolder,
  MemoryItem,
  NotionDatabaseTarget,
  PlanningFieldNames,
  Task,
} from "../types/domain.ts";

// ============================================================================
// Injectable Claude client — narrow structural interface, mirroring
// notification-adapter.ts's FetchLike seam. A real `new Anthropic(...)`
// instance satisfies this structurally (its `messages.create` returns
// `APIPromise<Message>`, itself a `Promise<Message>` subtype); tests inject
// a fake instead, since no live Claude API key is available in this
// environment.
// ============================================================================

/**
 * Widened (Story 8.3) to mirror the real SDK's own overloaded
 * `messages.create` exactly (`node_modules/@anthropic-ai/sdk`'s
 * `resources/messages/messages.d.ts`): a non-streaming call returns
 * `Message`, a `{stream: true}` call returns an `AsyncIterable` of raw
 * stream events. `new Anthropic(...)` still satisfies this structurally, so
 * `createAnthropicMessagesClient` needs no change.
 */
export interface AnthropicMessagesClient {
  readonly messages: {
    readonly create: {
      (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
      (params: Anthropic.MessageCreateParamsStreaming): Promise<AsyncIterable<Anthropic.RawMessageStreamEvent>>;
    };
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
// Prompt caching + per-call usage recording (real-use fixes plan, Task 9)
// ============================================================================
//
// Every function below that calls `client.messages.create` does two things
// this section supports:
//
//  1. Marks its STABLE content with an ephemeral `cache_control` breakpoint
//     (Anthropic's prompt caching: a prefix match over `tools -> system ->
//     messages`, up to 4 breakpoints per request). `cacheableSystemBlock`
//     wraps a system-prompt string as the one cached block; a few
//     functions (`draftNotionPageFields`, `draftCalendarEditRequest`) send
//     `system` as TWO blocks instead — the stable instructions (cached)
//     followed by a second, uncached block carrying whatever changes every
//     call (today's date/timezone, today's candidate events) — so the
//     cached prefix never silently goes stale once a day. `answerGeneral
//     Question`/`streamGeneralQuestion` additionally mark the LAST message
//     of the conversation history (`toCacheableMessages`) so the growing
//     chat prefix is cached turn to turn: each new call's shared history
//     (everything except the newest message) matches byte-for-byte what a
//     PRIOR call already cached, giving a cache read for that part and a
//     cache write for only the newly-added turn.
//  2. Records `response.usage` (or, for a stream, the usage accumulated
//     from `message_start`/`message_delta` events) into
//     `llm-usage-store.ts`, tagged with this function's own fixed
//     `LlmUsagePurpose` — `recordUsageSafely` never throws: a failed
//     write is logged and swallowed so it can never break a chat turn
//     (this is exactly the AD-8-style "adapters may throw, but a
//     best-effort side channel like this one must not" split).
//
// `connection` is an OPTIONAL trailing parameter on every exported function
// below — real production wiring (`shell/server.ts`'s `buildChatDeps`)
// always supplies it, but a caller/test with no interest in usage
// recording (most of this file's own pre-existing tests) simply omits it,
// exactly like `emit?` elsewhere in this codebase.

const EPHEMERAL_CACHE_CONTROL: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

/** Wraps `text` as the one `TextBlockParam` a stable system prompt sends, with an ephemeral cache breakpoint at its end. */
function cacheableSystemBlock(text: string): Anthropic.TextBlockParam {
  return { type: "text", text, cache_control: EPHEMERAL_CACHE_CONTROL };
}

/** A block carrying content that changes every call — deliberately WITHOUT `cache_control`, so it never gets folded into (and never invalidates) the preceding cached block. */
function volatileSystemBlock(text: string): Anthropic.TextBlockParam {
  return { type: "text", text };
}

/** Story 13.6: memory blocks after `base` — always-loaded folders cached (stable), relevant items volatile. */
function memorySystemBlocks(memory: MemoryContext | undefined): { always: Anthropic.TextBlockParam[]; relevant: Anthropic.TextBlockParam[] } {
  const always = memory ? formatAlwaysMemoryBlock(memory.always) : undefined;
  const relevant = memory ? formatRelevantMemoryBlock(memory.relevant) : undefined;
  return {
    always: always ? [cacheableSystemBlock(always)] : [],
    relevant: relevant ? [volatileSystemBlock(relevant)] : [],
  };
}

/**
 * Renders `messages` for the Messages API, marking the LAST turn's content
 * with an ephemeral cache breakpoint — every earlier turn is sent as a
 * plain string, unchanged from before this task. On the NEXT call (one
 * more turn appended), everything up to and including what was previously
 * the last turn is byte-identical to what this call already sent, so it
 * reads from cache; only the newly-appended turn(s) are a fresh cache
 * write. (`cache_control` is request metadata, not model input — wrapping a
 * turn's text in a one-element block array changes nothing about the
 * actual tokens Claude sees, only which segment the API is asked to
 * cache/read.)
 */
function toCacheableMessages(messages: readonly ChatTurn[]): Anthropic.MessageParam[] {
  const lastIndex = messages.length - 1;
  return messages.map((turn, i) => ({
    role: turn.role,
    content: i === lastIndex ? [{ type: "text", text: turn.content, cache_control: EPHEMERAL_CACHE_CONTROL }] : turn.content,
  }));
}

/** The zero-usage starting point `streamGeneralQuestion` accumulates onto as stream events arrive. */
const ZERO_STREAM_USAGE: StreamUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

/** The 4 fields `recordUsageSafely` actually needs — both `Anthropic.Usage` (a non-streaming `Message`'s own `usage`) and this file's own streamed-accumulator shape satisfy it structurally. */
interface StreamUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number | null;
  readonly cache_read_input_tokens: number | null;
}

/** Folds one `message_start` event's initial `Usage` into a `StreamUsage`. */
function streamUsageFromMessageStart(usage: Anthropic.Usage): StreamUsage {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
  };
}

/** Merges one `message_delta` event's CUMULATIVE `MessageDeltaUsage` onto `prev` — a `null` field means "unchanged since `message_start`," so `prev`'s own value is kept rather than clobbered with `null`. */
function mergeStreamDeltaUsage(prev: StreamUsage, delta: Anthropic.MessageDeltaUsage): StreamUsage {
  return {
    input_tokens: delta.input_tokens ?? prev.input_tokens,
    output_tokens: delta.output_tokens,
    cache_creation_input_tokens: delta.cache_creation_input_tokens ?? prev.cache_creation_input_tokens,
    cache_read_input_tokens: delta.cache_read_input_tokens ?? prev.cache_read_input_tokens,
  };
}

/**
 * Appends one usage row to `llm-usage-store.ts` — a no-op when `connection`
 * is `undefined` (no store wired, e.g. most of this file's own tests).
 * NEVER throws: a recording failure is logged (`logger.ts`) and swallowed,
 * per Task 9's own requirement that this side channel can never break a
 * chat turn.
 */
function recordUsageSafely(connection: SqliteConnection | undefined, purpose: LlmUsagePurpose, model: string, usage: StreamUsage): void {
  if (!connection) return;
  try {
    recordLlmUsage(connection, {
      at: new Date().toISOString(),
      model,
      purpose,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    });
  } catch (err) {
    writeStructuredLog({
      level: "warn",
      event: "llm-adapter.usage-record-failed",
      detail: { purpose, model, message: err instanceof Error ? err.message : String(err) },
    });
  }
}

// ============================================================================
// extractMemories (Story 13.4): Haiku proposes at most 2 memory candidates
// from Spencer's TYPED text only. `core/memory-filing.ts` validates them.
// ============================================================================

const EXTRACT_MEMORIES_MAX_TOKENS = 600;

function extractMemoriesSystemPrompt(opts: { forceStated: boolean; forceFolder?: MemoryFolder }): string {
  return [
    "You are Yoh's memory filer. From Spencer's typed message, propose at most 2 short facts worth remembering.",
    "Reply with ONLY a JSON array (no prose). Each element: {\"folder\", \"text\", \"origin\", optional \"scope\", \"expiresOn\", \"entityRef\", \"restatesId\", \"contradictsId\", \"sensitive\", \"ruleChange\"}.",
    `folder is one of: ${MEMORY_FOLDERS_IN_ORDER.join(", ")}.`,
    "text: one sentence in Spencer's own meaning, at most 280 characters.",
    'origin: "stated" when Spencer said it outright, "inferred" otherwise.',
    "For feedback items, scope is the NARROWEST reading of what Spencer's words cover (for example \"this kind of request\"); never widen it.",
    "expiresOn: YYYY-MM-DD, only for time-bound facts.",
    "restatesId / contradictsId: the id of an existing item below that this repeats or contradicts.",
    'sensitive: "health", "emotion" or "finance" when the fact is about those.',
    'ruleChange: {"key", "value"} only when Spencer states a planning rule (keys: schoolDayWorkStart, otherDayWorkStart, lunchWindow, communityWindow, areaDurationPadding).',
    opts.forceStated ? "Spencer explicitly asked you to remember this, so origin is \"stated\"." : "",
    opts.forceFolder ? `File it in the folder ${opts.forceFolder}.` : "",
    "If nothing is worth remembering, reply [].",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function parseMemoryCandidates(text: string): MemoryCandidate[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: MemoryCandidate[] = [];
  for (const e of raw) {
    if (out.length >= 2) break;
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (!isMemoryFolder(r.folder) || typeof r.text !== "string" || r.text.trim() === "") continue;
    const c: MemoryCandidate = { folder: r.folder, text: r.text.trim(), origin: r.origin === "inferred" ? "inferred" : "stated" };
    if (typeof r.scope === "string" && r.scope.trim() !== "") c.scope = r.scope.trim();
    if (typeof r.expiresOn === "string") c.expiresOn = r.expiresOn;
    if (typeof r.entityRef === "string" && r.entityRef !== "") c.entityRef = r.entityRef;
    if (typeof r.restatesId === "string" && r.restatesId !== "") c.restatesId = r.restatesId;
    if (typeof r.contradictsId === "string" && r.contradictsId !== "") c.contradictsId = r.contradictsId;
    if (r.sensitive === "health" || r.sensitive === "emotion" || r.sensitive === "finance") c.sensitive = r.sensitive;
    const rc = r.ruleChange as { key?: unknown; value?: unknown } | undefined;
    if (rc && typeof rc === "object" && typeof rc.key === "string") {
      c.ruleChange = { key: rc.key as NonNullable<MemoryCandidate["ruleChange"]>["key"], value: rc.value };
    }
    out.push(c);
  }
  return out;
}

/**
 * Proposes memory candidates from Spencer's typed text. The prompt sees only
 * `typedText` and the always-loaded items (for the duplicate check). Malformed
 * output yields `[]`; only a transport error throws (AD-8).
 */
export async function extractMemories(
  client: AnthropicMessagesClient,
  typedText: string,
  alwaysLoaded: readonly MemoryItem[],
  opts: { forceStated: boolean; forceFolder?: MemoryFolder },
  connection?: SqliteConnection,
): Promise<readonly MemoryCandidate[]> {
  const existing = alwaysLoaded.length === 0 ? "(none)" : alwaysLoaded.map((i) => `- ${i.id} [${i.folder}] ${i.text}`).join("\n");
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: EXTRACT_MEMORIES_MAX_TOKENS,
    system: [cacheableSystemBlock(extractMemoriesSystemPrompt(opts))],
    messages: [{ role: "user", content: `Existing memory items:\n${existing}\n\nSpencer's message:\n${typedText}` }],
  });
  recordUsageSafely(connection, "extract-memories", CLAUDE_CHAT_MODEL_FAST, message.usage);
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return parseMemoryCandidates(text);
}

// ============================================================================
// answerGeneralQuestion — the primary export (AD-9): the real Claude call
// (AD-8: may throw on I/O failure)
// ============================================================================

/**
 * Model routing (2026-09-22 revision). Every call this file makes used to
 * share one constant (`CLAUDE_CHAT_MODEL`, pinned to Opus). Two tiers now:
 *
 *  - `CLAUDE_CHAT_MODEL_FAST` (Haiku) — the default for EVERY call in this
 *    file, including `answerGeneralQuestion`. `suggestFieldValue`,
 *    `draftNotionPageFields`, `classifyChatIntent`, and
 *    `draftCalendarEditRequest` are narrow, structured-extraction tasks
 *    (parse a line into a fixed shape, classify into one of two labels) —
 *    exactly the kind of task a fast/cheap model handles reliably, and none
 *    of them are exposed for escalation; they always use this constant.
 *  - `CLAUDE_CHAT_MODEL_CAPABLE` (Sonnet) — used ONLY by
 *    `answerGeneralQuestion`, and only situationally: `app/general-question.ts`
 *    (Story 8.3: originally `shell/chat-cli.ts`) picks between the two based
 *    on `core/tone.ts`'s existing `classifyTone(line)` register (already
 *    computed there to choose the system prompt) — a `"concise-educational"`
 *    factual/analytical question routes to Sonnet, ordinary `"casual-peer"`
 *    chat stays on Haiku. That routing decision lives in
 *    `app/general-question.ts`, not here: AD-1 restricts
 *    `adapters/*.ts` to importing only from `types/`, so this file cannot
 *    import `core/tone.ts`'s `ToneRegister`/`classifyTone` itself.
 */
export const CLAUDE_CHAT_MODEL_FAST: Anthropic.Model = "claude-haiku-4-5-20251001";
export const CLAUDE_CHAT_MODEL_CAPABLE: Anthropic.Model = "claude-sonnet-5";

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
 * Calls Claude with `messages` — the session's real running conversation
 * history (`types/domain.ts`'s `ChatTurn`), ending in the current unanswered
 * user turn — and returns its text response.
 *
 * **Real history, not a single isolated turn (2026-09-22 revision).**
 * Originally this call sent ONLY `input` as a lone `user` message, with zero
 * memory of anything said or done earlier in the session — including by
 * Yoh's OWN prior actions. That caused a real, observed failure: right after
 * a Data-Completeness answer flow genuinely wrote several Task fields to
 * Notion, asking "have you written the data to Notion" got a confident "No
 * ... I don't see any task data" — correct only in the narrow sense that
 * THAT single isolated API call had no data in it, and useless/misleading to
 * Spencer, who experienced it as one continuous session. `messages` is the
 * `ChatTurnRequest.history` the caller supplies (Story 8.9: originally built
 * by `shell/chat-cli.ts`'s recording wrapper around its `ChatCliIo`, which
 * captured every line written/read across EVERY flow — deterministic
 * commands included, not just prior general-chat turns — as alternating
 * `user`/`assistant` turns; now held client-side, per turn, by `web/src/lib/
 * chatStore.ts` and sent as-is), trimmed to `MAX_CHAT_HISTORY_TURNS` by
 * `app/chat-turn.ts`'s `chatTurn`, which also guarantees the strict
 * alternation (and "starts with `user`") the Messages API requires. This
 * function trusts that invariant rather than re-validating it structurally
 * on every call; a malformed `messages` array is a caller bug, not a runtime
 * condition worth guarding against on the hot path, though an empty array is
 * rejected outright below (there is always at least the current turn by the
 * time this call site is reached — an empty array signals the caller's own
 * wiring is broken).
 *
 * Per AD-8, this throws rather than returning `Result` on any failure: a
 * transport/API-level rejection from the SDK propagates unchanged, and a
 * response that comes back with no text content at all is raised as a
 * thrown `Error` too (never silently returned as `""`, which would read as a
 * real if empty answer rather than something worth investigating).
 * `app/general-question.ts`'s `answerQuestion` (Story 8.3; formerly
 * `shell/chat-cli.ts`, retired Story 8.9) is the layer that catches either
 * around its call site, converting it to a `Result` so one failed turn never
 * crashes the calling shell (`server.ts`).
 *
 * `model` defaults to `CLAUDE_CHAT_MODEL_FAST` (Haiku) — `app/general-
 * question.ts`'s `answerQuestion` (Story 8.3: originally `shell/chat-cli.ts`)
 * overrides it with `CLAUDE_CHAT_MODEL_CAPABLE` (Sonnet) for a message
 * `core/tone.ts`'s `classifyTone` reads as genuinely factual/analytical; see
 * this file's "Model routing" doc comment above `CLAUDE_CHAT_MODEL_FAST`.
 */
export async function answerGeneralQuestion(
  client: AnthropicMessagesClient,
  messages: readonly ChatTurn[],
  systemPrompt: string = DEFAULT_GENERAL_QA_SYSTEM_PROMPT,
  model: Anthropic.Model = CLAUDE_CHAT_MODEL_FAST,
  connection?: SqliteConnection,
  memory?: MemoryContext,
): Promise<string> {
  if (messages.length === 0) {
    throw new Error("llm-adapter: answerGeneralQuestion called with no conversation history at all");
  }

  const message = await client.messages.create({
    model,
    max_tokens: CLAUDE_CHAT_MAX_TOKENS,
    system: generalSystemBlocks(systemPrompt, memory),
    messages: toCacheableMessages(messages),
  });
  recordUsageSafely(connection, "answer", model, message.usage);

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

function generalSystemBlocks(systemPrompt: string, memory: MemoryContext | undefined): Anthropic.TextBlockParam[] {
  const blocks = memorySystemBlocks(memory);
  return [cacheableSystemBlock(systemPrompt), ...blocks.always, ...blocks.relevant];
}

/**
 * Streaming twin of `answerGeneralQuestion` (Story 8.3): same inputs, same
 * "never a silent empty reply" contract (AD-8) — throws if the stream ends
 * having yielded no text at all, or if `messages` is empty. Yields raw text
 * chunks (`content_block_delta` events whose `delta.type === "text_delta"`)
 * as they arrive; a caller with no live stream sink should keep using
 * `answerGeneralQuestion` instead (this file exposes both — see
 * `app/general-question.ts`'s `answerQuestion`, which uses this one only
 * when its own caller supplied a stream sink; `shell/chat-cli.ts`, since
 * retired, never had one, so it only ever called the non-streaming twin).
 */
export async function* streamGeneralQuestion(
  client: AnthropicMessagesClient,
  messages: readonly ChatTurn[],
  systemPrompt: string = DEFAULT_GENERAL_QA_SYSTEM_PROMPT,
  model: Anthropic.Model = CLAUDE_CHAT_MODEL_FAST,
  connection?: SqliteConnection,
  memory?: MemoryContext,
): AsyncGenerator<string, void, void> {
  if (messages.length === 0) {
    throw new Error("llm-adapter: streamGeneralQuestion called with no conversation history at all");
  }

  const stream = await client.messages.create({
    model,
    max_tokens: CLAUDE_CHAT_MAX_TOKENS,
    system: generalSystemBlocks(systemPrompt, memory),
    messages: toCacheableMessages(messages),
    stream: true,
  });

  let sawText = false;
  // Usage arrives piecemeal across raw stream events (this file's injected
  // client shape has no `.finalMessage()` helper — see this file's own
  // `AnthropicMessagesClient` doc comment): `message_start` carries the
  // initial `Usage`, and each `message_delta` carries the running
  // CUMULATIVE totals, so the last one seen before `message_stop` is the
  // real final tally.
  let usage: StreamUsage = ZERO_STREAM_USAGE;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      sawText = true;
      yield event.delta.text;
    } else if (event.type === "message_start") {
      usage = streamUsageFromMessageStart(event.message.usage);
    } else if (event.type === "message_delta") {
      usage = mergeStreamDeltaUsage(usage, event.usage);
    }
  }
  recordUsageSafely(connection, "answer", model, usage);
  if (!sawText) {
    throw new Error("llm-adapter: Claude returned no text content for a streamed general Q&A response");
  }
}

// ============================================================================
// runToolTurn (Epic 14 Task 3: chat tool loop) — one model call with tools
// ============================================================================

/** The model the chat tool loop runs on (`app/chat-agent.ts`). The one place to change it. */
export const CHAT_AGENT_MODEL: Anthropic.Model = CLAUDE_CHAT_MODEL_FAST;

export type ToolTurnMessage = Anthropic.MessageParam;

export interface ToolTurnResult {
  readonly text: string;
  readonly toolUses: readonly { readonly id: string; readonly name: string; readonly input: unknown }[];
  /** The assistant content blocks, to be echoed back as the next request's assistant message. */
  readonly assistantContent: Anthropic.ContentBlock[];
}

/** One model call of the chat tool loop. Throws on a transport failure; `app/chat-agent.ts` converts that to a Result. */
export async function runToolTurn(
  client: AnthropicMessagesClient,
  input: {
    readonly systemPrompt: string;
    readonly messages: readonly ToolTurnMessage[];
    readonly tools: readonly ChatToolDefinition[];
    readonly memory?: MemoryContext;
    readonly connection?: SqliteConnection;
  },
): Promise<ToolTurnResult> {
  const blocks = memorySystemBlocks(input.memory);
  const message = await client.messages.create({
    model: CHAT_AGENT_MODEL,
    max_tokens: CLAUDE_CHAT_MAX_TOKENS,
    system: [cacheableSystemBlock(input.systemPrompt), ...blocks.always, ...blocks.relevant],
    tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
    messages: [...input.messages],
  });
  recordUsageSafely(input.connection, "agent", CHAT_AGENT_MODEL, message.usage);
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const toolUses = message.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return { text, toolUses, assistantContent: message.content };
}

// ============================================================================
// suggestFieldValue (Story 6.2 / FR-25, AD-11) — lazy, display-time-only
// inference of a missing Task planning field from Spencer's own recent chat
// lines. Called ONLY by `app/surface-open-items.ts` (Story 8.1: originally
// `shell/chat-cli.ts`), at the moment it's about to
// surface an already-open "missing-field" interaction request — never by
// core/data-completeness-gate.ts (pure/I-O-free, AD-1/AD-11) and never by a
// ritual (chat context is typically sparse/nonexistent at an unattended
// cron run).
// ============================================================================

/** Human-readable labels for `PlanningFieldNames`, used only to build this file's own Claude prompt — kept local rather than imported from `rituals/data-completeness.ts`'s `PLANNING_FIELD_LABELS`, since AD-1 forbids `adapters/` importing from `rituals/`. */
const FIELD_LABELS: Record<PlanningFieldNames, string> = {
  estimatedDurationMinutes: "Estimated Duration (a whole number of minutes)",
  area: "Area (a short free-form label)",
  dueDate: "Due Date (an ISO date, YYYY-MM-DD)",
  status: "Status (one of: not-started, in-progress, completed, slipped)",
  energy: "Energy (one of: low, medium, high)",
};

const SUGGEST_FIELD_VALUE_MAX_TOKENS = 256;

function buildSuggestFieldValueSystemPrompt(taskTitle: string, field: PlanningFieldNames): string {
  return [
    "You are helping Yoh, Spencer's personal planning assistant, decide whether a specific Task field can be confidently answered from Spencer's own recent chat messages.",
    `Task: "${taskTitle}"`,
    `Missing field: ${FIELD_LABELS[field]}`,
    "",
    "Look ONLY at the messages below. If Spencer clearly and specifically stated this field's value for THIS task, respond on one line as:",
    "CONFIDENT: <value> | <short reason quoting or paraphrasing what Spencer said>",
    "",
    "If nothing in the messages clearly and specifically answers this for THIS task, respond with exactly:",
    "NONE",
    "",
    "Never guess, and never answer for a different task. If in doubt, respond NONE.",
  ].join("\n");
}

/**
 * The shape `suggestFieldValue` is injected with (Epic 6 retro item 7,
 * F8/F9) — `core/planning-field-value.ts`'s `parsePlanningFieldValue`,
 * validating/coercing Claude's claimed raw value into `field`'s real type.
 * AD-1 forbids this `adapters/*.ts` file from importing `core/*.ts`
 * directly, so `app/surface-open-items.ts` (which may import both; Story
 * 8.1: originally `shell/chat-cli.ts`) passes a thin
 * wrapper over `parsePlanningFieldValue` that discards the rejection
 * message: unlike FR-4's typed answer, an unparseable CONFIDENT claim never
 * surfaces to Spencer — it just means "no confident inference"
 * (`undefined`), falling back to the ordinary blind ask.
 */
export type ParsePlanningFieldValueFn = (
  field: PlanningFieldNames,
  raw: string,
) => NonNullable<Task[PlanningFieldNames]> | undefined;

/**
 * Attempts to confidently infer `field`'s value for Task `taskId`
 * (`taskTitle`) from `recentMessages` (Spencer's own recent chat lines,
 * oldest first). Returns `undefined` — never throws — for every "no
 * confident answer" case: no recent messages at all (a cheap short-circuit,
 * no API call made); a response that doesn't match the required
 * `CONFIDENT: <value> | <reason>` format; or a claimed value `parseValue`
 * rejects as invalid for `field` (never trusted blindly). A genuine
 * API/transport failure still propagates as a thrown error (AD-8) —
 * `app/surface-open-items.ts` (Story 8.1: originally `shell/chat-cli.ts`)
 * treats that identically to "no confident inference" at its own call
 * site.
 */
export async function suggestFieldValue(
  client: AnthropicMessagesClient,
  taskId: ExternalId,
  taskTitle: string,
  field: PlanningFieldNames,
  recentMessages: readonly string[],
  parseValue: ParsePlanningFieldValueFn,
  connection?: SqliteConnection,
): Promise<FieldValueSuggestion | undefined> {
  if (recentMessages.length === 0) return undefined;

  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: SUGGEST_FIELD_VALUE_MAX_TOKENS,
    // Real-use fixes plan, Task 9: marked cacheable like every other system
    // prompt in this file, though — unlike the others — `taskTitle`/`field`
    // are baked into this ONE prompt string on every call, so a genuine
    // cache hit is unlikely (a different Task or field almost always means
    // a different prompt). Harmless either way (a too-short or
    // never-repeated prefix simply never gets read back), and keeps this
    // function consistent with the rest of the file rather than a bespoke
    // exception.
    system: [cacheableSystemBlock(buildSuggestFieldValueSystemPrompt(taskTitle, field))],
    messages: [{ role: "user", content: recentMessages.join("\n") }],
  });
  recordUsageSafely(connection, "suggest-field", CLAUDE_CHAT_MODEL_FAST, message.usage);

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const match = /^CONFIDENT:\s*(.+?)\s*\|\s*(.+)$/s.exec(text);
  if (!match) return undefined;

  const [, rawValue, rawReason] = match;
  const value = parseValue(field, rawValue!.trim());
  if (value === undefined) return undefined;

  return { taskId, taskTitle, field, value, reason: rawReason!.trim() };
}

// ============================================================================
// draftNotionPageFields (Story 6.3 / FR-26) — extracts a structured field
// map from Spencer's free-text "create a ..." request. Never validates
// against Notion's live schema itself (that's notion-adapter.ts's
// resolveNotionPageDraftProperties, called by app/create-item.ts right
// after this — Story 8.9: originally chat-cli.ts)
// — this function only turns prose into a flat internal-field-name ->
// raw-string-value map, on a best-effort basis, failing closed to
// `undefined` whenever no usable title was extracted.
// ============================================================================

const DRAFT_NOTION_PAGE_MAX_TOKENS = 512;

const DRAFT_NOTION_PAGE_KNOWN_FIELDS: Readonly<Record<NotionDatabaseTarget, readonly string[]>> = {
  Tasks: ["title", "estimatedDurationMinutes", "area", "dueDate", "status", "energy"],
  Projects: ["title"],
  ResearchVault: ["title", "keyFindings", "query", "searchDate", "sources", "status", "area", "confidence", "openQuestions"],
};

/**
 * Internal field names (per database) that are Notion `date`-typed
 * properties — Spencer's own free text for these needs date resolution,
 * unlike every other field here. Exported (review fix, Task 3): also the
 * ONE list `app/create-item.ts` runs through its own deterministic
 * `core/relative-date.ts` resolver before ever showing a draft — `app/`
 * importing `adapters/` is permitted, so this is imported there rather than
 * kept as a second, separately-maintained copy.
 */
export const DRAFT_NOTION_PAGE_DATE_FIELDS: Readonly<Record<NotionDatabaseTarget, readonly string[]>> = {
  Tasks: ["dueDate"],
  Projects: [],
  ResearchVault: ["searchDate"],
};

/**
 * The STABLE half of this prompt — everything that depends only on
 * `database`, never on today's date. Real-use fixes plan, Task 9: this
 * used to also embed `today`/`timeZone` directly (Task 3), which made the
 * ENTIRE system prompt change byte-for-byte once a day — a cache
 * breakpoint placed after that text would silently stop hitting cache
 * every midnight. `today`/`timeZone` now live in a SEPARATE, uncached
 * block (`buildDraftNotionPageDynamicContext`, sent as `system`'s second
 * element) so this block's own cache breakpoint stays valid call to call,
 * for as long as `database` doesn't change.
 */
function buildDraftNotionPageStableSystemPrompt(database: NotionDatabaseTarget): string {
  const fields = DRAFT_NOTION_PAGE_KNOWN_FIELDS[database];
  const dateFields = DRAFT_NOTION_PAGE_DATE_FIELDS[database];
  const lines = [
    `You are helping Yoh, Spencer's personal planning assistant, turn a chat request into a structured draft for a new "${database}" Notion item.`,
    `Extract ONLY fields Spencer actually mentioned, from this list: ${fields.join(", ")}.`,
    `Respond with one "field=value" line per field you can confidently extract, using EXACTLY these field names. "title" is required — if you cannot confidently extract a title, respond with exactly: NONE`,
    "Never invent a value Spencer didn't say or clearly imply.",
  ];
  if (dateFields.length > 0) {
    lines.push(
      `For ${dateFields.join("/")}, resolve any relative date or time Spencer gives (e.g. "tomorrow", "Thursday", "next week Friday", "Oct 3") into a real "YYYY-MM-DD" date — or, if Spencer also gave a specific time (e.g. "tomorrow at 10:45 AM"), a full ISO-8601 UTC datetime with a "Z" suffix (e.g. "2026-09-18T17:45:00.000Z"). Never respond with the relative phrase itself (e.g. never "dueDate=tomorrow") — always the resolved date/datetime. If you cannot confidently resolve it to a real date, omit that field entirely rather than guessing. Spencer's current date and timezone are given right after this instruction block.`,
    );
  }
  return lines.join("\n");
}

/** The VOLATILE half (Task 9) — `undefined` when `database` has no date-typed field at all (Projects), so no dynamic block is sent (and the stable prompt above never mentions date resolution either, unchanged from before this task). */
function buildDraftNotionPageDynamicContext(database: NotionDatabaseTarget, today: string, timeZone: string): string | undefined {
  if (DRAFT_NOTION_PAGE_DATE_FIELDS[database].length === 0) return undefined;
  return `Today's date is ${today}, Spencer's timezone is ${timeZone}.`;
}

/**
 * Extracts a `{internalField: rawValue}` map from `request` (Spencer's
 * free-text "create a ..." message) for `database`. Returns `undefined` —
 * never throws for "couldn't extract" — when Claude's response has no
 * parseable `field=value` lines at all, or extracts no `title`. A genuine
 * API/transport failure still propagates as a thrown error (AD-8);
 * `app/create-item.ts` (Story 8.9: originally `shell/chat-cli.ts`) treats
 * that the same as "couldn't draft."
 *
 * `today`/`timeZone` (real-use fixes plan, Task 3): Spencer's own host-local
 * "today" and IANA timezone, passed into the system prompt so the model
 * resolves a relative date field itself — but this is a best-effort LLM
 * resolution, NEVER trusted blindly: `app/create-item.ts` runs
 * `core/relative-date.ts`'s deterministic resolver over every date field
 * this returns before a Proposal is ever shown, and `notion-adapter.ts`'s
 * `resolveNotionPageDraftProperties` rejects a non-ISO value as a backstop
 * either way. This is exactly the incident this task fixes: a draft that
 * once carried the literal, never-resolved text "tomorrow at 10:45 AM" as
 * Due Date.
 */
export async function draftNotionPageFields(
  client: AnthropicMessagesClient,
  database: NotionDatabaseTarget,
  request: string,
  today: string,
  timeZone: string,
  connection?: SqliteConnection,
  memory?: MemoryContext,
): Promise<Record<string, string> | undefined> {
  const dynamicContext = buildDraftNotionPageDynamicContext(database, today, timeZone);
  const memoryBlocks = memorySystemBlocks(memory);
  const system: Anthropic.TextBlockParam[] = [cacheableSystemBlock(buildDraftNotionPageStableSystemPrompt(database)), ...memoryBlocks.always];
  if (dynamicContext) system.push(volatileSystemBlock(dynamicContext));
  system.push(...memoryBlocks.relevant);

  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: DRAFT_NOTION_PAGE_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: request }],
  });
  recordUsageSafely(connection, "draft-notion", CLAUDE_CHAT_MODEL_FAST, message.usage);

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    if (DRAFT_NOTION_PAGE_KNOWN_FIELDS[database].includes(key!)) {
      fields[key!] = value!.trim();
    }
  }

  return fields["title"] ? fields : undefined;
}

// ============================================================================
// classifyChatIntent (Story 6.4 / FR-28, AD-14) — the ONE real producer of
// ChatIntent today. Called only by `app/chat-turn.ts`'s `chatTurn` (Story
// 8.4: originally `shell/chat-cli.ts`), only on a line that
// already failed every existing deterministic trigger check (time budget,
// plan view, mid-day reflow, blocker, why-prioritized, create-item) — never
// on every message unconditionally, to avoid firing a paid search call on
// an ordinary planning/status message (AD-14's own named risk).
// ============================================================================

const CLASSIFY_CHAT_INTENT_MAX_TOKENS = 128;

const CLASSIFY_CHAT_INTENT_SYSTEM_PROMPT = [
  "You are Yoh's chat-intent classifier. Decide whether Spencer's message is:",
  '(a) an explicit request to search the web (e.g. "search for X", "look up X", "google X"), or a real-world factual/informational question — about people, companies, events, prices, scores, weather, current events, definitions of current things, or anything else outside Yoh\'s own planning data that a search engine (rather than Yoh\'s own memory) would answer — respond:',
  "SEARCH: <a clean, focused search query capturing what to look up>",
  "Lean toward SEARCH whenever the message reads as a genuine question about the world rather than about Spencer's own Tasks/Projects/Calendar/Plan — when in doubt between SEARCH and GENERAL for a real-world factual question, prefer SEARCH.",
  "(b) anything else (Spencer's own planning/status, something personal to Spencer, or ordinary conversational chat) — respond with exactly:",
  "GENERAL",
  "",
  "Examples:",
  'Message: "who is the CEO of OpenAI" -> SEARCH: current CEO of OpenAI',
  'Message: "what\'s the capital of France" -> SEARCH: capital of France',
  'Message: "price of bitcoin" -> SEARCH: current price of bitcoin',
  'Message: "who won the game last night" -> SEARCH: who won the game last night',
  'Message: "what\'s my plan for today" -> GENERAL',
  'Message: "why is my chemistry homework prioritized" -> GENERAL',
  'Message: "how\'s it going" -> GENERAL',
  'Message: "should I take a break" -> GENERAL',
].join("\n");

/**
 * Classifies `line` into `{kind: 'search-trigger', query}` or
 * `{kind: 'general-question'}` — the only two `ChatIntent` variants this
 * function ever actually produces (see `ChatIntent`'s own doc comment).
 * Defaults to `{kind: 'general-question'}` for ANY response that isn't a
 * recognized `SEARCH: ...` line — never throws for "not a search," so a
 * malformed classifier response degrades to the ordinary chat path rather
 * than blocking it. A genuine API/transport failure still propagates as a
 * thrown error (AD-8); `app/chat-turn.ts` (Story 8.9: originally
 * `shell/chat-cli.ts`) treats that the same way.
 */
export async function classifyChatIntent(client: AnthropicMessagesClient, line: string, connection?: SqliteConnection): Promise<ChatIntent> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: CLASSIFY_CHAT_INTENT_MAX_TOKENS,
    system: [cacheableSystemBlock(CLASSIFY_CHAT_INTENT_SYSTEM_PROMPT)],
    messages: [{ role: "user", content: line }],
  });
  recordUsageSafely(connection, "classify", CLAUDE_CHAT_MODEL_FAST, message.usage);

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const match = /^SEARCH:\s*(.+)$/is.exec(text);
  if (match && match[1]!.trim().length > 0) {
    return { kind: "search-trigger", query: match[1]!.trim() };
  }
  return { kind: "general-question" };
}

// ============================================================================
// classifyCapture (real-use fixes plan, Task 2 — replaces the old
// two-way detectTaskCapture, Story 8.8 / FR-26 extended, AD-14's cost
// discipline) — chat-turn.ts calls this ONLY after every deterministic
// recognizer (time-budget, plan-view, mid-day-reflow, blocker,
// why-prioritized, save-search-result, create-item's explicit Notion
// mention, calendar-edit) has already failed to match — never on every
// message unconditionally.
//
// The incident this fixes: "make a event at 10:45 am tommorow to meet with
// alex..." fell through `isCalendarEditCommand`'s old, narrower trigger and
// was captured as a Notion Task by the old `detectTaskCapture` (which only
// ever answered CAPTURE/NONE) — its Due Date ended up as the literal text
// "tomorrow at 10:45 AM", which Notion rejected. `isCalendarEditCommand` is
// broadened (`core/chat-commands.ts`) so this exact line is now caught
// deterministically BEFORE this function ever runs; this function is the
// backstop for whatever free-text phrasing still slips past that broadened
// regex — a genuinely time-bound thing to attend (a meeting, appointment,
// call, class, or event at a time) must still route to the calendar-create
// path, never to a Task.
//
// Answers one question: is `line` (a) a time-bound thing to ATTEND (an
// "event"), (b) something to DO or produce later (a "task"), or (c)
// neither ("none")? It does NOT draft either one's fields itself — an
// "event" hit is hedged to `app/calendar-edit.ts`'s `proposeCalendarEdit`
// (the same draft-then-confirm pipeline `isCalendarEditCommand` uses), and a
// "task" hit is handed to the existing draftNotionPageFields/createPage
// pipeline via `app/create-item.ts`'s `draftItem`, unchanged — so either hit
// goes through the exact same confirm-then-write trust boundary an explicit
// "create a task ..."/"create an event ..." command uses. Controller ruling:
// `ChatIntent` (domain.ts) is not widened for this — this is its own
// function/shape.
// ============================================================================

const CLASSIFY_CAPTURE_MAX_TOKENS = 16;

const CLASSIFY_CAPTURE_SYSTEM_PROMPT = [
  "You are Yoh's task/event-capture classifier. Decide which of these Spencer's message describes:",
  '(a) a TIME-BOUND thing to ATTEND at a particular time or date — a meeting, appointment, call, class, or other event (e.g. "meet with Alex tomorrow at 3", "dentist appointment Friday 2pm") — respond with exactly: EVENT',
  "(b) something he needs to DO or PRODUCE later — a new Task to track (an assignment, an errand, a chore, a deliverable, with or without a stated due date, and NOT itself an appointment to attend) — respond with exactly: TASK",
  "(c) anything else (a question, a greeting, a status update, small talk, or anything ambiguous) — respond with exactly: NONE",
].join("\n");

/**
 * Classifies `line` into `"event"`, `"task"`, or `"none"`. Never throws for
 * an unrecognized/ambiguous response — those default to `"none"` — only a
 * genuine API/transport failure propagates (AD-8), exactly like
 * `classifyChatIntent`/`draftCalendarEditRequest` above.
 */
export async function classifyCapture(
  client: AnthropicMessagesClient,
  line: string,
  connection?: SqliteConnection,
): Promise<"task" | "event" | "none"> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: CLASSIFY_CAPTURE_MAX_TOKENS,
    system: [cacheableSystemBlock(CLASSIFY_CAPTURE_SYSTEM_PROMPT)],
    messages: [{ role: "user", content: line }],
  });
  recordUsageSafely(connection, "capture", CLAUDE_CHAT_MODEL_FAST, message.usage);

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (/^EVENT\b/i.test(text)) return "event";
  if (/^TASK\b/i.test(text)) return "task";
  return "none";
}

// ============================================================================
// draftCalendarEditRequest (Story 6.6 / FR-27) — extracts a structured
// move/resize/create request from Spencer's free-text calendar-edit
// message. Never validates against the live Calendar itself (that's
// calendar-adapter.ts's job, via resolveCalendarEditRoute/
// proposeCalendarEdit) — this only turns prose (plus a `today`/`timeZone`
// anchor for resolving relative times) into structured, ISO-validated
// fields, failing closed to `undefined` on anything unparseable.
// ============================================================================

export type DraftedCalendarEditRequest =
  | { readonly kind: "move"; readonly eventTitle: string; readonly newStart: string }
  | { readonly kind: "resize"; readonly eventTitle: string; readonly newEnd: string }
  | {
      readonly kind: "create";
      readonly title: string;
      readonly start: string;
      readonly end: string;
      /**
       * Real-use fixes plan, Task 2: `true` when Spencer gave neither an
       * explicit end time nor a duration phrase, so the 60-minute default
       * was assumed rather than read from the request — `app/calendar-
       * edit.ts`'s confirm question says so ("…10:45–11:45 AM (1 hour, I
       * assumed)") so the assumption is visible before Spencer confirms,
       * never silently baked into the draft.
       */
      readonly durationAssumed: boolean;
    };

const DRAFT_CALENDAR_EDIT_MAX_TOKENS = 256;

interface CalendarEditCandidateEvent {
  readonly title: string;
  readonly start: string;
  readonly end: string;
}

/**
 * The STABLE half (Task 9) — the behavior/format instructions, none of
 * which depend on `today`/`timeZone`/`candidateEvents`. Before this task,
 * `today`/`timeZone`/the candidate-events list were interleaved into this
 * SAME string, which meant the "stable" prompt actually changed every
 * single call (a different day, and usually a different events list) —
 * nothing to cache at all. `buildDraftCalendarEditDynamicContext` below now
 * carries all of that as `system`'s second, uncached block instead.
 */
function buildDraftCalendarEditStableSystemPrompt(): string {
  return [
    "You are helping Yoh, Spencer's personal planning assistant, turn a chat request into a structured Calendar edit.",
    'Resolve any relative date or time Spencer gives (e.g. "4pm", "tomorrow", "Friday", "in an hour") into a full ISO-8601 UTC datetime with a "Z" suffix (e.g. "2026-09-18T20:00:00.000Z") — always include the date, time and "Z"; never a bare date or a time without an offset. Spencer\'s current date, timezone, and today\'s known calendar events are given right after this instruction block.',
    "For a CREATE request, compute the event's END time precisely from whatever Spencer said: an explicit end time (\"till 4\", \"until 4pm\") ends there; a duration phrase (\"an hour and a half\" = 90 minutes, \"half an hour\" = 30 minutes, \"for 45 minutes\"/\"for 45 mins\" = 45 minutes) ends that many minutes after the start. If Spencer gave NEITHER an explicit end time NOR a duration at all, default the duration to exactly 60 minutes.",
    "Respond on ONE line, in exactly one of these forms:",
    "MOVE: <exact event title> | <new start, ISO-8601 UTC>",
    "RESIZE: <exact event title> | <new end, ISO-8601 UTC>",
    "CREATE: <title> | <start, ISO-8601 UTC> | <end, ISO-8601 UTC> | <ASSUMED if you defaulted the 60-minute duration yourself, else EXPLICIT>",
    "or, if you cannot confidently determine this:",
    "NONE",
  ].join("\n");
}

/** The VOLATILE half (Task 9) — today's date/timezone plus today's own candidate events, all of which genuinely differ call to call (and day to day), so this is never marked `cache_control` (see `volatileSystemBlock`'s own doc comment). */
function buildDraftCalendarEditDynamicContext(
  today: string,
  timeZone: string,
  candidateEvents: readonly CalendarEditCandidateEvent[],
): string {
  const eventsList =
    candidateEvents.length > 0
      ? candidateEvents.map((e) => `  - "${e.title}": ${e.start} to ${e.end}`).join("\n")
      : "  (none)";
  return [
    `Today's date is ${today}, Spencer's timezone is ${timeZone}.`,
    "Today's known calendar events (for matching an event Spencer refers to by name):",
    eventsList,
  ].join("\n");
}

/**
 * Extracts a structured move/resize/create request from `line`. Returns
 * `undefined` ONLY when Claude confidently answered `NONE` or the response
 * contained no recognized `MOVE:`/`RESIZE:`/`CREATE:` line at all — i.e. it
 * genuinely isn't a calendar edit, so `app/calendar-edit.ts` (Story 8.9:
 * originally `shell/chat-cli.ts`) falls through to
 * ordinary chat. If a `MOVE:`/`RESIZE:`/`CREATE:` line IS present but fails
 * to parse (a malformed line, or an invalid/out-of-range ISO datetime, never
 * trusted blindly), this throws instead — that's a drafting failure, not
 * "not a calendar edit," and `app/calendar-edit.ts` reports it distinctly
 * rather than silently answering the line as general chat. A genuine
 * API/transport failure also propagates as a thrown error (AD-8);
 * `app/calendar-edit.ts` treats both throw cases the same way.
 */
export async function draftCalendarEditRequest(
  client: AnthropicMessagesClient,
  line: string,
  today: string,
  timeZone: string,
  candidateEvents: readonly CalendarEditCandidateEvent[],
  connection?: SqliteConnection,
): Promise<DraftedCalendarEditRequest | undefined> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: DRAFT_CALENDAR_EDIT_MAX_TOKENS,
    system: [cacheableSystemBlock(buildDraftCalendarEditStableSystemPrompt()), volatileSystemBlock(buildDraftCalendarEditDynamicContext(today, timeZone, candidateEvents))],
    messages: [{ role: "user", content: line }],
  });
  recordUsageSafely(connection, "draft-calendar", CLAUDE_CHAT_MODEL_FAST, message.usage);

  const fullText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  // Tolerate a preamble or trailing commentary: use the first line that
  // starts with one of the recognized keywords, ignoring everything else.
  // No such line at all means Claude said NONE (or something unparseable
  // with no keyword) — genuinely not a calendar edit.
  const text = fullText.split("\n").map((l) => l.trim()).find((l) => /^(MOVE|RESIZE|CREATE):/i.test(l));
  if (text === undefined) return undefined;

  const moveMatch = /^MOVE:\s*(.+?)\s*\|\s*(.+)$/i.exec(text);
  if (moveMatch) {
    const eventTitle = moveMatch[1]!.trim();
    const newStart = moveMatch[2]!.trim();
    if (!isValidIsoDateTime(newStart)) {
      throw new Error(`llm-adapter: MOVE response has an invalid or out-of-range datetime: "${newStart}"`);
    }
    return { kind: "move", eventTitle, newStart: normalizeIsoDateTime(newStart) };
  }

  const resizeMatch = /^RESIZE:\s*(.+?)\s*\|\s*(.+)$/i.exec(text);
  if (resizeMatch) {
    const eventTitle = resizeMatch[1]!.trim();
    const newEnd = resizeMatch[2]!.trim();
    if (!isValidIsoDateTime(newEnd)) {
      throw new Error(`llm-adapter: RESIZE response has an invalid or out-of-range datetime: "${newEnd}"`);
    }
    return { kind: "resize", eventTitle, newEnd: normalizeIsoDateTime(newEnd) };
  }

  // The trailing `| ASSUMED`/`| EXPLICIT` marker is optional in PARSING (not
  // in the system prompt's own spec above) so an older-shaped response with
  // only three fields still parses — it just can't say whether the duration
  // was assumed, so it defaults to EXPLICIT (not flagged as assumed).
  const createMatch = /^CREATE:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*(?:\|\s*(ASSUMED|EXPLICIT)\s*)?$/i.exec(text);
  if (createMatch) {
    const title = createMatch[1]!.trim();
    const start = createMatch[2]!.trim();
    const end = createMatch[3]!.trim();
    if (!isValidIsoDateTime(start) || !isValidIsoDateTime(end)) {
      throw new Error(`llm-adapter: CREATE response has an invalid or out-of-range datetime: start="${start}" end="${end}"`);
    }
    const normalizedStart = normalizeIsoDateTime(start);
    const normalizedEnd = normalizeIsoDateTime(end);
    // An inverted or zero-length range is never a sensible create.
    if (normalizedEnd <= normalizedStart) {
      throw new Error(`llm-adapter: CREATE response has an end not after start: start="${normalizedStart}" end="${normalizedEnd}"`);
    }
    const durationAssumed = (createMatch[4] ?? "EXPLICIT").toUpperCase() === "ASSUMED";
    return { kind: "create", title, start: normalizedStart, end: normalizedEnd, durationAssumed };
  }

  // Matched a recognized keyword prefix but neither sub-pattern parsed the rest of the line — malformed, not "not a calendar edit."
  throw new Error(`llm-adapter: unrecognized calendar-edit response: "${text}"`);
}

// ============================================================================
// normalizeQuickAddLine (Polish 4 Task 1) — the Haiku fallback for the
// Tasks page's quick-add line. `core/quick-add.ts`'s deterministic parser
// handles every unambiguous shape; `app/create-task.ts`'s `createTask`
// calls THIS only on submit (never while typing), and only when the
// deterministic title still contains a field-like word it didn't manage to
// read (`core/quick-add.ts`'s `hasUnresolvedFieldWords`). This function
// itself never validates its own answer against the live options or
// Yoh's fixed enums — it returns Claude's claimed values as loose,
// unvalidated strings, exactly like `draftNotionPageFields` above; the
// caller (`app/quick-add-normalize.ts`, which — unlike this `adapters/*.ts`
// file — may import `core/planning-field-value.ts`) is what actually
// coerces/validates each field, dropping anything that doesn't match a
// real live option rather than guessing.
// ============================================================================

/** Claude's claimed fields for one quick-add line — every value a raw, unvalidated string (or absent). `app/quick-add-normalize.ts` is what turns this into real, validated `QuickAddFields`. */
export interface QuickAddNormalizeRawFields {
  readonly title?: string;
  readonly dueDate?: string;
  readonly estimatedDurationMinutes?: string;
  readonly energy?: string;
  readonly area?: string;
  readonly status?: string;
  /** Task 7 (Priority field). */
  readonly priority?: string;
}

/** The live option names `normalizeQuickAddLine` shows Claude, so it never invents an Area/Status Spencer's workspace doesn't actually have. */
export interface QuickAddLiveOptions {
  readonly area?: readonly string[];
  readonly energy: readonly string[];
  readonly status: readonly string[];
  /** Task 7: the live Priority select option names (e.g. "🔴 High") — absent/empty means Priority isn't shown to Claude at all. */
  readonly priority?: readonly string[];
}

const NORMALIZE_QUICK_ADD_MAX_TOKENS = 256;

/** The STABLE half (Task 9's caching convention) — the instructions never depend on `today`/`timeZone`/the live option lists actually CHANGING shape call to call for the same Spencer session, only their VALUES do, which live in the volatile block instead. */
function buildNormalizeQuickAddStableSystemPrompt(): string {
  return [
    "You are helping Yoh, Spencer's personal planning assistant, read the real fields out of a quick-add line for a new Task — Spencer typed the WHOLE line as one piece of free text, and some of it is data (a due date, a duration, an energy level, an area, a status), not title.",
    'Respond with STRICT JSON only, on one line, with exactly these optional keys: {"title": "...", "dueDate": "YYYY-MM-DD", "estimatedDurationMinutes": "60", "energy": "low|medium|high", "area": "...", "status": "not-started|in-progress", "priority": "..."}.',
    '"title" is the words that are genuinely the task\'s name once every field below is read out of the line — drop a leading imperative like "add". Always include "title", even if you find no other field at all.',
    "Resolve any relative date/day phrase (\"wednesday\", \"tomorrow\", \"next week friday\") into a real \"YYYY-MM-DD\" date using today's date and timezone, given right after this instruction block. Never invent a date Spencer didn't say or clearly imply.",
    '"estimatedDurationMinutes" is a whole number of minutes, as a string (e.g. "90" for "1.5h" or "an hour and a half").',
    '"energy" is exactly one of: low, medium, high (map "deep"/"deep work" to high, "light"/"light work" to low).',
    '"area" MUST be exactly one of the live Area options listed below, verbatim — never a value that isn\'t in that list, and never invented free text.',
    '"status" is exactly one of: not-started, in-progress — NEVER "completed" or "done": quick-add must never mark a new Task complete, so if the line says "done"/"completed", omit "status" entirely rather than answering it.',
    '"priority" MUST be exactly one of the live Priority options listed below, verbatim (its emoji is optional in the line itself, e.g. "high priority"/"p1" both mean the "High" option) — never invented free text.',
    "Omit any key you can't confidently read from the line — never guess. If nothing at all is confidently readable, respond with just the title.",
  ].join("\n");
}

function buildNormalizeQuickAddDynamicContext(today: string, timeZone: string, options: QuickAddLiveOptions): string {
  const lines = [`Today's date is ${today}, Spencer's timezone is ${timeZone}.`, `Live Status options: ${options.status.join(", ")}.`];
  if (options.area && options.area.length > 0) lines.push(`Live Area options (area must be one of these, verbatim): ${options.area.join(", ")}.`);
  if (options.priority && options.priority.length > 0) lines.push(`Live Priority options (priority must be one of these, verbatim): ${options.priority.join(", ")}.`);
  return lines.join("\n");
}

/**
 * Calls Claude once with `line` and returns its claimed fields, unvalidated
 * (see this section's own header comment). Returns `undefined` — never
 * throws for "couldn't extract" — when the response has no parseable JSON
 * object in it, or that object carries no usable `title` at all. A genuine
 * API/transport failure (including a caller-imposed timeout racing this
 * promise) still propagates as a thrown error (AD-8); `app/quick-add-
 * normalize.ts` treats both the same way — fall back to the deterministic
 * parse, the Task is still created either way.
 */
export async function normalizeQuickAddLine(
  client: AnthropicMessagesClient,
  line: string,
  today: string,
  timeZone: string,
  options: QuickAddLiveOptions,
  connection?: SqliteConnection,
): Promise<QuickAddNormalizeRawFields | undefined> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: NORMALIZE_QUICK_ADD_MAX_TOKENS,
    system: [cacheableSystemBlock(buildNormalizeQuickAddStableSystemPrompt()), volatileSystemBlock(buildNormalizeQuickAddDynamicContext(today, timeZone, options))],
    messages: [{ role: "user", content: line }],
  });
  recordUsageSafely(connection, "quick-add-normalize", CLAUDE_CHAT_MODEL_FAST, message.usage);

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;

  const obj = parsed as Record<string, unknown>;
  const str = (key: string): string | undefined => (typeof obj[key] === "string" && obj[key].trim().length > 0 ? (obj[key] as string).trim() : undefined);
  const title = str("title");
  if (title === undefined) return undefined;

  const dueDate = str("dueDate");
  const estimatedDurationMinutes = str("estimatedDurationMinutes");
  const energy = str("energy");
  const area = str("area");
  const status = str("status");
  const priority = str("priority");

  return {
    title,
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes } : {}),
    ...(energy !== undefined ? { energy } : {}),
    ...(area !== undefined ? { area } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(priority !== undefined ? { priority } : {}),
  };
}

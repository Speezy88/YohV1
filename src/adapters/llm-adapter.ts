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
import { isValidIsoDateTime, normalizeIsoDateTime } from "./iso-datetime.ts";
import type {
  ChatIntent,
  ChatTurn,
  ExternalId,
  FieldValueSuggestion,
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
 *    `answerGeneralQuestion`, and only situationally: `shell/chat-cli.ts`
 *    picks between the two based on `core/tone.ts`'s existing
 *    `classifyTone(line)` register (already computed there to choose the
 *    system prompt) — a `"concise-educational"` factual/analytical question
 *    routes to Sonnet, ordinary `"casual-peer"` chat stays on Haiku. That
 *    routing decision lives in `chat-cli.ts`, not here: AD-1 restricts
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
 * Spencer, who experienced it as one continuous session. `messages` is built
 * by `shell/chat-cli.ts`'s recording wrapper around its `ChatCliIo`, which
 * captures every line written/read across EVERY flow (deterministic commands
 * included, not just prior general-chat turns) as alternating `user`/
 * `assistant` turns — see that wrapper's own doc comment for how it
 * guarantees the strict alternation (and "starts with `user`") the Messages
 * API requires. This function trusts that invariant rather than
 * re-validating it structurally on every call; a malformed `messages` array
 * is a caller bug, not a runtime condition worth guarding against on the
 * hot path, though an empty array is rejected outright below (there is
 * always at least the current turn once `chat-cli.ts` reaches this call
 * site — an empty array signals the wrapper wiring itself is broken).
 *
 * Per AD-8, this throws rather than returning `Result` on any failure: a
 * transport/API-level rejection from the SDK propagates unchanged, and a
 * response that comes back with no text content at all is raised as a
 * thrown `Error` too (never silently returned as `""`, which would read as a
 * real if empty answer rather than something worth investigating).
 * `shell/chat-cli.ts` is the layer that catches either around its call site
 * so one failed turn doesn't crash the whole REPL session.
 *
 * `model` defaults to `CLAUDE_CHAT_MODEL_FAST` (Haiku) — `chat-cli.ts`
 * overrides it with `CLAUDE_CHAT_MODEL_CAPABLE` (Sonnet) for a message
 * `core/tone.ts`'s `classifyTone` reads as genuinely factual/analytical; see
 * this file's "Model routing" doc comment above `CLAUDE_CHAT_MODEL_FAST`.
 */
export async function answerGeneralQuestion(
  client: AnthropicMessagesClient,
  messages: readonly ChatTurn[],
  systemPrompt: string = DEFAULT_GENERAL_QA_SYSTEM_PROMPT,
  model: Anthropic.Model = CLAUDE_CHAT_MODEL_FAST,
): Promise<string> {
  if (messages.length === 0) {
    throw new Error("llm-adapter: answerGeneralQuestion called with no conversation history at all");
  }

  const message = await client.messages.create({
    model,
    max_tokens: CLAUDE_CHAT_MAX_TOKENS,
    system: systemPrompt,
    messages: messages.map((turn) => ({ role: turn.role, content: turn.content })),
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

/**
 * Streaming twin of `answerGeneralQuestion` (Story 8.3): same inputs, same
 * "never a silent empty reply" contract (AD-8) — throws if the stream ends
 * having yielded no text at all, or if `messages` is empty. Yields raw text
 * chunks (`content_block_delta` events whose `delta.type === "text_delta"`)
 * as they arrive; a caller with no live stream sink should keep using
 * `answerGeneralQuestion` instead (this file exposes both — `chat-cli.ts`
 * never calls this one; see `app/general-question.ts`, which uses it only
 * when its caller supplied a stream sink).
 */
export async function* streamGeneralQuestion(
  client: AnthropicMessagesClient,
  messages: readonly ChatTurn[],
  systemPrompt: string = DEFAULT_GENERAL_QA_SYSTEM_PROMPT,
  model: Anthropic.Model = CLAUDE_CHAT_MODEL_FAST,
): AsyncGenerator<string, void, void> {
  if (messages.length === 0) {
    throw new Error("llm-adapter: streamGeneralQuestion called with no conversation history at all");
  }

  const stream = await client.messages.create({
    model,
    max_tokens: CLAUDE_CHAT_MAX_TOKENS,
    system: systemPrompt,
    messages: messages.map((turn) => ({ role: turn.role, content: turn.content })),
    stream: true,
  });

  let sawText = false;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      sawText = true;
      yield event.delta.text;
    }
  }
  if (!sawText) {
    throw new Error("llm-adapter: Claude returned no text content for a streamed general Q&A response");
  }
}

// ============================================================================
// suggestFieldValue (Story 6.2 / FR-25, AD-11) — lazy, display-time-only
// inference of a missing Task planning field from Spencer's own recent chat
// lines. Called ONLY by shell/chat-cli.ts, at the moment it's about to
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
 * directly, so `shell/chat-cli.ts` (which may import both) passes a thin
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
 * `chat-cli.ts` treats that identically to "no confident inference" at its
 * own call site.
 */
export async function suggestFieldValue(
  client: AnthropicMessagesClient,
  taskId: ExternalId,
  taskTitle: string,
  field: PlanningFieldNames,
  recentMessages: readonly string[],
  parseValue: ParsePlanningFieldValueFn,
): Promise<FieldValueSuggestion | undefined> {
  if (recentMessages.length === 0) return undefined;

  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: SUGGEST_FIELD_VALUE_MAX_TOKENS,
    system: buildSuggestFieldValueSystemPrompt(taskTitle, field),
    messages: [{ role: "user", content: recentMessages.join("\n") }],
  });

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
// resolveNotionPageDraftProperties, called by chat-cli.ts right after this)
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

function buildDraftNotionPageSystemPrompt(database: NotionDatabaseTarget): string {
  const fields = DRAFT_NOTION_PAGE_KNOWN_FIELDS[database];
  return [
    `You are helping Yoh, Spencer's personal planning assistant, turn a chat request into a structured draft for a new "${database}" Notion item.`,
    `Extract ONLY fields Spencer actually mentioned, from this list: ${fields.join(", ")}.`,
    `Respond with one "field=value" line per field you can confidently extract, using EXACTLY these field names. "title" is required — if you cannot confidently extract a title, respond with exactly: NONE`,
    "Never invent a value Spencer didn't say or clearly imply.",
  ].join("\n");
}

/**
 * Extracts a `{internalField: rawValue}` map from `request` (Spencer's
 * free-text "create a ..." message) for `database`. Returns `undefined` —
 * never throws for "couldn't extract" — when Claude's response has no
 * parseable `field=value` lines at all, or extracts no `title`. A genuine
 * API/transport failure still propagates as a thrown error (AD-8);
 * `chat-cli.ts` treats that the same as "couldn't draft."
 */
export async function draftNotionPageFields(
  client: AnthropicMessagesClient,
  database: NotionDatabaseTarget,
  request: string,
): Promise<Record<string, string> | undefined> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: DRAFT_NOTION_PAGE_MAX_TOKENS,
    system: buildDraftNotionPageSystemPrompt(database),
    messages: [{ role: "user", content: request }],
  });

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
// ChatIntent today. Called only by shell/chat-cli.ts, only on a line that
// already failed every existing deterministic trigger check (time budget,
// plan view, mid-day reflow, blocker, why-prioritized, create-item) — never
// on every message unconditionally, to avoid firing a paid search call on
// an ordinary planning/status message (AD-14's own named risk).
// ============================================================================

const CLASSIFY_CHAT_INTENT_MAX_TOKENS = 128;

const CLASSIFY_CHAT_INTENT_SYSTEM_PROMPT = [
  "You are Yoh's chat-intent classifier. Decide whether Spencer's message is:",
  '(a) an explicit request to search the web (e.g. "search for X", "look up X", "google X"), or an unambiguous factual/research question needing a live, current, or specific factual answer outside Yoh\'s own planning data — respond:',
  "SEARCH: <a clean, focused search query capturing what to look up>",
  "(b) anything else (ordinary planning, status, or conversational chat) — respond with exactly:",
  "GENERAL",
].join("\n");

/**
 * Classifies `line` into `{kind: 'search-trigger', query}` or
 * `{kind: 'general-question'}` — the only two `ChatIntent` variants this
 * function ever actually produces (see `ChatIntent`'s own doc comment).
 * Defaults to `{kind: 'general-question'}` for ANY response that isn't a
 * recognized `SEARCH: ...` line — never throws for "not a search," so a
 * malformed classifier response degrades to the ordinary chat path rather
 * than blocking it. A genuine API/transport failure still propagates as a
 * thrown error (AD-8); `chat-cli.ts` treats that the same way.
 */
export async function classifyChatIntent(client: AnthropicMessagesClient, line: string): Promise<ChatIntent> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: CLASSIFY_CHAT_INTENT_MAX_TOKENS,
    system: CLASSIFY_CHAT_INTENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: line }],
  });

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
// detectTaskCapture (Story 8.8 / FR-26 extended, AD-14's cost discipline) —
// chat-turn.ts calls this ONLY after every deterministic recognizer
// (time-budget, plan-view, mid-day-reflow, blocker, why-prioritized,
// save-search-result, create-item's explicit Notion mention, calendar-edit)
// has already failed to match — never on every message unconditionally. It
// answers one question only: "does this line describe something Spencer
// wants tracked as a new Task?" It does NOT draft the Task's fields itself —
// a hit is handed off to the existing draftNotionPageFields/createPage
// pipeline via app/create-item.ts's draftItem, unchanged, so a captured Task
// goes through the exact same confirm-then-write trust boundary as an
// explicit "create a task ..." command. Controller ruling: `ChatIntent`
// (domain.ts) is not widened for this — this is its own function/shape.
// ============================================================================

const DETECT_TASK_CAPTURE_MAX_TOKENS = 16;

const DETECT_TASK_CAPTURE_SYSTEM_PROMPT = [
  "You are Yoh's task-capture detector. Decide whether Spencer's message describes something he needs to DO or produce later — a new Task he wants tracked (an assignment, an errand, a chore, a deliverable, with or without a stated due date) — as opposed to a question he's asking, a status update, or ordinary conversation.",
  "If it clearly describes a new Task to track, respond with exactly: CAPTURE",
  "Otherwise (a question, a greeting, a status update, small talk, or anything ambiguous) respond with exactly: NONE",
].join("\n");

/**
 * Returns `{request: line}` (the ONE input `app/create-item.ts`'s `draftItem`
 * needs — the same shape `parseCreateItemCommand` already returns as
 * `.request`) when Claude confidently says `line` describes a new Task, else
 * `undefined`. Never throws for "not a capture" — only a genuine API/
 * transport failure propagates (AD-8), exactly like
 * `classifyChatIntent`/`draftCalendarEditRequest` above.
 */
export async function detectTaskCapture(
  client: AnthropicMessagesClient,
  line: string,
): Promise<{ readonly request: string } | undefined> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: DETECT_TASK_CAPTURE_MAX_TOKENS,
    system: DETECT_TASK_CAPTURE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: line }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return /^CAPTURE\b/i.test(text) ? { request: line } : undefined;
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
  | { readonly kind: "create"; readonly title: string; readonly start: string; readonly end: string };

const DRAFT_CALENDAR_EDIT_MAX_TOKENS = 256;

interface CalendarEditCandidateEvent {
  readonly title: string;
  readonly start: string;
  readonly end: string;
}

function buildDraftCalendarEditSystemPrompt(
  today: string,
  timeZone: string,
  candidateEvents: readonly CalendarEditCandidateEvent[],
): string {
  const eventsList =
    candidateEvents.length > 0
      ? candidateEvents.map((e) => `  - "${e.title}": ${e.start} to ${e.end}`).join("\n")
      : "  (none)";
  return [
    "You are helping Yoh, Spencer's personal planning assistant, turn a chat request into a structured Calendar edit.",
    `Today's date is ${today}, Spencer's timezone is ${timeZone}. Resolve any relative time Spencer gives (e.g. "4pm", "in an hour") into a full ISO-8601 UTC datetime with a "Z" suffix (e.g. "2026-09-18T20:00:00.000Z") — always include the date, time and "Z"; never a bare date or a time without an offset.`,
    "Today's known calendar events (for matching an event Spencer refers to by name):",
    eventsList,
    "Respond on ONE line, in exactly one of these forms:",
    "MOVE: <exact event title> | <new start, ISO-8601 UTC>",
    "RESIZE: <exact event title> | <new end, ISO-8601 UTC>",
    "CREATE: <title> | <start, ISO-8601 UTC> | <end, ISO-8601 UTC>",
    "or, if you cannot confidently determine this:",
    "NONE",
  ].join("\n");
}

/**
 * Extracts a structured move/resize/create request from `line`. Returns
 * `undefined` ONLY when Claude confidently answered `NONE` or the response
 * contained no recognized `MOVE:`/`RESIZE:`/`CREATE:` line at all — i.e. it
 * genuinely isn't a calendar edit, so `chat-cli.ts` falls through to
 * ordinary chat. If a `MOVE:`/`RESIZE:`/`CREATE:` line IS present but fails
 * to parse (a malformed line, or an invalid/out-of-range ISO datetime, never
 * trusted blindly), this throws instead — that's a drafting failure, not
 * "not a calendar edit," and `chat-cli.ts` reports it distinctly rather than
 * silently answering the line as general chat. A genuine API/transport
 * failure also propagates as a thrown error (AD-8); `chat-cli.ts` treats
 * both throw cases the same way.
 */
export async function draftCalendarEditRequest(
  client: AnthropicMessagesClient,
  line: string,
  today: string,
  timeZone: string,
  candidateEvents: readonly CalendarEditCandidateEvent[],
): Promise<DraftedCalendarEditRequest | undefined> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: DRAFT_CALENDAR_EDIT_MAX_TOKENS,
    system: buildDraftCalendarEditSystemPrompt(today, timeZone, candidateEvents),
    messages: [{ role: "user", content: line }],
  });

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

  const createMatch = /^CREATE:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/i.exec(text);
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
    return { kind: "create", title, start: normalizedStart, end: normalizedEnd };
  }

  // Matched a recognized keyword prefix but neither sub-pattern parsed the rest of the line — malformed, not "not a calendar edit."
  throw new Error(`llm-adapter: unrecognized calendar-edit response: "${text}"`);
}

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
import type {
  ChatIntent,
  Energy,
  ExternalId,
  FieldValueSuggestion,
  NotionDatabaseTarget,
  PlanningFieldNames,
  Task,
  TaskStatus,
} from "../types/domain.ts";

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

const SUGGEST_FIELD_VALUE_TASK_STATUSES: readonly TaskStatus[] = ["not-started", "in-progress", "completed", "slipped"];
const SUGGEST_FIELD_VALUE_ENERGIES: readonly Energy[] = ["low", "medium", "high"];
const SUGGEST_FIELD_VALUE_ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates/coerces Claude's claimed raw value into `field`'s real type.
 * Deliberately independent of `shell/chat-cli.ts`'s own `parseFieldAnswer`
 * (AD-1 forbids this `adapters/` file importing from `shell/`) — and unlike
 * that function, this one never surfaces a message to Spencer: an
 * unparseable claim just means "no confident inference" (`undefined`),
 * silently falling back to the ordinary blind ask.
 */
function parseSuggestedValue(field: PlanningFieldNames, raw: string): NonNullable<Task[PlanningFieldNames]> | undefined {
  switch (field) {
    case "estimatedDurationMinutes": {
      const minutes = Number(raw);
      return Number.isInteger(minutes) && minutes > 0 ? minutes : undefined;
    }
    case "area":
      return raw.length > 0 ? raw : undefined;
    case "dueDate": {
      const match = SUGGEST_FIELD_VALUE_ISO_DATE_RE.exec(raw);
      if (!match) return undefined;
      const [, y, m, d] = match;
      const year = Number(y);
      const month = Number(m);
      const day = Number(d);
      const date = new Date(Date.UTC(year, month - 1, day));
      const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
      return valid ? raw : undefined;
    }
    case "status": {
      const normalized = raw.toLowerCase().replace(/\s+/g, "-");
      return SUGGEST_FIELD_VALUE_TASK_STATUSES.find((status) => status === normalized);
    }
    case "energy": {
      const normalized = raw.toLowerCase();
      return SUGGEST_FIELD_VALUE_ENERGIES.find((energy) => energy === normalized);
    }
  }
}

/**
 * Attempts to confidently infer `field`'s value for Task `taskId`
 * (`taskTitle`) from `recentMessages` (Spencer's own recent chat lines,
 * oldest first). Returns `undefined` — never throws — for every "no
 * confident answer" case: no recent messages at all (a cheap short-circuit,
 * no API call made); a response that doesn't match the required
 * `CONFIDENT: <value> | <reason>` format; or a claimed value that doesn't
 * parse as valid for `field` (never trusted blindly — see
 * `parseSuggestedValue`). A genuine API/transport failure still propagates
 * as a thrown error (AD-8) — `chat-cli.ts` treats that identically to "no
 * confident inference" at its own call site.
 */
export async function suggestFieldValue(
  client: AnthropicMessagesClient,
  taskId: ExternalId,
  taskTitle: string,
  field: PlanningFieldNames,
  recentMessages: readonly string[],
): Promise<FieldValueSuggestion | undefined> {
  if (recentMessages.length === 0) return undefined;

  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL,
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
  const value = parseSuggestedValue(field, rawValue!.trim());
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
    model: CLAUDE_CHAT_MODEL,
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
    model: CLAUDE_CHAT_MODEL,
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

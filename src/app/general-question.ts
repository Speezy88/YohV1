/**
 * src/app/general-question.ts
 *
 * Story 8.3 (AD-16). Moved from `shell/chat-cli.ts`'s general-qa catch-all
 * (Tone/model routing unchanged) — now also streams through `deps.emit`
 * when present (`llm-adapter.ts`'s `streamGeneralQuestion`), otherwise the
 * existing non-streaming `answerGeneralQuestion`. A caller with no live
 * stream sink (`shell/chat-cli.ts`, before it was retired, never had one)
 * keeps using the non-streaming path; `shell/server.ts` (Task 6) supplies
 * one.
 */
import {
  answerGeneralQuestion,
  streamGeneralQuestion,
  CLAUDE_CHAT_MODEL_CAPABLE,
  CLAUDE_CHAT_MODEL_FAST,
  type AnthropicMessagesClient,
} from "../adapters/llm-adapter.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { COMMANDS } from "./commands.ts";
import type { MemoryContext } from "../core/memory-context.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { classifyTone, resolveToneSystemPrompt } from "../core/tone.ts";
import type { ChatStreamEvent, ChatTurnResponse } from "../types/api.ts";
import type { ChatTurn, Result, YohError } from "../types/domain.ts";

export interface GeneralQuestionDeps {
  readonly llmClient: AnthropicMessagesClient;
  readonly emit?: (event: ChatStreamEvent) => void;
  /**
   * Real-use fixes plan, Task 9: threaded straight through to
   * `llm-adapter.ts`'s `answerGeneralQuestion`/`streamGeneralQuestion` as
   * their own trailing `connection` argument, so every real Claude call
   * this file makes gets its usage recorded. Optional — a caller with no
   * interest in usage recording (most of this file's own tests) simply
   * omits it; `shell/server.ts`'s `buildChatDeps` always supplies it.
   */
  readonly connection?: SqliteConnection;
  /**
   * Review fix (real-use fixes plan, Task 5 fix, FR-42): threaded into
   * `core/tone.ts`'s `resolveToneSystemPrompt` so the general-chat
   * capability text never claims web search when it isn't actually
   * configured. Optional, defaulting to `true` (this file's own prior,
   * search-available behavior) — `app/chat-turn.ts` is the one real caller,
   * and always passes the actual derived value
   * (`ChatTurnDeps.webSearchAvailable`, ultimately `shell/server.ts`'s
   * `Boolean(env["PERPLEXITY_API_KEY"])`).
   */
  readonly webSearchAvailable?: boolean;
}

export interface AnswerQuestionInput {
  readonly message: string;
  readonly history: readonly ChatTurn[];
  /** Story 13.6: what Yoh remembers; absent when the store is down. */
  readonly memory?: MemoryContext;
}

/**
 * Model routing (unchanged): reuses `core/tone.ts`'s own `classifyTone`
 * (already the source of truth for which register's system prompt to send)
 * as the signal for which model to send it to. A `"concise-educational"`
 * message (a genuine factual/analytical question) escalates to
 * `CLAUDE_CHAT_MODEL_CAPABLE` (Sonnet); ordinary `"casual-peer"` chat stays
 * on `CLAUDE_CHAT_MODEL_FAST` (Haiku).
 */
export async function answerQuestion(
  deps: GeneralQuestionDeps,
  input: AnswerQuestionInput,
): Promise<Result<ChatTurnResponse, YohError>> {
  const systemPrompt = resolveToneSystemPrompt(input.message, deps.webSearchAvailable ?? true, COMMANDS);
  const model = classifyTone(input.message) === "concise-educational" ? CLAUDE_CHAT_MODEL_CAPABLE : CLAUDE_CHAT_MODEL_FAST;

  try {
    if (deps.emit) {
      let full = "";
      for await (const chunk of streamGeneralQuestion(deps.llmClient, input.history, systemPrompt, model, deps.connection, input.memory)) {
        full += chunk;
        deps.emit({ type: "delta", text: chunk });
      }
      return { ok: true, value: { reply: full, receipts: [] } };
    }
    const reply = await answerGeneralQuestion(deps.llmClient, input.history, systemPrompt, model, deps.connection, input.memory);
    return { ok: true, value: { reply, receipts: [] } };
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Claude" }) } };
  }
}

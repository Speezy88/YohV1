/**
 * src/app/general-question.ts
 *
 * Story 8.3 (AD-16). Moved from `shell/chat-cli.ts`'s general-qa catch-all
 * (Tone/model routing unchanged) — now also streams through `deps.emit`
 * when present (`llm-adapter.ts`'s `streamGeneralQuestion`), otherwise the
 * existing non-streaming `answerGeneralQuestion`. `chat-cli.ts` never
 * supplies `emit`, so it keeps using the non-streaming path exactly as
 * before; a future streaming caller (the server, Task 6) supplies one.
 */
import {
  answerGeneralQuestion,
  streamGeneralQuestion,
  CLAUDE_CHAT_MODEL_CAPABLE,
  CLAUDE_CHAT_MODEL_FAST,
  type AnthropicMessagesClient,
} from "../adapters/llm-adapter.ts";
import { classifyTone, resolveToneSystemPrompt } from "../core/tone.ts";
import type { ChatStreamEvent, ChatTurnResponse } from "../types/api.ts";
import type { ChatTurn, Result, YohError } from "../types/domain.ts";

export interface GeneralQuestionDeps {
  readonly llmClient: AnthropicMessagesClient;
  readonly emit?: (event: ChatStreamEvent) => void;
}

export interface AnswerQuestionInput {
  readonly message: string;
  readonly history: readonly ChatTurn[];
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  const systemPrompt = resolveToneSystemPrompt(input.message);
  const model = classifyTone(input.message) === "concise-educational" ? CLAUDE_CHAT_MODEL_CAPABLE : CLAUDE_CHAT_MODEL_FAST;

  try {
    if (deps.emit) {
      let full = "";
      for await (const chunk of streamGeneralQuestion(deps.llmClient, input.history, systemPrompt, model)) {
        full += chunk;
        deps.emit({ type: "delta", text: chunk });
      }
      return { ok: true, value: { reply: full, receipts: [] } };
    }
    const reply = await answerGeneralQuestion(deps.llmClient, input.history, systemPrompt, model);
    return { ok: true, value: { reply, receipts: [] } };
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: `I hit a problem trying to answer that: ${describeError(err)}` } };
  }
}

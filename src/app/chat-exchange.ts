/**
 * `chatExchange` (Story 13.1, AD-25/E2): the ONE orchestrator for a whole chat
 * exchange. Order: store Spencer's turn -> run the inner turn (`runChatTurn`,
 * default `chatTurn`), forwarding status/delta through `deps.emit` -> emit
 * `done` -> store Yoh's turn (synchronously after `done`, no awaits between)
 * -> post-done steps (later stories) -> return the Result.
 *
 * `chatTurn` keeps its contract of never emitting `done`/`error`; a failed
 * Result is returned for the transport to turn into ONE `error` event.
 * Store failures are logged and never surface: the answer still streams.
 * `timeZone`/`now` are read only when a chat store is configured.
 */
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { ChatStreamEvent, ChatTurnRequest, ChatTurnResponse } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";
import { chatTurn, type ChatTurnDeps } from "./chat-turn.ts";

export type ChatTurnFn = (deps: ChatTurnDeps, input: ChatTurnRequest) => Promise<Result<ChatTurnResponse, YohError>>;

export interface ChatExchangeDeps extends ChatTurnDeps {
  /** The inner turn; defaults to `chatTurn` (the e2e fixture injects a scripted one). */
  readonly runChatTurn?: ChatTurnFn;
  /** True once the client is gone; a stream that ends aborted stores a truncated Yoh turn. */
  readonly isAborted?: () => boolean;
}

export interface ChatExchangeSummary {
  readonly reply: string;
  readonly truncated: boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function chatExchange(
  deps: ChatExchangeDeps,
  input: ChatTurnRequest,
): Promise<Result<ChatExchangeSummary, YohError>> {
  const { runChatTurn = chatTurn, isAborted, ...turnDeps } = deps;
  const store = deps.chatHistory;

  const remember = (role: "user" | "assistant", text: string, truncated: boolean): void => {
    if (!store) return;
    try {
      const at = deps.now();
      store.appendTurn({ date: localIsoDate(at, deps.timeZone), role, text, truncated, at: at.toISOString() });
    } catch (error) {
      deps.log?.({ level: "warn", event: "chat-exchange.history-write-failed", detail: describe(error) });
    }
  };

  const emit = (event: ChatStreamEvent): void => deps.emit?.(event);

  remember("user", input.message.trim(), false);

  let streamed = "";
  const result = await runChatTurn(
    {
      ...turnDeps,
      emit: (event) => {
        if (event.type === "delta") streamed += event.text;
        emit(event);
      },
    },
    input,
  );

  if (!result.ok) return result;

  const response = result.value;
  emit({ type: "done", response });

  if (isAborted?.() === true) {
    if (streamed.trim() !== "") remember("assistant", streamed, true);
    return { ok: true, value: { reply: streamed, truncated: true } };
  }

  const text = response.question ? `${response.reply}\n\n${response.question.text}`.trim() : response.reply;
  if (text.trim() !== "") remember("assistant", text, false);

  // Post-done seam (AD-27 order): `remembered`, `proposal`, `rating` land here in later stories.

  return { ok: true, value: { reply: text, truncated: false } };
}

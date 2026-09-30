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
import { randomUUID } from "node:crypto";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { StoredChatTurn } from "../adapters/chat-store.ts";
import { isTrivialTurn } from "../core/memory-filing.ts";
import type { ChatStreamEvent, ChatTurnRequest, ChatTurnResponse } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";
import { chatTurn, type ChatTurnDeps } from "./chat-turn.ts";
import { fileMemory, type FileMemoryOutput } from "./file-memory.ts";

export type ChatTurnFn = (deps: ChatTurnDeps, input: ChatTurnRequest) => Promise<Result<ChatTurnResponse, YohError>>;

export interface ChatExchangeDeps extends ChatTurnDeps {
  /** The inner turn; defaults to `chatTurn` (the e2e fixture injects a scripted one). */
  readonly runChatTurn?: ChatTurnFn;
  /** True once the client is gone; a stream that ends aborted stores a truncated Yoh turn. */
  readonly isAborted?: () => boolean;
  /** Test seam: overrides `MEMORY_FILING_TIMEOUT_MS`. */
  readonly memoryFilingTimeoutMs?: number;
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

  const remember = (role: "user" | "assistant", text: string, truncated: boolean): StoredChatTurn | undefined => {
    if (!store) return undefined;
    try {
      const at = deps.now();
      return store.appendTurn({ date: localIsoDate(at, deps.timeZone), role, text, truncated, at: at.toISOString() });
    } catch (error) {
      deps.log?.({ level: "warn", event: "chat-exchange.history-write-failed", detail: describe(error) });
      return undefined;
    }
  };

  const emit = (event: ChatStreamEvent): void => deps.emit?.(event);

  const userTurn = remember("user", input.message.trim(), false);
  if (deps.memoryItems) {
    try {
      deps.memoryItems.purgeDeleted();
    } catch (error) {
      deps.log?.({ level: "warn", event: "chat-exchange.purge-deleted-failed", detail: describe(error) });
    }
  }

  let streamed = "";
  const result = await runChatTurn(
    {
      ...turnDeps,
      ...(userTurn ? { turn: { conversationId: userTurn.conversationId, userTurnId: userTurn.id } } : {}),
      emit: (event) => {
        if (event.type === "delta") streamed += event.text;
        emit(event);
      },
    },
    input,
  );

  if (!result.ok) return result;

  const { memory: directive, handledDeterministically, ...response } = result.value;
  emit({ type: "done", response });

  if (isAborted?.() === true) {
    if (streamed.trim() !== "") remember("assistant", streamed, true);
    return { ok: true, value: { reply: streamed, truncated: true } };
  }

  const text = response.question ? `${response.reply}\n\n${response.question.text}`.trim() : response.reply;
  if (text.trim() !== "") remember("assistant", text, false);

  // Post-done seam (AD-27 order): `remembered` (here), then `proposal`, `rating` in later stories.
  if (directive?.kind === "forgot") emit({ type: "remembered", receipt: directive.receipt });
  else if (directive?.kind === "remember") {
    const filed = await fileExplicitly(deps, directive.text, userTurn);
    emit({ type: "remembered", receipt: filed.receipt });
    if (filed.proposal) emit({ type: "proposal", question: filed.proposal });
  } else if (
    !directive &&
    deps.memoryItems &&
    !isTrivialTurn(input.message, { handledDeterministically: handledDeterministically === true, isStructuredAnswer: false })
  ) {
    // Story 13.5: automatic filing. Failure, timeout, or nothing worth filing shows nothing.
    try {
      const filed = await fileMemory(deps, { text: input.message.trim(), forceStated: false, ...(userTurn ? { userTurn } : {}) });
      if (!filed.ok) throw new Error(filed.error.message);
      if (filed.value) {
        emit({ type: "remembered", receipt: filed.value.receipt });
        if (filed.value.proposal) emit({ type: "proposal", question: filed.value.proposal });
      }
    } catch (error) {
      deps.log?.({ level: "warn", event: "chat-exchange.filing-failed", detail: describe(error) });
    }
  }

  return { ok: true, value: { reply: text, truncated: false } };
}

/**
 * The explicit "remember ..." path (Story 13.4): forced Stated. Any failure, timeout, or
 * empty result yields a receipt with `items: []` (the web says "Couldn't save that to
 * memory."). Never throws, never an `error` event.
 */
async function fileExplicitly(deps: ChatExchangeDeps, text: string, userTurn: StoredChatTurn | undefined): Promise<FileMemoryOutput> {
  const failed: FileMemoryOutput = { receipt: { receiptId: randomUUID(), kind: "remembered", items: [] } };
  const filed = await fileMemory(deps, { text, forceStated: true, ...(userTurn ? { userTurn } : {}) });
  if (!filed.ok) {
    deps.log?.({ level: "warn", event: "chat-exchange.memory-filing-failed", detail: filed.error.message });
    return failed;
  }
  return filed.value ?? failed;
}

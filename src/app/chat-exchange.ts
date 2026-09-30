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
import { extractMemories } from "../adapters/llm-adapter.ts";
import { ALWAYS_LOADED_FOLDERS } from "../core/memory-folders.ts";
import { MEMORY_FILING_TIMEOUT_MS, validateFiling } from "../core/memory-filing.ts";
import type { ChatStreamEvent, ChatTurnRequest, ChatTurnResponse, RememberedReceipt } from "../types/api.ts";
import type { MemoryCandidate, Result, YohError } from "../types/domain.ts";
import { chatTurn, type ChatTurnDeps } from "./chat-turn.ts";

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

  const { memory: directive, ...response } = result.value;
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
    emit({ type: "remembered", receipt: await fileExplicitly(deps, directive.text, userTurn) });
  }

  return { ok: true, value: { reply: text, truncated: false } };
}

/**
 * The explicit "remember ..." path (Story 13.4): Haiku extracts with `forceStated`,
 * `validateFiling` checks, each accepted item is filed. Bounded by the filing timeout;
 * any failure, timeout, or empty result yields a receipt with `items: []` (the web says
 * "Couldn't save that to memory."). Never throws, never an `error` event.
 */
async function fileExplicitly(deps: ChatExchangeDeps, text: string, userTurn: StoredChatTurn | undefined): Promise<RememberedReceipt> {
  const failed: RememberedReceipt = { receiptId: randomUUID(), kind: "remembered", items: [] };
  const store = deps.memoryItems;
  if (!store) return failed;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("memory filing timed out")), deps.memoryFilingTimeoutMs ?? MEMORY_FILING_TIMEOUT_MS);
    });
    const filing = (async (): Promise<RememberedReceipt> => {
      const alwaysLoaded = store.listItems({ folders: ALWAYS_LOADED_FOLDERS, status: ["current"] });
      const candidates = await extractMemories(deps.memoryLlmClient ?? deps.llmClient, text, alwaysLoaded, { forceStated: true }, deps.connection);
      const { accepted } = validateFiling(candidates, { now: deps.now(), timeZone: deps.timeZone, forceStated: true });
      if (accepted.length === 0) return failed;
      const filed = accepted.map((c) => fileCandidate(store, c, userTurn?.id));
      const receipt: RememberedReceipt = {
        receiptId: randomUUID(),
        kind: "remembered",
        items: filed.map((i) => ({
          id: i.id,
          text: i.text,
          folder: i.folder,
          ...(i.scope !== undefined ? { scope: i.scope } : {}),
          ...(i.expiresOn !== undefined ? { expiresOn: i.expiresOn } : {}),
        })),
      };
      if (userTurn) {
        store.putReceipt({
          receiptId: receipt.receiptId,
          conversationId: userTurn.conversationId,
          userTurnId: userTurn.id,
          kind: "remembered",
          itemIds: filed.map((i) => i.id),
          chainIds: filed.map((i) => i.id),
          createdAt: deps.now().toISOString(),
        });
      }
      return receipt;
    })();
    filing.catch(() => {}); // a late failure after the timeout must not go unhandled
    return await Promise.race([filing, timeout]);
  } catch (error) {
    deps.log?.({ level: "warn", event: "chat-exchange.memory-filing-failed", detail: describe(error) });
    return failed;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fileCandidate(store: NonNullable<ChatExchangeDeps["memoryItems"]>, c: MemoryCandidate, sourceTurnId: string | undefined) {
  const next = {
    folder: c.folder,
    text: c.text,
    origin: c.origin,
    ...(c.scope !== undefined ? { scope: c.scope } : {}),
    ...(c.expiresOn !== undefined ? { expiresOn: c.expiresOn } : {}),
    ...(c.entityRef !== undefined ? { entityRef: c.entityRef } : {}),
    ...(sourceTurnId !== undefined ? { sourceTurnId } : {}),
    // ruleChange stays "none" until T9.
  };
  const replaces = [c.restatesId, c.contradictsId].find((id) => id !== undefined && store.getItem(id)?.status === "current");
  return replaces !== undefined ? store.supersede(replaces, next) : store.insert(next);
}

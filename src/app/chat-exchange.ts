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
import { isTrivialTurn, MEMORY_FILING_TIMEOUT_MS, planFilingActions, validateFiling, type FilingAction } from "../core/memory-filing.ts";
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
    emit({ type: "remembered", receipt: await fileExplicitly(deps, directive.text, userTurn) });
  } else if (
    !directive &&
    deps.memoryItems &&
    !isTrivialTurn(input.message, { handledDeterministically: handledDeterministically === true, isStructuredAnswer: false })
  ) {
    // Story 13.5: automatic filing. Failure, timeout, or nothing worth filing shows nothing.
    try {
      const receipt = await fileMemories(deps, input.message.trim(), userTurn, false);
      if (receipt) emit({ type: "remembered", receipt });
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
async function fileExplicitly(deps: ChatExchangeDeps, text: string, userTurn: StoredChatTurn | undefined): Promise<RememberedReceipt> {
  const failed: RememberedReceipt = { receiptId: randomUUID(), kind: "remembered", items: [] };
  try {
    return (await fileMemories(deps, text, userTurn, true)) ?? failed;
  } catch (error) {
    deps.log?.({ level: "warn", event: "chat-exchange.memory-filing-failed", detail: describe(error) });
    return failed;
  }
}

/**
 * One filing pass shared by the explicit and automatic paths: Haiku extracts from Spencer's
 * typed text plus the always-loaded set (never the reply), `validateFiling` checks,
 * `planFilingActions` maps restate/contradict to supersede, each item is filed and a receipt
 * stored. Bounded by the filing timeout. Resolves `undefined` when nothing was accepted;
 * rejects on failure or timeout (the caller decides what that looks like).
 */
async function fileMemories(
  deps: ChatExchangeDeps,
  text: string,
  userTurn: StoredChatTurn | undefined,
  forceStated: boolean,
): Promise<RememberedReceipt | undefined> {
  const store = deps.memoryItems;
  if (!store) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("memory filing timed out"));
      }, deps.memoryFilingTimeoutMs ?? MEMORY_FILING_TIMEOUT_MS);
    });
    const filing = (async (): Promise<RememberedReceipt | undefined> => {
      const alwaysLoaded = store.listItems({ folders: ALWAYS_LOADED_FOLDERS, status: ["current"] });
      const candidates = await extractMemories(deps.memoryLlmClient ?? deps.llmClient, text, alwaysLoaded, { forceStated }, deps.connection);
      // A late extract (after the timeout) or an aborted stream must not write: no receipt means no Undo.
      if (timedOut || deps.isAborted?.() === true) return undefined;
      const { accepted } = validateFiling(candidates, { now: deps.now(), timeZone: deps.timeZone, forceStated });
      if (accepted.length === 0) return undefined;
      const filed = planFilingActions(accepted, alwaysLoaded).map((a) =>
        fileCandidate(store, a, userTurn?.id),
      );
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
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fileCandidate(store: NonNullable<ChatExchangeDeps["memoryItems"]>, action: FilingAction, sourceTurnId: string | undefined) {
  const c = action.candidate;
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
  return action.kind === "supersede" && action.targetId !== undefined ? store.supersede(action.targetId, next) : store.insert(next);
}

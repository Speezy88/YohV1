/**
 * web/src/lib/chatStream.ts
 *
 * Story 8.5, AD-18, contract C6: sends one chat turn as `POST /api/chat`
 * and parses the `text/event-stream` body into `ChatStreamEvent`s. There is
 * no `EventSource` for POST, so this is a small SSE-over-fetch parser of its
 * own; `eventBus.ts` stays the one `EventSource` (hints only). The request
 * goes through the typed Hono RPC client (AD-17's "the ONE way web/ talks to
 * the server"), then reads `.body` instead of `.json()`.
 */
import { apiClient } from "./apiClient.ts";
import type { ChatStreamEvent, ChatTurnRequest } from "../../../src/types/api.ts";

export interface StreamChatHandlers {
  onEvent(event: ChatStreamEvent): void;
}

/**
 * Parses a `text/event-stream` byte stream, calling `onEvent` for each
 * complete block (lines up to a blank line) that carries `data:`. Works
 * line by line over a carried-over buffer, so a chunk boundary anywhere —
 * mid-line, mid-character, or between a block's two newlines — never loses
 * or corrupts a block. Comment lines (`: keep-alive`) are skipped; a block
 * the stream ends without terminating is dropped, per the SSE spec.
 */
export async function parseSseStream(body: ReadableStream<Uint8Array>, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const takeLine = (rawLine: string): void => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      if (dataLines.length > 0) onEvent(JSON.parse(dataLines.join("\n")) as ChatStreamEvent);
      dataLines = [];
      return;
    }
    if (line.startsWith("data:")) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    // `event:` names the type, which the JSON payload already carries; `id:`, `retry:`, and comments are unused here.
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      takeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (done) return;
  }
}

/**
 * Sends one chat turn and relays its `ChatStreamEvent`s to
 * `handlers.onEvent` as they arrive. Resolves once the stream has delivered
 * its terminal `done`/`error` event. A well-formed `error` event is a
 * handled outcome, so it resolves too. It rejects only for a transport
 * failure: the fetch failing, a JSON failure envelope instead of a stream,
 * or a stream that ends before its terminal event (a dropped connection).
 */
export async function streamChat(request: ChatTurnRequest, handlers: StreamChatHandlers): Promise<void> {
  const res = await apiClient.api.chat.$post({ json: request });
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/event-stream") || !res.body) {
    const envelope = (await res.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
    throw new Error(envelope?.error?.message ?? `chat: unexpected response (HTTP ${res.status})`);
  }
  let settled = false;
  await parseSseStream(res.body, (event) => {
    if (event.type === "done" || event.type === "error") settled = true;
    handlers.onEvent(event);
  });
  if (!settled) throw new Error("chat: the reply stream ended before Yoh finished");
}

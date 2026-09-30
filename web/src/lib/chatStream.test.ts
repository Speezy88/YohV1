/**
 * web/src/lib/chatStream.test.ts — Story 8.5: the SSE-over-fetch parser for
 * `POST /api/chat` (there is no EventSource for POST), and `streamChat`'s
 * split between a handled outcome (a well-formed `error` event) and a
 * genuine transport failure (a rejection).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSseStream, streamChat } from "./chatStream.ts";
import type { ChatStreamEvent } from "../../../src/types/api.ts";

function sseStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i++;
    },
  });
}

function block(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

const DONE: ChatStreamEvent = { type: "done", response: { reply: "Hi", receipts: [] } };
const NOT_CONFIGURED: ChatStreamEvent = { type: "error", error: { kind: "unreachable", message: "server: chat dependencies not configured" } };

describe("parseSseStream", () => {
  it("parses event/data blocks in order, even when a chunk boundary splits a data: line itself", async () => {
    const events: ChatStreamEvent[] = [];
    const raw = block({ type: "status", text: "Thinking…" }) + block({ type: "delta", text: "Hi" }) + block(DONE);
    const splitAt = raw.indexOf('"delta"') + 3; // mid-`data:` line of the second block
    await parseSseStream(sseStream([raw.slice(0, splitAt), raw.slice(splitAt)]), (e) => events.push(e));
    expect(events).toEqual([{ type: "status", text: "Thinking…" }, { type: "delta", text: "Hi" }, DONE]);
  });

  it("survives a chunk boundary between the two newlines that end a block, and a multi-byte character split across chunks", async () => {
    const events: ChatStreamEvent[] = [];
    const raw = block({ type: "status", text: "Thinking…" }) + block(DONE);
    const bytes = new TextEncoder().encode(raw);
    const ellipsisAt = new TextEncoder().encode(raw.slice(0, raw.indexOf("…"))).length + 1; // inside the 3-byte "…"
    const blankAt = new TextEncoder().encode(raw.slice(0, raw.indexOf("\n\n") + 1)).length;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, ellipsisAt));
        controller.enqueue(bytes.slice(ellipsisAt, blankAt));
        controller.enqueue(bytes.slice(blankAt));
        controller.close();
      },
    });
    await parseSseStream(body, (e) => events.push(e));
    expect(events).toEqual([{ type: "status", text: "Thinking…" }, DONE]);
  });

  it("accepts CRLF line endings", async () => {
    const events: ChatStreamEvent[] = [];
    await parseSseStream(sseStream([block(DONE).replace(/\n/g, "\r\n")]), (e) => events.push(e));
    expect(events).toEqual([DONE]);
  });

  it("ignores a comment-only (keep-alive) block", async () => {
    const events: ChatStreamEvent[] = [];
    await parseSseStream(sseStream([": keep-alive\n\n", block(DONE)]), (e) => events.push(e));
    expect(events).toEqual([DONE]);
  });

  it("parses the single error-only stream the server sends when chat isn't configured", async () => {
    const events: ChatStreamEvent[] = [];
    await parseSseStream(sseStream([block(NOT_CONFIGURED)]), (e) => events.push(e));
    expect(events).toEqual([NOT_CONFIGURED]);
  });
});

describe("streamChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(response: Response | Error) {
    const fetchMock = response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("POSTs the request as JSON to /api/chat and relays each event in order", async () => {
    const fetchMock = stubFetch(new Response(sseStream([block({ type: "delta", text: "ok" }), block(DONE)]), { headers: { "Content-Type": "text/event-stream" } }));
    const events: ChatStreamEvent[] = [];
    await streamChat({ message: "hi" }, { onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: "delta", text: "ok" }, DONE]);
    const [url, init] = fetchMock.mock.calls[0]! as [string | URL, RequestInit];
    expect(String(url)).toMatch(/\/api\/chat$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ message: "hi" });
  });

  it("resolves for a well-formed error event — a handled outcome, not a transport failure", async () => {
    stubFetch(new Response(sseStream([block(NOT_CONFIGURED)]), { headers: { "Content-Type": "text/event-stream" } }));
    const events: ChatStreamEvent[] = [];
    await expect(streamChat({ message: "hi" }, { onEvent: (e) => events.push(e) })).resolves.toBeUndefined();
    expect(events).toEqual([NOT_CONFIGURED]);
  });

  it("rejects when the fetch itself fails", async () => {
    stubFetch(new Error("network down"));
    await expect(streamChat({ message: "hi" }, { onEvent: () => {} })).rejects.toThrow("network down");
  });

  it("rejects with the envelope's message when the server answers with a JSON failure instead of a stream", async () => {
    stubFetch(
      new Response(JSON.stringify({ ok: false, error: { kind: "validation", message: "chat: missing message" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(streamChat({ message: "hi" }, { onEvent: () => {} })).rejects.toThrow("chat: missing message");
  });

  it("rejects when the stream ends without a done or error event (the connection dropped mid-reply)", async () => {
    stubFetch(new Response(sseStream([block({ type: "delta", text: "Sure, I" })]), { headers: { "Content-Type": "text/event-stream" } }));
    const events: ChatStreamEvent[] = [];
    await expect(streamChat({ message: "hi" }, { onEvent: (e) => events.push(e) })).rejects.toThrow(/ended before/);
    expect(events).toEqual([{ type: "delta", text: "Sure, I" }]);
  });
});

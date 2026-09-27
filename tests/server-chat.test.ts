/**
 * Tests for `POST /api/chat` (Story 8.5, AD-18, contract C5): the route
 * streams `chatTurn`'s `status`/`delta` events on the request's own SSE
 * response, then exactly one terminal `done`/`error` event built from
 * `chatTurn`'s settled `Result`. `runChatStream` is driven with a fake
 * stream; the route through Hono's `app.request(...)` with the
 * `runChatTurn` test seam (controller ruling (c)) — never a real Claude
 * call. (`GET /api/events` lives in `tests/server-events.test.ts`.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import type { ChatSession } from "../src/app/chat-session.ts";
import type { ChatTurnDeps } from "../src/app/chat-turn.ts";
import { createApp, runChatStream, startServer, type ChatSseStreamLike, type ChatTurnFn, type ServerDeps } from "../src/shell/server.ts";
import type { ChatStreamEvent, ChatTurnRequest } from "../src/types/api.ts";

const REQUEST: ChatTurnRequest = { message: "hi", history: [{ role: "user", content: "hi" }] };

function fakeChatStream(options: { rejectWrites?: boolean; aborted?: boolean } = {}) {
  const events: Array<{ event: string; data: string }> = [];
  const stream: ChatSseStreamLike = {
    aborted: options.aborted ?? false,
    writeSSE: async (m) => {
      if (options.rejectWrites) throw new Error("client disconnected");
      events.push({ event: m.event, data: m.data });
    },
  };
  return { stream, events };
}

/** The `data:` payloads of an SSE body, parsed — one per event block. */
function parseSseBody(text: string): ChatStreamEvent[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) =>
      JSON.parse(
        block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n"),
      ) as ChatStreamEvent,
    );
}

function chatApp(chat: ServerDeps["chat"], extra: Partial<ServerDeps> = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const app = createApp({ connection, log: () => {}, ...(chat ? { chat } : {}), ...extra });
  return { app, connection };
}

function postChat(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** A `ServerDeps["chat"]` whose only meaningful field is the `runChatTurn` seam — the real `chatTurn` deps are never read by a fake. */
function seamOnly(runChatTurn: ChatTurnFn): NonNullable<ServerDeps["chat"]> {
  return { runChatTurn } as unknown as NonNullable<ServerDeps["chat"]>;
}

// ---------------------------------------------------------------------------
// runChatStream
// ---------------------------------------------------------------------------

test("runChatStream relays chatTurn's status/delta events in order, then exactly one done event", async () => {
  const { stream, events } = fakeChatStream();
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    deps.emit?.({ type: "status", text: "Thinking…" });
    deps.emit?.({ type: "delta", text: "Hel" });
    deps.emit?.({ type: "delta", text: "lo" });
    return { ok: true, value: { reply: "Hello", receipts: [] } };
  };
  await runChatStream(stream, {} as ChatTurnDeps, REQUEST, fakeChatTurn);
  assert.deepEqual(
    events.map((e) => e.event),
    ["status", "delta", "delta", "done"],
  );
  assert.deepEqual(JSON.parse(events[1]!.data), { type: "delta", text: "Hel" });
  assert.deepEqual(JSON.parse(events[3]!.data), { type: "done", response: { reply: "Hello", receipts: [] } });
});

test("runChatStream hands chatTurn the request unchanged and the deps plus its own emit", async () => {
  const { stream } = fakeChatStream();
  let seen: { deps: ChatTurnDeps; input: ChatTurnRequest } | undefined;
  const fakeChatTurn: ChatTurnFn = async (deps, input) => {
    seen = { deps, input };
    return { ok: true, value: { reply: "", receipts: [] } };
  };
  const session: ChatSession = { recentMessages: [], lastSearchAnswer: undefined };
  await runChatStream(stream, { session } as ChatTurnDeps, REQUEST, fakeChatTurn);
  assert.equal(seen?.input, REQUEST);
  assert.equal(seen?.deps.session, session);
  assert.equal(typeof seen?.deps.emit, "function");
});

test("a Result failure from chatTurn becomes exactly one error event, never a hang", async () => {
  const { stream, events } = fakeChatStream();
  const fakeChatTurn: ChatTurnFn = async () => ({ ok: false, error: { kind: "unreachable", message: "llm down", detail: { raw: "internals" } } });
  await runChatStream(stream, {} as ChatTurnDeps, REQUEST, fakeChatTurn);
  assert.deepEqual(
    events.map((e) => e.event),
    ["error"],
  );
  // `detail` (a raw adapter error) never crosses the wire — same rule as `wire()`.
  assert.deepEqual(JSON.parse(events[0]!.data), { type: "error", error: { kind: "unreachable", message: "llm down" } });
});

test("a thrown error inside chatTurn becomes exactly one error event (never propagates)", async () => {
  const { stream, events } = fakeChatStream();
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    deps.emit?.({ type: "status", text: "Thinking…" });
    throw new Error("boom");
  };
  await runChatStream(stream, {} as ChatTurnDeps, REQUEST, fakeChatTurn);
  assert.deepEqual(
    events.map((e) => e.event),
    ["status", "error"],
  );
  assert.deepEqual(JSON.parse(events[1]!.data), { type: "error", error: { kind: "unreachable", message: "boom" } });
});

test("every stream ends in exactly one terminal event even when chatTurn emits nothing", async () => {
  const { stream, events } = fakeChatStream();
  const fakeChatTurn: ChatTurnFn = async () => ({ ok: true, value: { reply: "", receipts: [] } });
  await runChatStream(stream, {} as ChatTurnDeps, REQUEST, fakeChatTurn);
  assert.deepEqual(
    events.map((e) => e.event),
    ["done"],
  );
});

test("a delta emitted synchronously right before chatTurn settles is still written before the terminal event", async () => {
  // Hono's writeSSE is async; the relay must serialize writes so an
  // unawaited emit can never land after `done`.
  const events: string[] = [];
  const stream: ChatSseStreamLike = {
    writeSSE: async (m) => {
      await new Promise((resolve) => setTimeout(resolve, m.event === "delta" ? 5 : 0));
      events.push(m.event);
    },
  };
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    deps.emit?.({ type: "delta", text: "late" });
    return { ok: true, value: { reply: "late", receipts: [] } };
  };
  await runChatStream(stream, {} as ChatTurnDeps, REQUEST, fakeChatTurn);
  assert.deepEqual(events, ["delta", "done"]);
});

test("a disconnected stream (writeSSE rejecting) never throws out of runChatStream", async () => {
  const { stream } = fakeChatStream({ rejectWrites: true });
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    deps.emit?.({ type: "status", text: "Thinking…" });
    return { ok: true, value: { reply: "Hello", receipts: [] } };
  };
  await assert.doesNotReject(() => runChatStream(stream, {} as ChatTurnDeps, REQUEST, fakeChatTurn));
});

test("once the client has disconnected (stream.aborted), nothing more is written", async () => {
  const { stream, events } = fakeChatStream({ aborted: true });
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    deps.emit?.({ type: "delta", text: "nobody is listening" });
    return { ok: true, value: { reply: "x", receipts: [] } };
  };
  await runChatStream(stream, {} as ChatTurnDeps, REQUEST, fakeChatTurn);
  assert.deepEqual(events, []);
});

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------

test("POST /api/chat with no chat deps configured streams a single unreachable error event", async () => {
  const { app, connection } = chatApp(undefined);
  const res = await postChat(app, REQUEST);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /^event: error\n/);
  assert.deepEqual(parseSseBody(text), [
    { type: "error", error: { kind: "unreachable", message: "server: chat dependencies not configured" } },
  ]);
  connection.close();
});

test("POST /api/chat streams chatTurn's events over real SSE framing, ending in one done event", async () => {
  const fakeChatTurn: ChatTurnFn = async (deps, input) => {
    deps.emit?.({ type: "status", text: "Thinking…" });
    deps.emit?.({ type: "delta", text: "echo: " });
    deps.emit?.({ type: "delta", text: input.message });
    return { ok: true, value: { reply: `echo: ${input.message}`, receipts: ["Saved."] } };
  };
  const { app, connection } = chatApp(seamOnly(fakeChatTurn));
  const res = await postChat(app, REQUEST);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const text = await res.text();
  assert.deepEqual(
    [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]),
    ["status", "delta", "delta", "done"],
  );
  assert.deepEqual(parseSseBody(text).at(-1), { type: "done", response: { reply: "echo: hi", receipts: ["Saved."] } });
  connection.close();
});

test("POST /api/chat: a thrown error inside chatTurn still ends the stream in exactly one error event", async () => {
  const { app, connection } = chatApp(
    seamOnly(async () => {
      throw new Error("kaboom");
    }),
  );
  const text = await (await postChat(app, REQUEST)).text();
  assert.deepEqual(parseSseBody(text), [{ type: "error", error: { kind: "unreachable", message: "kaboom" } }]);
  connection.close();
});

test("every POST /api/chat request shares the ONE ChatSession the server process was given (ruling (a))", async () => {
  const sessions: ChatSession[] = [];
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    sessions.push(deps.session);
    return { ok: true, value: { reply: "", receipts: [] } };
  };
  const chatSession: ChatSession = { recentMessages: [], lastSearchAnswer: undefined };
  const { app, connection } = chatApp(seamOnly(fakeChatTurn), { chatSession });
  await (await postChat(app, REQUEST)).text();
  await (await postChat(app, { message: "again", history: [] })).text();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0], chatSession);
  assert.equal(sessions[1], chatSession);
  connection.close();
});

test("without an explicit chatSession, one app still reuses one session across requests", async () => {
  const sessions: ChatSession[] = [];
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    sessions.push(deps.session);
    return { ok: true, value: { reply: "", receipts: [] } };
  };
  const { app, connection } = chatApp(seamOnly(fakeChatTurn));
  await (await postChat(app, REQUEST)).text();
  await (await postChat(app, REQUEST)).text();
  assert.equal(sessions[0], sessions[1]);
  assert.deepEqual(sessions[0], { recentMessages: [], lastSearchAnswer: undefined });
  connection.close();
});

test("POST /api/chat passes the configured chat deps through to chatTurn, never the runChatTurn seam itself", async () => {
  let seen: ChatTurnDeps | undefined;
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    seen = deps;
    return { ok: true, value: { reply: "", receipts: [] } };
  };
  const chat = { timeZone: "UTC", runChatTurn: fakeChatTurn } as unknown as ServerDeps["chat"];
  const { app, connection } = chatApp(chat);
  await (await postChat(app, REQUEST)).text();
  assert.equal(seen?.timeZone, "UTC");
  assert.equal("runChatTurn" in (seen ?? {}), false);
  connection.close();
});

test("POST /api/chat rejects a missing or blank message with a plain 400 validation envelope (not a stream)", async () => {
  const { app, connection } = chatApp(seamOnly(async () => ({ ok: true, value: { reply: "", receipts: [] } })));
  for (const body of [{}, { message: "   ", history: [] }, { message: 42 }]) {
    const res = await postChat(app, body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: { kind: "validation", message: "chat: missing message" } });
  }
  connection.close();
});

test("POST /api/chat rejects a malformed history with a 400 validation envelope", async () => {
  const { app, connection } = chatApp(seamOnly(async () => ({ ok: true, value: { reply: "", receipts: [] } })));
  for (const history of ["nope", [{ role: "system", content: "x" }], [{ role: "user" }]]) {
    const res = await postChat(app, { message: "hi", history });
    assert.equal(res.status, 400, JSON.stringify(history));
    assert.deepEqual(await res.json(), { ok: false, error: { kind: "validation", message: "chat: malformed history" } });
  }
  connection.close();
});

test("startServer threads the chat feature through and builds ONE ChatSession for the process (contract C3)", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const sessions: ChatSession[] = [];
  const fakeChatTurn: ChatTurnFn = async (deps) => {
    sessions.push(deps.session);
    return { ok: true, value: { reply: "", receipts: [] } };
  };
  let fetchFn: ((request: Request) => Response | Promise<Response>) | undefined;
  const serveFn = (options: { fetch: (request: Request) => Response | Promise<Response> }) => {
    fetchFn = options.fetch;
    return { close: () => {} };
  };
  startServer(connection, {}, serveFn, { chat: seamOnly(fakeChatTurn) });
  const request = () =>
    new Request("http://127.0.0.1/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(REQUEST) });
  await (await fetchFn!(request())).text();
  await (await fetchFn!(request())).text();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0], sessions[1]);
  connection.close();
});

test("POST /api/chat with the REAL chatTurn streams the general-question reply as deltas from the LLM stream, then done", async () => {
  // A fake Anthropic client: the classifier call (non-streaming) gets text
  // that isn't a search trigger; the general-question call streams words.
  const llmClient = {
    messages: {
      create: async (params: { stream?: boolean }) => {
        if (params.stream) {
          return (async function* () {
            for (const word of ["Hello", "from", "Yoh."]) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${word} ` } };
          })();
        }
        return { content: [{ type: "text", text: '{"kind":"general-question"}' }] };
      },
    },
  };
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const chat = { store: {}, timeZone: "UTC", now: () => new Date(), llmClient } as unknown as ServerDeps["chat"];
  const app = createApp({ connection, log: () => {}, ...(chat ? { chat } : {}) });
  const events = parseSseBody(await (await postChat(app, { message: "tell me something", history: [{ role: "user", content: "tell me something" }] })).text());
  assert.deepEqual(events[0], { type: "status", text: "Thinking…" });
  const deltas = events.filter((e): e is Extract<ChatStreamEvent, { type: "delta" }> => e.type === "delta").map((e) => e.text);
  assert.deepEqual(deltas, ["Hello ", "from ", "Yoh. "]);
  const last = events.at(-1);
  assert.equal(last?.type, "done");
  assert.equal(last?.type === "done" ? last.response.reply : undefined, deltas.join(""));
  assert.equal(events.filter((e) => e.type === "done" || e.type === "error").length, 1);
  connection.close();
});

test("POST /api/chat treats an absent history as empty", async () => {
  let seenInput: ChatTurnRequest | undefined;
  const { app, connection } = chatApp(
    seamOnly(async (_deps, input) => {
      seenInput = input;
      return { ok: true, value: { reply: "", receipts: [] } };
    }),
  );
  await (await postChat(app, { message: "hi" })).text();
  assert.deepEqual(seenInput, { message: "hi", history: [] });
  connection.close();
});

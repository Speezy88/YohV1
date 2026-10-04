import { test } from "node:test";
import assert from "node:assert/strict";
import { extractExportCandidates } from "../src/adapters/claude-export-llm.ts";
import { CLAUDE_CHAT_MODEL_FAST, type AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";

interface SeenCall {
  model: string;
  max_tokens: number;
  system: string;
  user: string;
}

function fakeClient(reply: string, seen: SeenCall[]): AnthropicMessagesClient {
  return {
    messages: {
      create: async (params: { model: string; max_tokens: number; system: string; messages: { content: string }[] }) => {
        seen.push({ model: params.model, max_tokens: params.max_tokens, system: params.system, user: params.messages[0]?.content ?? "" });
        return { content: [{ type: "text", text: reply }], usage: { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: null, cache_read_input_tokens: null } };
      },
    },
  } as unknown as AnthropicMessagesClient;
}

test("conversations: sends the batch to Haiku and returns stage 2 candidates with usage", async () => {
  const seen: SeenCall[] = [];
  const client = fakeClient('[{"folder":"about-you","text":"Runs most mornings.","date":"2025-11-02"}]', seen);
  const r = await extractExportCandidates(client, "conversations", "### Conversation (2025-11-02): Morning\n- I run most mornings.");
  assert.deepEqual(r.candidates, [{ folder: "about-you", text: "Runs most mornings.", stage: 2, sourceDate: "2025-11-02" }]);
  assert.deepEqual(r.usage, { model: CLAUDE_CHAT_MODEL_FAST, inputTokens: 1200, outputTokens: 80, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.model, CLAUDE_CHAT_MODEL_FAST);
  assert.match(seen[0]?.user ?? "", /I run most mornings/);
  assert.match(seen[0]?.system ?? "", /messages Spencer wrote/);
  assert.match(seen[0]?.system ?? "", /about-you/);
});

test("distilled: stage 1 candidates and a larger output budget", async () => {
  const seen: SeenCall[] = [];
  const r = await extractExportCandidates(fakeClient('[{"folder":"goals-projects","text":"Is building Yoh."}]', seen), "distilled", "### Claude's saved memory\nBuilds Yoh.");
  assert.deepEqual(r.candidates, [{ folder: "goals-projects", text: "Is building Yoh.", stage: 1 }]);
  const conv: SeenCall[] = [];
  await extractExportCandidates(fakeClient("[]", conv), "conversations", "x");
  assert.ok((seen[0]?.max_tokens ?? 0) > (conv[0]?.max_tokens ?? 0));
  assert.match(seen[0]?.system ?? "", /saved notes/);
});

test("a reply with no JSON array yields undefined candidates but still reports usage", async () => {
  const r = await extractExportCandidates(fakeClient("Sorry, nothing here.", []), "conversations", "x");
  assert.equal(r.candidates, undefined);
  assert.equal(r.usage.inputTokens, 1200);
});

test("a transport error throws", async () => {
  const client = { messages: { create: async () => { throw new Error("network down"); } } } as unknown as AnthropicMessagesClient;
  await assert.rejects(() => extractExportCandidates(client, "conversations", "x"), /network down/);
});

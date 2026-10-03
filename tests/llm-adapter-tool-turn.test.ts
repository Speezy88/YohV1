import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_AGENT_MODEL, runToolTurn, type AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { CHAT_TOOLS } from "../src/core/chat-tools.ts";

function fakeClient(content: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: (async (params: Record<string, unknown>) => {
        calls.push(params);
        return { content, usage: { input_tokens: 1, output_tokens: 1 } };
      }) as unknown as AnthropicMessagesClient["messages"]["create"],
    },
  };
  return { client, calls };
}

test("runToolTurn sends the tools and returns text and tool uses", async () => {
  const { client, calls } = fakeClient([
    { type: "text", text: "Checking." },
    { type: "tool_use", id: "tu_1", name: "list_tasks", input: { dueFrom: "2026-10-05", dueTo: "2026-10-05" } },
  ]);
  const result = await runToolTurn(client, { systemPrompt: "sys", messages: [{ role: "user", content: "hi" }], tools: CHAT_TOOLS });
  assert.equal(result.text, "Checking.");
  assert.deepEqual(result.toolUses, [{ id: "tu_1", name: "list_tasks", input: { dueFrom: "2026-10-05", dueTo: "2026-10-05" } }]);
  assert.equal(result.assistantContent.length, 2);
  assert.equal(calls[0]!["model"], CHAT_AGENT_MODEL);
  assert.equal((calls[0]!["tools"] as unknown[]).length, CHAT_TOOLS.length);
});

test("runToolTurn returns empty text and no tool uses for an empty reply", async () => {
  const { client } = fakeClient([]);
  const result = await runToolTurn(client, { systemPrompt: "sys", messages: [{ role: "user", content: "hi" }], tools: CHAT_TOOLS });
  assert.deepEqual({ text: result.text, toolUses: result.toolUses }, { text: "", toolUses: [] });
});

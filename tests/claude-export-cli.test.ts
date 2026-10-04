import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { parseMemoryImport } from "../src/core/memory-import.ts";
import { runClaudeExportExtract } from "../src/shell/claude-export-cli.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/claude-export", import.meta.url));

function world() {
  const dir = mkdtempSync(join(tmpdir(), "yoh-export-"));
  const exportDir = join(dir, "export");
  cpSync(FIXTURE, exportDir, { recursive: true });
  const printed: string[] = [];
  return { dir, exportDir, outPath: join(dir, "candidates.md"), printed, print: (l: string) => void printed.push(l) };
}

/** Replies are chosen by what the call contains, so the test does not depend on call order. */
function fakeClient(replyFor: (user: string) => string | Error): { client: AnthropicMessagesClient; users: string[] } {
  const users: string[] = [];
  const client = {
    messages: {
      create: async (params: { messages: { content: string }[] }) => {
        const user = params.messages[0]?.content ?? "";
        users.push(user);
        const reply = replyFor(user);
        if (reply instanceof Error) throw reply;
        return { content: [{ type: "text", text: reply }], usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
      },
    },
  } as unknown as AnthropicMessagesClient;
  return { client, users };
}

const DISTILLED_REPLY = '[{"folder":"goals-projects","text":"Is building Yoh on a Raspberry Pi."},{"folder":"feedback","text":"Wants short answers."}]';
const CONVERSATION_REPLY =
  '[{"folder":"about-you","text":"Runs most mornings before school.","date":"2025-11-02"},{"folder":"about-you","text":"Has a peanut allergy.","sensitive":"health","date":"2025-11-02"},{"folder":"goals-projects","text":"is building yoh on a raspberry pi","date":"2026-01-10"}]';
const goodReplies = (user: string): string => (user.includes("### Conversation (") ? CONVERSATION_REPLY : DISTILLED_REPLY);

test("writes a candidates file the import parser reads, merged across stages", async () => {
  const w = world();
  const { client, users } = fakeClient(goodReplies);
  const code = await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client, print: w.print });
  assert.equal(code, 0);
  assert.equal(users.length, 2);
  assert.ok(users.every((u) => !u.includes("swimming")), "the assistant's messages are never sent");
  const text = readFileSync(w.outPath, "utf8");
  const parsed = parseMemoryImport(text);
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.candidates.map((c) => [c.folder, c.text, c.sensitive]), [
    ["feedback", "Wants short answers.", undefined],
    ["about-you", "Runs most mornings before school.", undefined],
    ["about-you", "Has a peanut allergy.", "health"],
    ["goals-projects", "Is building Yoh on a Raspberry Pi.", undefined],
  ]);
  assert.match(text, /> Always-loaded folders: 3 lines here/);
  assert.ok(w.printed.some((l) => /2 conversations/.test(l) && /3 skipped/.test(l)));
  assert.ok(w.printed.some((l) => /Estimated cost: \$0\.\d\d/.test(l)));
  assert.ok(w.printed.some((l) => /Actual cost: \$0\.\d\d/.test(l)));
  rmSync(w.dir, { recursive: true });
});

test("a rerun uses the cache and makes no calls", async () => {
  const w = world();
  const first = fakeClient(goodReplies);
  await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: first.client, print: w.print });
  const before = readFileSync(w.outPath, "utf8");
  const second = fakeClient(() => new Error("must not be called"));
  const code = await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: second.client, print: w.print });
  assert.equal(code, 0);
  assert.equal(second.users.length, 0);
  assert.equal(readFileSync(w.outPath, "utf8"), before);
  rmSync(w.dir, { recursive: true });
});

test("a malformed reply and a transport error are not cached, and the next run retries only those", async () => {
  const w = world();
  const flaky = fakeClient((user) => (user.includes("### Conversation (") ? "I found nothing I can format." : new Error("network down")));
  const code = await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: flaky.client, print: w.print });
  assert.equal(code, 3);
  assert.equal(readdirSync(`${w.outPath}.cache`).length, 0);
  assert.ok(w.printed.some((l) => /2 of 2 calls failed/.test(l)));
  assert.ok(w.printed.every((l) => !l.includes("network down")), "raw error text is not printed");
  assert.ok(existsSync(w.outPath));

  const healed = fakeClient(goodReplies);
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: healed.client, print: w.print }), 0);
  assert.equal(healed.users.length, 2);
  assert.equal(readdirSync(`${w.outPath}.cache`).length, 2);
  rmSync(w.dir, { recursive: true });
});

test("an estimate over the limit stops before any call unless --yes was given", async () => {
  const w = world();
  // 6,000 conversations of 4,000 characters: about 6M input tokens, roughly $7 on Haiku.
  const big = Array.from({ length: 6000 }, (_, i) => ({ name: `c${i}`, updated_at: "2026-01-01T00:00:00Z", chat_messages: [{ sender: "human", text: `${i} `.padEnd(4000, "word ") }] }));
  writeFileSync(join(w.exportDir, "conversations.json"), JSON.stringify(big));
  const refused = fakeClient(() => "[]");
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: refused.client, print: w.print }), 2);
  assert.equal(refused.users.length, 0);
  assert.ok(w.printed.some((l) => /--yes/.test(l)));
  assert.equal(existsSync(w.outPath), false);

  const allowed = fakeClient(() => "[]");
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: true, client: allowed.client, print: w.print }), 0);
  assert.ok(allowed.users.length > 100);
  rmSync(w.dir, { recursive: true });
});

test("missing source files are reported and skipped; an empty export exits 1", async () => {
  const w = world();
  rmSync(join(w.exportDir, "memories.json"));
  rmSync(join(w.exportDir, "projects.json"));
  const only = fakeClient(goodReplies);
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: only.client, print: w.print }), 0);
  assert.equal(only.users.length, 1);
  assert.ok(w.printed.some((l) => /memories: not found/.test(l)));

  rmSync(join(w.exportDir, "conversations.json"));
  const none = fakeClient(goodReplies);
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: join(w.dir, "other.md"), yes: false, client: none.client, print: w.print }), 1);
  assert.equal(none.users.length, 0);
  rmSync(w.dir, { recursive: true });
});
test("reads the per-category layout: one file per project and memory, conversations in a folder", async () => {
  const w = world();
  const from = (name: string): unknown[] => JSON.parse(readFileSync(join(w.exportDir, name), "utf8")) as unknown[];
  const split = join(w.dir, "split");
  mkdirSync(join(split, "projects", "projects"), { recursive: true });
  mkdirSync(join(split, "memories", "memories"), { recursive: true });
  mkdirSync(join(split, "conversations"), { recursive: true });
  from("projects.json").forEach((p, i) => writeFileSync(join(split, "projects", "projects", `p${i}.json`), JSON.stringify(p)));
  writeFileSync(join(split, "memories", "memories", "m0.json"), JSON.stringify(from("memories.json")[0]));
  writeFileSync(join(split, "conversations", "conversations.json"), JSON.stringify(from("conversations.json")));
  const { client, users } = fakeClient(goodReplies);
  const code = await runClaudeExportExtract({ exportDir: split, outPath: w.outPath, yes: false, client, print: w.print });
  assert.equal(code, 0);
  assert.equal(users.length, 2);
  assert.ok(users.some((u) => u.includes("Project instructions: Yoh") && u.includes("Claude's saved memory") && u.includes("Claude's memory file: preferences.md")));
  assert.ok(w.printed.every((l) => !/not found/.test(l)));
  rmSync(w.dir, { recursive: true });
});

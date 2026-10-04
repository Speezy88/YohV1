/**
 * The one model call of the Claude export extractor. Kept out of
 * `llm-adapter.ts`: it runs from a one-shot CLI with no Yoh database, so it
 * returns its usage to the caller instead of recording it in `llm_usage`.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { parseExtractedCandidates, type ExtractedCandidate } from "../core/claude-export.ts";
import type { LlmUsageCostRow } from "../core/llm-cost.ts";
import { MEMORY_FOLDERS_IN_ORDER, MEMORY_ITEM_MAX_CHARS } from "../core/memory-folders.ts";
import { CLAUDE_CHAT_MODEL_FAST, type AnthropicMessagesClient } from "./llm-adapter.ts";

export type ExportSourceKind = "distilled" | "conversations";

export interface ExportExtraction {
  /** Undefined when the reply held no JSON array. */
  readonly candidates: ExtractedCandidate[] | undefined;
  readonly usage: LlmUsageCostRow;
}

const CONVERSATIONS_MAX_TOKENS = 1500;
/** Saved memory and project instructions are dense; one call may yield dozens of facts. */
const DISTILLED_MAX_TOKENS = 4000;

function systemPrompt(kind: ExportSourceKind): string {
  return [
    "You extract durable facts about Spencer for Yoh, his daily-planning assistant.",
    kind === "distilled"
      ? "The input is another assistant's saved notes about Spencer and the instructions he wrote for his projects. Rewrite what is durable as separate facts."
      : "The input is messages Spencer wrote to another assistant, grouped by conversation; each heading carries the conversation's date. Return at most 5 facts for the whole input, and [] when nothing is durable.",
    'Reply with ONLY a JSON array (no prose). Each element: {"folder", "text", optional "sensitive", optional "date"}.',
    `folder is one of: ${MEMORY_FOLDERS_IN_ORDER.filter((f) => f !== "patterns").join(", ")}.`,
    "feedback: how he wants an assistant to respond. planning-preferences: how he likes to plan his days. corrections: things assistants get wrong about him. about-you: stable facts about him. goals-projects: goals and ongoing projects. decisions-commitments: decisions he has made and commitments he holds. ideas-notes: ideas he wants kept.",
    `text: one standalone sentence about Spencer with no pronoun for him ("Prefers ...", "Is training for ..."), at most ${MEMORY_ITEM_MAX_CHARS} characters.`,
    'sensitive: "health", "emotion" or "finance" when the fact is about those.',
    "date: the YYYY-MM-DD from the heading of the conversation the fact came from; leave it out when there is none.",
    "Leave out: one-off requests, facts about other people, anything time-bound that has likely passed, passwords and account numbers, and anything you would be guessing.",
  ].join("\n");
}

/** Malformed output yields `candidates: undefined`; only a transport error throws. */
export async function extractExportCandidates(client: AnthropicMessagesClient, kind: ExportSourceKind, content: string): Promise<ExportExtraction> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: kind === "distilled" ? DISTILLED_MAX_TOKENS : CONVERSATIONS_MAX_TOKENS,
    system: systemPrompt(kind),
    messages: [{ role: "user", content }],
  });
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return {
    candidates: parseExtractedCandidates(text, kind === "distilled" ? 1 : 2),
    usage: {
      model: CLAUDE_CHAT_MODEL_FAST,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}

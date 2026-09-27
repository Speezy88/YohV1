/**
 * src/app/web-search.ts
 *
 * Story 8.4 (FR-28, AD-14, AD-16). Runs one web search and renders the
 * result as plain/markdown text (never ANSI — the shell colors it). Moved
 * from `shell/chat-cli.ts`'s `handleSearchCommand` (Story 6.4). Sets
 * `deps.session.lastSearchAnswer` (Story 8.1's `ChatSession`, contract C3)
 * so a LATER turn's `saveSearchResult` (FR-29) can file it — the F5/Ruling-
 * R20 clearing rules (Epic 6 retro) apply unchanged: a failure OR a
 * legitimate empty result both CLEAR any earlier answer.
 */
import { errorCopy } from "../core/error-copy.ts";
import type { ChatSession } from "./chat-session.ts";
import type { ChatStreamEvent, ChatTurnResponse } from "../types/api.ts";
import type { Result, SearchAnswer, YohError } from "../types/domain.ts";

export type SearchFn = (query: string) => Promise<Result<SearchAnswer, YohError>>;

export interface WebSearchDeps {
  readonly session: ChatSession;
  readonly searchFn: SearchFn;
  readonly emit?: (event: ChatStreamEvent) => void;
}

export interface WebSearchInput {
  readonly query: string;
}

export async function searchWeb(deps: WebSearchDeps, input: WebSearchInput): Promise<Result<ChatTurnResponse, YohError>> {
  deps.emit?.({ type: "status", text: "Searching the web…" });
  const result = await deps.searchFn(input.query);

  if (!result.ok) {
    deps.session.lastSearchAnswer = undefined;
    return { ok: true, value: { reply: errorCopy(result.error, { service: "web search" }), receipts: [] } };
  }

  const { answer, citations } = result.value;
  if (answer.length === 0 && citations.length === 0) {
    deps.session.lastSearchAnswer = undefined;
    return { ok: true, value: { reply: "I searched but didn't find anything useful.", receipts: [] } };
  }

  deps.session.lastSearchAnswer = { query: input.query, answer: result.value };
  const sources = citations.length > 0 ? `\n\nSources:\n${citations.map((url) => `- ${url}`).join("\n")}` : "";
  return { ok: true, value: { reply: `${answer}${sources}`, receipts: [] } };
}

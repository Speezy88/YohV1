/**
 * src/app/save-search-result.ts
 *
 * Story 8.4 (FR-29, AD-3, AD-12, AD-16). Files `deps.session.lastSearchAnswer`
 * to the Research Vault directly — no Proposal, no confirm step (AD-3: the
 * "save that" request itself IS the confirmation). Kept deliberately
 * separate from `confirm-proposal.ts`'s path (Story 8.2's own AC: FR-29's
 * `createPage` call site stays separate and is never routed through it).
 * Moved from `shell/chat-cli.ts`'s `handleSaveSearchResultCommand` (Story
 * 6.5). This is the one file in Story 8.4 that itself calls `createPage`
 * (AD-16: only `app/` may) — no `shell/*.ts` file does (Story 8.4 removed
 * `chat-cli.ts` from `SHELL_WRITE_ALLOWLIST`; Story 8.9 then retired the
 * file itself).
 *
 * Task 6C: on a successful file, appends one `research` outbox hint (the
 * same `deps.connection?.writeTx(...)` convention `app/create-task.ts`'s
 * `tasks` hint already establishes) so the Research Hub page's list
 * refetches on the shared event bus (AD-18) — never a second EventSource,
 * and never a client-side poll.
 */
import { appendOutboxInTx } from "../adapters/notification-store.ts";
import { createPage } from "../adapters/notion-adapter.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopy } from "../core/error-copy.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { NotionCreatePageBindingFn } from "./create-item.ts";
import type { ChatSession } from "./chat-session.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

/** The outbox topic the Research Hub page refetches on. */
export const RESEARCH_TOPIC = "research";

export interface SaveSearchResultDeps {
  readonly session: ChatSession;
  readonly getNotionCreatePageBinding: NotionCreatePageBindingFn;
  readonly timeZone: string;
  readonly now: () => Date;
  /** For the one `research` outbox hint after a successful file. Absent: no hint (tests that don't care). */
  readonly connection?: SqliteConnection;
}

export async function saveSearchResult(deps: SaveSearchResultDeps, _input: Record<string, never>): Promise<Result<ChatTurnResponse, YohError>> {
  const lastSearchAnswer = deps.session.lastSearchAnswer;
  if (!lastSearchAnswer) {
    return { ok: true, value: { reply: "I don't have a recent search result to save — search for something first.", receipts: [] } };
  }

  const binding = deps.getNotionCreatePageBinding();
  if (!binding.ok) {
    return { ok: true, value: { reply: errorCopy(binding.error, { service: "Notion" }), receipts: [] } };
  }

  const properties: Record<string, string> = {
    title: lastSearchAnswer.query,
    keyFindings: lastSearchAnswer.answer.answer,
    query: lastSearchAnswer.query,
    searchDate: localIsoDate(deps.now(), deps.timeZone),
    sources: lastSearchAnswer.answer.citations.join("\n"),
  };

  const created = await createPage(binding.value.client, binding.value.config, "ResearchVault", properties);
  if (!created.ok) {
    return { ok: true, value: { reply: errorCopy(created.error, { service: "Notion" }), receipts: [] } };
  }

  deps.connection?.writeTx((db) => appendOutboxInTx(db, { topic: RESEARCH_TOPIC, entityId: created.value.pageId }));

  return { ok: true, value: { reply: "", receipts: [`Filed "${properties["title"]}" to the Research Vault.`] } };
}

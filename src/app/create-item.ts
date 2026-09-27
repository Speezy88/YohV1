/**
 * src/app/create-item.ts
 *
 * Story 8.4 (FR-26, AD-3, AD-12, AD-16). Drafts a new Notion page from
 * Spencer's free-text request, validates the draft against the target
 * database's LIVE schema (draft-time check, AD-12), and persists it as an
 * open Proposal via `open-proposal.ts` (Story 8.2) — never writes anything
 * itself and never blocks for a confirm line (`app/` is one-shot per turn,
 * AD-16). The actual `createPage` write happens later, on a separate turn,
 * from `confirm-proposal.ts`'s `"notion-page-draft"` branch (Story 8.2),
 * reached via `answerOpenItem`.
 *
 * Moved from `shell/chat-cli.ts`'s `handleCreateItemCommand` (Story 6.3),
 * restructured out of its blocking `io.readLine` confirm loop into this
 * one-shot shape. Its former receipt-building is gone too — `confirmProposal`
 * builds the "Created ... in ..." receipt itself, once Spencer answers.
 */
import { randomUUID } from "node:crypto";
import { draftNotionPageFields, type AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import { resolveNotionPageDraftProperties, type NotionCreatePageClient, type NotionCreatePageConfig } from "../adapters/notion-adapter.ts";
import { openProposal, type OpenProposalDeps } from "./open-proposal.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { NotionDatabaseTarget, NotionPageDraft, Proposal, Result, YohError } from "../types/domain.ts";

/**
 * The one place this task's code names `resolveNotionPageDraftProperties` —
 * no `shell/*.ts` file does, keeping it clear of AD-16's write-surface
 * scan (Story 8.4 removed `chat-cli.ts` from `SHELL_WRITE_ALLOWLIST`; Story
 * 8.9 then retired the file itself).
 * `undefined`-shaped as a `Result` failure (not a thrown error) so this
 * function never needs its own try/catch around a missing-config case.
 * Shared with `app/save-search-result.ts` (this task's other real
 * `NotionCreatePageBindingFn` consumer).
 */
export type NotionCreatePageBindingFn = () => Result<
  { readonly client: NotionCreatePageClient; readonly config: NotionCreatePageConfig },
  YohError
>;

export interface CreateItemDeps extends OpenProposalDeps {
  readonly llmClient: AnthropicMessagesClient;
  readonly getNotionCreatePageBinding: NotionCreatePageBindingFn;
  readonly now: () => Date;
}

export interface CreateItemInput {
  readonly database: NotionDatabaseTarget;
  readonly request: string;
}

/** Unchanged wording from the Phase 1.5 `chat-cli.ts` preview — now the Proposal's own `reason`, so whatever question text `openProposal` builds from it still shows the field-by-field breakdown. */
function describeDraft(database: NotionDatabaseTarget, properties: Readonly<Record<string, string>>): string {
  const lines = [`Here's what I'll create in ${database}:`];
  for (const [field, value] of Object.entries(properties)) lines.push(`  ${field}: ${value}`);
  return lines.join("\n");
}

export async function draftItem(deps: CreateItemDeps, input: CreateItemInput): Promise<Result<ChatTurnResponse, YohError>> {
  let fields: Record<string, string> | undefined;
  try {
    fields = await draftNotionPageFields(deps.llmClient, input.database, input.request);
  } catch {
    fields = undefined;
  }

  if (!fields) {
    return {
      ok: true,
      value: { reply: `I couldn't tell what you want in the new ${input.database} item — try naming it more directly.`, receipts: [] },
    };
  }

  const binding = deps.getNotionCreatePageBinding();
  if (!binding.ok) {
    return { ok: true, value: { reply: `I can't create that — ${binding.error.message}`, receipts: [] } };
  }

  const validated = await resolveNotionPageDraftProperties(binding.value.client, binding.value.config, input.database, fields);
  if (!validated.ok) {
    return { ok: true, value: { reply: `I can't create that — ${validated.error.message}`, receipts: [] } };
  }

  const draft: NotionPageDraft = { database: input.database, properties: fields };
  // A UUID, not `now().getTime()` — two drafts issued within the same
  // millisecond (or, in a test, against a frozen clock) must still mint
  // distinct ids, since this id doubles as the create-type Proposal's own
  // `entityId` (controller ruling, below).
  const proposalId = `create-${input.database}-${randomUUID()}`;
  const proposal: Proposal<NotionPageDraft> = {
    id: proposalId,
    kind: "notion-page-draft",
    // Controller ruling: a create-type Proposal is keyed by its OWN id, not
    // by `database` — two independent captures never conflict (openProposal's
    // conflict rule, Story 8.2/C4, is for a Proposal on an EXISTING entity).
    entityId: proposalId,
    entityVersion: "new",
    suggested: draft,
    reason: describeDraft(input.database, fields),
    createdAt: deps.now().toISOString(),
  };

  const opened = await openProposal(deps, { proposal });
  if (!opened.ok) {
    // Structurally unreachable today (a create-type Proposal never shares
    // its entityId with anything else), kept only because `openProposal`'s
    // return type is still `Result` — a future conflict source should not
    // have to re-add this branch.
    return {
      ok: true,
      value: { reply: `I'm already waiting on your answer about creating something in ${input.database} — answer that first.`, receipts: [] },
    };
  }

  // Final-review fix (Important #2): the "Create"/"Cancel" chip labels
  // (Story 8.8 AC3) are no longer relabeled here — `open-proposal.ts`'s own
  // return already carries them, via `core/open-item-questions.ts`'s
  // `buildProposalQuestion`, the ONE place every `"proposal"` question is
  // assembled (Controller Ruling 1). Relabeling only this direct-return
  // value (as this file used to) meant a later re-surface through
  // `app/surface-open-items.ts` regressed to generic Yes/No — moving the
  // relabeling into that one shared assembly point fixes it for every
  // caller at once.
  return { ok: true, value: { reply: "", receipts: [], question: opened.value } };
}

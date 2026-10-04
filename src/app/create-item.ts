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
import { draftNotionPageFields, DRAFT_NOTION_PAGE_DATE_FIELDS, type AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import { resolveNotionPageDraftProperties, type NotionCreatePageClient, type NotionCreatePageConfig } from "../adapters/notion-adapter.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { MemoryContext } from "../core/memory-context.ts";
import { errorCopy } from "../core/error-copy.ts";
import { resolveRelativeDate, resolveRelativeDateTime } from "../core/relative-date.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
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
  /** Spencer's IANA timezone — real-use fixes plan, Task 3: both `draftNotionPageFields`'s own prompt and this file's own deterministic date resolution below need it. Already supplied at the `chatTurn`-deps level (shared with `CalendarEditDeps`'s identical field). */
  readonly timeZone: string;
  /** Real-use fixes plan, Task 9: passed straight through to `draftNotionPageFields`'s own trailing `connection` argument so its usage gets recorded. Optional, mirroring every other Deps interface in this file's own capability. */
  readonly connection?: SqliteConnection;
}

export interface CreateItemInput {
  readonly database: NotionDatabaseTarget;
  readonly request: string;
  /** Story 13.6: what Yoh remembers; absent when the store is down. */
  readonly memory?: MemoryContext;
}

/** Unchanged wording from the Phase 1.5 `chat-cli.ts` preview — now the Proposal's own `reason`, so whatever question text `openProposal` builds from it still shows the field-by-field breakdown. */
function describeDraft(database: NotionDatabaseTarget, properties: Readonly<Record<string, string>>): string {
  const lines = [`Here's what I'll create in ${database}:`];
  for (const [field, value] of Object.entries(properties)) lines.push(`  ${field}: ${value}`);
  return lines.join("\n");
}

/**
 * Resolves ONE drafted date field's raw string value deterministically: an
 * already-valid ISO date/datetime passes through unchanged; a recognized
 * relative phrase (with or without a time-of-day) resolves to one;
 * anything else is `undefined`. Tries the time-aware form FIRST so a value
 * that carries both a date and a time (the incident: "tomorrow at 10:45
 * AM") resolves to a full datetime rather than silently dropping the time.
 */
function resolveDraftDateField(rawValue: string, ctx: { readonly now: Date; readonly timeZone: string }): string | undefined {
  return resolveRelativeDateTime(rawValue, ctx) ?? resolveRelativeDate(rawValue, ctx);
}

/**
 * Real-use fixes plan, Task 3: runs BEFORE `resolveNotionPageDraftProperties`
 * / before any Proposal is opened — the incident this fixes is a draft that
 * carried the literal, unresolved text "tomorrow at 10:45 AM" as Due Date,
 * shown to Spencer and confirmed, rejected by Notion only afterward. On an
 * unresolvable date field this returns a plain clarifying question instead
 * (never a draft, never a Proposal) — `resolveNotionPageDraftProperties`'s
 * own ISO backstop (notion-adapter.ts) still exists for defense in depth,
 * but by the time it runs here every date field is already ISO or this
 * function has already returned.
 */
function resolveDraftDateFields(
  database: NotionDatabaseTarget,
  fields: Record<string, string>,
  ctx: { readonly now: Date; readonly timeZone: string },
): { readonly ok: true } | { readonly ok: false; readonly reply: string } {
  for (const field of DRAFT_NOTION_PAGE_DATE_FIELDS[database]) {
    const raw = fields[field];
    if (raw === undefined) continue;
    const resolved = resolveDraftDateField(raw, ctx);
    if (resolved === undefined) {
      const title = fields["title"] ?? "that";
      const reply =
        field === "dueDate"
          ? `When is "${title}" due? I couldn't read "${raw}" as a date.`
          : `I couldn't read "${raw}" as a date for "${title}"'s ${field} — can you give me an actual date?`;
      return { ok: false, reply };
    }
    fields[field] = resolved;
  }
  return { ok: true };
}

/**
 * `draftItem` without its no-draft reply: `undefined` means no draft could
 * be built from the line (the model found no fields). Every other outcome,
 * including a clarifying reply, is returned as-is. `chat-turn.ts` uses this
 * to hand an undraftable line to the tool loop without reading reply copy.
 */
export async function tryDraftItem(deps: CreateItemDeps, input: CreateItemInput): Promise<Result<ChatTurnResponse | undefined, YohError>> {
  const now = deps.now();
  const today = localIsoDate(now, deps.timeZone);

  let fields: Record<string, string> | undefined;
  try {
    fields = await draftNotionPageFields(deps.llmClient, input.database, input.request, today, deps.timeZone, deps.connection, input.memory);
  } catch {
    fields = undefined;
  }

  if (!fields) return { ok: true, value: undefined };

  const dateResolution = resolveDraftDateFields(input.database, fields, { now, timeZone: deps.timeZone });
  if (!dateResolution.ok) {
    return { ok: true, value: { reply: dateResolution.reply, receipts: [] } };
  }

  const binding = deps.getNotionCreatePageBinding();
  if (!binding.ok) {
    return { ok: true, value: { reply: errorCopy(binding.error, { service: "Notion" }), receipts: [] } };
  }

  const validated = await resolveNotionPageDraftProperties(binding.value.client, binding.value.config, input.database, fields);
  if (!validated.ok) {
    return { ok: true, value: { reply: errorCopy(validated.error, { service: "Notion" }), receipts: [] } };
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

export async function draftItem(deps: CreateItemDeps, input: CreateItemInput): Promise<Result<ChatTurnResponse, YohError>> {
  const drafted = await tryDraftItem(deps, input);
  if (!drafted.ok) return drafted;
  if (drafted.value !== undefined) return { ok: true, value: drafted.value };
  return {
    ok: true,
    value: { reply: `I couldn't tell what you want in the new ${input.database} item — try naming it more directly.`, receipts: [] },
  };
}

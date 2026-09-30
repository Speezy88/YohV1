/**
 * `fileMemory` (Story 13.8, shared by chat auto/explicit filing and T12 ratings): one filing pass.
 * Haiku extracts from Spencer's typed text plus the always-loaded set (never the reply),
 * `validateFiling` checks, `planFilingActions` maps restate/contradict to supersede, each item
 * is filed and a receipt stored. A planning preference whose candidate carries a valid
 * `ruleChange` also raises a Yes/No `Proposal<RuleChange>` in the same transaction as the item
 * (AD-29); memory text never changes planning by itself. Bounded by the filing timeout.
 * Nothing accepted -> `{ok:true, value: undefined}`; failure or timeout -> `unreachable`.
 */
import { randomUUID } from "node:crypto";
import { extractMemories, type AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import type { MemoryItemStore, NewMemoryItem } from "../adapters/memory-item-store.ts";
import { putOpenInteractionRequest, withdrawRuleProposal, findOpenRuleProposals, type MemoryStore } from "../adapters/memory-store.ts";
import { readPlanningSettings } from "../adapters/settings-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { ALWAYS_LOADED_FOLDERS } from "../core/memory-folders.ts";
import { MEMORY_FILING_TIMEOUT_MS, planFilingActions, validateFiling, type FilingAction } from "../core/memory-filing.ts";
import { buildProposalQuestion, PROPOSAL_QUESTION_ID } from "../core/open-item-questions.ts";
import { currentRuleValue, validateProposedRuleValue } from "../core/planning-settings.ts";
import { describeRuleChange, ruleChangeEntityId, ruleChangeProposalId, ruleChangeRequestId, ruleValuesEqual } from "../core/rule-change.ts";
import type { OpenItemQuestion, RememberedReceipt } from "../types/api.ts";
import type { MemoryFolder, MemoryItem, Proposal, Result, RuleChange, Task, YohError } from "../types/domain.ts";

export interface FileMemoryDeps {
  readonly memoryItems?: MemoryItemStore;
  readonly llmClient: AnthropicMessagesClient;
  readonly memoryLlmClient?: AnthropicMessagesClient;
  readonly connection?: SqliteConnection;
  /** Rule-change proposals need the settings (read via `store.withDb`) and the open-request table. */
  readonly store?: MemoryStore;
  readonly readTasks?: () => Promise<readonly Task[]>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly isAborted?: () => boolean;
  readonly memoryFilingTimeoutMs?: number;
}

export interface FileMemoryInput {
  readonly text: string;
  readonly forceStated: boolean;
  readonly forceFolder?: MemoryFolder;
  readonly userTurn?: { readonly conversationId: string; readonly id: string };
}

export interface FileMemoryOutput {
  readonly receipt: RememberedReceipt;
  readonly proposal?: OpenItemQuestion;
}

interface Filed {
  readonly item: MemoryItem;
  readonly question?: OpenItemQuestion;
}

export async function fileMemory(deps: FileMemoryDeps, input: FileMemoryInput): Promise<Result<FileMemoryOutput | undefined, YohError>> {
  const items = deps.memoryItems;
  if (!items) return { ok: true, value: undefined };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("memory filing timed out"));
      }, deps.memoryFilingTimeoutMs ?? MEMORY_FILING_TIMEOUT_MS);
    });
    const filing = (async (): Promise<FileMemoryOutput | undefined> => {
      const alwaysLoaded = items.listItems({ folders: ALWAYS_LOADED_FOLDERS, status: ["current"] });
      const candidates = await extractMemories(deps.memoryLlmClient ?? deps.llmClient, input.text, alwaysLoaded, { forceStated: input.forceStated }, deps.connection);
      // A late extract (after the timeout) or an aborted stream must not write: no receipt means no Undo.
      if (timedOut || deps.isAborted?.() === true) return undefined;
      const { accepted } = validateFiling(candidates, {
        now: deps.now(),
        timeZone: deps.timeZone,
        forceStated: input.forceStated,
        ...(input.forceFolder !== undefined ? { forceFolder: input.forceFolder } : {}),
      });
      if (accepted.length === 0) return undefined;
      const filed: Filed[] = [];
      for (const action of planFilingActions(accepted, alwaysLoaded)) filed.push(await fileOne(deps, items, action, input.userTurn?.id));
      const receipt: RememberedReceipt = {
        receiptId: randomUUID(),
        kind: "remembered",
        items: filed.map(({ item: i }) => ({
          id: i.id,
          text: i.text,
          folder: i.folder,
          ...(i.scope !== undefined ? { scope: i.scope } : {}),
          ...(i.expiresOn !== undefined ? { expiresOn: i.expiresOn } : {}),
        })),
      };
      if (input.userTurn) {
        items.putReceipt({
          receiptId: receipt.receiptId,
          conversationId: input.userTurn.conversationId,
          userTurnId: input.userTurn.id,
          kind: "remembered",
          itemIds: filed.map((f) => f.item.id),
          chainIds: filed.map((f) => f.item.id),
          createdAt: deps.now().toISOString(),
        });
      }
      const proposal = filed.find((f) => f.question)?.question;
      return { receipt, ...(proposal ? { proposal } : {}) };
    })();
    filing.catch(() => {}); // a late failure after the timeout must not go unhandled
    return { ok: true, value: await Promise.race([filing, timeout]) };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function baseItem(c: FilingAction["candidate"], sourceTurnId: string | undefined): NewMemoryItem {
  return {
    folder: c.folder,
    text: c.text,
    origin: c.origin,
    ...(c.scope !== undefined ? { scope: c.scope } : {}),
    ...(c.expiresOn !== undefined ? { expiresOn: c.expiresOn } : {}),
    ...(c.entityRef !== undefined ? { entityRef: c.entityRef } : {}),
    ...(sourceTurnId !== undefined ? { sourceTurnId } : {}),
  };
}

function file(items: MemoryItemStore, action: FilingAction, next: NewMemoryItem): MemoryItem {
  return action.kind === "supersede" && action.targetId !== undefined ? items.supersede(action.targetId, next) : items.insert(next);
}

/** Decides whether the candidate's `ruleChange` may raise a card; undefined means "file it soft". */
async function planRuleChange(deps: FileMemoryDeps, items: MemoryItemStore, action: FilingAction): Promise<Omit<RuleChange, "memoryItemId"> | undefined> {
  const rc = action.candidate.ruleChange;
  const store = deps.store;
  if (!rc || !deps.connection || !store) return undefined;
  const target = action.targetId !== undefined ? items.getItem(action.targetId) : undefined;
  if (target && (target.ruleChange === "declined" || target.ruleChange === "pending")) return undefined;
  const settings = store.withDb(readPlanningSettings);
  const checked = validateProposedRuleValue(settings, rc.key, rc.value);
  if (!checked.ok) return undefined;
  let value = checked.value;
  let area: string | undefined;
  if (rc.key === "areaDurationPadding") {
    const requested = (value as { area: string }).area;
    if (!deps.readTasks) return undefined;
    try {
      const tasks = await deps.readTasks();
      const match = tasks.map((t) => t.area).find((a): a is string => typeof a === "string" && a.toLowerCase() === requested.toLowerCase());
      if (match === undefined) return undefined;
      area = match;
    } catch {
      return undefined;
    }
    value = { area, minutes: (value as { minutes: number }).minutes };
  }
  const previous = currentRuleValue(settings, rc.key, area);
  if (ruleValuesEqual(previous, value)) return undefined;
  return { key: rc.key, value, previous };
}

async function fileOne(deps: FileMemoryDeps, items: MemoryItemStore, action: FilingAction, sourceTurnId: string | undefined): Promise<Filed> {
  const base = baseItem(action.candidate, sourceTurnId);
  const planned = await planRuleChange(deps, items, action);
  const connection = deps.connection;
  const store = deps.store;
  if (!planned || !connection || !store) {
    // Soft: the item never carries a rule change. A restate of a declined preference keeps `declined`.
    const target = action.targetId !== undefined ? items.getItem(action.targetId) : undefined;
    if (target?.ruleChange === "pending" && store) withdrawRuleProposal(store, target.id);
    return { item: file(items, action, target?.ruleChange === "declined" ? base : { ...base, ruleChange: "none" }) };
  }
  const entityId = ruleChangeEntityId(planned.key, typeof planned.value === "object" && "area" in planned.value ? planned.value.area : undefined);
  // ONE transaction: nested item-store / request writes are SAVEPOINTs, so all of it persists or none of it.
  return connection.writeTx(() => {
    const item = file(items, action, { ...base, ruleChange: "pending" });
    for (const open of findOpenRuleProposals(store)) {
      const p = (open.data.detail as { proposal?: Proposal<RuleChange> }).proposal;
      if (p && p.entityId === entityId && p.suggested.memoryItemId !== item.id) {
        withdrawRuleProposal(store, p.suggested.memoryItemId);
        items.setRuleChange(p.suggested.memoryItemId, "none");
      }
    }
    const change: RuleChange = { ...planned, memoryItemId: item.id };
    const reason = describeRuleChange(change);
    const proposal: Proposal<RuleChange> = {
      id: ruleChangeProposalId(item.id),
      kind: "rule-change",
      entityId,
      entityVersion: JSON.stringify(planned.previous),
      suggested: change,
      reason,
      createdAt: deps.now().toISOString(),
    };
    const requestId = ruleChangeRequestId(item.id);
    putOpenInteractionRequest(store, requestId, {
      requestKind: "proposal",
      promptText: reason,
      detail: { proposal, cursor: { questionId: PROPOSAL_QUESTION_ID } },
      createdAt: proposal.createdAt,
    });
    return { item, question: buildProposalQuestion(requestId, reason, proposal) };
  });
}

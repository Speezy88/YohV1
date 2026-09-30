/**
 * Story 13.10 (server half): the Memory page's direct writes. Every write is a new
 * version (supersede) so the old row is never touched on failure; edits and moves
 * never change planning (that stays in `confirmProposal`).
 */
import type { LogEntry } from "../adapters/logger.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import { withdrawRuleProposal, type MemoryStore } from "../adapters/memory-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { MEMORY_ITEM_MAX_CHARS, STATED_ONLY_FOLDERS, isMemoryFolder, memoryFolderLabel } from "../core/memory-folders.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import { recallMemoryContext } from "./memory-recall.ts";
import type {
  DeleteMemoryRequest,
  EditMemoryRequest,
  EditMemoryResponse,
  MemoryWriteResponse,
  MoveMemoryRequest,
  ReviewMemoryRequest,
  SetMemoryExpiryRequest,
} from "../types/api.ts";
import type { MemoryItem, Result, Task, YohError } from "../types/domain.ts";

export interface MemoryEditDeps {
  readonly memoryItems: MemoryItemStore;
  readonly store?: MemoryStore;
  readonly readTasks?: () => Promise<readonly Task[]>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

const fail = (kind: YohError["kind"], message: string): Result<never, YohError> => ({ ok: false, error: { kind, message } });
const CHANGED = "That item has changed. Reload the page.";
const PENDING = "Answer the pending change first.";

/** Fields copied to the next version; `ruleChange` is inherited by the store. */
function carry(item: MemoryItem): { folder: MemoryItem["folder"]; text: string; origin: MemoryItem["origin"]; scope?: string; expiresOn?: string; entityRef?: string; sourceTurnId?: string } {
  return {
    folder: item.folder,
    text: item.text,
    origin: item.origin,
    ...(item.scope !== undefined ? { scope: item.scope } : {}),
    ...(item.expiresOn !== undefined ? { expiresOn: item.expiresOn } : {}),
    ...(item.entityRef !== undefined ? { entityRef: item.entityRef } : {}),
    ...(item.sourceTurnId !== undefined ? { sourceTurnId: item.sourceTurnId } : {}),
  };
}

function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function checkFutureDate(deps: MemoryEditDeps, value: unknown): Result<string, YohError> {
  if (!isRealDate(value) || value < localIsoDate(deps.now(), deps.timeZone)) return fail("validation", "Pick a date that hasn't passed.");
  return { ok: true, value };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.,;:!?]+$/, "");
}

/** The current item an edit/move/expiry/renew may act on, or the refusal to return. */
function editable(deps: MemoryEditDeps, itemId: unknown, allowPending = false): Result<MemoryItem, YohError> {
  const item = typeof itemId === "string" ? deps.memoryItems.getItem(itemId) : undefined;
  if (!item || item.status !== "current") return fail("conflict", CHANGED);
  if (item.ruleChange === "pending" && !allowPending) return fail("conflict", PENDING);
  return { ok: true, value: item };
}

const unreachable = (error: unknown): Result<never, YohError> => fail("unreachable", errorCopyForThrown(error));

export async function editMemoryItem(deps: MemoryEditDeps, input: EditMemoryRequest): Promise<Result<EditMemoryResponse, YohError>> {
  try {
    const got = editable(deps, input.itemId);
    if (!got.ok) return got;
    const item = got.value;
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (text.length < 1 || text.length > MEMORY_ITEM_MAX_CHARS) return fail("validation", "Memory text must be 1 to 280 characters.");
    const next = { ...carry(item), text, origin: "stated" as const };
    const wanted = normalize(text);
    const dup = deps.memoryItems.listItems({ status: ["current"] }).find((o) => o.id !== item.id && normalize(o.text) === wanted);
    if (input.mergeWithId !== undefined) {
      if (!dup || dup.id !== input.mergeWithId) return fail("conflict", CHANGED);
      if (dup.ruleChange === "pending") return fail("conflict", PENDING);
      const merged = deps.memoryItems.merge([item.id, dup.id], next);
      return { ok: true, value: { status: "merged", itemId: merged.id } };
    }
    if (dup && input.allowDuplicate !== true) {
      return { ok: true, value: { status: "duplicate", other: { id: dup.id, text: dup.text, folder: dup.folder } } };
    }
    const saved = deps.memoryItems.supersede(item.id, next);
    return { ok: true, value: { status: "saved", itemId: saved.id } };
  } catch (error) {
    return unreachable(error);
  }
}

export async function moveMemoryItem(deps: MemoryEditDeps, input: MoveMemoryRequest): Promise<Result<MemoryWriteResponse, YohError>> {
  try {
    const got = editable(deps, input.itemId);
    if (!got.ok) return got;
    const item = got.value;
    if (!isMemoryFolder(input.folder)) return fail("validation", "Pick a folder to move this to.");
    if (input.folder === item.folder) return fail("validation", "That's already in this folder.");
    if (item.origin === "inferred" && STATED_ONLY_FOLDERS.includes(input.folder)) {
      return fail("validation", `Only things you said can go in ${memoryFolderLabel(input.folder)}.`);
    }
    const saved = deps.memoryItems.supersede(item.id, { ...carry(item), folder: input.folder });
    return { ok: true, value: { itemId: saved.id } };
  } catch (error) {
    return unreachable(error);
  }
}

export async function setMemoryExpiry(deps: MemoryEditDeps, input: SetMemoryExpiryRequest): Promise<Result<MemoryWriteResponse, YohError>> {
  try {
    const got = editable(deps, input.itemId);
    if (!got.ok) return got;
    const { expiresOn: _drop, ...rest } = carry(got.value);
    void _drop;
    let next: ReturnType<typeof carry> = rest;
    if (input.expiresOn !== null) {
      const date = checkFutureDate(deps, input.expiresOn);
      if (!date.ok) return date;
      next = { ...rest, expiresOn: date.value };
    }
    const saved = deps.memoryItems.supersede(got.value.id, next);
    return { ok: true, value: { itemId: saved.id } };
  } catch (error) {
    return unreachable(error);
  }
}

export async function deleteMemoryItem(deps: MemoryEditDeps, input: DeleteMemoryRequest): Promise<Result<MemoryWriteResponse, YohError>> {
  try {
    const item = typeof input.itemId === "string" ? deps.memoryItems.getItem(input.itemId) : undefined;
    if (!item || item.status === "deleted") return fail("conflict", "That item is already gone.");
    const chainIds = deps.memoryItems.forget(item.id).chainIds;
    if (deps.store) for (const id of chainIds) withdrawRuleProposal(deps.store, id);
    deps.memoryItems.purgeChain(chainIds);
    return { ok: true, value: {} };
  } catch (error) {
    return unreachable(error);
  }
}

export async function reviewMemoryItem(deps: MemoryEditDeps, input: ReviewMemoryRequest): Promise<Result<MemoryWriteResponse, YohError>> {
  try {
    if (input.action !== "renew" && input.action !== "keep") return fail("validation", "Choose Renew or Keep as history.");
    const got = editable(deps, input.itemId, input.action === "keep");
    if (!got.ok) return got;
    const item = got.value;
    if (input.action === "keep") {
      deps.memoryItems.keepAsHistory(item.id);
      if (deps.store) withdrawRuleProposal(deps.store, item.id);
      return { ok: true, value: { itemId: item.id } };
    }
    const recalled = await recallMemoryContext(deps, { requestText: "" });
    const reason = recalled.ok ? recalled.value?.states.find((s) => s.itemId === item.id)?.reason : undefined;
    if (!reason || (reason.kind !== "expired" && reason.kind !== "unused")) return fail("conflict", "Nothing to renew here.");
    const { expiresOn: _drop, ...rest } = carry(item);
    void _drop;
    let next: ReturnType<typeof carry> = reason.kind === "unused" ? carry(item) : rest;
    if (reason.kind === "expired" && input.expiresOn !== undefined) {
      const date = checkFutureDate(deps, input.expiresOn);
      if (!date.ok) return date;
      next = { ...rest, expiresOn: date.value };
    }
    const saved = deps.memoryItems.supersede(item.id, next);
    return { ok: true, value: { itemId: saved.id } };
  } catch (error) {
    return unreachable(error);
  }
}

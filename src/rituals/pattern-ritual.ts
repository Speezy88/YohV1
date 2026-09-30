/**
 * Pattern detection ritual (Story 13.13, E7): runs after the Morning Ritual. Withdraws stale Pattern
 * proposals, reads slip events and same-day check-offs, and opens at most one Pattern proposal per
 * (kind, Area). Never a push or notification.
 */
import { randomUUID } from "node:crypto";
import type { LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import { clearInteractionRequest, listOpenInteractionRequests, putOpenInteractionRequest, type MemoryStore } from "../adapters/memory-store.ts";
import { listPlannedCheckOffs, listSlipEvents } from "../adapters/completion-log.ts";
import { describePattern, detectPatterns, patternKey, PATTERN_QUIET_DAYS, PATTERN_WINDOW_DAYS } from "../core/pattern-detect.ts";
import { isOlderThanDays, PATTERN_PROPOSAL_TTL_DAYS } from "../core/proposal-ttl.ts";
import { localIsoDate } from "./ritual-shared.ts";
import type { Area, IsoDate, PatternKind, PatternProposal, Proposal, Result, YohError } from "../types/domain.ts";

export interface PatternRitualDeps {
  readonly store: MemoryStore;
  readonly connection: SqliteConnection;
  readonly memoryItems: MemoryItemStore;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

export interface PatternRunOutcome {
  readonly withdrawn: number;
  readonly proposed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runPatternDetection(deps: PatternRitualDeps): Promise<Result<PatternRunOutcome, YohError>> {
  const log = deps.log ?? ((): void => {});
  const now = deps.now();
  const nowIso = now.toISOString();
  const today = localIsoDate(now, deps.timeZone);
  let withdrawn = 0;
  let proposed = 0;

  // (1) Withdraw Pattern proposals unanswered for more than 7 days: declined, quiet period starts.
  for (const record of listOpenInteractionRequests(deps.store)) {
    const proposal = (record.data.detail as { readonly proposal?: Proposal<PatternProposal> } | undefined)?.proposal;
    if (record.data.requestKind !== "proposal" || proposal?.kind !== "pattern") continue;
    if (!isOlderThanDays(proposal.createdAt, now, PATTERN_PROPOSAL_TTL_DAYS)) continue;
    try {
      deps.connection.writeTx(() => {
        clearInteractionRequest(deps.store, record.id, record.version);
        const existing = deps.memoryItems.getPatternState(proposal.suggested.kind, proposal.suggested.area);
        const { pendingProposalId: _cleared, ...rest } = existing ?? { kind: proposal.suggested.kind, area: proposal.suggested.area };
        deps.memoryItems.putPatternState({ ...rest, declinedAt: nowIso });
      });
      withdrawn += 1;
      log({ level: "info", event: "pattern-ritual.withdrawn", detail: { id: proposal.id } });
    } catch (err) {
      log({ level: "warn", event: "pattern-ritual.withdraw-failed", detail: { id: proposal.id, error: errText(err) } });
    }
  }

  // (2) Observations.
  const sinceIso = new Date(now.getTime() - (PATTERN_WINDOW_DAYS + 2) * DAY_MS).toISOString();
  const windowStart = localIsoDate(new Date(now.getTime() - PATTERN_WINDOW_DAYS * DAY_MS), deps.timeZone);
  let slips: { area: Area; date: IsoDate }[];
  let overruns: { area: Area; date: IsoDate; overrunMinutes: number }[];
  try {
    slips = [];
    for (const s of listSlipEvents(deps.connection)) if (s.area !== null && s.date >= windowStart) slips.push({ area: s.area, date: s.date });
    overruns = [];
    for (const c of listPlannedCheckOffs(deps.connection, sinceIso)) {
      if (c.area === null) continue;
      const date = localIsoDate(new Date(c.completedAt), deps.timeZone);
      if (localIsoDate(new Date(c.plannedEnd), deps.timeZone) !== date) continue;
      const overrunMinutes = Math.round((Date.parse(c.completedAt) - Date.parse(c.plannedEnd)) / 60000);
      if (Number.isNaN(overrunMinutes)) continue;
      overruns.push({ area: c.area, date, overrunMinutes });
    }
  } catch (err) {
    log({ level: "error", event: "pattern-ritual.read-failed", detail: { error: errText(err) } });
    return { ok: false, error: { kind: "unreachable", message: "Pattern detection could not read its data." } };
  }

  // (3) Keys to skip / to count only after.
  const skip = new Set<string>();
  const after = new Map<string, IsoDate>();
  for (const st of deps.memoryItems.listPatternStates()) {
    const key = patternKey(st.kind as PatternKind, st.area);
    if (st.pendingProposalId) skip.add(key);
    if (st.declinedAt && !isOlderThanDays(st.declinedAt, now, PATTERN_QUIET_DAYS)) skip.add(key);
    if (st.confirmedAt) after.set(key, localIsoDate(new Date(st.confirmedAt), deps.timeZone));
  }

  // (4) + (5) Detect and open proposals.
  for (const found of detectPatterns({ slips, overruns, today, skip, after })) {
    try {
      const desc = describePattern(found);
      const id = `pattern-${randomUUID()}`;
      const suggested: PatternProposal = { ...found, evidence: desc.evidence };
      const proposal: Proposal<PatternProposal> = {
        id,
        kind: "pattern",
        entityId: patternKey(found.kind, found.area),
        entityVersion: "new",
        suggested,
        reason: [desc.headline, desc.evidence, desc.question].join("\n"),
        createdAt: nowIso,
      };
      deps.connection.writeTx(() => {
        putOpenInteractionRequest(deps.store, `proposal:${id}`, {
          requestKind: "proposal",
          promptText: proposal.reason,
          detail: { proposal, cursor: { questionId: "confirm" } },
          createdAt: nowIso,
        });
        const existing = deps.memoryItems.getPatternState(found.kind, found.area);
        deps.memoryItems.putPatternState({ ...(existing ?? { kind: found.kind, area: found.area }), pendingProposalId: id });
      });
      proposed += 1;
      log({ level: "info", event: "pattern-ritual.proposed", detail: { id, key: proposal.entityId, occurrences: found.occurrences } });
    } catch (err) {
      log({ level: "warn", event: "pattern-ritual.propose-failed", detail: { key: patternKey(found.kind, found.area), error: errText(err) } });
    }
  }
  return { ok: true, value: { withdrawn, proposed } };
}

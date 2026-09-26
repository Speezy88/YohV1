/**
 * src/app/home-view.ts
 *
 * Story 7.8, AD-16/AD-17: Home's one server-computed view. Reads today's
 * stored Plan (`memory-store.ts`'s `getPlan`, unchanged from Phase 1), a
 * live read of today's primary-calendar events (once per request — no
 * background polling, per the controller's implementer note), and a live
 * read of Notion Tasks to know each Plan work-block's CURRENT completion
 * status (the stored Plan only ever snapshots a Task's title at generation
 * time, never its live status).
 *
 * **Why the "fixed" blocks come from a live Calendar read, not the stored
 * Plan's own `calendar-anchor` blocks.** `core/work-break-fit.ts` already
 * bakes every `CalendarEvent` into the Plan as a `calendar-anchor` PlanBlock
 * at Plan-generation (or Mid-Day Re-Flow) time — that snapshot exists so
 * work/break fitting never overlaps a fixed commitment, but it goes stale
 * the moment the primary calendar changes afterward (a new event, a move, a
 * cancellation), and nothing in this epic re-generates the Plan just
 * because Calendar changed. The controller's own ruling ("Home re-fetches
 * Plan AND today's calendar" on a Plan-change hint; "no calendar polling is
 * added — not a background trigger for calendar changes, just an on-demand
 * read whenever Home is queried") calls for the CURRENT state of the
 * calendar on every read, not a hint-stale snapshot. This function therefore
 * takes today's Plan's `"work"`/`"break"` blocks (Yoh-owned) and layers a
 * fresh `readCalendarEvents()` result on top as `kind: "fixed"` — the
 * stored Plan's own `"calendar-anchor"` blocks are never read for display,
 * only used internally by `work-break-fit.ts` at generation time. Since Yoh
 * writes its own work/break blocks to a SEPARATE "Yoh Plan" calendar
 * (`calendar-adapter.ts`'s `writeTodaysPlanToCalendar`), a live read of the
 * PRIMARY calendar naturally returns only events Yoh did not create — there
 * is no risk of double-counting a Yoh-owned block as a live "fixed" one.
 *
 * **Fix round 1 (reviewer findings #1/#2).** A Calendar-read failure used
 * to blank the ENTIRE Home view (`ok: false` before the stored Plan was
 * ever read) — that over-punished a transient Calendar outage exactly the
 * way a Notion outage never does. Both failure paths now behave the same
 * way: log a structured error line, then fall back and keep going. A
 * Calendar failure falls back to `calendarEvents: []`, so `calendar.blocks`
 * degrades to the Plan's own Yoh-owned `work`/`break` blocks only (or `[]`
 * with no Plan yet) — never a thrown exception, never a blanked checklist.
 */
import { getPlan } from "../adapters/memory-store.ts";
import type { MemoryStore } from "../adapters/memory-store.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { CalendarEvent, ExternalId, PlanBlock, Result, Task, YohError } from "../types/domain.ts";
import type { HomeCalendarBlock, HomePlanRow, HomeViewResponse } from "../types/api.ts";

export interface HomeViewDeps {
  readonly store: MemoryStore;
  /** `calendar-adapter.ts`'s `readCalendarEvents`, pre-bound to its client/config. Called once per request — never on a timer. */
  readonly readCalendarEvents: () => Promise<readonly CalendarEvent[]>;
  /** `notion-adapter.ts`'s `readNotionTasks`, pre-bound. Used only for each Task's CURRENT `status`. */
  readonly readTasks: () => Promise<{ readonly tasks: readonly Task[] }>;
  readonly timeZone: string;
  readonly now: () => Date;
  /** One structured log line (Consistency Conventions) on a Calendar/Notion read failure, mirroring `rituals/*.ts`'s own `log?` seam — optional, defaults to a no-op; `shell/server.ts` binds the real writer. */
  readonly log?: (entry: LogEntry) => void;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toFixedBlock(event: CalendarEvent, nowMs: number): HomeCalendarBlock {
  return { id: event.id, kind: "fixed", label: event.title, start: event.start, end: event.end, completed: false, past: Date.parse(event.end) < nowMs };
}

/** Home's one server-computed view (AD-17): every order and placement below is decided here, never re-sorted or re-derived client-side. */
export async function getHomeView(deps: HomeViewDeps, _input: Record<string, never>): Promise<Result<HomeViewResponse, YohError>> {
  const log = deps.log ?? ((): void => {});
  const now = deps.now();
  const nowMs = now.getTime();
  const today = localIsoDate(now, deps.timeZone);

  let calendarEvents: readonly CalendarEvent[] = [];
  try {
    calendarEvents = await deps.readCalendarEvents();
  } catch (err) {
    // A Calendar outage must not blank Home's Plan checklist — the
    // checklist and Yoh-owned calendar blocks still render from the stored
    // Plan; only the live "fixed" (non-Yoh) anchors are missing until the
    // next successful read.
    log({ level: "error", event: "home-view.read-calendar-failed", detail: describeError(err) });
  }
  const fixedBlocks = calendarEvents.map((e) => toFixedBlock(e, nowMs));

  const stored = getPlan(deps.store, today);
  if (!stored) {
    return { ok: true, value: { today, plan: undefined, calendar: { blocks: fixedBlocks } } };
  }

  let tasksById = new Map<ExternalId, Task>();
  try {
    const { tasks } = await deps.readTasks();
    tasksById = new Map(tasks.map((t) => [t.id, t]));
  } catch (err) {
    // A Notion outage must not blank Home's Plan checklist — rows still
    // render from the Plan's own snapshot; completion just falls back to
    // "not completed" until the next successful read.
    log({ level: "error", event: "home-view.read-tasks-failed", detail: describeError(err) });
  }

  const isCompleted = (block: PlanBlock): boolean =>
    block.kind === "work" && block.taskId !== undefined && tasksById.get(block.taskId)?.status === "completed";

  const rows: HomePlanRow[] = [];
  for (const block of stored.data.blocks) {
    if (block.kind !== "work" || block.taskId === undefined) continue;
    rows.push({
      blockId: block.id,
      taskId: block.taskId,
      label: block.label,
      start: block.start,
      end: block.end,
      completed: isCompleted(block),
      past: Date.parse(block.end) < nowMs,
    });
  }

  const ownedBlocks: HomeCalendarBlock[] = stored.data.blocks
    .filter((b): b is PlanBlock & { kind: "work" | "break" } => b.kind === "work" || b.kind === "break")
    .map((b) => ({ id: b.id, kind: b.kind, label: b.label, start: b.start, end: b.end, completed: isCompleted(b), past: Date.parse(b.end) < nowMs }));

  const blocks = [...ownedBlocks, ...fixedBlocks].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  return { ok: true, value: { today, plan: { rows }, calendar: { blocks } } };
}

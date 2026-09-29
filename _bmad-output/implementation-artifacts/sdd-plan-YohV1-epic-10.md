# Yoh — SDD Plan: Epic 10 (Drag-to-Reshuffle, Routines, Pins, Chat plan edits, Priority) — 2026-09-28

Sources: `epics.md` "## Epic 10" Stories 10.1–10.5; HANDOFF 2026-09-28 additions (chat plan edits replacing `PLAN_EDIT_NOT_SUPPORTED_REPLY`; Notion Priority in Derived Priority, strong weight, never above due-today/overdue); polish-5 school-day rulings (binding); fact sweep `.superpowers/sdd/sdd-plan-YohV1-epic-10/facts.md` (HEAD 30fb433).

Precedent and constraints: AGENTS.md binds (layering, app exports `(deps,input)=>Promise<Result>`, pure parsers in core/, shells call one app fn, tokens only, WCAG AA). One commit per task, trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never write to Spencer's real Notion or Calendar. Each task ≤ ~5–7 source files (mechanical constant swaps don't count).

Test order for every task: focused tests while iterating → `npm run check` ONCE → ONE full `cd web && npx playwright test` (only if web/ or a route changed, and only when the coordinator's brief allows — one Playwright runner at a time) → rerun only failing specs by file.

## Shared design (every brief carries the parts it needs)

**Types (domain.ts, added by the task that first needs them):**
```ts
export type ReshuffleRequest =
  | { readonly kind: "reflow-now" }
  | { readonly kind: "move-block"; readonly planBlockId: string; readonly newStart: IsoDateTime }
  | { readonly kind: "pin-task"; readonly taskId: ExternalId; readonly newStart: IsoDateTime }
  | { readonly kind: "unpin-task"; readonly taskId: ExternalId }
  | { readonly kind: "drop-task"; readonly taskId: ExternalId }
  | { readonly kind: "swap"; readonly addTaskId: ExternalId; readonly removeTaskId: ExternalId };
export interface DayPin { readonly date: IsoDate; readonly subject: { readonly kind: "task"; readonly taskId: ExternalId } | { readonly kind: "routine"; readonly routineId: string }; readonly start: IsoDateTime }
export interface ReshufflePreview {
  readonly date: IsoDate; readonly request: ReshuffleRequest;
  readonly blocks: readonly PlanBlock[];               // full proposed day (past blocks kept verbatim)
  readonly movedBlockIds: readonly string[];           // proposed block ids whose taskId/routineId existed but times changed, or newly placed
  readonly deferredTaskIds: readonly ExternalId[]; readonly needsDataTaskIds: readonly ExternalId[];
  readonly pins: readonly DayPin[]; readonly drops: readonly ExternalId[];   // the day's pins/drops AFTER approve
  readonly unplacedRoutineLabels: readonly string[];
  readonly rejectedReason?: string;                    // e.g. pin overlaps a fixed event; preview then equals current plan
  readonly summary: string;                            // one line naming moves + deferred Tasks
  readonly planVersion: number; readonly calendarVersion: string;
}
```
Proposal kind `"reshuffle"`, `entityId` = today's IsoDate, `entityVersion` = `${planVersion}:${calendarVersion}`, stored like every proposal (open InteractionRequest `proposal:<id>`).

**Rulings (coordinator, 2026-09-28; logged in the ledger):**
- R1 Priority: rank from the emoji-stripped lowercase word — high −1, medium 0, low +1, missing/unknown 0. `PRIORITY_WEIGHT_MINUTES = 360` per step (High vs Low = 1.5 days). Applied only to Tasks with `daysUntilDue >= 1`; a boosted Task never sorts ahead of any due-today/overdue Task it sorted behind without the boost (floor at the max primary score of the due-today/overdue set). Priority never gates, never required.
- R2 One pipeline: `rituals/reshuffle.ts` exports a pure-ish compute (no store writes) used by morning, reflow, request and approve. Reflow keeps rebuilding anchors from the stored Plan (the stored Plan already carries protected windows as anchors); request/approve use a live calendar read. Reflow's app wrapper gains `bumpLevels`.
- R3 Calendar version = stable hash over today's live events' `id|start|end` (sorted). Title-only edits don't stale a preview.
- R4 Proposal lifecycle: one open reshuffle proposal (a new request clears the old one, never `conflict`); TTL `RESHUFFLE_PROPOSAL_TTL_MINUTES = 10` (one export in core); expired = treated as absent, approve returns `stale-proposal` "That preview expired. Ask again or drag the block again."
- R5 Approve writes the Plan (+ pins/drops) in one `writeTx`, then syncs the Yoh Plan calendar through the existing narrow `writeCalendarPlan` (`writeTodaysPlanToCalendar`), which only ever touches events tagged with `PLAN_BLOCK_ID_EXTENDED_PROPERTY` on the Yoh Plan calendar — that is how the "`external` aborts" rule is met; never the broad client. `writeTodaysPlanToCalendar` changes to return `{ written: string[]; failed: string[] }` (per-block try/catch). Any failure → `reshuffle-apply-failed` notification "Couldn't update your calendar" deep-linking Home; the response says so; never reported as full success.
- R6 Drag = pin: dragging a work block pins its Task at the drop time (shows the pin control); dragging a routine block pins that routine for today; break blocks, anchors, past and completed blocks are not draggable. A pinned Task is placed contiguously from its pin start, split into work segments + breaks by the normal rule, its whole span fixed; if that span overlaps a fixed event → rejected with a reason naming the event. Pinned Tasks are removed from the population before ordering, use their remaining duration, and count against the Time Budget.
- R7 Drops: "drop X today" persists a day-scoped drop (same table family as pins) applied by every refit that day; `unpin-task` also clears a drop for that Task.
- R8 Routines occupy time like anchors but do NOT consume the Time Budget. Placed at declared time, else the nearest free slot (5-min steps, same length) inside the day; unfit → not placed, label listed in `unplacedRoutineLabels` and the reasoning/summary. Routines whose declared time is already past at fit start are skipped silently. Bare times: 1–7 → PM, 8–11 → AM, 12 → noon.
- R9 Chat plan edits resolve Task/routine names deterministically (case-insensitive substring against today's Plan blocks, then open Tasks for "instead of" X); 0 matches → "I couldn't find <x> in today's Plan."; >1 → ask which, listing up to 3 titles; never guess, never LLM. "after lunch" = end of the Lunch protected window on school days, else 13:00 local. "X instead of Y" = `swap`: drop Y, pin X at Y's first remaining block start.
- R10 Proposal chips for kind `reshuffle` are **Approve / Discard**; `parseProposalAnswer` also accepts approve/discard.

**Block ids**: stay positional but prefixed per version (`v<N>-work-0`), so ids are unique across versions; drags address `PlanBlock.id` of the plan version the client saw (the move request carries it; request-reshuffle resolves it against the current stored Plan and returns `stale-proposal` if absent).

## Task order and parallelism
```
[T1 ‖ T2] → [T3 ‖ T6a] → T4a → T4b → T5 → [T6b ‖ T7] → T8a → T8b → final review (Opus) → fix → re-review (Sonnet)
```
Per-task Sonnet review (risky logic): T1, T2, T5, T6b. Others fold into the final review. Only one Playwright runner at a time (T8b owns the full run; earlier web tasks run only their specs if needed).

## T1: Notion Priority in Derived Priority (R1)
**Owns:** `src/core/derived-priority.ts`, `src/core/plan-reasoning.ts`, the why-prioritized core/app reply builder (grep `why`), `src/core/planning-field-value.ts` (reuse its emoji-stripped word helper; export a `priorityRank(raw?: string): -1|0|1` there if no equivalent exists), + tests.
**Behavior:** add the Priority term once in `computeScored` (shared by `orderByDerivedPriority` and `computeDerivedPriorityFactors`); expose `priorityRank` and the applied `priorityBoost` in `DerivedPriorityFactors`; plan reasoning / why-prioritized mention Priority only when it changed the order ("ranked up for High priority"). Export `PRIORITY_WEIGHT_MINUTES`.
**Tests:** High due in 2 days beats Low due in 1 day; High due tomorrow never beats a due-today or overdue Task (incl. long due-today Task); no priorities anywhere → identical order to before (existing tests untouched); unknown option string → rank 0; bumps still work.
**Commit:** `feat(plan): Notion Priority in Derived Priority — strong weight, never above due-today`

## T2: One re-planning pipeline (10.1 part 1, R2)
**Owns:** new `src/rituals/reshuffle.ts`, `src/rituals/morning-ritual.ts`, `src/rituals/mid-day-reflow.ts`, `src/rituals/ritual-shared.ts`, `src/app/mid-day-reflow.ts`; mechanical: export `PLAN_TOPIC = "plan"` once from `src/adapters/memory-store.ts` (next to `putPlan`) and replace the private copies/bare literals (confirm-proposal.ts, check-off.ts, both rituals).
**Behavior:**
1. `computeDayRefit(input)` in reshuffle.ts: inputs `{ date, timeZone, now, openTasks (already gated CompleteTask[]), budget, fixedEvents (CalendarEvent[] — anchors + protected windows, caller-computed), pastBlocks (kept verbatim), bumpLevels?, idPrefix, log? }` → `Result<{ blocks, deferredTaskIds, fitMs }, YohError>`: `orderByDerivedPriority` → `mergeOverlappingAnchors` → `fitWorkBreakBlocks` → school-day last resort (move `applySchoolDayLastResort` here from morning) → merge with pastBlocks sorted by start. Also export `computeSchoolDayInputs(events, date, tz)` wrapper if useful. No store I/O. Logs `reshuffle.computed` with duration ms.
2. Morning and reflow both call it; no other `fitWorkBreakBlocks`/`orderByDerivedPriority` call remains in rituals (grep proves it). Shared `failure()`/`describeError()` move to ritual-shared.ts.
3. Reflow app wrapper passes `computeBumpLevels(store)` like planDay.
4. Block ids `v<version>-<kind>-<n>` for both paths (update tests that assert literal ids).
5. Behavior otherwise unchanged: every existing morning/reflow/blocker test passes (adjusting only id literals).
**Tests:** morning + reflow produce identical blocks to the pre-refactor path for the existing fixtures; reflow now applies bumpLevels; reflow keeps protected-window anchors from the stored Plan; `reshuffle.computed` logged.
**Commit:** `refactor(plan): one re-planning pipeline — computeDayRefit shared by morning and reflow`

## T3: Request a reshuffle — preview + proposal lifecycle (10.1 part 2, R3, R4)
**Owns:** `src/types/domain.ts` (ReshuffleRequest `reflow-now` only for now + ReshufflePreview + DayPin types as above), new `src/core/reshuffle-preview.ts` (pure: `diffPlanBlocks(old, proposed)` → moved/unchanged; `calendarVersionHash(events)`; `buildReshuffleSummary(...)`; `RESHUFFLE_PROPOSAL_TTL_MINUTES`; `isProposalExpired(createdAt, now)`), new `src/app/request-reshuffle.ts`, + tests.
**Behavior:** `requestReshuffle(deps, { request })`: read stored Plan (none → `missing-field` "There's no Plan for today yet."), live calendar events, tasks → gate → `computeDayRefit` with past blocks kept → build preview (needs-data ids from the gate) → clear any open `reshuffle` proposal → open the new one → return `{ proposal, question }` (question from `buildProposalQuestion`). Nothing written to Calendar. Supersede is server-side and atomic enough (clear + put in one `writeTx` if the store allows; else sequential, tested).
**Tests:** preview lists moved/unchanged/deferred; second request supersedes first (only one open); expired helper; calendar hash stable under reordering and changes when a start moves; nothing calls writeCalendarPlan; Task missing Duration → in needsDataTaskIds, others still planned.
**Commit:** `feat(plan): request a reshuffle — Proposal<ReshufflePreview> with one open, 10-min TTL`

## T4a: Approve or discard a reshuffle (10.2 server core, R5, R10)
**Owns:** new `src/app/approve-reshuffle.ts` (`approveReshuffle`, `discardReshuffle`), `src/app/confirm-proposal.ts` (new `reshuffle` branch delegating to approve/discard), `src/core/open-item-questions.ts` (Approve/Discard chips for reshuffle), `src/core/open-item-answers.ts` (accept approve/discard), `src/adapters/calendar-adapter.ts` (`writeTodaysPlanToCalendar` returns `{written, failed}`; update its two callers' types only), + tests.
**Behavior:** approve re-reads calendar + stored Plan; version mismatch or expired → recompute via `requestReshuffle` semantics and return `{ status: "recomputed", preview, question }`; else in ONE `writeTx`: `putPlan` (version-checked; conflict → recompute) + outbox `PLAN_TOPIC` + clear the request; then `writeCalendarPlan(non-anchor blocks)`; failures → notification `reshuffle-apply-failed` "Couldn't update your calendar" (deep link Home) and `{ status: "applied", calendarFailedBlockIds }`. Discard/expiry: clear request only, nothing else written. Answering "yes"/"approve" in chat routes through confirm-proposal to the same code.
**Tests:** stale plan version → recomputed, nothing written; calendar hash changed → recomputed; happy path writes Plan once + outbox + calendar sync with non-anchor blocks; partial calendar failure → notification + failed ids; discard writes nothing (store + calendar spies); chips read Approve/Discard; "discard" parses as false.
**Commit:** `feat(plan): approve or discard a reshuffle — one writeTx, narrow calendar sync, honest failure`

## T4b: Reshuffle routes + chat re-flow goes through the preview (10.2 wiring)
**Owns:** `src/shell/server.ts` (routes + `buildPlanDeps`/`ServerDeps.plan`), `src/types/api.ts` (request/response types incl. `ReshufflePreviewView` with `HomeCalendarBlock[]` + `moved` flag, `expiresAt`), `src/app/chat-turn.ts` (`isMidDayReflowCommand` → `requestReshuffle` returning the Approve/Discard question; blocker stays unconditional), `src/app/home-view.ts` (include the open, unexpired preview as `reshuffle?: ReshufflePreviewView`), `tests/e2e/fixture-server.ts` (wire `plan` deps with fakes so later web tasks can use it), + tests.
**Routes:** `POST /api/plan/reshuffle` (body = ReshuffleRequest; validated in shell), `POST /api/plan/reshuffle/approve` `{ proposalId }`, `POST /api/plan/reshuffle/discard` `{ proposalId }`. Each calls ONE app fn, `wire()`/`httpStatus()`.
**Tests:** route validation 400s; happy paths via fake deps; chat "I'm behind" returns a question with Approve/Discard and writes no Plan; blocker still reflows immediately; home view carries an open preview and omits an expired one.
**Commit:** `feat(plan): reshuffle routes; chat re-flow previews before applying`

## T5: Pins, moves, drops, swaps (10.5 server + move-block, R6, R7)
**Owns:** `src/adapters/plan-state-store.ts` (tables `day_pins(date, subject_kind, subject_id, start)` and `day_drops(date, task_id)`; `*InTx` writers; readers by date), `src/rituals/reshuffle.ts` (pins/drops inputs: pinned Tasks removed from population before ordering and placed first; pin-overlap rejection), `src/types/domain.ts` (remaining ReshuffleRequest kinds; `PlanBlock.pinned?: true`), `src/app/request-reshuffle.ts` (resolve each request kind to the day's pins/drops set), `src/app/approve-reshuffle.ts` (persist pins/drops in the same writeTx), `src/app/home-view.ts` + `src/types/api.ts` (`HomeCalendarBlock.taskId?`, `pinned?`; `HomePlanRow.pinned?`), + tests. Morning/reflow callers load the day's pins/drops (reflow + morning pass them into computeDayRefit).
**Tests:** pinned Task placed exactly once at its pin, split by the normal rule; others keep Derived Priority order (pins never reach derived-priority/slip-bump/completion-log — prove with spies/inputs); pin overlapping a fixed event → rejectedReason names it, plan unchanged; move-block of a work block ≡ pin-task; unknown planBlockId → stale-proposal; drop removes the Task for today; swap = drop + pin; approve persists pins/drops in the same transaction as the Plan (rollback test); pins for another date ignored.
**Commit:** `feat(plan): pin, move, drop and swap Tasks — placed around by the one pipeline`

## T6a: Routines — store, chat declaration (10.3 part 1, R8)
**Owns:** new `src/adapters/routine-store.ts` (`initRoutineStoreSchema`, table `routines(id, label, days, start, duration_minutes)`, CRUD), new `src/core/routine-commands.ts` (parse add/change/remove/list), new `src/app/routines.ts` (`manageRoutine`), `src/app/chat-turn.ts` (route BEFORE `isPlanEditRequest`), schema init in `src/shell/server.ts`, `src/shell/ritual-cli.ts`, `tests/e2e/fixture-server.ts`, + tests.
**Parses:** "my commute is 3:00–3:30 on weekdays", "lunch is 12 to 12:30 every day", "change my commute to 3:15", "remove my commute routine", "what are my routines". Days: weekdays, weekends, every day/daily, named days. Receipt one line: "Added your commute: weekdays, 3:00–3:30 PM."
**Tests:** parser positives/negatives (plan-edit lines and task captures don't match); store idempotent init; add/change/remove/list via app; chat routes.
**Commit:** `feat(routines): declare routines in chat — stored once, own table`

## T6b: Routines placed every day (10.3 part 2, R8)
**Owns:** new `src/core/routine-placement.ts` (pure: routines × day × fixed events → routine blocks + unplaced labels), `src/types/domain.ts` (`PlanBlockKind` adds `"routine"`, `PlanBlock.routineId?`, `Plan.unplacedRoutineLabels?`), `src/rituals/reshuffle.ts` (precedence: anchors + pins → routines → work/break), `src/rituals/morning-ritual.ts` + `src/shell/ritual-cli/morning-deps.ts` (load routines), `src/app/home-view.ts`, `src/app/calendar-day.ts`, `src/types/api.ts` (`HomeCalendarBlock.kind` adds `"routine"`), `web/src/components/CalendarDayView.tsx` (Yoh-owned style with the routine label), `src/rituals/ritual-shared.ts` (render line). Audit every `kind ===` site in facts §11 and state in the report how each treats `routine`.
**Tests:** routine at declared time; shifted to nearest free slot around an anchor/pin; unfit → unplaced label, never dropped silently; routine written through writeCalendarPlan (non-anchor filter includes it); not a checklist row; budget unaffected; Home renders label.
**Commit:** `feat(routines): place routines every day — anchors and pins, then routines, then work`

## T7: Chat plan edits (HANDOFF add, R9)
**Owns:** new `src/core/plan-edit-commands.ts` (parse "work on X instead of Y", "move X after lunch", "move X to 4", "move my study block to 4", "drop X today", "unpin X" → `{ kind, targetText, otherText?, when? }`; resolve against a supplied list of plan blocks/tasks → ReshuffleRequest or a reply), `src/core/chat-commands.ts` (`isPlanEditRequest` kept as the catch-all), `src/app/chat-turn.ts` (route: parse → `requestReshuffle` → question; unparseable plan-edit → new honest how-to reply; delete `PLAN_EDIT_NOT_SUPPORTED_REPLY`), + tests (`tests/chat-commands.test.ts` list updates, `tests/app-chat-turn.test.ts`).
**Tests:** each phrase → correct request; ambiguous name → asks, lists ≤3; unknown → "I couldn't find …"; "after lunch" school day vs not; time parsing per R8; routine target ("study block" routine or task) resolves; old reply constant gone (grep).
**Commit:** `feat(chat): plan edits in chat — swap, move, drop and unpin preview before applying`

## T8a: Home reshuffle preview card, pin control, pinned badge (10.4/10.5 web, non-drag)
**Owns:** new `web/src/lib/reshuffle.ts` (request/approve/discard clients; module store fed by home view), new `web/src/components/ReshufflePreviewCard.tsx` (one-line summary, Primary "Approve", Secondary "Discard", deferred names; stale → shows fresh preview; errors visible), `web/src/pages/Home.tsx` (render card under calendar; calendar shows proposed blocks while open, moved blocks with 1.5px accent-solid outline; Discard/navigate away restores), `web/src/components/CalendarDayView.tsx` (moved outline; pin control on pinned blocks — pin glyph on `surface-sunken` pill, button "Unpin <label>" → unpin request), `web/src/components/PlanChecklist.tsx` (indicator-only "pinned" badge), `web/src/lib/homeView.ts` (also refetch on `open-items` hint) + Vitest.
**Tests:** card renders summary + buttons; approve success refetches; stale shows new summary; discard restores; unpin click sends request; badge not interactive; reduced motion honored (no transition classes).
**Commit:** `feat(web): reshuffle preview card, pin control and pinned badge on Home`

## T8b: Drag a block (10.4 drag, Playwright)
**Owns:** `web/package.json` (+ lock) `@dnd-kit/react` pinned exact, new `web/src/hooks/useBlockDrag.ts` (the one drag hook; snaps to 5 min by y-offset over `HOUR_HEIGHT_PX`; keyboard sensor), `web/src/components/CalendarDayView.tsx` (draggable work/routine blocks only per R6; lifted style 1.5px accent-solid outline, "(dragging, from 2:00)" label, gentle bob via tokens; drags blocked while a preview is open; animated glide to proposed slots, cross-fade under reduced motion), `tests/e2e/fixture-server.ts` (complete fixture Tasks for the plan deps + a fixture-only reset so the spec doesn't disturb check-off specs; keep existing exports), new `web/e2e/reshuffle.spec.ts` (drag → preview appears → Approve → Plan reorders), + Vitest for the hook.
**Commit:** `feat(web): drag a Plan block to reshuffle the day`

## Final review
Opus whole-branch review on `review-30fb433..<HEAD>.diff`: folds per-task reviews for T3, T4a, T4b, T6a, T7, T8a, T8b; checks layering, one pipeline (grep), no Calendar write before Approve, TTL/one-open, pins never reach priority, R1 floor, a11y of the card/drag, fixture isolation. Then fix round (Sonnet) and Sonnet re-review. Merge per HANDOFF §4 standing authorization.

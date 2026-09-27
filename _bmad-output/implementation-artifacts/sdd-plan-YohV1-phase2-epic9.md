# Yoh — SDD Implementation Plan, Phase 2 (Epic 9)

**Derived plan file for superpowers:subagent-driven-development.** This file exists
only so the SDD scripts (`task-brief`, `review-package`) have `## Task N` headings
to key on. It is *not* a new source of requirements. It packages the approved
planning documents into task-shaped briefs:

- **Spec (binding authority):** `_bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md`
  (AD-1, AD-2, AD-5, AD-8, AD-9, AD-11, AD-12, AD-16, AD-17, AD-18 are the ones Epic 9 leans on)
- **Plan argument (task/story breakdown):** `_bmad-output/planning-artifacts/epics.md`, "## Epic 9: Missing data never blocks the day" (Stories 9.1–9.4, as amended 2026-09-27)
- **UX:** `_bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/DESIGN.md` and `EXPERIENCE.md`
  (UX-DR39 — Sandbox Card and Sandbox Finale — and UX-DR42 — Needs-Data Indicator — apply to Epic 9)
- **Per-story implementation plans:** `docs/superpowers/plans/2026-09-27-story-9.N-<slug>.md` (one per story task below)
- **Precedent and format:** `_bmad-output/implementation-artifacts/sdd-plan-YohV1-phase2-epic8.md` (Global Constraints, Interface Contract, and per-task shape), amended by `sdd-plan-YohV1-phase2-fixes-ui.md` (IA decisions: page order, Chat is a panel, swipe retired) and `sdd-plan-YohV1-polish-1.md` (plain-language notification copy, readable notification cards).

Every acceptance-criteria block below is copied verbatim from `epics.md`. The
"Depends on / Owns / Per-story plan / Implementer notes" lines above each story
are packaging only. They point at spine rules, record controller rulings, and
resolve ordering; they add no requirements. Epic 9 has exactly four stories and
four tasks, one per story, built in order: the two-tier gate must exist before
`/sandbox` can compute a queue from it, `/sandbox` must exist before its Finale
can settle its writes, and the Finale's per-session outcome shape is what the
Needs-Data Indicator's notification path reuses.

## Global Constraints

These bind every task. Copy the relevant subset into each dispatch's
"global constraints" block. Do not paste this whole section into every prompt.

**Still binding from Epic 8 (`sdd-plan-YohV1-phase2-epic8.md`), unchanged:**

- **Layering (AD-1):** `shell/{server,ritual-cli}.ts → app → {rituals, core, adapters}`;
  `ritual-cli.ts` and `rituals/` **never import `app/`**; `core/` imports only
  `types/` and other `core/`; `web/` imports only `import type` from `src/types/`.
  `tests/layering-rules.test.ts` enforces this and must stay green. (`chat-cli.ts`
  is gone — Story 8.9 retired it; every chat surface is `app/chat-turn.ts` reached
  through `shell/server.ts`.)
- **`app/` layer (AD-16):** one file per interaction use-case. Every exported
  function in `src/app/*.ts` is shaped `(deps, input) → Promise<Result<Output,
  YohError>>`. Pure parsers and recognizers live in `core/`, never in `app/`.
  `app/` functions are one-shot per turn and never block for input.
- **Functional core (AD-2, AD-8):** `core/*.ts` exports are pure (no I/O, no
  module state, no argument mutation, never throws). `adapters/*.ts` may throw;
  `app/`/`rituals/` catch and convert to `Result`.
- **Propose-Don't-Impose (AD-3):** unaffected by Epic 9. FR-24/FR-29-style direct
  writes (and now FR-38's per-card sandbox writes) never pass through
  `confirm-proposal.ts`; nothing in Epic 9 opens a `Proposal`.
- **Storage (AD-10):** `adapters/sqlite.ts` stays the only opener; multi-step
  writes use `writeTx`; every user-visible change appends one outbox row in the
  same transaction (AD-18).
- **Live delivery (AD-18):** the web client reuses the single shared
  `EventSource` in `web/src/lib/eventBus.ts` for hints; it never opens a second
  one. `NotificationKind` stays the closed union — Epic 9's three kinds
  (`sandbox-complete`, `sandbox-failed`, `needs-data`) are **already** in it
  (verified against `src/types/api.ts`; no union edit is needed).
- **Browser client (AD-17):** every queue, card, and count is computed
  server-side. Optimistic UI is visual only; a failure renders as a failure.
- **Web UI (FR-46, NFR-Accessibility):** tokens only in `web/src/tokens.css`.
  Every animation reads `web/src/hooks/useReducedMotion.ts` and has an instant
  fallback. Neutral, guilt-free copy, no emoji. Contrast meets WCAG 2.2 AA in
  both themes.
- **Tone (FR-18, FR-19, FR-42):** peer-level, no filler.
- **Tests:** `node:test` for `src/`, Vitest + RTL for `web/`, Playwright smoke
  for `web/`. The per-task gate is `npm run check` (typecheck, web typecheck,
  web build, node tests, web tests) plus `cd web && npx playwright test`.
  **Baseline, taken fresh at this plan's HEAD (`78350fa`):** node 1375, web 386,
  Playwright ~20 (static count of `test(` in `web/e2e/`; not all executed for
  this baseline reading — the implementer's own `npx playwright test` run is
  the gate). Tests start green and stay green after every task.

**Amended since Epic 8 (fixes + UI plan, `sdd-plan-YohV1-phase2-fixes-ui.md`, and polish-1):**

- **Pages are Home, Tasks, Desk, Research Hub.** There is no Chat page and no
  swipe gesture anywhere. Chat is a panel (`web/src/components/ChatPanel.tsx`),
  opened from the "Ask Yoh" pill or ⌘K, that covers the content area with the
  sidebar still visible. Navigation is the vertical page stack (arrows, ↑/↓,
  edge-aware wheel, sidebar) — `web/src/lib/pages.ts`'s `PAGES` list has no
  `"chat"` entry, and nothing in Epic 9 adds one (the panel is not a page).
- **`/plan` exists** (`src/app/plan-day.ts`) alongside `/morning`/`/night`,
  reusing `rituals/morning-ritual.ts`'s `runMorningRitual` with `sendNotification`
  a no-op (no Pushover push). Epic 9's `needs-data` notification is an **in-app**
  notification, never a push, so it is unaffected by that no-op and must still
  fire on an on-demand `/plan` run exactly as it does on the 6am cron run — see
  Task 4's implementer notes.
- **Tasks is a full page already**, not the "minimal route stub" Epic 9's own
  story text describes (`web/src/pages/Tasks.tsx`, shipped by Story 11.1,
  pulled forward 2026-09-27). Story 9.4's "minimal route stub" language is
  superseded: the Needs-Data Indicator lands on the real Tasks page header.
- **Error copy is honest and centralized** in `core/error-copy.ts`
  (`errorCopy`/`errorCopyForThrown`) — every new `app/` file in this plan uses
  it for every Notion-write failure, never a raw adapter string.
- **Notification card style is already fixed** (polish-1): opaque/glass-with-
  solid-backdrop cards, capped at 3 + "+N more", plain short sentences, no
  internal names or ISO timestamps. Epic 9's three notification bodies follow
  that register from the start — no separate polish pass needed.

**Epic 9 specifics:**

- **The two-tier gate is a type-level change (AD-11).** `CompleteTask` requires
  only Due Date and Estimated Duration; Area and Energy become `Refining<T>` —
  never `T | undefined`, never a defaulted `T`. Status is **not** a gate field
  at all any more (`[PRD ASSUMPTION, adopted]`: empty Status = eligible) — Task 1
  removes it from the gate's field list entirely, not just from `CompleteTask`'s
  required set.
- **`/sandbox`'s queue is computed, not stored (AD-11).** No new SQLite table,
  no new `InteractionRequest` kind. `app/sandbox-queue.ts` re-derives the queue
  from a live Notion read plus the same gate every time it's called. It is the
  **one** source every consumer (the card flow, the Needs-Data Indicator, the
  needs-data notification's count) reads — none of them keeps its own count.
- **Sandbox Cards are not Structured Questions.** They never touch
  `memory-store.ts`'s `interaction-request` table, never go through
  `app/answer-open-item.ts`/`app/confirm-proposal.ts`, and are not surfaced by
  `app/surface-open-items.ts`. They are their own small API surface
  (`/api/sandbox/*`), reusing `core/planning-field-value.ts` and the existing
  Notion select-guard for validation exactly as `app/update-task.ts` does today.
- **Sandbox writes are direct writes (FR-38, AD-12 amended 2026-09-27 for
  Spencer-typed Tasks — same tier).** No confirm step, no `Proposal`.
- **This is the first epic to set a real `deepLink`.** Every notification
  raised so far in this codebase carries `deepLink: null`
  (`web/src/components/NotificationOverlay.tsx`'s own doc comment confirms no
  producer has ever set one). Since Chat is a panel, not a `PAGES` entry, "deep-
  links to Chat" cannot resolve through `resolveDeepLinkIndex`. Task 3 defines
  the convention (`"chat"` / `"chat:/sandbox"`) and extends
  `NotificationOverlay.tsx` to open the panel (and optionally run a command)
  instead of navigating pages; Task 4 reuses it verbatim.

---

## Epic 9 Interface Contract (controller rulings, binding on every task)

Tasks are built in order, but the names below are fixed here up front. A task
may **add** fields or helpers, but may not rename, re-home, or reshape anything
listed. If a task finds a listed shape unworkable, the implementer reports
`DONE_WITH_CONCERNS` and the controller rules.

### E1. `types/domain.ts` — `Refining<T>` and the reshaped `CompleteTask`

```ts
// New (Task 1). Never T | undefined, never a defaulted T.
export type Refining<T> = { readonly kind: "set"; readonly value: T } | { readonly kind: "missing" };

// New (Task 1). The two Required Fields (FR-4 amended) — the only fields the
// gate can hold a Task back for. `PlanningFieldNames` itself is UNCHANGED
// (still all five names: it's still "a planning field name" for the Tasks
// page, FR-25 suggestions, and answer parsing) — this is a narrower, new,
// additive alias naming the gate's own required subset.
export type RequiredFieldNames = "dueDate" | "estimatedDurationMinutes";

// New (Task 1). The two Refining Fields.
export type RefiningFieldNames = "area" | "energy";

// Reshaped (Task 1) — was Omit<Task, PlanningFieldNames> & Required<Pick<Task, PlanningFieldNames>>.
export interface CompleteTask
  extends Omit<Task, RequiredFieldNames | RefiningFieldNames>,
    Required<Pick<Task, RequiredFieldNames>> {
  readonly area: Refining<Area>;
  readonly energy: Refining<Energy>;
}
```

`status` is untouched by this reshape (it was never in `RequiredFieldNames`/
`RefiningFieldNames`, so `Omit<Task, ...>` still carries it through as the
plain, optional `Task["status"]` it always was) — matching "Status decides
eligibility [for planning generally] and is not a gate field."

### E2. `core/data-completeness-gate.ts` — the reshaped gate

- `checkDataCompleteness` computes missingness over **`RequiredFieldNames`
  only** (`["dueDate", "estimatedDurationMinutes"]`) — Status leaves the field
  list entirely, not just the required set.
- `toCompleteTask` always wraps `task.area`/`task.energy` into `Refining<T>`
  (`{kind:"set", value}` when present, `{kind:"missing"}` when absent) on the
  way to `CompleteTask` — this is the **only** place that wrapping happens.
- `MissingFieldReport.missingFields` narrows to `readonly RequiredFieldNames[]`.
- A Task missing only Area and/or Energy is **not** reported in `incomplete`
  at all — it's fully eligible and appears in `completeTasks` with one or both
  fields `{kind:"missing"}`. Only a Task missing a Required Field appears in
  `incomplete` (and is absent from `completeTasks`).

### E3. `core/derived-priority.ts` — the neutral score

- `computeSecondaryScoreDetails` unwraps `task.area`/`task.energy` before
  scoring. A `{kind:"missing"}` Area is excluded from the alphabetical-rank
  set entirely (it doesn't participate in `distinctAreasSorted`) and its
  `areaSub` is the fixed neutral value `0.5`. A `{kind:"missing"}` Energy's
  `energySub` is also the fixed neutral value `0.5` (coincidentally already
  `ENERGY_RANK.medium`'s value — reuse that constant, don't invent a new one).
  "Neutral" per AD-11/FR-4: neither favors nor penalizes. This value exists
  only inside this computation — never stored, never sent to the client as a
  real Area/Energy, never written to Notion.
- `orderByDerivedPriority`/`computeDerivedPriorityFactors`'s own signatures
  are unchanged (`CompleteTask[]` in, same out) — this is an internal-only
  change.

### E4. `types/domain.ts` / `Plan` — carrying the missing-Refining list

```ts
// PlanBlock gains one optional field (Task 1, additive per AD-9's own
// "extend this file instead of redeclaring" allowance). Present only on a
// "work" block whose Task had one or both Refining fields {kind:"missing"}.
export interface PlanBlock {
  // ...unchanged fields...
  readonly missingRefining?: readonly RefiningFieldNames[];
}
```

`rituals/morning-ritual.ts` (and `mid-day-reflow.ts`, unchanged behavior
otherwise) sets this when assembling each `"work"` block from its
`CompleteTask`. `types/api.ts`'s `HomePlanRow` gains the same optional field
(additive, C2-style: added, never widened) so `app/home-view.ts` can pass it
through untouched, and Home's Plan Row renders a glyph + text (e.g. "no
Energy") — never color alone (NFR-Accessibility).

### E5. `app/sandbox-queue.ts` (Task 2) — the one computed source

```ts
export interface SandboxQueueItem {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly dueDate?: IsoDate;
  readonly estimatedDurationMinutes?: number;
  readonly area?: string;
  readonly energy?: Energy;
  /** Always non-empty — which Required field(s) this Task is missing. */
  readonly missingFields: readonly RequiredFieldNames[];
}
export interface SandboxQueueDeps {
  readonly store: MemoryStore;             // for mergeStoredOverrides, reused from rituals/data-completeness.ts
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}
export interface SandboxQueueInput {
  /** taskIds to leave out — the CURRENT `/sandbox` session's already-handled cards (saved or skipped this run). Omitted/`[]` for the "true" global count (the Indicator, the notification). */
  readonly exclude?: readonly string[];
}
export interface SandboxQueueResponse {
  /** Soonest-due-first; no-due-date last; ties broken by title (stable). */
  readonly items: readonly SandboxQueueItem[];
}
export function sandboxQueue(
  deps: SandboxQueueDeps,
  input: SandboxQueueInput,
): Promise<Result<SandboxQueueResponse, YohError>>;
```

`sandboxQueue` reads live Tasks, merges stored `TaskFieldOverride`s
(`rituals/data-completeness.ts`'s `mergeStoredOverrides` — `app/` importing
`rituals/` is permitted, precedent: `app/night-close-out.ts`), runs
`checkDataCompleteness`, and returns one `SandboxQueueItem` per
`MissingFieldReport`, minus anything in `input.exclude`, ordered soonest-due
first with no-due-date last. **Every caller of this function — the
`/sandbox` card flow, the Needs-Data Indicator, and the `needs-data`
notification's count — goes through this one export.** None keeps its own
count (AD-11).

### E6. `app/sandbox-submit.ts` (Task 2 saves the card; Task 3 adds the finale)

```ts
// Task 2
export interface SandboxCardInput {
  readonly taskId: string;
  readonly dueDate: string;                    // raw; parsed via parsePlanningFieldValue
  readonly estimatedDurationMinutes: string;   // raw
  readonly area?: string;                      // raw, optional
  readonly energy?: string;                    // raw, optional
}
export interface SandboxCardOutput {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly receipt: string;
}
export function submitSandboxCard(
  deps: SandboxSubmitDeps,
  input: SandboxCardInput,
): Promise<Result<SandboxCardOutput, YohError>>;

// Task 3
export interface SandboxSessionOutcome {
  readonly taskId: string;
  readonly taskTitle: string;
  /** true = this card's write succeeded this session; a skipped card never appears here. */
  readonly ok: boolean;
}
export interface SandboxFinishInput {
  readonly outcomes: readonly SandboxSessionOutcome[];
}
export interface SandboxFinishOutput {
  readonly savedCount: number;
  readonly failedTitles: readonly string[];
}
export function finishSandboxSession(
  deps: SandboxSubmitDeps,
  input: SandboxFinishInput,
): Promise<Result<SandboxFinishOutput, YohError>>;
```

`submitSandboxCard` **validates every provided field first** (Due Date and
Estimated Duration through `parsePlanningFieldValue`; Area/Energy, if
present, through the same parse **and** the live-schema select-guard
resolution `app/update-task.ts`'s `describe`/write path already does) —
`ok:false` on any failure, and **nothing is written**, matching FR-38's "an
unresolvable value re-prompts on that card and writes nothing." Only once
every provided field is valid does it call `NotionTaskWriteBindings.updateTaskField`
once per present field (reusing the same binder `update-task.ts` uses — no
new Notion call shape), and appends one `tasks`-topic outbox hint (AD-18,
reusing `appendOutboxInTx`, same pattern as `update-task.ts`'s `hint`).

`finishSandboxSession` raises **at most one** of `sandbox-complete` /
`sandbox-failed` (never both) via `createNotificationInTx`, using the
`"chat"` / `"chat:/sandbox"` deep-link convention (E8). See Task 3's
implementer notes for the "all-skip session" ruling.

### E7. `types/api.ts` — wire shapes (added, never widened)

```ts
// Task 2
export interface SandboxCardView {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly dueDate?: IsoDate;
  readonly estimatedDurationMinutes?: number;
  readonly area?: string;
  readonly energy?: Energy;
  /** The queue's length AFTER this card — what the card itself shows as "N remaining". */
  readonly remaining: number;
}
export interface SandboxStartRequest { readonly exclude?: readonly string[]; }
export interface SandboxStartResponse { readonly card: SandboxCardView | undefined; } // undefined = empty queue

export interface SandboxSaveRequest {
  readonly dueDate: string;
  readonly estimatedDurationMinutes: string;
  readonly area?: string;
  readonly energy?: string;
  /** This session's already-handled taskIds, NOT including this card. */
  readonly exclude: readonly string[];
}
export interface SandboxSaveResponse {
  readonly receipt: string;
  readonly next: SandboxCardView | undefined; // undefined = queue now empty
}
export interface SandboxSkipRequest { readonly exclude: readonly string[]; }
export interface SandboxSkipResponse { readonly next: SandboxCardView | undefined; }

// Task 3
export interface SandboxOutcome { readonly taskId: string; readonly taskTitle: string; readonly ok: boolean; }
export interface SandboxFinishRequest { readonly outcomes: readonly SandboxOutcome[]; }
export interface SandboxFinishResponse { readonly savedCount: number; readonly failedTitles: readonly string[]; }

// Task 4
export interface NeedsDataCountResponse { readonly count: number; }
```

`ChatTurnResponse` (Story 8.3, unchanged shape) gains one additive optional
field in Task 2: `readonly sandboxCard?: SandboxCardView` (a fifth kind of
follow-up alongside `question`, never both on the same turn) — this is how
`/sandbox`'s first card reaches Chat through the existing `chatTurn`
dispatch, with no new route needed for the *first* card. Every subsequent
card, save, and skip goes through the routes in E9 below.

### E8. Deep-link convention (Task 3 defines; Task 4 reuses)

- `deepLink: "chat"` — open the Chat panel only (`sandbox-complete`).
- `deepLink: "chat:/sandbox"` — open the Chat panel **and** immediately send
  `/sandbox` as if typed (`sandbox-failed`, `needs-data`).
- One shared helper, `openChatWithCommand(command?: string)`, added to
  `web/src/lib/chatPanel.ts` (calls `openChatPanel()`, then, if given,
  `chatStore.ts`'s `send(command)`). `NotificationOverlay.tsx`'s `activate()`
  is extended: a `deepLink` starting with `"chat"` calls this helper instead
  of `resolveDeepLinkIndex`/`nav.goTo`; every existing page-id deep link
  (none is in production use yet, per the file's own doc comment) keeps
  working unchanged.

### E9. Server routes (Tasks 2–4)

| Route | Calls | Task |
|---|---|---|
| `POST /api/sandbox/start` (body `SandboxStartRequest`) → `SandboxStartResponse` | `sandboxQueue` (first item) | 2 |
| `POST /api/sandbox/:taskId/save` (body `SandboxSaveRequest`) → `SandboxSaveResponse` | `submitSandboxCard`, then `sandboxQueue` (exclude + this id) for `next` | 2 |
| `POST /api/sandbox/:taskId/skip` (body `SandboxSkipRequest`) → `SandboxSkipResponse` | `sandboxQueue` (exclude + this id) for `next`; no write | 2 |
| `POST /api/sandbox/finish` (body `SandboxFinishRequest`) → `SandboxFinishResponse` | `finishSandboxSession` | 3 |
| `GET /api/sandbox/count` → `ApiResult<NeedsDataCountResponse>` | `sandboxQueue({})`, count only | 4 |

`chatTurn`'s existing `/`-dispatch (Story 8.7) handles `/sandbox` itself: it
calls `sandboxQueue({})` directly (no route needed for the *first* card —
see E7) and returns either the empty-queue reply ("Nothing's missing a Due
Date or Duration.") or a `ChatTurnResponse` carrying `sandboxCard`.

### E10. Web client files

| File | Role | Task |
|---|---|---|
| `web/src/lib/sandbox.ts` | Client-held session state (`useSyncExternalStore`, same shape family as `chatStore.ts`/`chatPanel.ts`): the accumulating `exclude` set, the current `SandboxCardView`, and the list of `SandboxOutcome`s collected so far this session. `startSandbox()`, `saveCard(input)`, `skipCard()`, `finishSandbox()`. | 2 (3 extends) |
| `web/src/components/SandboxCard.tsx` | UX-DR39's card: Task name, Due Date + Estimated Duration (rimmed, required), Area + Energy (optional), Secondary "Skip", Primary "Save" (disabled until both Required fields are filled), "N remaining" in `typography.numerals`. | 2 |
| `chatStore.ts` (extended) | Gains a `StreamEntry` union — `{kind:"message"; turn: ChatTurn} | {kind:"sandbox-card"; view: SandboxCardView; status:"pending"\|"saved"\|"skipped"\|"failed"; receipt?: string}` — so a card renders inline in the stream and "stays in chat history" once saved/skipped, while `history` sent to the server (`ChatTurnRequest.history`) is still built from the `"message"` entries only (a card is never appended to the LLM-facing transcript). | 2 |
| `web/src/components/SandboxFinale.tsx` | UX-DR39's finale: a right-aligned `accent-solid` loading bar while `POST /api/sandbox/finish` is in flight, then "Saved {n} Tasks" or "Couldn't save {Task}" (one line per failure) as a stream entry. | 3 |
| `web/src/lib/sandboxSound.ts` | `playSandboxCompleteChime()` — a short chime **generated with the Web Audio API** (an `OscillatorNode` envelope; no external audio asset), played once per session, only when `≥1` card was saved this session (E6's ruling) and reduced motion is off. Volume modest, and the one call site is this file's own export, so it's swappable in one place (resolves OQ16). System mute is a hardware/OS-level attenuation of any audio output, so no separate "is muted" check is needed or possible from `web/`. | 3 |
| `web/src/components/NotificationOverlay.tsx` (extended) | `activate()` recognizes the `"chat"`/`"chat:/sandbox"` deep-link convention (E8). | 3 |
| `web/src/components/NeedsDataIndicator.tsx` | UX-DR42: "3 need data" in `typography.numerals`, Secondary-style rim, hidden at 0. Reads `GET /api/sandbox/count`, refetched on mount and on a `tasks`/`sandbox` outbox hint via the shared `eventBus.ts`. Click calls `openChatWithCommand("/sandbox")`. | 4 |
| `web/src/pages/Tasks.tsx` (extended) | Mounts `NeedsDataIndicator` in the page header. | 4 |

---

## Task 1: Story 9.1 — Two-Tier Data-Completeness Gate

**Depends on:** nothing (first task). **Owns:** `Refining<T>`, `RequiredFieldNames`,
`RefiningFieldNames`, the reshaped `CompleteTask` in `src/types/domain.ts`
(E1); the reshaped `checkDataCompleteness`/`toCompleteTask`/
`MissingFieldReport` in `src/core/data-completeness-gate.ts` (E2); the
unwrap-and-neutral-score change in `src/core/derived-priority.ts` (E3);
`PlanBlock.missingRefining` + its assembly in `src/rituals/morning-ritual.ts`
(and `mid-day-reflow.ts` if it independently builds `"work"` blocks rather
than delegating) (E4); `types/api.ts`'s `HomePlanRow.missingRefining` +
`app/home-view.ts` passing it through; `web/src/pages/Home.tsx`'s Plan Row
incomplete marker (glyph + text, e.g. "no Energy" — never color alone); every
Epic 1 test asserting all-five-fields gating, updated to the two-tier
contract; `sprint-status.yaml`: `epic-9` → `in-progress`, `9-1-two-tier-data-completeness-gate` → `done`.

**Per-story plan:** `docs/superpowers/plans/2026-09-27-story-9.1-two-tier-data-completeness-gate.md`

**Implementer notes:** Contract E1–E4 bind. This is a type-level, single-
process change with a wide blast radius (every downstream consumer of
`CompleteTask.area`/`.energy` must unwrap `Refining<T>` — grep
`\.area\b|\.energy\b` across `core/`, `app/`, `rituals/` before starting;
`work-break-fit.ts`/`plan-reasoning.ts` were checked while writing this plan
and neither reads `.area`/`.energy` directly, only `derived-priority.ts`
does). `data-completeness-gate.ts`'s own doc comment currently says "five
planning fields" throughout — update it in place, don't leave it stale. The
`Refining` neutral score is internal-only: it is never stored in
`memory-store.ts`, never serialized to `TaskListItem`/`TaskGroup` (the Tasks
page keeps reading `task.area`/`task.energy` as plain optional values — it
has no gate-shaped view and needs none), and never written to Notion. A Task
missing only Area and/or Energy is fully eligible for `/sandbox`'s queue
(Task 2) **only if** it's *also* missing a Required field — `FR-36`
("Tasks missing only Refining Fields are not queued") is Task 2's concern,
but this task's `checkDataCompleteness` reshape is what makes that possible
(a Refining-only-missing Task never appears in `incomplete` at all any
more). **Model: Sonnet.** Wide (many locked files touched) but single-
process — no cross-surface protocol to keep in agreement, unlike Story 8.5's
SSE work.

**Controller rulings (pre-execution):** (a) Status is removed from the
gate's field list entirely (not narrowed to Refining) — `[PRD ASSUMPTION,
adopted]` per epics.md, "empty Status = eligible" describes eligibility for
planning at all, not a Refining tier. (b) `PlanningFieldNames` itself is
**not** renamed or split — it stays the existing five-name union, since
`core/planning-field-value.ts`, the Tasks page, and FR-25 suggestions still
need to parse/label all five; `RequiredFieldNames`/`RefiningFieldNames` are
new, additive, narrower aliases used only by the gate and its consumers. (c)
`ENERGY_RANK.medium` (`0.5`) is reused verbatim as the neutral Energy score
rather than inventing a second constant — document the coincidence, don't
hide it.

As Spencer,
I want a Task missing only its Area or Energy to still be planned, and clearly marked as incomplete,
So that one empty tie-breaker field no longer keeps real work off my day.

**Acceptance Criteria:**

**Given** `types/domain.ts`
**When** this story is complete
**Then** `CompleteTask` requires only Due Date and Estimated Duration. Area and Energy are typed `Refining<T> = {kind:'set', value:T} | {kind:'missing'}`, never `T | undefined` and never a defaulted `T` (AD-11, FR-4 amended).
**And** `data-completeness-gate.ts` is still the only producer of `CompleteTask`

**Given** a Task missing only Area and/or Energy
**When** the Morning Plan, or any later re-plan, is built
**Then** it is placed. `derived-priority.ts` maps `'missing'` to a neutral score that neither favors nor penalizes the Task, and that value exists only inside the scoring computation. It is never stored, never sent to the client as a real value, and never written to Notion.
**And** the Plan carries that Task's list of missing Refining fields

**Given** a placed Task with missing Refining fields
**When** Home renders its Plan Row
**Then** the row is visibly marked incomplete with a glyph plus text (e.g. "no Energy"), never by color alone

**Given** a Task missing a Required field
**When** the Plan is built
**Then** it is not placed and cannot become a `CompleteTask`. The existing `missing-field` placeholder request is still created.

**Given** a Task with an empty Status
**When** the gate runs
**Then** it is treated as eligible, not gated `[PRD ASSUMPTION, adopted]`

**Given** the Epic 1 tests that assumed all five fields gate
**When** the suite runs
**Then** those tests are updated to the two-tier contract. Every other planning test passes.

---

## Task 2: Story 9.2 — /sandbox Card Flow

**Depends on:** Task 1. **Owns:** `src/app/sandbox-queue.ts` (new, E5), the
save half of `src/app/sandbox-submit.ts` (new, E6's `submitSandboxCard`);
`/sandbox` appended to `src/app/commands.ts`'s `COMMANDS`; `chatTurn`'s
`/sandbox` dispatch and `ChatTurnResponse.sandboxCard` (E7); the E9 routes
`POST /api/sandbox/start`, `POST /api/sandbox/:taskId/save`,
`POST /api/sandbox/:taskId/skip` in `src/shell/server.ts` (+ `tests/e2e/fixture-server.ts`
wiring); `web/src/lib/sandbox.ts`, `web/src/components/SandboxCard.tsx`, the
`StreamEntry` extension of `chatStore.ts` (E10); tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-27-story-9.2-sandbox-card-flow.md`

**Implementer notes:** Contract E5–E7, E9–E10 bind. `sandboxQueue` reuses
`rituals/data-completeness.ts`'s `mergeStoredOverrides` (`app/` → `rituals/`
is a permitted edge, precedent: `app/night-close-out.ts`) — it must **not**
duplicate that merge logic. `submitSandboxCard` reuses the exact select-guard
resolution `app/update-task.ts`'s write path already performs for Area/
Energy (same live-schema lookup, same rejection message shape) — do not
invent a second guard. Validate every provided field **before** writing
any of them: a card with a bad Area or Energy writes nothing at all, even
if Due Date and Estimated Duration parsed fine (FR-38's "an unresolvable
value re-prompts on that card and writes nothing" reads as whole-card, not
per-field). "Save stays disabled until both Required fields are filled" is
enforced redundantly client- and server-side (the client disables the
button; the server still validates on its own, since AD-17 computes
everything server-side and a client bug must not become a bad write). The
client's `exclude` set accumulates **both** skipped and saved taskIds this
session (not just skipped) — this is deliberate: it also guards against
Notion read-after-write staleness making a just-saved Task reappear at the
top of the very next `sandboxQueue` call before Notion's own read model has
caught up. **Model: Opus.** This is Epic 9's one genuinely cross-process
story: a new command dispatched through `chatTurn`, three new routes, a new
client-side session store, and a new inline-in-the-stream card component,
all of which must agree on the same `SandboxCardView` shape and the same
disabled/validation rules — comparable in shape (though smaller in scope)
to Story 8.5's SSE work.

**Controller rulings (pre-execution):** (a) `/sandbox`'s *first* card comes
back on `ChatTurnResponse.sandboxCard` through the existing `chatTurn`
dispatch (no new route for it) — every subsequent card comes from `next` on
a save/skip response. (b) An empty queue at `/sandbox` time replies "Nothing's
missing a Due Date or Duration." as plain `ChatTurnResponse.reply` text, with
`sandboxCard` left `undefined` — matching the AC's "no finale" (there's
nothing to finish). (c) `SandboxQueueItem.dueDate`/`estimatedDurationMinutes`
carry the Task's **current** value when one is present (e.g. Due Date
present but Duration missing) so the card can pre-fill it — a card is never
shown with no due date field just because Duration is what's actually
missing.

As Spencer,
I want `/sandbox` to walk me through each Task missing data, one card at a time, with a live count,
So that I can fill in what the planner needs in a couple of minutes in class.

**Acceptance Criteria:**

**Given** `app/sandbox-queue.ts`
**When** it is called
**Then** it derives the queue live from Notion Tasks by running the gate: Tasks missing a Required field, soonest-due first, with no due date last (AD-11)
**And** it is the only source for the /sandbox counter, the Needs-Data Indicator, and the needs-data notification count. None of them keeps its own count.

**Given** the command registry
**When** this story ships
**Then** `/sandbox` appears in the Command Palette with a description and an example

**Given** Spencer runs `/sandbox`
**When** the queue is non-empty
**Then** a Sandbox Card appears inline in the stream for the first Task: the Task name, Due Date and Estimated Duration fields with rims, optional Area and Energy fields, a Secondary "Skip", a Primary "Save", and "N remaining" in tabular numerals (FR-36, UX-DR39)
**And** Save stays disabled until both Required fields are filled

**Given** Spencer clicks Save
**When** the card is submitted
**Then** the card's values are written synchronously through `updateTaskField` as a direct write, with no second confirmation. Due Date and Estimated Duration use the existing strict validation, and select values use the existing guard (FR-38, AD-12).
**And** on success the card's rim pulses once in `accent-solid` and settles into "Saved" (text only under reduced motion). The counter decrements live and is announced to screen readers (FR-37).
**And** a select value that can't be resolved re-prompts on that card and writes nothing

**Given** Spencer clicks Skip
**When** the card advances
**Then** nothing is written, no cue plays, and the Task stays in the count, eligible for the next session

**Given** one card is finished
**When** the next Task exists
**Then** its card appears below. Earlier cards stay in chat history.

**Given** an empty queue
**When** Spencer runs `/sandbox`
**Then** Yoh replies "Nothing's missing a Due Date or Duration." and the session ends with no finale

---

## Task 3: Story 9.3 — /sandbox Finale and Proof-of-Action Notification

**Depends on:** Task 2. **Owns:** the finale half of `src/app/sandbox-submit.ts`
(E6's `finishSandboxSession`); `POST /api/sandbox/finish` (E9); the deep-link
convention (E8) and `NotificationOverlay.tsx`'s `activate()` extension;
`web/src/components/SandboxFinale.tsx`, `web/src/lib/sandboxSound.ts` (E10);
`web/src/lib/sandbox.ts`'s `finishSandbox()` (extends Task 2's file); tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-27-story-9.3-sandbox-finale-and-proof-of-action-notification.md`

**Implementer notes:** Contract E6, E8, E10 bind. Every per-card write
already completed (success or failure) synchronously before the client
advanced past that card (Task 2) — so by the time the client calls
`POST /api/sandbox/finish`, nothing is actually still in flight. The Finale's
"waits for writes to settle" is therefore a real (if usually near-instant)
network round trip to `finishSandboxSession` — which is also where the
notification is actually raised, from the accumulated client-side outcome
list — not a second, independent settle-wait mechanism. Render the loading
bar for at least a brief minimum duration even when the response is
near-instant, so it never flashes illegibly (a small, named constant, not a
magic number). `finishSandboxSession` raises `sandbox-complete` when every
outcome in the batch is `ok:true`, or `sandbox-failed` (naming each failed
Task by title) when any is `ok:false` — never both, and never before the
route call returns. **Model: Sonnet.** Smaller and more contained than
Task 2: it extends an existing session store and card-save path rather than
inventing new cross-surface protocol.

**Controller rulings (pre-execution):** (a) **`[DECISION DEFAULT]`** resolves
the epics.md `[OPEN]`/UX-DR39 ambiguity between "the finale runs whether the
last card was saved or skipped" and "the reward sound plays when the batch
is cleared": an **all-skip session** (zero cards saved, however many
skipped) ends with a plain in-stream line and **no** Finale bar, **no**
`POST /api/sandbox/finish` call, and **no** notification — mirroring the
empty-queue case's spirit, since there is nothing Notion-side to report on
and "Saved 0 Tasks" is not a sentence Spencer should ever see. The Finale
(bar → notification) fires only when the session includes **at least one
save** (matching the AC that gates the sound this way already); the sound
itself additionally requires reduced motion to be off. (b) **`[ASSUMPTION:
resolves UX OQ10]`** "batch cleared" = the session reached the end of its
(exclude-adjusted) queue, not "every card individually saved or skipped" —
so the sound plays once at the Finale's end, not per card and not per
skip. (c) **`[ASSUMPTION: resolves UX OQ16]`** the sound is a short chime
**generated with the Web Audio API** (an oscillator envelope) at modest
volume — no external audio file to source, license, or fail to load — with
the one playback call site in `sandboxSound.ts` so it's swappable later.

As Spencer,
I want the end of a /sandbox session to show that my answers actually landed in Notion,
So that I trust the data is there, and I'm told exactly what failed if something didn't save.

**Acceptance Criteria:**

**Given** the last card in the session is saved or skipped
**When** the session ends
**Then** the Sandbox Finale (a right-aligned `accent-solid` loading bar) runs in the stream while `app/sandbox-submit.ts` waits for every card write to settle. It never requires a click (FR-38).

**Given** every write succeeded
**When** they have all settled
**Then** a `sandbox-complete` notification, "Saved {n} Tasks", deep-links to Chat. It never appears before the writes succeed.

**Given** any write failed
**When** the writes settle
**Then** a `sandbox-failed` notification names each failed Task, e.g. "Couldn't save Chem problem set", and never claims completion. Failed Tasks stay in the count.

**Given** the session saved at least one card and reached the end of the queue
**When** the finale completes
**Then** `[ASSUMPTION: resolves UX OQ10 — "batch cleared" means the session reached the end of its queue]` the reward sound plays once, respecting system mute. It is never the only confirmation.
**And** `[ASSUMPTION: resolves UX OQ16]` the sound is a short, self-hosted asset at modest volume, swappable in one place

---

## Task 4: Story 9.4 — Needs-Data Notification and Indicator

**Depends on:** Tasks 1–3. **Owns:** the `needs-data` notification raise in
`src/rituals/morning-ritual.ts` (via `createNotificationInTx`, same
`writeTx` pattern `app/check-off.ts` already uses for its own `operational`
notification — this ritual needs the same `connection`/DB-write seam added
to `MorningRitualDeps`, see implementer notes); `GET /api/sandbox/count` in
`src/shell/server.ts` (E9); `web/src/components/NeedsDataIndicator.tsx`
(new); mounting it on `web/src/pages/Tasks.tsx`'s header; tests;
`sprint-status.yaml`: `9-4-needs-data-notification-and-indicator` → `done`,
`epic-9` → `done`.

**Per-story plan:** `docs/superpowers/plans/2026-09-27-story-9.4-needs-data-notification-and-indicator.md`

**Implementer notes:** Contract E5, E8 bind. The AC's "Tasks page (a minimal
route stub until Epic 11 builds the full page)" is stale/superseded — the
real Tasks page already ships (Story 11.1, pulled forward). Mount the
Indicator in its existing header, not a stub. `runMorningRitual` computes
`incompleteTaskIds` today (from the gate's `incomplete`, i.e. Required-field-
missing Tasks only, post-Task-1) but never raises a notification for it —
this task adds exactly that raise, once per run, only when
`incompleteTaskIds.length > 0`, with count and body built from
`sandboxQueue`'s own item list (reuse it — don't recompute a parallel count
from `incompleteTaskIds` by hand, since the two must never be able to
disagree). `MorningRitualDeps` gains an optional `connection?: SqliteConnection`
(mirroring `app/check-off.ts`'s own `deps.connection` seam) wired from
`shell/ritual-cli/morning-deps.ts` and from `app/plan-day.ts`'s deps (the
on-demand `/plan` path, fixes-ui plan Task 1) alike — **the needs-data
notification must fire from an on-demand `/plan` run exactly as it does from
the 6am cron run**, since it is in-app only, not a Pushover push, and is
therefore *not* covered by `/plan`'s "no push" no-op. This is the one place
this task must touch a file outside Epic 9's own list. **Model: Sonnet.**
Contained: a ritual-side notification raise plus one small polling
indicator component, reusing Task 2's single source of truth.

**Controller rulings (pre-execution):** (a) The Indicator polls
`GET /api/sandbox/count` on mount and refetches on any `tasks` or `sandbox`
outbox hint over the shared `eventBus.ts` (both topics already exist or are
added by Task 2/4's own writes) — it does not need its own bespoke topic.
(b) Per FR-34/AD-5, `needs-data` and `operational` are the only two
notification kinds a ritual itself may raise (`sandbox-complete`/
`sandbox-failed` are raised by `app/sandbox-submit.ts`, not a ritual) — this
task adds no new kind, since `needs-data` is already in the closed
`NotificationKind` union (verified in `src/types/api.ts`).

As Spencer,
I want to be told how many Tasks need data to be placed, with one click into fixing them,
So that an unplaceable Task never silently falls off my radar.

**Acceptance Criteria:**

**Given** a Morning Plan run leaves one or more Tasks unplaced for a missing Required field
**When** the ritual finishes
**Then** it creates one `needs-data` notification, "{n} Tasks need data to be placed", deep-linking to Chat with `/sandbox` started (FR-34)
**And** this is one of the only two notification kinds a ritual may raise (AD-5). No notification is raised when the count is zero.

**Given** the Tasks page (a minimal route stub until Epic 11 builds the full page)
**When** the queue count is greater than zero
**Then** the Needs-Data Indicator shows e.g. "3 need data" in tabular numerals inside a Secondary-style rim. It is hidden when the count is zero (UX-DR42).
**And** clicking it opens Chat with `/sandbox` started

**Given** a Task is unplaced
**When** anything on the web surface shows the day
**Then** that Task never appears with a guessed Due Date or Estimated Duration, and is always reachable through the indicator or the notification (FR-34)

**Given** a /sandbox session ends
**When** the Needs-Data Indicator next renders
**Then** it reflects the new queue count from `app/sandbox-queue.ts`

---

## Process

One squashed commit per story (`feat(9.N): <story title, lower-case>`),
`sprint-status.yaml` updated **in that same commit**: `epic-9` goes to
`in-progress` in Task 1's commit, each story key
(`9-1-two-tier-data-completeness-gate`, `9-2-sandbox-card-flow`,
`9-3-sandbox-finale-and-proof-of-action-notification`,
`9-4-needs-data-notification-and-indicator`) goes to `done` in its own
commit, and `epic-9` goes to `done` in Task 4's commit. WIP commits are fine
mid-task but must be squashed before the implementer reports DONE. The
commit trailer is **exactly and only**:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Never use bare `git stash`. Never push. Per Spencer's standing
authorization, the controller merges `phase2-epic-9` into `main`
autonomously once the final review after Task 4 passes — no separate
go-ahead is required (unlike Epic 8, where the merge explicitly waited on
Spencer).

This plan excludes `epic-9-retrospective` (BMad's optional post-epic ritual;
`sprint-status.yaml` already lists it as `optional`).

## Controller rulings

Open questions in the source documents, resolved here so no task stalls on
them:

1. **UX-DR39/OQ10 ("batch cleared"):** `[DECISION DEFAULT]` means the
   session reached the end of its queue, not every-card-individually — see
   Task 3.
2. **UX-DR39/OQ16 (sound asset):** `[DECISION DEFAULT]` a short chime
   generated with the Web Audio API, no external asset, one swappable call
   site, silent under reduced motion — see Task 3.
3. **All-skip `/sandbox` session:** `[DECISION DEFAULT]` no Finale, no
   `finish` call, no notification — only a session with ≥1 save reaches the
   Finale. Resolves a real tension between two Story 9.3 ACs that the source
   text leaves implicit (see Task 3's ruling (a)).
4. **`NotificationKind` union:** verified already closed and already
   containing `sandbox-complete`, `sandbox-failed`, `needs-data` in
   `src/types/api.ts` — no task edits this union.
5. **"Tasks page (minimal route stub)" in Story 9.4's own AC text:**
   superseded by the already-shipped Story 11.1 Tasks page (fixes + UI
   plan). Task 4 targets the real page.
6. **Deep-link mechanics for "Chat":** no prior story ever set a real
   `deepLink` (Chat is a panel, not a `PAGES` entry) — Task 3 defines the
   `"chat"`/`"chat:/sandbox"` convention and extends
   `NotificationOverlay.tsx`; Task 4 reuses it.

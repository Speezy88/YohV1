# Yoh — SDD Implementation Plan, Phase 2 (Epic 8)

**Derived plan file for superpowers:subagent-driven-development.** This file exists
only so the SDD scripts (`task-brief`, `review-package`) have `## Task N` headings
to key on. It is *not* a new source of requirements. It packages the approved
planning documents into task-shaped briefs:

- **Spec (binding authority):** `_bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md`
  (AD-1, AD-3, AD-5, AD-11, AD-12, AD-13, AD-14, AD-16, AD-17, AD-18 are the ones Epic 8 leans on)
- **Plan argument (task/story breakdown):** `_bmad-output/planning-artifacts/epics.md`, "## Epic 8" (Stories 8.1–8.9)
- **UX:** `_bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/DESIGN.md` and `EXPERIENCE.md`
  (UX-DR35–UX-DR38 and UX-DR40 apply to Epic 8; the UX-DR list is in `epics.md` around line 512)
- **Per-story implementation plans:** `docs/superpowers/plans/2026-09-26-story-8.N-*.md` (one per story task below)
- **Epic 7's plan (format and precedent):** `_bmad-output/implementation-artifacts/sdd-plan-YohV1-phase2.md`

Every acceptance-criteria block below is copied verbatim from `epics.md`. The
"Depends on / Owns / Implementer notes" lines above each story are packaging
only. They point at spine rules, record controller rulings, and resolve ordering;
they add no requirements. Task 1 is the Epic 6 retro item that must land "before
the next chat-command epic". Tasks 2–10 are Stories 8.1–8.9 in build order. Tasks
11–12 are small follow-ups that run only after Task 10.

## Global Constraints

These bind every task. Copy the relevant subset into each dispatch's
"global constraints" block. Do not paste this whole section into every prompt.

**Layering (AD-1, Phase 2):** dependency direction is
`shell/{server,chat-cli}.ts → app → {rituals, core, adapters}`;
`shell/ritual-cli.ts → rituals → {core, adapters}`; `adapters → types` (plus
sibling adapters, as today). `shell/ritual-cli.ts` and `rituals/` **never import
`app/`**. `core/` imports only `types/` and other `core/`. `web/` is outside this
graph: it reaches the system only over HTTP/SSE and imports only `import type`
from `src/types/` (AD-17). `tests/layering-rules.test.ts` enforces all of this and
must stay green.

**`app/` layer (AD-16):** one file per interaction use-case. **Every exported
function** in `src/app/*.ts` is shaped `(deps, input) → Promise<Result<Output,
YohError>>`: `tests/layering-rules.test.ts` fails on any other exported function
(interfaces, types, and constants are fine). So **pure parsers and recognizers
never live in `app/`**. They move to `core/` (see the contract below). `app/`
functions are **one-shot per turn and never block for input**. Shells contain
transport only: parse the request or terminal line, call one `app/` function,
and render its `Result`. A shell never calls an adapter write function, never
constructs or applies a `Proposal`, and never branches on business rules. `app/`
is the only layer that may call `setTaskStatus` / `updateTaskField` / `createPage`
(AD-12) or `applyCalendarEdit` (AD-13).

**Moved, not copied (AD-16):** every handler and parser that leaves
`shell/chat-cli.ts` is **deleted** from it in the same task, and its tests move
with it (from `tests/chat-cli.test.ts` into the new file's test file, adapted to
the one-question-per-turn shape). After each task, `grep` must find no second
definition of a moved function. Behavior is unchanged unless the story's AC says
otherwise: same wording, validation, re-prompts, skip handling, and receipts.

**Functional core (AD-2, AD-8):** `core/*.ts` exports are pure (no I/O, no module
state, no argument mutation). `adapters/*.ts` may throw on I/O failure; `app/*`
catches and converts to `Result`. `YohError.kind` includes `missing-field`,
`auth-expired`, `unreachable`, `rate-limited`, `validation`, `stale-proposal`,
`conflict`.

**Propose-Don't-Impose (AD-3, FR-48):** a `Proposal` is applied only by
`app/confirm-proposal.ts`, after an explicit yes from an interactive surface (a
typed yes, a chip, or a button: all equal). The same staleness check runs for every
surface: an existing entity whose version changed rejects with `stale-proposal`,
and a create-type proposal (`NotionPageDraft`, calendar `create`) skips the
re-read. A decline writes nothing. FR-29 ("save that") and FR-24 (a typed field
answer) are **direct writes** and never pass through the confirm path. FR-29's
`createPage` call site stays separate from FR-26's.

**Data-Completeness (AD-11):** FR-25 suggestions are built **lazily at display
time**, every time the question is surfaced. `memory-store.ts` never stores a
pre-built FR-25 `Proposal`. Only the bare placeholder request and a question cursor
are stored. Every confirmed or typed field value is written through `updateTaskField`
(with its select guard) and only then merged as a `TaskFieldOverride`.

**Rituals and notifications (AD-5, AD-18):** the four cron one-shots stay
OS-scheduled. `ritual-cli.ts` and `rituals/` gain only the `night-prompt` no-op
check (Task 8). A ritual's open close-out or Self-Check raises **no** in-app
notification. `NotificationKind` stays the closed union from Epic 7. Epic 8 adds no
kind.

**Storage (AD-10):** `adapters/sqlite.ts` stays the only opener. Multi-step writes
use `writeTx`. Every user-visible change appends one outbox row in the same
transaction (AD-18). Epic 8 adds the `open-items` topic (Task 7). Chat transcript
persistence: **client memory only for Phase 2** (8.5's `[DECISION DEFAULT]`). No
`chat-store.ts` is added, and `web/` never invents its own storage for the transcript.

**Live delivery (AD-18):** chat replies stream on **their own SSE response to
`POST /api/chat`**, separate from `GET /api/events`. The web client reuses the
single shared `EventSource` in `web/src/lib/eventBus.ts` for hints. It never
opens a second one.

**Browser client (AD-17):** `web/` is a view over the server API. Every Plan,
gate result, proposal, open item, and command list is computed server-side.
Optimistic UI is visual only: your own turn appears immediately, and so does the
Thinking Indicator. A failure renders as a failure. Ephemeral view state (unsent
Chat text, the transcript, scroll) is client-only and survives swipes and the
Screensaver (pages stay mounted: see `web/src/components/PageShell.tsx`).
Home's `"home-data"` stays the **only** launch-splash gate: Chat registers none.
CSP stays `default-src 'self'`.

**Web UI (FR-46, NFR-Accessibility, UX-DR47–50):** tokens only in
`web/src/tokens.css` (consumed through Tailwind v4's theme). No component
hard-codes a color, shadow, radius, or duration. Every animation reads the one
reduced-motion flag (`web/src/hooks/useReducedMotion.ts`) and has a fade or
instant fallback. Skeleton loads, never a static spinner. Every write is visibly
acknowledged or visibly failed. Neutral, guilt-free copy, no emoji, and no button
that duplicates a slash command. Icons are 1.8 px-stroke line icons with a label
or accessible name. Chips, the palette, and inputs are fully keyboard-operable.
Contrast meets WCAG 2.2 AA in both themes.

**Tone (FR-18, FR-19, FR-42):** peer-level, no filler, no "it's not just X,
it's Y". Yoh never claims a capability it doesn't have, and it ends
conversations naturally rather than fishing for more.

**Conventions:** kebab-case `src/` filenames, and PascalCase React components in
`web/`. API routes are `/api/<noun>[/<verb>]`, JSON in and out, returning the
serialized `Result` envelope (except the chat stream, see the contract). Use
`wire()` and `httpStatus()` in `shell/server.ts`. "Today" uses the configured
host `TZ`, never the browser's. Logging is single-line structured JSON to stderr.
Each shared tuning constant has exactly one defining export.

**Tests:** `node:test` with fake adapters for `src/`. Vitest + React Testing
Library for `web/`. Playwright smoke via `web/playwright.config.ts` +
`tests/e2e/fixture-server.ts` (fake Notion and LLM, never real services). The
per-task gate is `npm run check`: typecheck, web typecheck, web build, node tests,
and web tests. Web stories also run `npx playwright test` from `web/`. Tests
start green (baseline: node 964, web 149, Playwright 3/3) and stay green after
every task.

**Process:** one squashed commit per story (WIP commits must be squashed before the implementer reports DONE), `feat(8.N): <story title, lower-case>`,
with `sprint-status.yaml` updated **in that same commit**. `epic-8` goes to
`in-progress` in Task 2's commit, each story key goes to `done` in its own commit,
and `epic-8` goes to `done` in Task 10's commit. The commit trailer is **only**
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use bare
`git stash`. Never push or merge.

---

## Epic 8 Interface Contract (controller rulings, binding on every task)

Tasks are built in order, but their per-story plans were written up front, so the
names below are fixed here. A task may **add** fields or helpers, but it may not
rename, re-home, or reshape anything listed. If a task finds a listed shape
unworkable, the implementer reports `DONE_WITH_CONCERNS` and the controller rules.

### C1. Pure parsers and recognizers → `core/`

| File (new) | Exports | Moved from | Task |
|---|---|---|---|
| `src/core/planning-field-value.ts` | `parsePlanningFieldValue(field, raw)` → `{ok:true, value} \| {ok:false, message}`. This is the **one** planning-field parser for FR-4 typed answers **and** FR-25 LLM suggestions. It accepts the union of what `chat-cli.ts`'s `parseFieldAnswer` and `llm-adapter.ts`'s `parseSuggestedValue` accept today. | `chat-cli.ts` `parseFieldAnswer`, `llm-adapter.ts` `parseSuggestedValue` (both deleted) | 1 |
| `src/core/open-item-answers.ts` | `parseNightCloseOutAnswer`, `isSkipAnswer`, `parseSelfCheckAnswer` (+ `SelfCheckAnswer` type) | `chat-cli.ts` | 2 |
| `src/core/open-item-answers.ts` | `parseProposalAnswer` | `chat-cli.ts` | 2 (amended: moves with the other answer parsers) |
| `src/core/open-item-questions.ts` | pure cursor → question logic (questionId, text, options, next cursor) | new | 2 |
| `src/core/chat-commands.ts` | `parseTimeBudgetCommand`, `isPlanViewCommand`, `isMidDayReflowCommand`, `isBlockerReportCommand`, `parseWhyPrioritizedCommand` | `chat-cli.ts` | 4 |
| `src/core/chat-commands.ts` | `parseCreateItemCommand`, `isSaveSearchResultCommand`, `isCalendarEditCommand` | `chat-cli.ts` | 5 |

`llm-adapter.ts` cannot import `core/` (AD-1). So `suggestFieldValue` takes the
parser as an **injected parameter** (`parseValue: (field, raw) => value |
undefined`), and callers pass a thin wrapper over `parsePlanningFieldValue`.

### C2. Shared wire shapes → `src/types/api.ts` (added, never widened)

```ts
// Task 2 (8.1)
export interface OpenItemOption { readonly label: string; readonly value: string; }
export interface OpenItemQuestion {
  readonly requestId: string;          // the InteractionRequest id
  readonly questionId: string;         // deterministic id of the ONE pending question
  readonly text: string;               // the question text (plain text, never ANSI)
  readonly options: readonly OpenItemOption[];   // [] = free text only
  readonly allowsFreeText: boolean;
  readonly proposal?: Proposal<unknown>;         // present when the question confirms a Proposal
}
export interface OpenItem {
  readonly requestId: string;
  readonly requestKind: string;        // "data-completeness" | "night-close-out" | "self-check" | "proposal" | other
  readonly promptText: string;         // the request's stored header text
  readonly question: OpenItemQuestion;
}
export interface OpenItemsResponse { readonly items: readonly OpenItem[]; }
export interface AnswerOpenItemRequest {
  readonly requestId: string;
  readonly questionId: string;
  readonly answer: string;             // a typed line, or a chip's `value`
  readonly proposal?: Proposal<unknown>;   // echoes a display-time (FR-25) proposal back; see C4
}
export interface AnswerOpenItemResponse {
  readonly message?: string;           // re-prompt / validation / acknowledgement text
  readonly receipts: readonly string[];    // one-line receipts for writes this answer made (FR-24)
  readonly next: OpenItemQuestion | "done";
}

// Task 3 (8.2)
export interface ConfirmProposalResponse {
  readonly applied: boolean;           // false on decline
  readonly receipts: readonly string[];
}

// Task 4 (8.3)
export interface ChatTurnRequest {
  readonly message: string;
  readonly history: readonly ChatTurn[];   // client-held transcript; server trims to MAX_CHAT_HISTORY_TURNS
}
export interface ChatTurnResponse {
  readonly reply: string;              // Yoh's full reply text (markdown allowed; never ANSI); may be ""
  readonly receipts: readonly string[];
  readonly question?: OpenItemQuestion;    // a follow-up Structured Question (e.g. a new proposal to confirm)
}
export type ChatStreamEvent =
  | { readonly type: "status"; readonly text: string }     // "Thinking…", "Searching the web…"
  | { readonly type: "delta"; readonly text: string }      // a streamed reply chunk
  | { readonly type: "done"; readonly response: ChatTurnResponse }
  | { readonly type: "error"; readonly error: YohError };

// Task 8 (8.7)
export interface CommandDescriptor { readonly name: string; readonly description: string; readonly example: string; }
export interface CommandList { readonly commands: readonly CommandDescriptor[]; }
export interface MorningViewResponse {
  readonly today: string;
  readonly plan: { readonly text: string; readonly reasoning: string } | undefined;   // undefined = no Plan yet today
  readonly openItems: readonly OpenItem[];
}
```
`ChatTurn`, `Proposal`, and `YohError` are imported from `types/domain.ts`. `ChatIntent`
in `domain.ts` is **not widened** by Epic 8. If a task needs a new classification,
it adds a new function and type (see Task 9).

### C3. `app/` files and signatures

| File | Export(s) | Task |
|---|---|---|
| `app/chat-session.ts` | `interface ChatSession { recentMessages: string[]; lastSearchAnswer: { query: string; answer: SearchAnswer } \| undefined }` (a mutable per-conversation holder the **shell** creates as a literal: one per `chat-cli` run, one per server process); `RECENT_MESSAGES_WINDOW = 20`. There are no exported functions. | 2 |
| `app/surface-open-items.ts` | `surfaceOpenItems(deps, input: {}) → Result<OpenItemsResponse>` returns every open request with its **current** pending question, built from the stored cursor. FR-25 suggestions are built here, lazily, from `deps.session.recentMessages`. Also exports `buildOpenItemQuestion(deps, { requestId }) → Result<OpenItemQuestion \| "done">`, which the `answer*` functions call to build `next`. | 2 |
| `app/answer-data-completeness.ts` | `answerDataCompleteness(deps, AnswerOpenItemRequest) → Result<AnswerOpenItemResponse>` | 2 |
| `app/answer-night-close-out.ts` | `answerNightCloseOut(deps, AnswerOpenItemRequest) → Result<AnswerOpenItemResponse>` | 2 |
| `app/answer-self-check.ts` | `answerSelfCheck(deps, AnswerOpenItemRequest) → Result<AnswerOpenItemResponse>` | 2 |
| `app/answer-open-item.ts` | `answerOpenItem(deps, AnswerOpenItemRequest) → Result<AnswerOpenItemResponse>`: the one entry shells call. It dispatches on the stored request's `requestKind`. Unknown kinds keep chat-cli's generic behavior (any non-blank answer clears the request). `"proposal"` is added in Task 3. | 2 (3 extends) |
| `app/confirm-proposal.ts` | `confirmProposal(deps, { proposal: Proposal<unknown>; accept: boolean; requestId?: string }) → Result<ConfirmProposalResponse>`: the single confirm path. It dispatches on `proposal.kind`: `"time-budget-change"` → the existing generic `apply` + accessor (moved here); `"field-value"` (FR-25) → `updateTaskField(payload)` + override merge; `"notion-page-draft"` (FR-26) → `createPage(database, properties)`; `"calendar-edit"` (FR-27) → `applyCalendarEdit(proposal)`. When `requestId` is given, it clears that interaction request after apply or decline. | 3 (Task 5 adds the FR-26/27 kinds' wiring if not done in 3) |
| `app/open-proposal.ts` | `openProposal(deps, { proposal }) → Result<OpenItemQuestion>` persists a proposal as an interaction request (`requestKind: "proposal"`, id `proposal:<proposal.id>`) and returns its confirm question. It rejects with `conflict` when an open proposal already targets the same `(kind, entityId)`. | 3 |
| `app/time-budget.ts` | `declareTimeBudget(deps, { totalMinutes }) → Result<{ receipt: string }>` (moved) | 4 |
| `app/chat-turn.ts` | `chatTurn(deps: ChatTurnDeps, input: ChatTurnRequest) → Result<ChatTurnResponse>`; `MAX_CHAT_HISTORY_TURNS = 40` (moved). `ChatTurnDeps` includes `session: ChatSession` and optional `emit?: (e: ChatStreamEvent) => void` (the per-request stream sink the server passes; the CLI omits it). It dispatches in chat-cli's existing order, one `app/` function per capability. **A message starting with `/` is dispatched through the command registry (Task 8).** | 4 (5, 8 extend) |
| `app/plan-view.ts`, `app/mid-day-reflow.ts`, `app/blocker-report.ts`, `app/why-prioritized.ts`, `app/general-question.ts` | one export each (`showPlan`, `reflowDay`, `reportBlocker`, `explainPriority`, `answerQuestion`), each `(deps, input) → Result<ChatTurnResponse>` | 4 |
| `app/create-item.ts`, `app/calendar-edit.ts`, `app/web-search.ts`, `app/save-search-result.ts` | `draftItem`, `proposeCalendarEdit`, `searchWeb`, `saveSearchResult`, each `(deps, input) → Result<ChatTurnResponse>`. Create-item and calendar-edit **persist** their Proposal via `openProposal` and return it as `response.question`. Confirmation arrives later through `answerOpenItem` → `confirmProposal`. | 5 |
| `app/commands.ts` | `COMMANDS: readonly CommandDescriptor[]` (the one registry); `listCommands(deps, {}) → Result<CommandList>` | 8 |
| `app/morning-view.ts` | `morningView(deps, {}) → Result<MorningViewResponse>` (reads only, never pushes, never regenerates) | 8 |
| `app/night-close-out.ts` | `startNightCloseOut(deps, {}) → Result<ChatTurnResponse>`: ensures tonight's `night-close-out` interaction request exists (excluding Tasks completed today, reusing `rituals/night-ritual.ts`'s builders) and returns its first question. Answers go through `answerOpenItem`. | 8 |

Shells (`chat-cli.ts` in Tasks 2–5 and `server.ts`) build `deps` once per
process, plus a per-request `emit` in the server.

### C4. Resumable open items (Task 2), the conflict rule (Tasks 3, 7)

- The pending-question cursor is stored **inside the interaction request's own
  record** (under `detail.cursor`) via a versioned `memory-store.ts` update. A
  request a ritual wrote without a cursor starts at its first question. No new
  table is added.
- `questionId` is deterministic from the cursor (for example
  `"<taskId>:<field>"`, `"<taskId>:<field>:suggest"`, `"<taskId>"` for
  close-out, `"score"` for Self-Check, `"confirm"` for a stored proposal).
- **Conflict rule (AD-5 Phase 2):** an answer whose `questionId` isn't the
  request's current pending question, or whose request no longer exists, returns
  `{ok:false, error:{kind:"conflict"}}` and writes nothing. `openProposal` on an
  entity that already has an open proposal returns `conflict`. **Nothing else is
  blocked:** `chatTurn` never refuses a message because an item is open.
- FR-25 (display-time proposal): the suggest-question carries
  `proposal: Proposal<FieldValueSuggestion>` (kind `"field-value"`), and the answer
  echoes it back in `AnswerOpenItemRequest.proposal`. The value is re-validated
  through `parsePlanningFieldValue` and written through `updateTaskField`'s
  select guard, exactly as a typed value would be. So an echoed proposal can
  never write anything a typed answer couldn't. A "no" records
  `suggestionDeclined` for that field in the cursor, and the next question is
  the blind ask.
- `chat-cli.ts` keeps its **blocking presentation**: before each line it calls
  `surfaceOpenItems`. For each item it prints the question, reads one line, and
  calls `answerOpenItem` until `next === "done"`, re-prompting exactly as today
  (blank line = re-ask, UX-DR20). The Web App presents the same items
  non-blockingly (Task 7).

### C5. Server routes (Tasks 6–8)

| Route | Calls | Task |
|---|---|---|
| `POST /api/chat` (body `ChatTurnRequest`) → `text/event-stream` of `ChatStreamEvent`s (`event: <type>` + `data: <json>`), always ending in exactly one `done` or `error` | `chatTurn` with `emit` wired to the stream | 6 |
| `GET /api/open-items` → `ApiResult<OpenItemsResponse>` | `surfaceOpenItems` | 7 |
| `POST /api/open-items/answer` (body `AnswerOpenItemRequest`) → `ApiResult<AnswerOpenItemResponse>` | `answerOpenItem` | 7 |
| `GET /api/commands` → `ApiResult<CommandList>` | `listCommands` | 8 |

`/morning` and `/night` are **not** separate routes. They are chat messages
dispatched by `chatTurn` through the registry, so the CLI and the Web App get them
identically.

### C6. Web client files

| File | Role | Task |
|---|---|---|
| `web/src/lib/chatStream.ts` | `fetch` POST `/api/chat` and parse the SSE body into `ChatStreamEvent`s (there's no `EventSource` for POST). Typed via `import type`. | 6 |
| `web/src/lib/chatStore.ts` | module-level transcript + unsent draft store (`useSyncExternalStore`), shared by the Chat page and the Home bubble; `send(message)` | 6 (8 extends) |
| `web/src/pages/Chat.tsx`, `web/src/components/ChatInput.tsx`, `ChatMessage.tsx`, `ThinkingIndicator.tsx` | UX-DR36/37 | 6 |
| `web/src/components/StructuredQuestion.tsx`, `OpenItems.tsx`, `web/src/lib/openItems.ts` | UX-DR38 Structured Question; refetch on load, after each turn, and on an `open-items` hint via `eventBus.ts` | 7 |
| `web/src/components/CommandPalette.tsx`, `web/src/lib/commands.ts` | UX-DR38 palette; list from `GET /api/commands` | 8 |
| `web/src/components/ChatBubble.tsx` | UX-DR35, on Home | 9 |

---

## Task 1: Epic 6 retro item 7 — `runChatCli` deps object and one planning-field value parser

**Depends on:** nothing (first task; due "before next chat-command epic"). **Owns:** `src/core/planning-field-value.ts` (new) + `tests/planning-field-value.test.ts`; `runChatCli`'s signature in `src/shell/chat-cli.ts` (positional params → one `ChatCliDeps` object) and its `main()` call site; `suggestFieldValue`'s injected parser in `src/adapters/llm-adapter.ts`; deleting `parseFieldAnswer` (chat-cli) and `parseSuggestedValue` (llm-adapter); `sprint-status.yaml` action item `epic-6-retro-item-7-before-next-chat-command-epic-replace-ru` → `done`.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-epic-6-retro-item-7-chat-cli-deps-and-field-parser.md`

**Commit:** `refactor(epic-6-retro): item 7 — runChatCli deps object, one planning-field value parser`

**Implementer notes:** Source: `_bmad-output/implementation-artifacts/epic-6-retro-2026-09-24.md` (findings F8, F9). Action text, verbatim from `sprint-status.yaml`: "Before next chat-command epic: replace runChatCli positional deps with a deps object; extract shared planning-field value parser for FR-4/FR-25 (F8, F9)". Pure refactor: every existing `chat-cli`, `llm-adapter`, and ritual test passes unchanged in behavior (call sites in tests are updated to the deps object). The one parser accepts the **union** of both current parsers' inputs. Where they disagree, a test pins the chosen behavior, and the report names the disagreement. `ChatCliDeps` is the shape Tasks 2–5 extend, so keep it a plain interface with required `store`, `io`, `timeZone`, and `llmClient`, and optional everything else, with the same throwing defaults as today.

---

## Task 2: Story 8.1 — Open Interaction Requests as Resumable Turns

**Depends on:** Task 1. **Owns:** contract C2's Task-2 shapes in `src/types/api.ts`; `src/app/chat-session.ts`, `src/app/surface-open-items.ts`, `src/app/answer-data-completeness.ts`, `src/app/answer-night-close-out.ts`, `src/app/answer-self-check.ts`, `src/app/answer-open-item.ts` (all new, with tests); `src/core/open-item-answers.ts` (new, the Task-2 parsers); the versioned cursor update in `src/adapters/memory-store.ts` (if one doesn't already exist); `chat-cli.ts`'s `surfaceOpenInteractionRequests` rewritten as transport over `surfaceOpenItems` + `answerOpenItem` (contract C4) and the three `answer*Request` functions deleted; the moved tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.1-open-items-as-resumable-turns.md`

**Implementer notes:** Contract C1–C4 bind. The `"proposal"` branch of `surfaceOpenInteractionRequests` (`answerProposalRequest`, `apply`, `parseProposalAnswer`) is **left in `chat-cli.ts` untouched** for Task 3. `answerOpenItem` must not route `"proposal"` yet, and chat-cli keeps calling `answerProposalRequest` for it. Until Task 3, FR-25's inline confirm calls `updateTaskField` + `mergeTaskFieldOverride` from `app/answer-data-completeness.ts` directly, with the same behavior as today. Task 3 re-points it at `confirmProposal`. The "raises no in-app notification" AC is pinned by a test asserting no `notification-store` write occurs when a close-out or Self-Check request is surfaced or answered. **Model: Sonnet.** This story is large but single-process.

**Controller rulings (pre-execution):** (a) `app/surface-open-items.ts` also exports `buildOpenItemQuestion(deps, {requestId}) → Result<OpenItemQuestion | "done">`, which the `answer*` functions call to build `next`, including the lazy FR-25 enrichment. There's no plain-object-of-methods export to get around the layering scan. The pure cursor → question logic (ids, text, options, next cursor) lives in `src/core/open-item-questions.ts`. (b) `parseProposalAnswer` moves to `core/open-item-answers.ts` **in this task** (chat-cli imports it from there), and there's no temporary `parseYesNoAnswer`. (c) A FR-25 proposal's `entityVersion` is the literal `"field-value"`. Integrity comes from re-parsing, not a re-read.

As Spencer,
I want Yoh's pending questions (missing Task fields, night close-out, Self-Check) to be answerable one turn at a time from any surface,
So that the Web App can resolve them exactly as the terminal does, without either surface blocking on input.

**Acceptance Criteria:**

**Given** `chat-cli.ts`'s `answerDataCompletenessRequest`, `answerNightCloseOutRequest`, and `answerSelfCheckRequest` each loop on `io.readLine()`
**When** this story is complete
**Then** their logic lives in `app/surface-open-items.ts` plus one answer function per request kind. The logic is **moved, not copied**, along with `parseFieldAnswer`, `parseNightCloseOutAnswer`, `parseSelfCheckAnswer`, and their tests (AD-16).
**And** each `app/` call answers exactly one question: the interaction request records which question is pending, and the response carries the next question, or "done".

**Given** a missing-field request is surfaced
**When** `llm-adapter.ts` can infer a value from recent chat context
**Then** the app layer builds the `Proposal<FieldValueSuggestion>` lazily at display time, exactly as before (AD-11, FR-25)
**And** a confirmed or typed answer writes through `updateTaskField` with the existing select guard, and is echoed as a one-line receipt (FR-24)

**Given** `chat-cli.ts` after the refactor
**When** Spencer uses it
**Then** it is transport only over these `app/` functions: it prints each returned question, reads one line, and calls `app/` again. Every existing data-completeness, close-out, and Self-Check behavior (validation, re-prompts, skip, the number-plus-reason rule) is unchanged, and its tests pass.

**Given** a Self-Check or close-out request raised by a ritual
**When** it is open
**Then** it raises **no** in-app notification (AD-5)

---

## Task 3: Story 8.2 — One Confirmation Path for Every Proposal

**Depends on:** Task 2. **Owns:** `src/app/confirm-proposal.ts`, `src/app/open-proposal.ts` (new, with tests); `parseProposalAnswer` → `src/core/open-item-answers.ts`; `apply`, `ProposalEntityAccessor`, `timeBudgetEntityAccessor`, and `answerProposalRequest` moved out of `chat-cli.ts` (`apply` becomes a private helper of `confirm-proposal.ts`); `answerOpenItem`'s `"proposal"` branch; FR-25 re-pointed at `confirmProposal`; the moved tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.2-one-confirmation-path.md`

**Implementer notes:** Contract C2–C4 bind. `confirmProposal` must support all four kinds (`time-budget-change`, `field-value`, `notion-page-draft`, `calendar-edit`) in this task, each through its existing calling convention (AD-3). The FR-26/FR-27 **handlers** stay in `chat-cli.ts` until Task 5, but in this task their inline "yes" must already call `confirmProposal` (through `answerOpenItem` or directly) instead of calling `createPage` / `applyCalendarEdit` themselves. FR-29's `createPage` call in `handleSaveSearchResultCommand` stays a separate direct write (AD-3), and a test pins that `confirm-proposal.ts` is not on its path. The "rituals can't confirm" AC is already enforced by the 7.2 import test. Add one assertion naming `confirm-proposal.ts` to it if the existing test doesn't cover `app/` generically.

**Controller rulings (pre-execution):** (a) `apply`, `ProposalEntityAccessor`, and `timeBudgetEntityAccessor` stay **module-private** in `confirm-proposal.ts` (the layering test rejects other exported function shapes). The moved white-box tests drive them through `confirmProposal` with fake deps that simulate the race. (b) `parseProposalAnswer` is already in `core/open-item-answers.ts` (Task 2). (c) Create-type proposals use their own proposal id as `entityId`, so `openProposal`'s conflict rule only bites proposals on existing entities (a calendar move or resize by event id, a Time Budget by date). (d) `confirmProposal` clears a given `requestId` on every outcome, including stale, which matches chat-cli's prior behavior. (e) `AnswerOpenItemDeps` may gain optional `createPage` / `applyCalendarEdit` fields (additive).

As Spencer,
I want every Yoh proposal to be confirmed through one set of rules, whether I type "yes" or click a button,
So that no surface can apply something I didn't approve, or apply it against stale data.

**Acceptance Criteria:**

**Given** `chat-cli.ts`'s `apply`, `answerProposalRequest`, and `parseProposalAnswer`
**When** this story is complete
**Then** `app/confirm-proposal.ts` is the single confirm path for learned-pattern and Time Budget proposals (FR-16, FR-5) and for FR-25, FR-26, and FR-27 proposals. The logic and tests are moved, not copied (AD-3, FR-48). FR-25's inline confirm, which 8.1 moved, is re-pointed at `confirmProposal`.
**And** each proposal keeps its existing calling convention: `applyCalendarEdit` takes the `Proposal` itself; `updateTaskField` and `createPage` take the extracted payload.
**And** FR-29's direct `createPage` call site stays separate and is never routed through this path.

**Given** a confirmation arrives from any interactive surface (a typed yes/no, or a web control)
**When** `confirmProposal` runs
**Then** the same staleness check applies: an existing entity whose version changed rejects with `stale-proposal`, and a create-type proposal skips the re-read, as already specified
**And** a decline writes nothing

**Given** a non-interactive ritual run
**When** any code path tries to confirm a proposal from it
**Then** it cannot, because `rituals/` and `ritual-cli.ts` can't import `app/` (the AD-1 import test from 7.2)

**Given** a proposal is open
**When** Spencer sends an unrelated message
**Then** only writes that conflict with the proposal are blocked (another answer to the same field, a second proposal on the same entity). Unrelated chat proceeds (AD-5 Phase 2).

---

## Task 4: Story 8.3 — Chat Turn Routing for Planning Commands

**Depends on:** Tasks 2–3. **Owns:** `src/app/chat-turn.ts`, `src/app/time-budget.ts`, `src/app/plan-view.ts`, `src/app/mid-day-reflow.ts`, `src/app/blocker-report.ts`, `src/app/why-prioritized.ts`, `src/app/general-question.ts` (new, with tests); `src/core/chat-commands.ts` (the Task-4 recognizers); the streaming variant in `src/adapters/llm-adapter.ts` (`streamGeneralQuestion(client, history, systemPrompt, model): AsyncIterable<string>` plus whatever `AnthropicMessagesClient` needs); `chat-cli.ts`'s main loop calling `chatTurn` for these capabilities, with the handlers deleted; the moved tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.3-chat-turn-planning-commands.md`

**Implementer notes:** Contract C1–C3 bind. `app/` returns plain text or markdown, never ANSI. `chat-cli.ts` keeps its terminal styling (`renderMarkdownForTerminal`, `paint`, and `renderPlan`'s color), applied in the shell to the returned text. Where `showPlanCommand` used `renderPlan` with color, the app returns uncolored text and the shell colors it, or the shell calls `renderPlan` itself only if that's pure rendering of data the app returned. The implementer picks one approach and names it in the report. Conversation history moves from `withConversationHistory`'s in-shell recording to `ChatTurnRequest.history`. The CLI keeps building it with the same buffering rules (that wrapper stays in the shell as transport), and `chatTurn` also records into `session.recentMessages`. Status events: `chatTurn` emits `{type:"status", text:"Thinking…"}` first on every turn, and capability-specific statuses where a slow read happens. Status strings are exported constants of `chat-turn.ts`. The general-question path streams deltas through `deps.emit` when `emit` is present, and otherwise uses the existing non-streaming `answerGeneralQuestion`. The "Tone rules hold" AC is covered by the existing `tone.ts` and system-prompt tests moving with it, plus one test that `answerQuestion` passes `resolveToneSystemPrompt(line)`.

**Controller rulings (pre-execution):** (a) In this task, `chat-cli.ts` keeps its search-trigger handling inline (`classifyChatIntent` + `handleSearchCommand` + `lastSearchAnswer`) together with the create-item, calendar-edit, and save-that checks, all before it falls through to `chatTurn`. `chatTurn`'s fallback here is `answerQuestion` without classification. Task 5 moves classification and search into `chatTurn`. There's no intermediate search regression. (b) `chatTurn` emits only `status` and `delta`, **never** `done` or `error`. The server builds the terminal event (Task 6). (c) Update `tests/mid-day-reflow.test.ts`'s sole-caller assertion to `app/mid-day-reflow.ts`. (d) Accepted: the CLI's plan-view and re-flow output lose ANSI color (the CLI retires in 8.9), and every reply goes through `renderMarkdownForTerminal` in the shell.

As Spencer,
I want my everyday chat messages (what's my plan, I'm behind, a blocker, change my time budget, why is X first, general questions) handled by one surface-agnostic chat turn,
So that the terminal and the Web App answer them identically, in Yoh's usual tone.

**Acceptance Criteria:**

**Given** `chat-cli.ts`'s plan-view, mid-day re-flow, blocker, Time Budget, why-prioritized, and general-question handlers
**When** this story is complete
**Then** `app/chat-turn.ts` dispatches on `llm-adapter.ts`'s `ChatIntent` and on the existing command parsers, calling one `app/` function per capability (`app/time-budget.ts` among them). The logic and tests are moved, not copied (AD-16).
**And** `chat-cli.ts`'s main loop calls `chatTurn` for each non-slash line.

**Given** a re-flow or blocker report
**When** it runs
**Then** the behavior is unchanged from Epic 2: a re-flow shows only the updated remainder, and a blocker applies unconditionally with a one-line confirmation. (Both move onto the single reshuffle pipeline in Epic 10.)

**Given** replies
**When** Yoh answers
**Then** Tone rules hold (FR-18, FR-19): peer-level, no filler, no "it's not just X, it's Y"
**And** Yoh never claims a capability it doesn't have, and it ends a conversation naturally rather than fishing for more (FR-42)

**Given** `llm-adapter.ts`
**When** a caller requests a streamed reply
**Then** it exposes a streaming variant that yields text chunks plus status events ("Thinking…", "Searching Notion…"). The non-streaming path the CLI uses still works.

---

## Task 5: Story 8.4 — Chat Turn Routing for Notion, Calendar, and Search Commands

**Depends on:** Tasks 2–4. **Owns:** `src/app/create-item.ts`, `src/app/calendar-edit.ts`, `src/app/web-search.ts`, `src/app/save-search-result.ts` (new, with tests); the Task-5 recognizers in `src/core/chat-commands.ts`; `chatTurn`'s routing for them; deleting `handleCreateItemCommand`, `handleCalendarEditCommand`, `handleSearchCommand`, and `handleSaveSearchResultCommand` from `chat-cli.ts`; **removing `"chat-cli.ts"` from `SHELL_WRITE_ALLOWLIST` in `tests/layering-rules.test.ts`** (Ruling R1; after this task `chat-cli.ts` calls no adapter write function); updating `deferred-work.md`'s Story 7.2 entry to "resolved in 8.4"; the moved tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.4-chat-turn-notion-calendar-search.md`

**Implementer notes:** Create-item and calendar-edit now **persist** their Proposal via `openProposal` and return it as `ChatTurnResponse.question`. The CLI presents that question immediately (blocking, as today: it reads one line and calls `answerOpenItem`), so terminal behavior is unchanged. The Web App shows it as a Structured Question (Task 7). The calendar confirm question still names the specific event, and there's still no delete variant (AD-13). `lastSearchAnswer` lives in `session` (C3), with the F5 clearing rules unchanged. Search emits a `"Searching the web…"` status. `resolveCalendarEditRoute`'s unreachable `owned` branch moves unchanged. (Epic 6 retro item 5 is Spencer's to reconcile; see Task 11.)

**Preflight ruling P1:** `OpenProposalDeps` is Story 8.2's `{ store: MemoryStore; now?: () => Date }`, not the `{connection}` shape the 8.4 plan invented. `CreateItemDeps` / `CalendarEditDeps` / `ChatTurnDeps` extend the real type, and the tests build a real `MemoryStore`. **P3:** the chat-turn test file is `tests/app-chat-turn.test.ts` (created by 8.3). Where the 8.4 plan says `tests/chat-turn.test.ts`, append to `app-chat-turn.test.ts` instead.

**Controller rulings (pre-execution):** (a) A create-item (`notion-page-draft`) or calendar `create` proposal uses its own proposal id as `entityId`. It never uses the database name, so two captures never conflict. (b) This task moves `classifyChatIntent` + search out of `chat-cli.ts` into `chatTurn` (see Task 4's ruling a) and restores the original dispatch order.

As Spencer,
I want creating Notion items, editing my Calendar, searching the web, and saving results to work through the same chat turn,
So that the Phase 1.5 capabilities carry over to the Web App with their trust boundaries intact.

**Acceptance Criteria:**

**Given** `chat-cli.ts`'s create-item, calendar-edit, search, and save-search-result handlers
**When** this story is complete
**Then** they are dispatched from `app/chat-turn.ts`. Logic and tests are moved, not copied.
**And** create-item and calendar-edit produce their `Proposal`s and confirm only through `app/confirm-proposal.ts` (8.2)
**And** a calendar edit still requires confirmation that names the specific event, and has no delete variant (AD-13)

**Given** a search-trigger intent
**When** it's handled
**Then** `search-adapter.ts` is called exactly as before: only on an explicit ask or an unambiguous factual question, with citations, and with honest failure and no-results replies (FR-28, AD-14)
**And** "save that" files the most recent `SearchAnswer` directly via `createPage('ResearchVault', …)` (FR-29)

**Given** any chat-triggered write (FR-24 through FR-29)
**When** it succeeds
**Then** the `app/` result carries a one-line receipt naming what changed, which both shells render

---

## Task 6: Story 8.5 — Chat Page With Streaming Replies

**Depends on:** Tasks 4–5. **Owns:** `POST /api/chat` in `src/shell/server.ts` (+ the `chatTurn` deps wiring in `startServer`/`main`, and a fake-LLM wiring in `tests/e2e/fixture-server.ts`); `web/src/lib/chatStream.ts`, `web/src/lib/chatStore.ts`, `web/src/pages/Chat.tsx`, `web/src/components/ChatInput.tsx`, `ChatMessage.tsx`, `ThinkingIndicator.tsx` (+ tests); any new tokens in `web/src/tokens.css` (the shimmer gradient and dot-matrix timing) + token tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.5-chat-page-streaming.md`

**Implementer notes:** **Model: Opus.** This is the one genuinely cross-process story: server SSE framing on a POST response, the llm-adapter stream, a fetch-body SSE parser in the browser, and a React streaming UI, all of which must agree. Contract C2/C5/C6 bind. The Thinking Indicator appears on send, before any network activity (a test pins that it renders synchronously on submit). Every `/api/chat` stream ends in exactly one `done` or `error`. A thrown error inside `chatTurn` becomes an `error` event, never a hung stream. A client disconnect aborts cleanly. Receipts render in caption style. Chat registers **no** launch gate. The transcript lives only in `chatStore.ts` memory (the `[DECISION DEFAULT]`), and the Chat page must also render `response.question` (Task 7 upgrades it to a Structured Question; here, plain question text is enough). OQ17 shimmer: `ink-primary` text with a translucent overlay sweep, so text contrast is never below 4.5:1, and static `ink-secondary` under reduced motion.

**Controller rulings (pre-execution):** (a) `ServerDeps.chat` holds the `chatTurn` deps minus `session` and `emit`. `startServer`/`main` builds **one** `ChatSession` literal per process and shares it with every route (Tasks 7 and 8 reuse it). (b) A missing `deps.chat` streams a single `error` event. (c) A `runChatTurn` test seam in `ServerDeps` is allowed for the e2e fixture.

As Spencer,
I want a Chat page in the Web App where Yoh's replies stream in behind a live thinking indicator,
So that talking to Yoh feels immediate and I can always see what it's doing.

**Acceptance Criteria:**

**Given** the Chat page
**When** it renders
**Then** the conversation stream is centered with the Chat Input at the bottom: glass, always wide, with a focus ring and glow. The left-bar space is reserved and empty, because the Skill Switcher is hidden (UX-DR36, UX-DR40).

**Given** Spencer sends a message
**When** he presses Enter
**Then** his turn appears right-aligned on `surface-sunken`, and within a fraction of a second, before any server response, the Thinking Indicator appears: a dot-matrix loader and live status text (NFR-Latency, UX-DR37)
**And** the server handles `POST /api/chat` by calling `app/chat-turn.ts` and streaming the reply on that request's own SSE response. The Thinking Indicator gives way to streaming text in Yoh's left-aligned turn (AD-18).

**Given** the Thinking Indicator's status text
**When** it shows
**Then** it carries the gradient shimmer (static `ink-secondary` text under reduced motion) and is an `aria-live` region
**And** `[ASSUMPTION: resolves UX OQ17]` the shimmer runs over text that is already legible: the text renders in `ink-primary` and the shimmer is a translucent overlay sweep, so contrast never drops below 4.5:1

**Given** a chat-triggered write succeeds
**When** the reply renders
**Then** the one-line receipt appears in caption style in the stream

**Given** Spencer swipes away, or the Screensaver shows
**When** he returns
**Then** the unsent Chat Input text and the stream are intact

**Given** chat history persistence (spine Deferred, UX OQ13)
**When** this story is built
**Then** `[DECISION DEFAULT: client memory only for Phase 2]` the transcript lasts for the page session. If Spencer instead wants it to survive a reload, this story adds a `chat-store.ts` owner under AD-10, and `web/` never invents its own storage.

---

## Task 7: Story 8.6 — Open Items and Structured Questions in Chat

**Depends on:** Tasks 2, 3, 6. **Owns:** `GET /api/open-items` and `POST /api/open-items/answer` in `server.ts`; the `open-items` outbox topic (memory-store's interaction-request put/update/clear append one outbox row via `notification-store.ts`'s `appendOutboxInTx` inside one `writeTx`; entityId = request id); `web/src/lib/openItems.ts`, `web/src/components/OpenItems.tsx`, `web/src/components/StructuredQuestion.tsx` (+ tests); the Chat page rendering open items at the top and `ChatTurnResponse.question` as a Structured Question.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.6-open-items-structured-questions.md`

**Implementer notes:** Contract C2–C6 bind. A chip pick sends `AnswerOpenItemRequest` with the chip's `value` (the same `app/` function a typed answer calls). It appends Spencer's pick to the transcript as his turn, then renders `message`, `receipts`, and `next`. A `stale-proposal` or `conflict` result renders honestly in the stream ("That proposal is out of date — nothing was changed." style, neutral copy), and the open items refetch. Chips: Secondary style, flipping to Primary when selected. "Other" is a free-text field. Everything is keyboard-operable (arrow or Tab between chips, Enter/Space picks). Unrelated chat while a question is open still goes to `/api/chat` unblocked. Open items refetch on Chat mount, after each turn or answer, and on an `open-items` hint from the shared `eventBus.ts` (never a second `EventSource`). If wrapping memory-store's interaction-request writes in `writeTx` with the outbox append would change a ritual's observable behavior, stop and report `DONE_WITH_CONCERNS`.

**Preflight ruling P2:** `ServerDeps.chat` excludes `session`. `createApp` builds one `chatDeps = { ...deps.chat, session: <the one per-process ChatSession> }`, and `/api/chat`, `/api/open-items`, and `/api/open-items/answer` **all** use that same object, never `deps.chat` directly. **P4:** the route tests seed interaction requests in the real shapes, a ritual-written `detail` (e.g. `detail.incomplete`) plus a cursor built with `core/open-item-questions.ts`, so the answer routes exercise real cursor logic (not a hand-guessed `detail.cursor`). The same applies to the Playwright fixture seed. **P7:** one squashed `feat(8.6)` commit at the end, not one commit per plan task. WIP commits are fine if they're squashed before reporting.

**Controller rulings (pre-execution):** (a) The outbox append reuses `MemoryStore.readModifyWrite`'s existing `onCommit` hook, and `deleteRecord` gains an optional `onCommit`. Test fixtures that build a bare store add the notification schema. (b) The routes reuse Task 6's single `ChatSession`.

As Spencer,
I want Yoh's pending questions and proposals to appear at the top of Chat as tappable options,
So that I can answer or approve them with one click, and I never lose a proposal the rituals created.

**Acceptance Criteria:**

**Given** open interaction requests or Proposals exist, including ones created while the CLI was in use
**When** the Chat page loads
**Then** they render at the top of Chat through `app/surface-open-items.ts` (AD-5, FR-48, FR-50)

**Given** Yoh asks a question with discrete answers (a proposal confirmation, a close-out status, a clarifying question)
**When** it renders
**Then** it appears as a Structured Question: the question text, option chips (Secondary style, flipping to Primary when selected), and a free-text "Other" field (UX-DR38)
**And** one pick answers it, is recorded as Spencer's turn, and calls the same `app/` function that a typed answer would call
**And** chips and "Other" are fully keyboard-operable

**Given** a proposal is confirmed via a chip
**When** it is stale
**Then** the stale rejection is shown honestly, and nothing is applied (FR-48)

**Given** an unanswered Structured Question
**When** Spencer types unrelated chat
**Then** the chat proceeds, and only conflicting writes are blocked

---

## Task 8: Story 8.7 — Command Palette, /morning, and /night

**Depends on:** Tasks 2, 4, 6, 7. **Owns:** `src/app/commands.ts`, `src/app/morning-view.ts`, `src/app/night-close-out.ts` (new, with tests); `chatTurn`'s `/`-dispatch through the registry (unknown command → a neutral "No command named /x" reply listing the commands); `GET /api/commands`; the `night-prompt` no-op check in `src/rituals/night-ritual.ts` (+ tests in `tests/night-ritual.test.ts` / `tests/ritual-cli.test.ts`); `web/src/lib/commands.ts`, `web/src/components/CommandPalette.tsx` (+ tests); Chat Input opening the palette when `/` is the first character.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.7-command-palette-morning-night.md`

**Implementer notes:** The registry lists only commands that exist (`/morning`, `/night`). Epics 9 and 11 add `/sandbox` and `/research` by appending registry entries. `/morning` returns the stored Plan text (uncolored) + its reasoning line + open items, and never calls Notion, Calendar, Pushover, or plan generation (a test asserts none of those deps is called). `/night` builds tonight's close-out request through `rituals/night-ritual.ts`'s existing builders. `app/` may import `rituals/`. It excludes Tasks completed today (`completion-log.ts`'s `getCompletedTaskIdsToday`), and on the final answer it records the close-out in **the same `memory-store.ts` record `night-escalate` checks**. The implementer identifies that record in the per-story plan and pins it with a test. `night-prompt` then gains the same check (no-op, no push) when tonight's close-out is already recorded, and a test covers `/night` → `night-prompt` no-op → `night-escalate` no-op → the day is not marked unchecked. The palette is a glass panel, and the highlighted row gets a 1.5 px `accent-solid` rim. ↑↓, Enter, and Esc work. No match shows "No matching command" plus the full list.

**Preflight ruling P3:** the chat-turn test file is `tests/app-chat-turn.test.ts`. **P5:** `ChatInput.tsx`'s draft lives in `chatStore.ts` (`useChatStore()` → `{ messages, draft, sending }`, plus standalone `setDraft(text)` and `send(message)`), not in local component state. The palette wiring reads and writes the draft through that API.

**Controller rulings (pre-execution):** (a) `/night`'s "handled" marker reuses the existing `NIGHT_PROMPT_RITUAL_ID` `RitualRun` record and the `"already-ran"` outcome, so night-prompt and night-escalate take their existing no-op branches. (b) A `/night` that concludes with skipped Tasks still marks the night handled. That matches today's behavior, where concluding the close-out clears the request.

As Spencer,
I want to type "/" to see every command, open today's Morning Ritual in Chat, and close out my day early,
So that commands are discoverable without cluttering any page, and an early close-out stops tonight's nagging.

**Acceptance Criteria:**

**Given** "/" is the first character in the Chat Input
**When** Spencer types it
**Then** the Command Palette (a glass panel) lists the commands available so far, each with a one-line description and an example, and filters as he types. ↑↓ moves, Enter runs, and Esc closes (UX-DR38).
**And** a query with no match shows "No matching command" plus the full list
**And** the palette's command list comes from one server-provided registry, so `/sandbox` (Epic 9) and `/research` (Epic 11) appear when their stories register them

**Given** `/morning`
**When** Spencer runs it
**Then** `app/morning-view.ts` shows today's stored Plan, its reasoning line, and any pending questions or proposals in Chat
**And** it never sends a push and never regenerates the Plan (FR-1, FR-42)
**And** with no Plan yet, it says so

**Given** `/night`
**When** Spencer runs it
**Then** `app/night-close-out.ts` runs the close-out interactively through 8.1's resumable flow, excluding Tasks already completed today, and records it in the same `memory-store.ts` record `night-escalate` checks

**Given** tonight's close-out is already recorded via `/night`
**When** `ritual-cli.ts night-prompt` and later `night-escalate` run
**Then** both are no-ops for that night, and the day is never marked unchecked (FR-12–FR-14, AD-5)

---

## Task 9: Story 8.8 — Chat Bubble on Home and the Three-Action Capture Flow

**Depends on:** Tasks 5–8. **Owns:** `web/src/components/ChatBubble.tsx` (+ tests) on `web/src/pages/Home.tsx`; `chatStore.send` + navigate-to-Chat from the bubble; the palette opening in place from the bubble; Task-capture detection (see notes) in `src/adapters/llm-adapter.ts` + `app/chat-turn.ts` / `app/create-item.ts`; the Structured Question's pre-focused "Create" option; the Playwright capture-flow smoke in `web/e2e/` (+ `tests/e2e/fixture-server.ts` wiring for a fake LLM that drafts a Task).

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.8-chat-bubble-capture-flow.md`

**Implementer notes:** "Lab report draft, due Thursday" doesn't match `parseCreateItemCommand`'s "create/add/new a task …" phrasing, so capture needs detection. Ruling: **don't widen `ChatIntent`**. Add a new exported `llm-adapter.ts` function (e.g. `detectTaskCapture(client, line)`) that returns a draft request or `undefined`. `chatTurn` calls it after the deterministic recognizers and before general chat, and on a hit routes to `app/create-item.ts`'s FR-26 path with database `Tasks`. That path uses the same draft → `openProposal` → `confirmProposal` flow, with no shortcut write. A general question must not be captured: tests cover a question, a statement, and a Task description. The confirm question's options list "Create" first, and the web pre-focuses it, so Enter confirms. The receipt names the Task and its database. The Playwright smoke asserts that from a fresh launch no login, picker, or extra screen appears before a focused Chat Bubble, and that sending takes at most three actions (focus/click bubble, type, Enter). Home's `"home-data"` stays the only launch gate. The bubble is focusable without waiting on anything else.

**Preflight ruling P5/P6:** there's no `useChatDraft()`. The bubble uses `chatStore.ts`'s real API: `useChatStore()` → `{ messages, draft, sending }`, plus `setDraft(text)` and `send(message)`. The bubble shares the same `draft` as the Chat Input, so unsent text follows Spencer to Chat.

As Spencer,
I want to open my laptop, click the Yoh icon, type a Task into Home's chat bubble, and press Enter,
So that capturing something in class takes seconds.

**Acceptance Criteria:**

**Given** Home
**When** it renders
**Then** the Chat Bubble is docked bottom-center: a small glass pill with a "/" chip and "Ask Yoh, or type / for commands". It expands wide on hover or focus, with a focus ring and glow. Esc collapses it (UX-DR35).

**Given** text in the Chat Bubble
**When** Spencer presses Enter
**Then** the app moves to Chat, and the message is sent as the first turn of the conversation (FR-40)
**And** "/" in the bubble opens the Command Palette in place

**Given** a message describing a new Task (e.g. "Lab report draft, due Thursday")
**When** it is sent
**Then** Yoh drafts it through FR-26's create path and shows the draft as a Structured Question
**And** confirmation follows FR-26's confirm-then-write rule. The "Create" option is pre-focused, so Enter confirms it. On success the receipt names the Task and its database. `[DECIDED 2026-09-25: FR-39's three actions are counted up to the message being sent; the one-click FR-26 confirmation is kept as a trust boundary and is not a regression of NFR-CaptureSpeed]`

**Given** the Playwright smoke suite
**When** it runs the capture flow from a fresh launch
**Then** it asserts no login, picker, or extra screen appears between launch and a focused Chat Bubble, and the flow takes at most three actions to send. This test is the NFR-CaptureSpeed regression gate for every later story.

---

## Task 10: Story 8.9 — CLI Parity Check and Retirement

**Depends on:** Tasks 1–9. **Owns:** a parity checklist in this story's per-story plan (each FR-42 item → its passing `app/`-level test file + test name, and a manual Web App check for Spencer); deleting `src/shell/chat-cli.ts`, `tests/chat-cli.test.ts` (after confirming every test in it has an `app/` or `core/` counterpart; list any that were terminal-rendering-only and why they die with the CLI), and the `chat` package script/entry; removing CLI-only rendering code that nothing else uses (e.g. `renderMarkdownForTerminal` if only chat-cli used it; ritual push and email text keep their wording, and anything `ritual-cli.ts` still uses stays); `layering-rules.test.ts`'s references to `chat-cli.ts`; docs that tell Spencer to run the CLI (`SETUP.md`, `deploy/`, `CLAUDE_HANDOFF.md`) updated to point at the Web App; `sprint-status.yaml`: `8-9` done and `epic-8` done.

**Per-story plan:** `docs/superpowers/plans/2026-09-26-story-8.9-cli-parity-and-retirement.md`

**Implementer notes:** Before deleting, run the parity checklist mechanically: every item must name an existing, passing test. A gap is fixed by adding the missing `app/`-level test in this task, never by skipping the item. After deletion, `grep -rn "chat-cli" src tests web package.json` returns only historical comments, and those comments are updated to the present tense where they'd mislead. Rituals keep running unchanged (`ritual-cli.ts` tests green), and their open items surface in Chat (covered by Task 7's tests; the checklist cites them).

**Controller rulings (pre-execution):** (a) There's no `chat` npm script to remove. Retirement deletes the file and its `main()`, and rewrites SETUP.md's run instructions. `deploy/` has no references. (b) The 10 tests in `tests/chat-cli.test.ts` that exercise `rituals/data-completeness.ts` move to a new `tests/data-completeness.test.ts` before deletion. (c) Delete `WRAP_WIDTH`, `renderMarkdownForTerminal`, and `tests/ritual-shared.test.ts` (chat-cli-only).

As Spencer,
I want the terminal chat removed only after the Web App provably does everything it did,
So that I end up with one surface and lose nothing.

**Acceptance Criteria:**

**Given** FR-42's parity list: Time Budget, Mid-Day Re-Flow, Blocker reports, open interaction requests and Proposals, FR-24 through FR-29, Self-Check responses, plan view, and why-prioritized
**When** the parity check runs
**Then** each item has a passing `app/`-level test and a manual check in the Web App, and the checklist is recorded in the story

**Given** parity passes
**When** `chat-cli.ts` is deleted
**Then** no logic is lost, because every handler already lives in `app/`. The CLI entry point and its package script are removed, and the full test suite passes (FR-50).

**Given** the CLI is retired
**When** the Morning, Night, and Self-Check rituals run on schedule
**Then** they are unaffected, and their open items and proposals surface in Chat

**Given** the CLI sections of the UX spines (UX-DR1 through UX-DR21, CLI rendering)
**When** retirement completes
**Then** the ritual push and email text keep their existing wording, and no CLI-only rendering code remains

---

## Task 11: Epic 6 retro items 5 and 6 — prepare Spencer's decisions (docs only)

**Depends on:** Task 10 (run only if time allows). **Owns:** `deferred-work.md` only. Both items are owned by Spencer, so this task prepares his decisions and doesn't make them:

- Item 6 (`epic-6-retro-item-6-add-perplexity-daily-cost-ceiling-pricin`, verbatim: "Add Perplexity daily cost ceiling / pricing confirmation to deferred-work.md (F3)"): add the deferred-work entry the action names, citing AD-14 and the spine's Deferred bullet. This fully satisfies the item, so mark it `done` in `sprint-status.yaml`.
- Item 5 (`epic-6-retro-item-5-reconcile-story-6-6-ac2-ad-13-with-as-bu`, verbatim: "Reconcile Story 6.6 AC2 / AD-13 with as-built FR-27-only routing; resolve deferred owned-branch entry (F1)"): add a short "Decision needed" note under the existing Story 6.6 deferred entry, with the two options (drop the unreachable `owned` branch and its test, or keep it as a fail-safe) and the as-built fact that `app/calendar-edit.ts` now holds the code. Leave the item `open`, because the spine and story text are Spencer's to amend.

**Commit:** `docs(epic-6-retro): items 5–6 — Perplexity cost-ceiling entry, AD-13 reconciliation note`

---

## Task 12: Split `ritual-cli.ts` (optional)

**Depends on:** Task 10 (run only if time allows, after Task 11). **Owns:** `src/shell/ritual-cli.ts` (~1500 lines) split into `src/shell/ritual-cli.ts` (entry + dispatch + the AD-7 top-level handler) plus per-subcommand deps builders under `src/shell/ritual-cli/` (e.g. `morning-deps.ts`, `night-deps.ts`, `self-check-deps.ts`). Pure move: no behavior change, `tests/ritual-cli.test.ts` passes with at most import-path edits, and `layering-rules.test.ts`'s ritual-cli rules are extended to cover the new directory (it still never imports `app/`). Deferred-work's "`ritual-cli.ts` is ~1500 lines" line is marked resolved.

**Per-story plan:** none (a pure move). The brief is this task text.

**Commit:** `refactor(shell): split ritual-cli.ts into per-subcommand deps builders`

---

## Retrospective note

This plan excludes `epic-8-retrospective` (BMad's optional post-epic ritual).
Update `sprint-status.yaml` per story in each story's own commit (`epic-8` →
`in-progress` in Task 2's commit, each story key → `done` in its commit, and
`epic-8` → `done` in Task 10's commit). Merging `phase2-epic-8` into `main`
waits for Spencer's explicit go-ahead.


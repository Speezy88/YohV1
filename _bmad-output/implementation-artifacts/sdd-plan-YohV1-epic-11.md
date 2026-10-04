# SDD plan — Epic 11: asynchronous research (Stories 11.2, 11.3, 11.4)

Written 2026-10-04 from `epics.md` (Epic 11) against `main` at `7e85747`.
Branch `worktree-phase2-epic-11`, worktree `.claude/worktrees/phase2-epic-11`.
Ledger: `~/Documents/Yoh-previews/ledgers/epic-11/progress.md`.
Story 11.1 shipped earlier. The stories' acceptance criteria in `epics.md` are the
requirement; this plan splits them into five tasks and records the decisions the
stories leave open.

## Rulings (made without Spencer; they bind until he overrules)

- **E11-R1 Paging.** `GET /api/research?pages=N` returns the first `N × 20` items, newest first, plus `hasMore`. `pages` missing, non-integer or below 1 means 1. The page size is one exported constant, `RESEARCH_PAGE_SIZE = 20`, in `src/app/research-list.ts`. The web page never sorts or slices.
- **E11-R2 Document read.** `GET /api/research/document?id=<id>` returns `{ document?: ResearchDocument }` where `ResearchDocument = { id, title, date?, body, sources: string[], url }`. `body` is the "Key Findings" property; `sources` is one entry per non-empty trimmed line of "Sources". A missing or unknown `id` returns the most recent document (same ordering as the list). An empty vault returns `{}` (no `document` key) — not an error.
- **E11-R3 Sources.** A source line that parses as an `http:`/`https:` URL renders as a link (`target="_blank"`, `rel="noopener noreferrer"`); any other line renders as plain text.
- **E11-R4 Body rendering.** The body renders through the same markdown rendering `web/src/components/ChatMessage.tsx` uses for a Yoh reply (move the shared piece into its own component if needed; no new dependency).
- **E11-R5 Open by id.** The deep link is `research:<pageId>`. `NotificationOverlay` goes to the Research Hub page and calls `openResearchDocument(id)`, a module-level selection in `web/src/lib/research.ts`. The id is not put in the URL hash.
- **E11-R6 Rows.** A library row is a `<button>` that opens its document in the box; the row for the open document carries `aria-current="true"` and a visible marker. The link to the Notion page moves into the box ("Open in Notion", new tab).
- **E11-R7 Live refresh.** On a `research` hint the list refetches (with the current `pages`), and the box refetches only when Spencer has not picked a document himself (it then shows the newest).
- **E11-R8 Job store.** Table `research_jobs` (`id`, `question`, `status` ∈ queued/running/done/failed, `created_at`, `claimed_at`, `finished_at`, `page_id`, `error`) in `src/adapters/job-store.ts`.
- **E11-R9 Runner.** The loop lives in `src/shell/server.ts` (same shape as `startCheckOffCommitSweep`): a tick every `RESEARCH_JOB_POLL_INTERVAL_MS = 3000`, one job per tick, ticks never overlap. All job logic — claim, search, file, mark, notify — is in `src/app/run-research-job.ts`. At startup every job still `running` is set to `failed` with a `research-failed` notification, before the first tick; it is never re-queued.
- **E11-R10 Honest failure.** A search that returns no answer and no citations is a failure, not "ready". `/research` with web search or the Research Vault not configured replies plainly and queues nothing.
- **E11-R11 Copy.** Acknowledgment: `Queued. You'll get a notification when it's on Research Hub.` No question after the command: `Say what to research, like /research best budget laptops for college.` Not configured: reuse `WEB_SEARCH_NOT_CONFIGURED_REPLY`; vault missing: `The Research Vault isn't set up yet, so there's nowhere to file research.`
- **E11-R12 Notifications.** Ready: title `Research ready: {topic}`, body `Open it on Research Hub.`, deepLink `research:<pageId>`; the same transaction appends a `research` outbox hint. Failed: title `Couldn't finish research: {topic}`, body = the plain error copy, deepLink `chat`. `{topic}` is the question, cut to 80 characters with `…`.
- **E11-R13 No push.** Research notifications are in-app only (no Pushover).
- **E11-R14 The offer (11.4).** A deterministic recognizer in `src/core/` decides "research-sized"; no model call. It matches an imperative `research …` line (after the optional polite lead `search-intent.ts` already allows) and explicit depth phrases: `deep dive on/into`, `in-depth`/`in depth`, `comprehensive`/`detailed`/`thorough` + `overview|analysis|breakdown|guide|report|comparison`, `pros and cons of`, `write/give me a report on`. It never matches a line that fails `search-intent.ts`'s planning-noun or first-person guards, an explicit `search:` line, or a slash command. On a match chat asks one Structured Question, `Do you want to do research on this?`, with choices `Yes` and `No`. Yes calls `queueResearch` exactly as `/research` would. No writes nothing and replies `Okay. Nothing queued.` The same message sent again in the session after a decline is not offered again and takes the normal path (a search). This changes today's behaviour for an imperative "research X" line: it used to search at once.
- **E11-R15 One builder.** The Research Vault property set (`title`, `keyFindings`, `query`, `searchDate`, `sources`) is built by one pure function in `src/core/`, used by both `save-search-result.ts` and the job runner.
- **E11-R16 Single writer.** Only `src/app/queue-research.ts` may import the job store's insert function; a test in `tests/layering-rules.test.ts` (or beside it) enforces this by scanning `src/`.

Added in the review rounds (2026-10-04):
- **E11-R17** refines R14: bare "in depth" does not trigger an offer. It joins the adjective list (`comprehensive|detailed|thorough|in-depth|in depth`) and needs a research noun (`overview|analysis|breakdown|guide|report|comparison|look`). The depth-phrase path also rejects day/time words and `we|our|us`. `research hub|paper|project` are not imperative research. No offer is made when research could not run (no web search, vault or database).
- **E11-R18** replaces R14's "remembered after a decline": the message is remembered when the offer is made; an open offer is cleared at the start of the next chat turn and is stale after its own calendar day.
- **E11-R19** A `running` job seen at claim time is failed like a restart-interrupted one. A search gets 120 s (`RESEARCH_SEARCH_TIMEOUT_MS`). When the page was filed but the job could not be recorded, the failed row keeps the page id, the notification is titled `Research filed, but not recorded: {topic}`, links to the page, and the `research` hint is appended.
- **E11-R20** A typed yes/no while an offer card is open replies `Use Yes or No on the card above.` and keeps the offer.
- Deferred: each document open reads the whole vault (M8); a timed-out search request is not aborted (N6); an offer card already on screen stays after the server clears it, and its Yes then says it is no longer pending (N8).

## Task 1: Research documents and paging on the server (Story 11.2)

Behaviour:
- `ResearchVaultRecord` gains `keyFindings: string` and `sources: readonly string[]`; `sourceCount` stays and equals `sources.length`. `readResearchVault` fills them from the "Key Findings" and "Sources" properties. Nothing is written to Notion.
- `listResearch(deps, { pages })` returns `{ items, hasMore }` per E11-R1. `ResearchListResponse` gains `hasMore: boolean`.
- New `getResearchDocument(deps, { id? })` in `src/app/research-list.ts` per E11-R2, with the same error handling as `listResearch`. New wire types `ResearchDocument` and `ResearchDocumentResponse` in `src/types/api.ts`.
- Routes: `GET /api/research` reads `pages` from the query; new `GET /api/research/document` reads `id`. Both use the existing `researchDeps` and the "not configured" failure.
- Fixture (`tests/e2e/fixture-server.ts`): the fake vault has 23 rows — the two existing ones stay the two newest, unchanged, and gain a "Key Findings" body (the AP Bio one with two paragraphs) — plus one row with empty body and empty sources. Export the rows' ids/titles the web spec will assert on.

Tests (node): ordering and `hasMore` for 0, 20, 21 and 45 records at `pages` 1–3; bad `pages` values; document by id, unknown id, no id, empty vault, empty body/sources; adapter mapping of body and sources; both routes including "not configured" and a Notion failure. The existing `web/e2e/research-hub.spec.ts` must still pass unchanged.

**Commit:** `feat(research): the server returns a research document and pages the library`

## Task 2: Research Box on Research Hub (Story 11.2)

Behaviour (all Story 11.2 acceptance criteria that are visible on the page):
- The Research Box sits above the library rows and shows one document: heading (title), date when present, body (E11-R4), source list (E11-R3), and "Open in Notion". An empty body or empty sources is simply absent. With an empty vault the box is absent and the existing empty state is unchanged. Loading shows a skeleton; a failed document load shows a `StateMessage` error with retry and leaves the library usable.
- Rows open in place and mark the current one (E11-R6); keyboard-operable.
- "Show more" (E11-R1): present only when `hasMore`; adds the next 20; a failed "Show more" keeps the rows listed and says `Couldn't load more.` with `Try again`.
- Open by id (E11-R5): `openResearchDocument(id)`; `NotificationOverlay` handles a `research:<id>` deep link by going to the Research Hub page and opening that document. An id the server no longer has falls back to the newest (the server does this; the row marker follows the document actually returned).
- Live refresh per E11-R7.
- The caption under the ask box and the file's header comment are updated to match what the page now does.

Tests: Vitest for the hook(s) and the page (box content, absent parts, in-place open, current marker, Show more incl. failure, deep-link selection, hint refresh rule); `NotificationOverlay` test for `research:<id>`; Playwright in `web/e2e/research-hub.spec.ts` (box shows the newest document; clicking a row opens it in place and marks it; Show more adds rows and then disappears; axe passes) — update the existing row-link assertions to the new row shape.

**Commit:** `feat(web): Research Hub shows a document in the Research Box and opens rows in place`

## Task 3: /research queues a job (Story 11.3, part 1)

Behaviour:
- `src/adapters/job-store.ts` per E11-R8: schema init (called where the other store schemas are initialized in `src/shell/server.ts` and in the fixture), insert a queued job (in a caller's transaction), claim the oldest queued job (sets `running` + `claimed_at`, atomically, one at a time — returns nothing while another job is `running`), mark done (page id), mark failed (error text), list jobs still `running`.
- `src/app/queue-research.ts`: `queueResearch(deps, { question })` → inserts one `queued` job and returns the acknowledgment (E11-R11) as a `ChatTurnResponse`. Asks nothing. Honest replies and no job when the question is empty, web search is not configured, or the vault is not configured (E11-R10, R11).
- `/research` is added to `COMMANDS` (description + example) and dispatched in `dispatchSlashCommand`; the question is everything after the command name, verbatim.
- E11-R16 layering test.
- E11-R15: move the property builder to `src/core/` and use it from `save-search-result.ts` (no behaviour change there).

Tests (node): job-store unit tests (queue order, single running job, done/failed transitions, running list); `queueResearch` cases; `/research` through `chatTurn` (ack, empty, not configured, no search call made, no model call); the registry lists `/research`; the single-writer test.

**Commit:** `feat(research): /research queues a background research job`

## Task 4: The job runner, notifications and restart recovery (Story 11.3, part 2)

Behaviour:
- `src/app/run-research-job.ts`: `runNextResearchJob(deps, {})` claims one job; none → `{ ran: false }`. Otherwise: search → on success `createPage("ResearchVault", …)` with the E11-R15 properties (direct write) → mark done with the page id + `research-ready` notification + `research` outbox hint in one transaction (E11-R12). Search failure, an empty result (E11-R10), a thrown error, or a filing failure → mark failed + `research-failed` notification in one transaction. A failure is never reported as ready.
- `failInterruptedResearchJobs(deps, {})` in the same file: every `running` job → failed, one `research-failed` notification each (E11-R9).
- `src/shell/server.ts`: `startResearchJobRunner` (E11-R9) started with the real deps when chat's search and Notion vault deps exist; recovery runs once before the first tick; the runner stops with the server like the other sweeps. `buildChatDeps` (or a sibling `build*Deps`) supplies `queueResearch`'s and the runner's deps.
- Fixture server: runs the same runner with a fake search and the fake vault (the created page must appear in the fake vault's rows so the list and document reads see it), and its fake `runChatTurn` handles `/research <question>` by calling the real `queueResearch`. Playwright: type `/research …` in Chat → acknowledgment → a "Research ready: …" notification appears → clicking it lands on Research Hub with that document open in the box.

Tests (node): runner success path (job done, page created with provenance, notification + hint rows), each failure path, nothing queued, recovery, tick non-overlap with injected timers, and that a failed job is never picked again.

**Commit:** `feat(research): the server runs queued research and notifies when it is ready`

## Task 5: One-time research offer (Story 11.4)

Behaviour per E11-R14 and Story 11.4's acceptance criteria. The recognizer is pure (`src/core/`); `chatTurn` checks it before `parseSearchIntent`'s non-prefix path and after the slash, memory-command and explicit `search:` checks. The Structured Question uses the existing open-item question mechanism; its answer path calls `queueResearch`. Declined messages are remembered on the chat session for the life of the session.

Tests (node): recognizer table (matches and near-misses, incl. ordinary planning/status lines and plain factual questions that must still search); `chatTurn` offer → yes queues exactly one job; → no queues nothing and replies; repeat after decline takes the search path; no model call on any of these. Playwright only if the fixture's chat fake can carry it cheaply; otherwise Vitest on the question card is enough (it is an existing component).

**Commit:** `feat(chat): a research-sized message gets a one-time offer to queue research`

## Review and gate
Per-task Sonnet review for Tasks 3–5 (data writes, cross-process). One Opus whole-branch review at the end, a fix round, a Sonnet re-review of the fixes. Final gate: `npm run check` and `cd web && npx playwright test`.

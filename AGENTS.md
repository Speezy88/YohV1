# AGENTS.md — Yoh (YohV1)

Agent-facing guide: the facts and rules a coding agent needs to work here without
opening planning documents. `CLAUDE.md` imports this file. If something here
disagrees with the code, the code wins; report the drift.

## What Yoh is
A single-user daily-planning assistant for Spencer: Notion (Tasks/Projects) +
Google Calendar + Claude (Haiku 4.5 for the chat tool loop and structured drafts) + Perplexity
(web search) + Pushover/SMTP notifications. Runs on Spencer's Raspberry Pi
(`yoh`) under systemd, reached over the tailnet; the Mac is for development only.

- Server: Node 24 with native TypeScript type-stripping (no build step), Hono, SQLite (better-sqlite3).
- Web: React + Vite + Tailwind v4 in `web/`, served by the server.
- Scheduled rituals: `src/shell/ritual-cli.ts` (morning, night-prompt, night-escalate) and `src/shell/backup-cli.ts`, run by the Pi's crontab.
- Deploy and update steps: `deploy/RASPBERRY-PI.md` (section 9 is the update one-liner).

## Where things live
```
src/types/     domain.ts (domain types), api.ts (HTTP request/response types; web imports these as `import type`)
src/core/      pure logic — no I/O, no module state (chat-commands, quick-add, search-intent, tone, error-copy, ...)
src/adapters/  I/O — notion-adapter, calendar-adapter, llm-adapter, search-adapter, sqlite (only DB opener), *-store, logger
src/app/       one file per interaction use-case (chat-turn, home-view, check-off, confirm-proposal, ...)
src/rituals/   scheduled workflows (morning-ritual, night-ritual, data-completeness, ...)
src/shell/     entry points: server.ts (startup; re-exports server-routes.ts = all HTTP routes, server-streams.ts = SSE + sweeps, server-wiring.ts = real deps), ritual-cli.ts, backup-cli.ts
tests/         node:test files (flat, e.g. tests/app-chat-turn.test.ts); tests/e2e/fixture-server.ts = fake-backed server for Playwright
web/src/       pages/, components/, lib/ (API clients, stores, eventBus), hooks/, tokens.css (design tokens)
web/e2e/       Playwright specs (run against the fixture server on port 8788)
docs/process/  implementer contract, brief template, context hygiene
_bmad-output/  planning artifacts (PRD, architecture spine, plans) — coordinator-only; implementers don't open them
```

## Commands (use exactly these)
| Purpose | Command |
|---|---|
| Server typecheck | `npm run typecheck` |
| Node tests (all) | `npm test` |
| One node test file | `node --test tests/<file>.test.ts` |
| Web tests (one file) | `cd web && npx vitest run src/<path>` |
| Full gate (once, before commit) | `npm run check` (typecheck, web typecheck, web build, node tests, web tests) |
| Playwright (web changes) | `cd web && npx playwright test` |

Run focused tests while iterating; the full gate once. Send gate output to a file
and read only failures and the summary.

## Binding constraints
- **Layering** (enforced by `tests/layering-rules.test.ts`): `shell/server.ts → app → {rituals, core, adapters}`; `shell/ritual-cli.ts → rituals → {core, adapters}`; rituals never import `app/`. `core/` imports only `types/` and `core/`. `web/` talks to the server only over HTTP/SSE and imports only `import type` from `src/types/`.
- **app/**: every exported function is `(deps, input) => Promise<Result<Output, YohError>>` — nothing else may be exported except types/interfaces/constants. Pure parsers live in `core/`. One-shot per turn; never blocks for input.
- **Writes**: only `app/` calls the Notion writes (`setTaskStatus`, `updateTaskField`, `createPage`, `updateTaskTitle`, `archiveTask` — the one move-to-Trash, only from an approved chat change set) and `applyCalendarEdit`. Shells are transport only: parse → call one app function → render its Result.
- **core/** is pure. Adapters may throw on I/O; `app/` converts to `Result`. `YohError.kind` ∈ missing-field, auth-expired, unreachable, rate-limited, validation, stale-proposal, conflict.
- **Proposals** apply only via `app/confirm-proposal.ts` after an explicit yes; a decline writes nothing. Typed field answers and "save that" are direct writes.
- **Storage**: `adapters/sqlite.ts` is the only opener; multi-step writes use `writeTx`; each user-visible change appends one outbox row in the same transaction. Chat transcript is client memory only.
- **Live delivery**: chat replies stream on their own SSE response to `POST /api/chat`; everything else rides the one shared `EventSource` in `web/src/lib/eventBus.ts`. Never open a second.
- **Web**: a view over the server API. Design tokens only (`web/src/tokens.css`) — no hard-coded colors, shadows, radii, durations. Animations honor `useReducedMotion`. Skeletons, not spinners. Every write visibly succeeds or fails. WCAG 2.2 AA in light and dark; keyboard-operable; icons 1.8px stroke with an accessible name. CSP `default-src 'self'`.
- **Copy**: second person, peer-level, neutral, no emoji, no filler; never claim a capability Yoh lacks.
- **Conventions**: kebab-case `src/` files; PascalCase React components. Routes `/api/<noun>[/<verb>]`, returning the serialized Result envelope via `wire()`/`httpStatus()`. "Today" uses the host `TZ` (`YOH_TIMEZONE`), never the browser's. Log via `src/adapters/logger.ts` (single-line JSON to stderr), not `console.log`. Each shared tuning constant has one defining export.
- **Tests**: `node:test` with fake adapters for `src/`; Vitest + React Testing Library for `web/`; Playwright via the fixture server (fake Notion/LLM). Never call real Notion, Google, Anthropic or Perplexity in tests.

## Entry points and recurring idioms (names, not lines — grep for them)
- **Chat routing:** `chatTurn` in `src/app/chat-turn.ts` — deterministic recognizers (`src/core/chat-commands.ts`, `src/core/search-intent.ts`) → the `chatAgent` tool loop (`src/app/chat-agent.ts`, tools in `src/core/chat-tools.ts`). Read tools answer; write tools only stage items into one `"change-set"` Proposal, applied by `applyChangeSet` (`src/app/apply-change-set.ts`) after Approve. New deterministic routes go before the loop.
- **Adding an HTTP route:** in `createApp` (`src/shell/server-routes.ts`), copy an existing `.get`/`.post` (e.g. `/api/calendar/day`): validate input in the shell, call ONE app function, return `c.json(wire(result), httpStatus(result))`. Its dependencies go on `ServerDeps` and are built by a `build*Deps` function in `src/shell/server-wiring.ts` (`buildHomeViewDeps`, `buildCalendarDayDeps`, `buildChatDeps`, …).
- **Errors:** adapters throw; app functions catch and return `{ ok: false, error }`, with user copy from `errorCopyForThrown` (`src/core/error-copy.ts`). Never leak raw error text to the UI.
- **Live updates:** a store write calls `appendOutboxInTx(db, { topic, entityId })` in the same transaction. Topics: `plan`, `tasks`, `research`, `open-items`, `notification`, `memory` (the `*_TOPIC` constants). Web listens with `onHint` (`web/src/lib/eventBus.ts`) and refetches on `hint.topic`.
- **Web → server calls:** `apiClient` (`web/src/lib/apiClient.ts`, typed Hono client), e.g. `apiClient.api["open-items"].$get()`. Types come from `src/types/api.ts` via `import type`.
- **Web data hooks:** module-level store + `use*`/`refetch*`/`start*Stream` trio, e.g. `web/src/lib/homeView.ts`, `web/src/lib/openItems.ts`.
- **E2E fake data:** `tests/e2e/fixture-server.ts` builds `ServerDeps` with fakes (`FIXTURE_TASKS`, `FIXTURE_OTHER_DAY_*`, a fake `runChatTurn`); add fixture data there, exported for specs to assert on.
- **Tests with fakes:** each `tests/app-*.test.ts` builds fake deps inline; copy the nearest one.

## Safety (non-negotiable)
- Spencer's live server runs on the Pi: systemd `yoh-server`, port 8787 on loopback, from `~/yoh` on `main`, with the rituals in the Pi's crontab. Nothing Yoh runs on the Mac (no launchd jobs, nothing on 8787). Never deploy to, restart, or write on the Pi — Spencer deploys; read-only checks over ssh are fine. Leave the main checkout alone (it is Spencer's working copy). Use port 8788 for the fixture server.
- Never `pkill`/`killall` by pattern. Stop only processes you started, by exact PID.
- Never write to Spencer's real Notion or Calendar. Never print or commit `.env` secrets.
- Never use bare `git stash`. Never push or merge (the coordinator does).
- Commit trailer is exactly and only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Anti-patterns (observed in this repo's agent runs — don't)
1. Reading whole files before writing anything. Grep, then read by line range (`sed -n 'a,bp'`); write the first failing test early.
2. Opening `_bmad-output/` or `docs/superpowers/plans/` — except the per-story plan sections your brief names. The brief + this file are otherwise complete; if not, report `NEEDS_CONTEXT`.
3. Re-reading a file you've already read and haven't changed.
4. Dumping full test/gate output into context.
5. Exporting a helper from `app/` (fails the layering test) — move it to `core/`.
6. Duplicating a private helper into a second file instead of moving it to `core/`.
7. Letting an LLM decide something a deterministic recognizer in `core/` can decide.
8. Running past the turn/context budget in the implementer contract instead of handing off.

## For coordinators
Dispatch = `docs/process/implementer-contract.md` + a brief built from `docs/process/brief-template.md`.
Session hygiene: `docs/process/context-hygiene.md`.

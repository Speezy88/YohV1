# AGENTS.md — Yoh (YohV1)

Agent-facing guide: the facts and rules a coding agent needs to work here without
opening planning documents. `CLAUDE.md` imports this file. If something here
disagrees with the code, the code wins; report the drift.

## What Yoh is
A single-user daily-planning assistant for Spencer: Notion (Tasks/Projects) +
Google Calendar + Claude (Haiku 4.5 for classify/capture/answer) + Perplexity
(web search) + Pushover/SMTP notifications. Runs on Spencer's Mac under launchd.

- Server: Node 24 with native TypeScript type-stripping (no build step), Hono, SQLite (better-sqlite3).
- Web: React + Vite + Tailwind v4 in `web/`, served by the server.
- Scheduled rituals: `src/shell/ritual-cli.ts` (morning, night-prompt, night-escalate, self-check) and `src/shell/backup-cli.ts`, run by launchd.

## Where things live
```
src/types/     domain.ts (domain types), api.ts (HTTP request/response types; web imports these as `import type`)
src/core/      pure logic — no I/O, no module state (chat-commands, quick-add, search-intent, tone, error-copy, ...)
src/adapters/  I/O — notion-adapter, calendar-adapter, llm-adapter, search-adapter, sqlite (only DB opener), *-store, logger
src/app/       one file per interaction use-case (chat-turn, home-view, check-off, confirm-proposal, ...)
src/rituals/   scheduled workflows (morning-ritual, night-ritual, self-check, data-completeness, ...)
src/shell/     entry points: server.ts (all HTTP routes + real deps wiring), ritual-cli.ts, backup-cli.ts
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
- **Writes**: only `app/` calls the Notion writes (`setTaskStatus`, `updateTaskField`, `createPage`, `updateTaskTitle`) and `applyCalendarEdit`. Shells are transport only: parse → call one app function → render its Result.
- **core/** is pure. Adapters may throw on I/O; `app/` converts to `Result`. `YohError.kind` ∈ missing-field, auth-expired, unreachable, rate-limited, validation, stale-proposal, conflict.
- **Proposals** apply only via `app/confirm-proposal.ts` after an explicit yes; a decline writes nothing. Typed field answers and "save that" are direct writes.
- **Storage**: `adapters/sqlite.ts` is the only opener; multi-step writes use `writeTx`; each user-visible change appends one outbox row in the same transaction. Chat transcript is client memory only.
- **Live delivery**: chat replies stream on their own SSE response to `POST /api/chat`; everything else rides the one shared `EventSource` in `web/src/lib/eventBus.ts`. Never open a second.
- **Web**: a view over the server API. Design tokens only (`web/src/tokens.css`) — no hard-coded colors, shadows, radii, durations. Animations honor `useReducedMotion`. Skeletons, not spinners. Every write visibly succeeds or fails. WCAG 2.2 AA in light and dark; keyboard-operable; icons 1.8px stroke with an accessible name. CSP `default-src 'self'`.
- **Copy**: second person, peer-level, neutral, no emoji, no filler; never claim a capability Yoh lacks.
- **Conventions**: kebab-case `src/` files; PascalCase React components. Routes `/api/<noun>[/<verb>]`, returning the serialized Result envelope via `wire()`/`httpStatus()`. "Today" uses the host `TZ` (`YOH_TIMEZONE`), never the browser's. Log via `src/adapters/logger.ts` (single-line JSON to stderr), not `console.log`. Each shared tuning constant has one defining export.
- **Tests**: `node:test` with fake adapters for `src/`; Vitest + React Testing Library for `web/`; Playwright via the fixture server (fake Notion/LLM). Never call real Notion, Google, Anthropic or Perplexity in tests.

## Safety (non-negotiable)
- Spencer's live server runs from the main checkout on port 8787 (launchd `com.yoh.server`). Never touch port 8787, launchd, or the main checkout. Use port 8788 for the fixture server.
- Never `pkill`/`killall` by pattern. Stop only processes you started, by exact PID.
- Never write to Spencer's real Notion or Calendar. Never print or commit `.env` secrets.
- Never use bare `git stash`. Never push or merge (the coordinator does).
- Commit trailer is exactly and only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Anti-patterns (observed in this repo's agent runs — don't)
1. Reading whole files before writing anything. Grep, then read by line range (`sed -n 'a,bp'`); write the first failing test early.
2. Opening `_bmad-output/` or `docs/superpowers/plans/`. The brief + this file are complete; if not, report `NEEDS_CONTEXT`.
3. Re-reading a file you've already read and haven't changed.
4. Dumping full test/gate output into context.
5. Exporting a helper from `app/` (fails the layering test) — move it to `core/`.
6. Duplicating a private helper into a second file instead of moving it to `core/`.
7. Letting an LLM decide something a deterministic recognizer in `core/` can decide.
8. Running past the turn/context budget in the implementer contract instead of handing off.

## For coordinators
Dispatch = `docs/process/implementer-contract.md` + a brief built from `docs/process/brief-template.md`.
Session hygiene: `docs/process/context-hygiene.md`.

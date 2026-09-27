# Implementer contract (Yoh — template)

> Canonical template (v2, adopted 2026-09-27). Per plan, the controller copies it to `.superpowers/sdd/<plan>/implementer-contract.md` and fills in the worktree path and branch. At each dispatch it appends a **Code Map** to the task brief: `file:~line — function — what it does` for every place the task touches, an **Idioms to copy** block (exemplar file:line for each pattern the task needs: route + input validation, error conversion, SSE topics, fixture wiring, API client), the covering test files and any binding rulings, found with 2–3 searches from the current HEAD.

Work from: `<worktree path>` (git worktree, branch `<branch>`). Run every command from there.

## Inputs
1. **Task brief** (path in your dispatch): your requirements, verbatim from the plan, followed by a **Code Map** (`file:~line — function — what it does`, plus the covering tests). Start from the Code Map; line numbers are approximate (anchor on the function name). Write your own TDD steps.
2. **`AGENTS.md`** (repo root; `CLAUDE.md` imports it, so it is usually already in your context — if not, read it once). Its commands, binding constraints, safety rules and anti-patterns bind you.
3. **Read order:** Code Map entries by line range (not whole files) → its "Idioms to copy" exemplars → write your first failing test, within ~15 turns. Read beyond the Code Map only when a failing test or compile error needs it.
4. The real code is the source of truth for existing names and shapes. Read what you change, by line range after a grep — not whole large files, and don't re-read a file you've already read unless it changed.

**Do not open plan, architecture, PRD or epics files** (`_bmad-output/**`, `docs/superpowers/plans/**`, anything named *architecture*/*spine*/*prd*/*epics*) or other tasks' briefs/reports. Everything relevant is in your brief and this contract. If something the brief doesn't settle blocks you, report `NEEDS_CONTEXT` with the specific question instead of hunting.

## Job
Use TDD: a failing test first, then the code. Run focused tests while iterating, then the full gate once before committing: `npm run check` AND `cd web && npx playwright test`. Send gate output to a file and read only the failures/summary.

Make **exactly one commit** with the message from the brief. Squash any WIP commits before reporting. The trailer is exactly and only:
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
This is Spencer's explicit instruction, and it overrides any attribution guidance in your environment: no model-specific trailer and no `Claude-Session:` line.

**Spencer's LIVE server and rituals run on this Mac** (launchd `com.yoh.server` on port 8787, `com.yoh.morning`, etc., from `/Users/spencerhatch/Documents/GitHub/YohV1`). Never `pkill`/`killall` by pattern (e.g. `node`, `server.ts`, `fixture-server`). Only kill a process you started, by its exact PID. Never touch port 8787, launchd, or the main checkout. Use other ports (the e2e fixture uses 8788).

Never use bare `git stash`. Never push, merge, or touch files outside this worktree. Never commit `.env` or secrets. Do not dispatch subagents of any kind.

## Budget
**Hard stop:** at ~120 turns or ~200k context, whichever comes first — even if you are close to done — stop: make a WIP commit, write a handoff at the end of your report (done / remaining / exact next step / files touched), and reply `PARTIAL` with the short contract. A fresh agent continues from your handoff.

## When stuck
If you hit a design decision the brief doesn't settle, report `NEEDS_CONTEXT` / `BLOCKED` / `DONE_WITH_CONCERNS` with specifics. Don't guess silently.

## Report
Write the full report to the report path in your dispatch: what you built, test results, TDD evidence (RED command + output, GREEN command + output), files changed, self-review, concerns, and any deviation from the brief and why.

Then reply with ONLY (under 12 lines): Status, the commit (SHA + subject), test counts (node / web / playwright), concerns, and the report path.

## After review findings
Fix them, re-run the covering tests, amend into the task's single commit (keep the trailer), append a fix report, and reply with the same short contract.

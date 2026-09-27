# Context hygiene (Yoh)

Adopted 2026-09-27. Why: cache reads grow with context size × turns; a long-lived
controller context (964k peak) and long implementer runs drove most of the cost.
A fresh session re-orienting from a handoff costs roughly 30–60k tokens once.

## When to clear
- After every merge or milestone (a batch merged, an epic story completed).
- When the controller's context passes ~250k tokens.
- Before switching topic (ops/setup Q&A mid-epic): run that in a separate short session.
- Don't clear when context is small (<~80k) — the saving doesn't cover re-orientation.

## Preconditions (all must hold)
1. No subagents running (clearing orphans their reports).
2. The plan ledger (`.superpowers/sdd/<plan>/progress.md`) has a line for every finished step.
3. The handoff file is refreshed (below).
4. Work is committed; nothing half-edited in a worktree.

## Never
- Mid-task, or before the task's ledger line is written.

## Handoff file
Path: `~/Documents/Yoh-previews/HANDOFF.md` — one living file, rewritten (not appended) at each clear point. Fixed sections:
1. **Current state** — branches/worktrees, what's merged, what's live.
2. **Next action** — the exact next step.
3. **Binding rulings** — pointers to ledger `Ruling:` lines, not copies.
4. **Standing rules** — commit trailer, worktree/port/Notion safety, lean-token rules.
5. **Reminders for Spencer.**

Point to ledgers, plans and contracts; don't summarize them.

## The clear
The controller says "ready to /clear" and gives the resume prompt. Spencer runs `/clear` and pastes:

> Read ~/Documents/Yoh-previews/HANDOFF.md and follow it exactly. Work autonomously.

(The controller can't clear its own context.)

## Measure every resume
Record in the ledger: turns and context size before the first real action. Target ≤15 turns and ≤80k tokens. A miss means the handoff format needs fixing.

## Caching notes (coordinators)
- Cache reads are cheap per token (~10% of input) but are paid on **every turn** for the whole context, so cost ≈ context size × turns. Shrinking context and shortening runs are the levers; "caching more" is not.
- The prompt cache expires after ~1 hour idle. A long idle wait re-writes the whole context (cache writes cost more than fresh input). Prefer clearing at a boundary over idling a huge context.
- Hand agents inputs as files (brief, contract, report paths). Never paste large content into a dispatch prompt or read a subagent's transcript into your own context — both stay resident for every later turn.
- Edit `CLAUDE.md` / `AGENTS.md` only between batches. Both load into every agent at start; mid-batch edits can be absorbed into a running implementer's commit and make runs inconsistent.
- Keep `AGENTS.md` small: it is paid on every turn of every agent. Task-specific detail belongs in the brief.

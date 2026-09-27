## Subagent usage

- Default subagent model: Sonnet. Use Haiku for simple/mechanical tasks
  (single-file edits, small scoped reviews). Reserve Opus for tasks that
  genuinely need it — high-complexity multi-file integration, architecture
  decisions — and say why when you pick it.
- Don't spawn a subagent for something you can just do directly in the
  main thread. Subagents are for work that's genuinely independent /
  parallelizable, or where isolating context is the point (e.g. a fresh
  implementer that shouldn't inherit prior task history).
- Ask before spawning more than 2-3 subagents for a single task —
  UNLESS the user has explicitly requested an autonomous/no-checkpoint
  run (e.g. Subagent-Driven Development mode). In that case, follow the
  per-task implementer+reviewer pattern without pausing, and only flag
  concerns if something looks genuinely wrong (not just "this is
  expensive").

## Context management

- Follow `docs/process/context-hygiene.md`. In short: clear at natural
  boundaries — after each merge/milestone, when context passes ~250k, or
  before switching topic (ops Q&A goes in its own short session). Never
  mid-task, never while subagents run, and not below ~80k.
- Before a clear: ledger lines written, work committed, and the living
  handoff `~/Documents/Yoh-previews/HANDOFF.md` rewritten (current state /
  next action / binding rulings as pointers / standing rules / reminders).
  Then tell the user "ready to /clear" with the resume prompt: "Read
  ~/Documents/Yoh-previews/HANDOFF.md and follow it exactly. Work autonomously."
- After each resume, log turns and context before the first real action
  (target ≤15 turns, ≤80k).
- Since I can't invoke /compact or /clear on myself, proactively flag it
  when those triggers are hit rather than silently continuing.

## Implementer subagents

- Every implementer gets `docs/process/implementer-contract.md` (copied into
  the plan workspace) plus a brief built from `docs/process/brief-template.md`
  (Code Map + "Idioms to copy" filled from the current HEAD). Binding
  constraints live once, in `AGENTS.md`. Implementers never open
  plan/architecture/PRD files.
- Measure each implementer with `scripts/agent-metrics.py` and log the
  numbers in the plan ledger.

## Agent guide

@AGENTS.md

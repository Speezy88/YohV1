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

- Since I can't invoke /compact on myself, proactively flag it: if a
  session's context is visibly ballooning (long tool outputs, many
  files read, long-running subagent chains), tell the user it's a good
  point to /compact or /clear rather than silently continuing.

# Task brief template

The coordinator builds one brief per task: the task text is extracted verbatim from
the plan, then the sections below are filled from the current HEAD (2–3 greps).
Constraints are NOT repeated here — they live in `AGENTS.md`; list only
story-specific ones. Keep the brief under ~120 lines.

```markdown
# Task N: <title>

## Objective
<one or two sentences: the user-visible outcome>

## Requirements (verbatim from the plan)
<task text: behavior, tests, commit message>

## Success criteria
- [ ] Each behavior above has a test that failed first
- [ ] Focused tests green; `npm run check` green once; Playwright green if web changed
- [ ] One commit, message exactly: `<message>`

## Files you'll touch
| File | ~Line | Function | Change |
|---|---|---|---|
| src/... | ~120 | `fnName` | <what changes> |

## Code Map (read these first, by line range)
- `path:~line — fnName — what it does now`

## Idioms to copy
- <pattern>: `exemplar/path:~line` (and its test `tests/...`)

## Story-specific constraints and rulings
- Ruling: <decision> — <why>

## Read order
1. Files-you'll-touch rows, by line range  2. Idioms exemplars  3. Write the first failing test (within ~15 turns)
```

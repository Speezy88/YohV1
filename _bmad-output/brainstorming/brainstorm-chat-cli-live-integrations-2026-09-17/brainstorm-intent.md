---
source: brainstorm-chat-cli-live-integrations-2026-09-17/.memlog.md
type: intent distillation
---

# Intent: Live Integrations for Yoh's Chat CLI

## Context

Give Yoh's chat CLI live write access to Notion (task/page/DB creation, not just today's narrow reads), Google Calendar (ad hoc time-blocking on the user's real calendar, not just the dedicated Yoh Plan calendar), and web search — so Yoh becomes a genuinely active assistant that can act in one chat turn instead of a passive one requiring manual app-switches.

## Current state

- **Notion adapter**: only `readNotionTasks` / `setTaskStatus` / `updateTaskField` — narrow, schema-bound writes; no arbitrary page or DB creation.
- **Calendar adapter**: reads events and writes the daily plan to a dedicated "Yoh Plan" calendar; does not read/write the user's main calendar.
- **chat-cli.ts**: a deterministic command parser (`parseTimeBudgetCommand`, `parseFieldAnswer`, etc.), not a freeform LLM tool-calling loop.
- **Web search**: no existing search/browsing capability anywhere in the codebase — wholly new surface area.
- **Precedent**: FR-24 already established chat-cli writing missing planning fields back to Notion live from a chat turn.
- Existing reusable machinery: Research Vault DB, Yoh Plan's block-ID tracking, and the prior session's "propose, don't impose" rule.

## Chosen direction / design principles

1. **Safety-tier system is the single most load-bearing decision** — design once as a shared primitive every capability slots into, not per-feature: `read-only` / `propose+confirm` / `auto-write+receipt` (auto-write *silent* is explicitly excluded — see rejections).
2. **Safety tier and scope are coupled, not independent.** Auto-write is only safe when the target is Yoh-owned (Yoh Plan calendar, Yoh-created rows). Anything touching the user's real calendar or full workspace requires propose+confirm regardless of trigger mode.
3. **Provenance is never silent.** Every live write gets a chat receipt (e.g. "created task X, due Y") and/or memlog log. This is the fix for the three most common failure modes: silent background writes, swallowed API failures, unlabeled web-search facts.
4. **Architecture: extend, don't rebuild.** The session converges against turning chat-cli into an open LLM tool-calling loop. Instead, extend the existing adapter pattern (`notion-adapter.ts`, `calendar-adapter.ts`) with a small scoped tool registry of named, typed commands (e.g. `create_task`, `create_page_in`, `move_calendar_block`, `search_web`) — the fork resolves toward "more commands," not "general agent."
5. **Composability is the most novel, highest-value direction**: chaining the two new capabilities — "research X and file the results" — search, then draft page, then confirm, then create. More valuable than either capability shipped in isolation.
6. **Reuse over invention**: Research Vault DB as the search-results sink; Yoh Plan's block-ID tracking as the time-block edit anchor; "propose, don't impose" as the write-confirmation philosophy; existing data-completeness gate extended to also propose inferred values (not just ask).
7. Notion page/DB creation must be schema-validated against the target DB's real property names (e.g. `DEFAULT_TASK_PROPERTY_NAMES`) before writing, to avoid creating rows invisible to the planning engine.
8. New credentials follow the existing adapter pattern (env/config), never hardcoded or handed raw to the model.

## Explicitly rejected approaches

- No raw Notion/API tokens given to the model — all writes go through a hardcoded, explicit verb set (scoped tool registry).
- No zero-confirmation auto-scheduling — no moving or deleting the user's existing (non-Yoh-created) calendar events without explicit named confirmation. Writes are additive-only and confirm-gated by default.
- No pasting web-search results into the plan/TaskDB as unlabeled fact — every search-derived write is tagged with source and timestamp.
- No single universal "do_anything" tool routing natural language internally with no per-capability limits — keep chat-cli's typed, named-command strength.
- No silent false success on API failure — failures are surfaced honestly with a retry/undo path.
- No search-on-every-turn "just in case" — search is triggered only by explicit ask or clear intent.
- No proactive/unprompted workspace reorganization — even with write access, restructuring stays a proposal until confirmed.
- No big-bang rollout — capabilities ship independently, each behind its own safety tier, so a bug in one (e.g. web search) can't block another (e.g. task creation).
- **Flagged-against configuration to explicitly avoid implementing later as a "convenience shortcut"**: Calendar write × explicit command × auto-write **silent** × Yoh-owned scope.

## Proposed build sequence

1. **Notion task/page writes** extending the existing adapter — smallest gap from current state.
2. **Calendar time-block editing** via chat, reconciled through the existing plan-block-ID tracking.
3. **Web search** last, as the highest-uncertainty net-new capability — ship read-only-with-citation first, before enabling any write-back to Notion.

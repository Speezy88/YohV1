# Chat tool loop — design

Date: 2026-10-03
Status: awaiting Spencer's review

## Problem

Free-form chat cannot do what the planner and the fixed commands can. A message
that matches no deterministic recognizer in `src/app/chat-turn.ts` ends at
`answerQuestion` (`src/app/general-question.ts`), which gives the model the
message, tone prompt and memory context and nothing else: no Tasks, no
Calendar, no Plan, no date, no way to write.

Observed in the chat history of 2026-10-01 and 2026-10-03:

| Message | Reply | Cause |
|---|---|---|
| "what is the total amount of minutes of tasks that i have due on monday" | "I don't have real access to your Notion workspace" | Fallback model has no read access |
| "add the workout and dinner to my google calendar for today" | "I couldn't tell what you want in the new Tasks item" | Routed to create-item; one item per message |
| Same request, rephrased, then "yes" | "Done. Both events are now on your calendar." | Fallback model cannot write; the claim was not backed by a write |
| "yes build the plan around this" | "What's today's date?" | Model is not told the date; cannot run the planner |
| "move the rest of my tasks accordingly" | "Run `/plan`" | Cannot chain steps |
| "add the english MGP assignment to my google calendar after dinner" | "I couldn't tell what you want in the new Tasks item" | Cannot look up a task or resolve "after dinner" |

## Goal

Free-form chat can read and change the same data as the planner and fixed
commands, in one message plus one yes.

Success: every message in the table above produces a correct answer or a
correct change set, and chat never states that a write happened unless it did.

## Decisions (Spencer, 2026-10-03)

- Approach: a tool-using loop replaces the LLM tail of `chatTurn`; deterministic recognizers stay.
- Scope: answer from live data; Calendar create/move/resize; Notion task writes; build and re-fit the Plan.
- Writes: one yes per batch. Nothing is written before the yes; a decline writes nothing.
- Calendar delete: only events Yoh created.
- Model: Haiku 4.5, defined by one exported constant.
- Canvas: separate project, later. Chat says plainly that it cannot read Canvas.
- TypeSafe Jev: not used. Routing sits behind one function so a pre-router can be added later.

## Routing

`chatTurn` keeps its order: slash commands, memory commands, `search:`, then
the deterministic recognizers. These still cost zero model calls.

Changes:

1. `classifyCapture`, `classifyChatIntent` and the final `answerQuestion` call
   are replaced by one call to `chatAgent` (new, `src/app/chat-agent.ts`).
2. Where a recognizer matches but its parser cannot produce a draft
   (`parseCreateItemCommand` → `draftItem`, `isCalendarEditCommand` →
   `tryCalendarCreate`), the line falls through to `chatAgent` instead of
   returning a "couldn't tell what you want" reply.
3. `isCalendarDeleteRequestCommand` no longer returns the fixed refusal; delete
   requests go to `chatAgent`, which enforces the Yoh-created rule.

`reachedLlm` is set before `chatAgent` runs, as it is today before
`classifyCapture`.

## The loop (`src/app/chat-agent.ts`)

`chatAgent(deps, input) => Promise<Result<ChatTurnResponse, YohError>>`

- System prompt: existing tone prompt, plus today's date, local time and
  timezone (host `TZ`), plus memory context, plus the rule that changes are
  only ever proposed, never reported as done.
- History: the same trimmed history `answerQuestion` receives today.
- Runs model → tool calls → tool results until the model returns a final text
  or `CHAT_AGENT_MAX_STEPS` (8) is reached. At the cap the reply states what
  was read and staged and that it stopped.
- Emits `status` events per tool ("Checking your Tasks…", "Checking your
  Calendar…") and streams the final text as `delta` events.
- Tool schemas and the pure parts (argument validation, totals, change-set
  summary copy) live in `src/core/chat-tools.ts`. The Messages call with
  `tools` is a new function in `src/adapters/llm-adapter.ts`.
- `CHAT_AGENT_MODEL` and `CHAT_AGENT_MAX_STEPS` each have one defining export.

## Tools

### Read tools — execute immediately

| Tool | Input | Output |
|---|---|---|
| `list_tasks` | due range, status, project, title query | tasks (id, title, due, duration, priority, status, project) plus `count`, `totalMinutes`, `missingDurationCount`, all computed in code |
| `list_events` | date or date range | events (id, calendar, title, start, end, `yohCreated`) |
| `get_plan` | date | the stored Plan's blocks, or "no Plan" |
| `search_memory` | query | matching memory items |
| `web_search` | query | the existing `searchWeb` result |

Arithmetic the user asks for (totals, counts) is returned by the tool, not left
to the model.

### Write tools — staged only

Each call validates its arguments, appends one item to the turn's change set
and returns a short description to the model. No adapter write happens.

| Tool | Change-set item |
|---|---|
| `create_event` | title, start, end |
| `move_event` / `resize_event` | event id, new start/end |
| `delete_event` | event id; rejected at staging unless the event is Yoh-created |
| `create_task` | title and optional planning fields |
| `update_task` | task id and one or more of due date, duration, priority, title |
| `complete_task` | task id |
| `plan_day` / `refit_plan` | no arguments; at most one per change set |

Ids always come from a read tool result in the same turn; a write tool call
with an unknown id is rejected back to the model.

## Change set and the one yes

- If the loop ends with staged items, `chatAgent` stores one Proposal of a new
  kind, `"change-set"`, through `openProposal`, and returns it as the turn's
  `question`. The reply text lists the items; the summary copy is built in
  `core/` from the items, not from model prose.
- On yes, `confirmProposal` applies the items in staged order, with any Plan
  step moved to the end so it sees the new events. Each item uses the existing
  write path and its existing checks: `applyCalendarEdit` (etag staleness),
  `createPage`, `updateTaskField`, `updateTaskTitle`, `setTaskStatus`,
  `planDay`, `requestReshuffle` + `approveReshuffle`.
- Apply continues past a failed item. The confirmation reply is built from the
  per-item results: "Added Workout 1:10–2:50 PM. Added Dinner 6–7 PM. Couldn't
  re-fit the Plan: …". Each applied item contributes a receipt.
- A decline clears the Proposal and writes nothing.
- The existing Proposal TTL and stale handling apply to the whole set.
- Each user-visible change appends its outbox row as the underlying write
  already does.

## Yoh-created events

- Events created through a change set are stamped with a new
  `extendedProperties.private` key (`yohChatCreated`), alongside the existing
  `yohPlanBlockId` on Plan blocks.
- `yohCreated` is true when either key is present. `delete_event` is refused
  for any other event, with a reply telling Spencer to delete it in Google
  Calendar.
- Events chat created before this ships carry no marker and cannot be deleted
  by chat.
- Deleting needs a new `"delete"` variant on `CalendarEditChange` and its
  handling in `applyCalendarEdit`, with the same etag staleness check and a
  re-check of the marker at apply time.

## Honesty rules

- The model is told it cannot write; it can only stage.
- Text that says a change was made comes only from `confirmProposal`'s results.
- If the loop staged nothing, the reply carries no receipts.
- A capability outside the tool list (Canvas, deleting other people's events)
  gets a plain "I can't do that" reply.

## Errors

- A read tool that throws returns an error result to the model containing the
  `errorCopyForThrown` text; the model reports it. Raw error text never
  reaches the UI.
- A failure of the model call itself returns `{ ok: false, error }` from
  `chatAgent`, as `answerQuestion` does today.
- A partial apply is reported per item (see above).

## Web

- The confirm card renders a `"change-set"` Proposal as a list of items with
  one Approve and one Discard. Design tokens only; keyboard-operable.
- After approve, the card shows the per-item outcome returned by the server.
- No new SSE connection; the chat reply stream and the shared event bus are
  used as today.

## Tests

- `tests/core-chat-tools.test.ts`: argument validation, totals, summary copy.
- `tests/app-chat-agent.test.ts`: scripted fake model client and fake
  Notion/Calendar. One case per row of the Problem table, plus: step cap,
  read-tool failure, unknown id on a write tool, delete of a non-Yoh event,
  decline writes nothing.
- `tests/app-confirm-proposal.test.ts`: change-set apply order, Plan step
  last, partial failure, stale item.
- `tests/app-chat-turn.test.ts`: recognizers still cost zero model calls;
  parse failures fall through to the agent.
- `tests/e2e/fixture-server.ts`: fake `runChatTurn` returns a change-set
  question; one Playwright spec covers the multi-item card, approve, discard.
- No test calls real Notion, Google, Anthropic or Perplexity.

## Cost

A free-form turn changes from up to three Haiku calls to between two and
`CHAT_AGENT_MAX_STEPS`. Usage is recorded through the existing
`llm-usage-store` under a new `agent` label.

## Out of scope

- Canvas.
- Deleting events Yoh did not create.
- A separate classification model (Jev or otherwise).
- Changes to slash commands, rituals, or the Plan algorithm.
- Automatic memory filing behaviour (unchanged: applies to turns that reach the model).

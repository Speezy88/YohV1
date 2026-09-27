# Yoh — SDD Plan: Real-Use Fixes + UI Refresh (between Epic 8 and Epic 9)

**Why this exists.** Spencer's first real session on the merged Epic 8 app (2026-09-27) found it close to unusable with his real data:

- "make a event at 10:45 am tommorow to meet with alex. itll go for an hour and a half" became a Notion **Task** whose Due Date was the literal text `"tomorrow at 10:45 AM"`. Notion rejected it only after he confirmed, and the error said "I can't apply that any more" (the stale-proposal wording).
- `/morning` and `/night` said "No Plan has been generated for today yet", and nothing could generate one.
- "what is happening tomorrow" couldn't be answered.
- The UI looks small, dark, flat and unfinished.

These tasks fix that before Epic 9. **Spencer approved these decisions (2026-09-27):** Yoh can build today's Plan on demand. The look changes to a brighter cool white with stronger neumorphism and more blue gradient. A nav sidebar is added. Home gets a Google-Calendar-style day view with a mini month. The mouse wheel and swipe move between pages. The UI refresh lands before Epic 9 starts.

- **Spec (binding authority):** `ARCHITECTURE-SPINE.md` (AD-1, AD-3, AD-5, AD-11, AD-12, AD-13, AD-16, AD-17). `DESIGN.md` / `EXPERIENCE.md` are **amended by Task 6** where this plan's decisions differ.
- **Precedent and format:** `_bmad-output/implementation-artifacts/sdd-plan-YohV1-phase2-epic8.md`. Its Global Constraints and Interface Contract (C1–C6) still bind everything below, except where a task explicitly amends them.
- There are no separate per-story plans. Each task section below is the implementer's full brief, and the implementer writes the TDD steps.

## Global Constraints (in addition to Epic 8's, which all still apply)

- Layering is unchanged: `shell → app → {rituals, core, adapters}`, `ritual-cli/rituals` never import `app/`, and every exported `app/` function is `(deps, input) → Promise<Result>`. Pure parsing goes in `core/`. `web/` imports only `import type` from `src/types/`.
- **The confirm boundary is unchanged.** Creating a Notion item or Calendar event is still draft → Structured Question → explicit yes → `confirmProposal`. No new direct-write path.
- **Never show a draft the write will reject.** Every date and datetime in a draft is resolved to ISO (a `YYYY-MM-DD` date, or an ISO-8601 UTC datetime) and validated **before** the confirm question is shown. If it can't be resolved, Yoh asks for the missing piece in plain words instead of drafting.
- **Relative dates resolve against the host `TZ`** ("today", "tomorrow", weekday names, "next Friday", "Oct 3", "10:45 am"), never the browser's clock and never UTC midnight.
- **Error copy is honest:** a failure names what actually went wrong in plain language. The stale wording ("out of date") is used only for `stale-proposal`. Raw adapter/Notion API text (`body.properties…`) never reaches Spencer.
- Tests: `npm run check` + `cd web && npx playwright test` green after every task. Baseline: node 1093, web 269, Playwright 10.
- **One commit per task**, message given per task, with the trailer exactly and only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use bare `git stash`, never push or merge.

---

## Task 0: Chat stream never runs into the input or cards (urgent, reported 2026-09-27)

**Owns:** `web/src/pages/Chat.tsx`, `web/src/components/ChatInput.tsx`, `OpenItems.tsx`, `StructuredQuestion.tsx`, `ChatMessage.tsx` layout, plus the Chat page's Vitest and Playwright tests.

**Reported:** once the conversation grows, the stream extends down into the cards (open items, Structured Questions) and the Chat Input at the bottom, and they overlap.

**Behavior:**
- Chat is a full-height column with three regions that never overlap:
  1. open items at the top, collapsible when there are many, and capped with their own scroll;
  2. the message stream as the **only** flexible, scrollable region (`min-height: 0`, `overflow-y: auto`);
  3. the Chat Input, pinned at the bottom in normal flow. It is not absolutely positioned over the stream, or it keeps enough bottom padding that the last message is never hidden.
- Structured Question cards inside the stream take normal flow height and are never clipped or overlaid.
- Auto-scroll to the newest message while streaming, unless Spencer has scrolled up. Scrolling up pauses auto-scroll, and a "Jump to latest" control appears.
- Holds at 1440×900, 1280×720, and a narrow ~390 px width.
- **Tests:**
  - Vitest: the layout structure, and auto-scroll paused when scrolled up.
  - A Playwright spec seeds a long conversation (≥30 turns, via the fixture's scripted `runChatTurn`) plus an open item. It asserts that the last message's bounding box sits fully above the Chat Input's, and that no card intersects the input.

**Commit:** `fix(chat): stream, cards and input never overlap in long conversations`

---

## Task 1: Plan my day on demand

**Owns:** `src/app/plan-day.ts` (new, `planDay(deps, {}) → Result<ChatTurnResponse>`); a `/plan` registry entry in `src/app/commands.ts`; a deterministic recognizer in `src/core/chat-commands.ts` for "plan my day" / "make my plan" / "generate today's plan" / "plan today"; `chatTurn` routing; `/morning`'s no-Plan reply; server + fixture wiring; tests.

**Behavior:**
- `planDay` runs the **same** `rituals/morning-ritual.ts` `runMorningRitual` pipeline the 6am cron runs, with the same gate, priority, fitting, reasoning line, Yoh-Plan calendar write and open-items. The only difference is that `sendNotification` is a no-op, so there's **no Pushover push**.
- **If today's Plan already exists,** it doesn't regenerate. It replies that a Plan already exists, gives a one-line summary, and suggests "I'm behind" (re-flow) to re-fit the rest of the day.
- On success, the reply is the rendered Plan text (uncolored, same as `/morning`) + its reasoning line, plus any open questions it raised (e.g. missing fields) as `ChatTurnResponse.question` / open items.
- Check how the morning ritual's idempotence marker (ritual-run record, dead-man switch, heartbeat check) interacts with an on-demand run. Required outcome: after `/plan` today, the 6am cron run for the **same** host-TZ day must no-op, with no second Plan and no push. The next day's cron runs normally. An on-demand run must not trip the dead-man's-switch alert. Pin each with a test.
- `/morning` with no Plan now replies "No Plan yet today. Type /plan (or say "plan my day") and I'll build it now." It still never generates a Plan itself (FR-1 stands).
- The server wires `planDay`'s deps the way `ritual-cli/morning-deps.ts` builds the morning deps (Notion/Calendar/token-store/memory), minus the push. It never names adapter write functions (layering scan), and reuses the adapter binders or the morning-deps builder where possible.
- Home's empty state (Task 6 restyles it) says: "No Plan yet today. Type /plan to build it now."
- **The morning Plan reaches Spencer only in the app** (Spencer, 2026-09-27). The scheduled `morning` ritual no longer sends the Pushover Plan push. The Plan appears on Home and via `/morning`, and the in-app Plan view is the delivery. Pushover stays only for AD-7 failure and operational alerts (a ritual failed, the server is down, a missed run). Update the ritual's tests: the delivered outcome no longer depends on push success. The PRD/UX amendment is recorded in Task 8.

**Commit:** `feat(fixes): plan my day on demand (/plan)`

---

## Task 2: Calendar requests go to Calendar, never to a Notion Task

**Owns:** routing in `src/app/chat-turn.ts`; `src/core/chat-commands.ts` (a broader calendar-create recognizer); `src/adapters/llm-adapter.ts` (the capture detector becomes a 3-way classifier); tests.

**Behavior:**
- Broaden deterministic calendar detection. A line whose verb is create/make/add/schedule/set up/book/put and that names an event/meeting/appointment/call/block, or says "meet with …" / "meeting with …" together with a time or date, routes to the calendar-edit **create** path (`app/calendar-edit.ts` → `draftCalendarEditRequest` → `openProposal` → confirm). Required cases:
  - "make a event at 10:45 am tommorow to meet with alex. itll go for an hour and a half" (typos included)
  - "schedule a meeting with Alex tomorrow at 3"
  - "add dentist appointment Friday 2pm"
  - "put a study block at 4 today"
  - "create an event …"
- Replace `detectTaskCapture` with a **new** function `classifyCapture(client, line) → "task" | "event" | "none"` (don't widen `ChatIntent`). A time-bound thing to attend (meeting, appointment, call, class, event at a time) is `event`, and something to do or produce is `task`. `event` → the calendar create path, `task` → the FR-26 create path as today, `none` → general chat. Deterministic recognizers still run first, and deterministic command lines stay at zero LLM calls.
- Duration phrases resolve: "an hour and a half" = 90 min, "for 45 minutes", "till 4". No end and no duration = 60 min, and the confirm question states it ("…10:45–11:45 AM (1 hour, I assumed)").
- The calendar confirm question names the event, the day and the local time range, e.g. "Create "Meet with Alex" on Sat Sep 28, 10:45 AM–12:15 PM?". There's still no delete variant (AD-13).
- **Tests:** the five lines above route to calendar create with a correct ISO start/end for a fixed `now` and TZ, and "Lab report draft, due Thursday" still routes to a Task.

**Commit:** `fix(chat): calendar requests create calendar events, not tasks`

---

## Task 3: Dates are resolved and validated before any draft is shown

**Owns:** `src/adapters/llm-adapter.ts` `draftNotionPageFields` (and `draftCalendarEditRequest` if it has the same gap); `src/adapters/notion-adapter.ts` draft-time validation; `src/app/create-item.ts`; tests.

**Behavior:**
- `draftNotionPageFields` receives today's host-TZ date + timezone and resolves relative dates ("tomorrow", "Thursday", "next week Friday", "Oct 3") into `YYYY-MM-DD` for date properties, and into an ISO datetime when the property allows a time and a time was given.
- Draft-time validation in `resolveNotionPageDraftProperties` rejects any non-ISO date or datetime value, so it never reaches the confirm question. On rejection, `create-item.ts` replies with a plain question, e.g. "When is "Lab report draft" due? I couldn't read "sometime soon" as a date."
- The write-time re-validation stays (AD-12).
- **Tests:** the relative dates above resolve correctly for a fixed `now`/TZ, including across a month boundary and after midnight local time. An unparseable date never produces a draft, and a Notion `validation` error can no longer come from a date the draft showed.

**Commit:** `fix(chat): resolve and validate dates before drafting`

---

## Task 4: Honest error messages

**Owns:** `src/app/answer-open-item.ts` (`"I can't apply that any more — …"` at ~line 82), `src/app/confirm-proposal.ts` receipts and errors, and every other place `app/` turns an error into Spencer-facing text (grep `error.message` in `src/app`); tests.

**Behavior:**
- Map by `YohError.kind`:
  - `stale-proposal` → "That changed since I suggested it, so I didn't apply it."
  - `validation` → "Notion/Google didn't accept that: <plain reason>"
  - `unreachable` / `auth-expired` / `rate-limited` → "I couldn't reach <Notion|Google Calendar> right now; nothing was changed." Auth adds "your Google sign-in needs refreshing".
  - `conflict` → "That was already answered elsewhere."
- Put one shared pure mapper in `core/` (e.g. `core/error-copy.ts`) used by every app file. Raw API text (anything containing `body.`, `properties.`, stack traces) is dropped. Keep the adapter's message only when it's already a plain sentence written by our own code.
- **Tests:** one per kind, plus the exact Notion-validation message from the incident (`body.properties.Due Date.date.start should be a valid ISO 8601 date string…`) → a plain sentence naming Due Date.

**Commit:** `fix(chat): honest, plain-language error messages`

---

## Task 5: "What's happening tomorrow" (read any day)

**Owns:** `src/adapters/calendar-adapter.ts` `readCalendarEvents` (optional target date, default today, still host-TZ day window, same read-only client); `src/core/chat-commands.ts` (a deterministic recognizer + date resolver for "what's happening/what do I have/what's on tomorrow|<weekday>|<date>|this weekend"); `src/app/day-view.ts` (new, `dayView(deps, {date}) → Result<ChatTurnResponse>`); `chatTurn` routing; tests.

**Behavior:**
- Lists that day's calendar events in local time, plus that day's stored Plan if one exists. For a future day, it's events only, with a hint to type "/plan" that morning. An empty day says so plainly.
- Put the shared relative-date resolver (today/tomorrow/weekday/next X/month-day/ISO) in `core/` as ONE function also used by Tasks 2 and 3. Task 3 may land it first. Whichever task lands first owns it, and the other reuses it. Never write two resolvers.
- General chat (`answerQuestion`) keeps an accurate capability list. Update its system prompt so Yoh can say what it can do now (plan on demand, read any day, create events and tasks, search, etc.) and never claims more.

**Commit:** `feat(chat): see any day's calendar ("what's happening tomorrow")`

---

## Task 9: Prompt caching + recording what every Claude call costs

**Owns:** `src/adapters/llm-adapter.ts` (every `messages.create` / stream call); a new `src/adapters/llm-usage-store.ts` (a dedicated SQLite table under AD-10, created idempotently: one row per Claude call with `{at, model, purpose, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`); a price table as ONE export (per model, input / output / cache-write / cache-read $ per million tokens: Haiku 4.5 $1 / $5, Sonnet 5 $2 / $10, with cache read 0.1× input and cache write 1.25× input); tests.

- **Prompt caching (Spencer, 2026-09-27):**
  - Put `cache_control` breakpoints on every call with a stable prefix: the system prompts (tone, capability list), the few-shot or instruction blocks of the classifiers and drafters, and the growing chat history for general chat. Cache the history prefix so each new turn only pays full price for the new message.
  - Keep prefixes byte-stable: no timestamps or dates inside the cached system prompt. Pass today's date in the user turn or after the last breakpoint instead.
  - Respect the model's minimum cacheable prefix. A too-short prefix simply won't cache, and nothing breaks.
- **Usage recording:** after every call (streaming included), append a row to `llm-usage-store` with `response.usage`. A failed write never breaks the chat turn: log it and continue.
- **Tests:**
  - The request bodies carry `cache_control` in the right places, and the cached prefix is identical across two consecutive turns (a byte comparison of the prefix).
  - Usage rows are written with the right `purpose` (e.g. `classify`, `capture`, `answer`, `draft-notion`, `draft-calendar`, `suggest-field`).
  - A cost function over rows × the price table gives the right dollars for a fixed fixture.
- Epic 12's Desk shows **"Claude API spend this month"** from this store. Recording starts now, so there's history by then.

**Commit:** `feat(llm): prompt caching and per-call usage recording`

---

## Spencer's information-architecture decisions (2026-09-27): these amend the PRD, UX spines and epics (Task 8)

- **Pages, in order:** 1. **Home**, 2. **Tasks** (the task entry area), 3. **Desk**, 4. **Research Hub**. **There is no Chat page.** Chat is a **panel available on every page**, opened from a **small floating "Ask Yoh" pill** fixed bottom-center on every page, like Wispr Flow's pill: compact (~46 px tall), raised, not too low (~30 px above the bottom edge), never covering content (pages reserve room for it). Click the pill or press **⌘K** to open the chat panel with the input already focused. **The panel is large** (Spencer, 2026-09-27): it covers the whole content area to the right of the sidebar, inset about 24 px, with only the sidebar still visible. The page behind is dimmed context, not functional. Messages are up to about 640–700 px wide. Open items and Structured Questions live in that panel, and so do `/`-commands and the Command Palette.
- **Navigation is a vertical stack.** Pages sit top-to-bottom, and you move between them with **smooth** transitions using:
  - on-screen **up and down arrow buttons**;
  - the keyboard **↑ / ↓** (and Page Up / Page Down) when no text field has focus;
  - the mouse wheel, only when the hovered scroll area is at its edge.

  The sidebar jumps directly to any page. Reduced motion makes transitions instant.
- **Side swipe is retired, officially and everywhere.** No swipe gesture code remains in `web/`, and every living spec document says so (Task 8).
- **Tasks must be as easy as Notion, or easier.** It's a standalone page, pulled forward from Epic 11 (Task 6B).

## Task 6A: UI refresh + new app shell (after Spencer approves the updated mockup)

**Owns:** `web/src/tokens.css`, `PageShell` and page navigation (`web/src/lib/pages.ts`, deleting `web/src/lib/swipe.ts` and its tests), the sidebar, the chat panel (moving Chat's contents out of `web/src/pages/Chat.tsx` into a panel component shared by every page), Home, `manifest.webmanifest` + icons, and the Vitest/Playwright updates. The approved mockup is the "Yoh UI Refresh" artifact (https://claude.ai/artifact/1dxqs2AEZU4a2NEcFyoEWi). Its values become tokens.

- **Look:**
  - A brighter **cool white** base (`#EEF2F8` family), with no warm off-white.
  - Stronger **neumorphism**, using the recipe from Spencer's reference (`usamamoinakhter/Neumorphism-ui`, React Native, so ported as CSS tokens, not installed): a white highlight top-left and a `#a3b1c6`-family shadow bottom-right. Cards are raised, and inputs and pressed states are inset. The hairline-rim contrast rule stays.
  - **More blue gradient** (Sky → Azure `#7FC1F5 → #1E6FD9`) on the active nav, primary buttons, checked boxes, today's date, Plan blocks, the thinking text, and accent headings.
  - A **bigger scale** (body 17–18px, headings ~40px, controls 44–64px).
  - Dark theme retuned to match.
- **Shell:**
  - A left **sidebar**: the Yoh wordmark, then Home, Tasks, Desk, Research Hub (icons + labels, active item in the gradient pill), then the theme toggle.
  - The **vertical stack** navigation described above, with up/down arrow buttons.
  - The **"Ask Yoh" pill** (see the IA decisions above) on every page, opening the **chat panel** drawer. ⌘K opens it too, Esc closes it, and focus returns to where it was.
  - The chat panel carries everything Chat did in Epic 8: streaming, the thinking indicator, open items, Structured Questions, the Command Palette, receipts, the draft surviving panel close, and **markdown rendering** (a bundled library, no raw HTML, CSP-safe). Task 0's no-overlap guarantees hold inside the panel.
  - Home's capture flow still counts at most 3 actions: click the pill (or ⌘K), type, Enter. The NFR-CaptureSpeed Playwright gate is updated, not weakened.
- **Home:**
  - A greeting + host-TZ date.
  - **Today's Time Budget** (Spencer, 2026-09-27), always visible on Home. It shows the budget, how much of it the Plan uses, and time done so far (e.g. "Time Budget 6 h · 4 h planned · 1 h done"). Click it to change the budget in place, through the existing `app/time-budget.ts`. With no budget set today, it shows the default and "Set today's budget".
  - A Plan card of raised rows (check-off + Undo as before).
  - A **mini month** + a **Google-Calendar-style day view** (a scrolling hour grid that opens at the current time, with a now-line and rounded event blocks showing title + time). It never stretches the full screen height.
  - Untitled or punctuation-only events show "(No title)".
  - Empty state: "No Plan yet today. Type /plan to build it now."
- **Installed-app quality:** keep `display: standalone`. Add PNG icons (192, 512, maskable) + an `apple-touch-icon`, and use the new palette in `background_color` / `theme_color`.

**Commit:** `feat(ui): brighter neumorphic shell, vertical page stack, chat panel, Google-style day calendar`

## Task 6B: Tasks page, as easy as Notion or easier

**Owns:** `src/app/tasks-view.ts` (new, `listTasks(deps, {groupBy?, query?}) → Result<TasksViewResponse>`); `src/app/create-task.ts` (new, `createTask(deps, TaskDraftInput) → Result<{task, receipt}>`); `src/app/update-task.ts` (new, `updateTask(deps, {taskId, field, value}) → Result<{receipt}>`); a pure inline quick-add parser in `src/core/` (e.g. `core/quick-add.ts`, reusing Task 5's date resolver and `parsePlanningFieldValue`); routes `GET /api/tasks`, `POST /api/tasks`, `POST /api/tasks/:id/field`; `web/src/pages/Tasks.tsx` + components; tests; the Playwright spec.

- **Quick-add row, always at the top and focused on page arrival.** Type a title and press Enter, and it's created. Inline tokens are parsed live and shown as chips before you press Enter:
  - "Lab report due fri 90m high" → Due = Friday, Duration = 90, Energy = high;
  - "#bio" → Area.

  Nothing is guessed silently: each unrecognized token stays in the title.
- **Ruling (spec amendment, Task 8 records it):** a Task **Spencer types himself** on the Tasks page is a **direct write** (like FR-24), not a Yoh-drafted Proposal. `app/create-task.ts` calls `createPage('Tasks', …)` with the same draft-time + write-time schema validation (AD-12). The Proposal/confirm path stays for anything **Yoh** drafts from chat (FR-26).
- **The list:**
  - Every Task, completed ones included (FR-43).
  - Grouped by default as **Overdue / Today / This week / Later / No date**, switchable to Area or Status.
  - Search and filter.
  - Each row shows the checkbox, title, Due, Duration, Area, Energy and Status, with a missing-field badge for anything missing.
- **Inline editing like Notion:**
  - Click or Enter on a cell to edit it in place: a date picker for Due, a number with presets for Duration, a select for Area and Energy fed from **live Notion options**, and a select for Status.
  - Each edit writes through `updateTaskField` (FR-24 direct write, select guard intact) with visual optimism. A failed write reverts, shows a plain error, and gets a receipt.
  - Checking a box uses the existing check-off + Undo (AD-20).
- **Keyboard-first:**
  - `N` or `/` focuses quick-add;
  - ↑↓ move between rows (inside the list; page navigation only takes ↑↓ when no row or field has focus);
  - Enter edits, Esc cancels, Tab moves between cells;
  - `⌘⌫` asks before deleting? **No: nothing is ever deleted (AD-12).** Status changes only.
- **Speed bar:** creating a Task with title + due date takes ≤ 1 typed line + Enter, with no dialog and no required fields beyond the title. The list reflects it immediately and reconciles with the server on SSE hint or refetch. A Playwright spec asserts: a fresh load → the quick-add is focused → typing "Test task due tomorrow 30m" and Enter makes the Task appear in the list with the right Due and Duration (fake Notion in the fixture).
- The look follows 6A's tokens: raised rows, inset editors, gradient accents.

**Commit:** `feat(tasks): standalone Tasks page — quick-add, inline editing, grouping`

## Task 6C: Research Hub page (shell)

**Owns:** `web/src/pages/ResearchHub.tsx`; `src/app/research-list.ts` (new, a read-only list of recent Research Vault pages via the existing Notion read path; add a small adapter read function if none exists); `GET /api/research`; tests.

- Shows recent Research Vault items (title, date, source count), each linking to its Notion page.
- Has an "Ask a research question" box that sends the question into the chat panel (the existing search → "save that" flow).
- The asynchronous `/research` job queue stays **Epic 11**. The page states what it does today, with no fake features.
- Empty state: "Nothing saved yet. Ask a question, then say "save that"."

**Commit:** `feat(research): Research Hub page`

## Task 8: Documents amended — page order, chat panel, vertical navigation, swipe retired

**Runs before Task 6A** so the implementers build from updated specs. **Owns (living specs):**
- `_bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/DESIGN.md` + `EXPERIENCE.md`
- `_bmad-output/planning-artifacts/epics.md`
- `ARCHITECTURE-SPINE.md` (only where it names pages, navigation, or swipe)
- `sprint-status.yaml` if the Tasks page moving out of Epic 11 changes story scope

**Changes:**
- The page order is Home, Tasks, Desk, Research Hub.
- Chat is a panel on every page; there is no Chat page.
- Navigation is a vertical stack (smooth up/down arrow buttons, ↑/↓ keys, edge-aware wheel, and a sidebar).
- **Side swipe is retired.** Remove swipe from every living requirement, UX rule and story AC, and write "Swipe navigation retired 2026-09-27 (Spencer)".
- The new palette and neumorphism direction (from the approved mockup) replace the warm off-white.
- The Tasks page moves from Epic 11 into this plan: Epic 11 keeps only the Research Box/`/research` job and the research offer, and Story 11.1 is marked "delivered early in the 2026-09-27 fixes + UI plan".
- The Research Hub page shell exists now.
- The direct-create ruling for Spencer-typed Tasks is recorded as an amendment to AD-3/AD-12.
- **Historical records** (memlogs, reconciliation reviews, past SDD and story plans, brainstorms) are **not rewritten**. Each one that describes swipe or the Chat page gets a one-line note at the top: "Superseded 2026-09-27: swipe retired; Chat is a panel; pages are Home, Tasks, Desk, Research Hub."

**Commit:** `docs: page order, chat panel, vertical navigation; swipe retired`

---

## Task 7: Live end-to-end check against Spencer's real data (with Spencer)

**Not a subagent task.** After Tasks 0–6C, the controller runs the real server with `--env-file=.env` and walks Spencer through:

1. `/plan`, then `/morning`
2. "what's happening tomorrow"
3. "make an event at 10:45 am tomorrow to meet with alex for an hour and a half" → the confirm names the right time → the event appears in Google Calendar
4. "Lab report draft, due Thursday" in the chat panel → Create → it appears in Notion with the right date
5. Tasks page quick-add + inline edits of Due, Duration, Area and Energy → visible in Notion
6. answering a missing-field question
7. checking off a Task on Home and on Tasks, with Undo
8. `/night`
9. page navigation: the arrows, ↑/↓, the wheel and the sidebar, with no swipe anywhere

Every failure found becomes a fix before the merge. The results are recorded in this section.

---

## Order

0 → 1 → 2 → 3 → 4 → 5 → 9 (fixes, serial), with the mockup updated for the new structure in parallel. Then **8** (docs), then **6A** (after Spencer approves the mockup), **6B**, **6C**, then **7**, then Spencer's merge decision.

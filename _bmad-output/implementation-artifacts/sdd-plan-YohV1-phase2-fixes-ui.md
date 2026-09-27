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

## Task 6: UI refresh (after Spencer approves the design mockup)

**Owns:** `web/src/tokens.css` and every web component/page it affects; `DESIGN.md` amendments; Playwright + Vitest updates. The detailed brief is written into this section once Spencer approves the mockup artifact ("Yoh UI Refresh"). The approved decisions so far:

- A brighter **cool white** base. No warm off-white.
- Stronger **neumorphism**, using the recipe from the reference Spencer named (`usamamoinakhter/Neumorphism-ui`, React Native, so ported as CSS tokens, not installed): a white highlight top-left and a `#a3b1c6`-family soft shadow bottom-right. Cards are raised, and inputs and pressed states are inset. The hairline-rim contrast rule stays for accessibility.
- **More blue gradient** (Sky → Azure) on the active nav item, primary buttons, the thinking state, the check-off state, the now-line and headings accents.
- A **bigger scale overall** (type, controls, spacing). It should look sleek and never cramped.
- A **left nav sidebar** on every page: Home, Chat, Tasks, Desk with icons + labels, and the active item in the gradient pill. It replaces the tiny page dots.
- **Page navigation:** the mouse wheel changes pages, but only when the hovered scroll area is already at its edge. Swipe/trackpad is smoother and more reliable. Arrow keys still work.
- **Home calendar:** a Google-Calendar-style day view (a scrolling hour grid that opens at the current time, with a now-line and rounded event blocks showing title + time) plus a **mini month** above it. It never stretches the whole screen height. Untitled or punctuation-only events show "(No title)".
- The chat bubble never overlaps content. Every page has a real empty state (Home: "No Plan yet today. Type /plan to build it now."). Chat gets a welcome with example prompts and the "/" hint. Chat replies render **markdown** safely (no raw HTML), with a bundled library, CSP-safe.

**Commit:** `feat(ui): brighter neumorphic refresh, nav sidebar, Google-style day calendar`

---

## Task 7: Live end-to-end check against Spencer's real data (with Spencer)

**Not a subagent task.** After Tasks 1–6, the controller runs the real server with `--env-file=.env` and walks Spencer through:

1. `/plan`, then `/morning`
2. "what's happening tomorrow"
3. "make an event at 10:45 am tomorrow to meet with alex for an hour and a half" → the confirm names the right time → the event appears in Google Calendar
4. "Lab report draft, due Thursday" → Create → it appears in Notion with the right date
5. answering a missing-field question
6. checking off a Task on Home, with Undo
7. `/night`

Every failure found becomes a fix before the merge. The results are recorded in this section.

---

## Order

Tasks 1 → 2 → 3 → 4 → 5 (the fixes, serial), with the design mockup made and approved in parallel. Then Task 6, then Task 7, then Spencer's merge decision.

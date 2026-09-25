---
source: brainstorm-phase2-web-app-ui-2026-09-24/.memlog.md
type: intent distillation
---

# Intent: Yoh Phase 2 Web App UI

## Goal

Make the web app the most effective way to use every Yoh feature built so far and planned; lay groundwork for later phases.

## Usage contexts (drive every design choice)

1. **Home morning** — starting the day at home.
2. **Classroom** — ~30 seconds to a couple minutes; jobs: add/change tasks quickly, fire off research questions for later.
3. **Desk after school** — longer session; reflect on the day's data.

## Minimum capture flow (~3 actions)

Open laptop → click app icon (launches/routes to web app) → type task in chat bubble. Nothing added to the app (e.g. the screensaver) may add a click to this flow.

## Top priorities, as stated by the user

1. **Drag-a-block reshuffle**: drag a calendar block to a new time in one move; Yoh smartly reshuffles the rest of the day, shown as an animated preview and approved with one click (Propose-Don't-Impose — the web equivalent of CLI confirm gates; builds on FR-27 confirm-gated calendar editing). Must degrade gracefully (best effort) rather than hard-gate when input data is missing.
2. **/sandbox** guided data-entry flow (below).
3. **Layout and design choices** (design system below).

/sandbox and drag-reshuffle are one system: sandbox is the input that makes the reshuffle smart.

## /sandbox — guided data-entry flow

- Purpose: fills in missing high-impact task data (Data-Completeness Gate); invoked as a slash command in chat.
- Walks through tasks one at a time, down the line.
- Card per task shows high-impact fields: Estimated Duration, Focus level (Energy), Name, Area, plus a couple more TBD.
- User can optionally add more fields beyond the high-impact set.
- Small reward after each completed task (ping sound or haptic feedback).
- Shows a live counter of tasks that still have unfilled data.
- Skipping a task is allowed.
- Finale: a loading-bar animation on the right, making it look like data is being loaded fast. Once the Notion write actually finishes, a ping notification pops at the top and the session is complete — this is where trust/proof-of-action lives (not a separate receipts surface).

## Confirmed page map

- **P1 Home**: ordered daily plan, left, with checkboxes — the answer to "what, in what order." Checking a task fades it out (transitions.dev checkbox-check/dissolve) and removes it from Notion. Google Calendar day view, right — the answer to "when." Small chat bubble at the bottom (starts small, expands wide on hover); pressing Enter sends the message and routes to P2 to continue the conversation.
- **P2 Chat**: dedicated chat with Yoh. Slash commands: `/morning` (Morning Ritual), `/night` (Night Ritual), `/sandbox`, `/research` (send a research question to the Research Vault). Typing "/" opens a filterable command palette (command + one-line description + example) as the app-wide command discovery/execution mechanism. On prompt: matrix dot loader + shimmering thinking-states status text; responses stream in. Left vertical menu bar ships empty as a placeholder.
- **P3 Tasks DB**: full Tasks DB organized by Area and by field. One organized research box: latest research output shown up front, full research-doc library browsable from the same box (supersedes any separate research surface on P4). A research-ready notification can pop on whatever page the user is on and jumps straight to the new doc on P3.
- **P4 Desk dashboard** (used at the desk; job is to visualize all the data and surface everything the system can provide): widget list — stock/crypto tickers, Yoh usage-frequency heatmap (GitHub-style contribution heatmap via `@bklitui/ui/charts`: HeatmapChart/Cells/XAxis/YAxis/Tooltip/Legend, fluid layout, week columns × 7 day bins), task on-time completion rate, "Task Completed" box (scrollable list: task name + checked/struck-through checkbox, modeled on Meta Muse's Task Completed feature), "Total minutes worked" box (sums Estimated Duration of completed tasks), weather, streak of consecutive days using Yoh, total hours worked with Yoh, breaking news hub.

## Screensaver behavior

Gradient-dot background, varying transparency, moving fluidly (like ChatGPT's image-generation animation); centered "Yoh Meeseek" wordmark. Triggers: (a) briefly as an intro splash on app launch, auto-fading into P1 with no click required (preserves the 3-action capture flow), and (b) after idle. Purpose is aesthetic.

## Design system direction

- Colors: off-white + black. Style: neumorphism (needs a contrast/accessibility check).
- Wordmark: "Yoh Meeseek," bold Montserrat.
- Animation: transitions.dev free set (matrix-loader, thinking-states, shimmer-text, streaming-text, page-side-by-side, panel-reveal, tabs-sliding, reasoning-stream, skeleton-reveal). Note: "Image generation placeholder" — the closest match to the screensaver dot field — is Pro-only, so the screensaver must be custom-built.
- Stack: Tailwind CSS custom config for neumorphic shadows/palette + neumorphism.io for shadow CSS + shadcn/ui as headless base (alternatives considered: Chakra, MD3) + Framer Motion/Motion (or GSAP) alongside transitions.dev.
- Charts: `@bklitui/ui/charts` for the usage heatmap.
- Anti-clutter strategy: one job per page (P1 what/when, P2 talk, P3 find, P4 reflect at desk) + slash commands instead of buttons.

## Behavioral principles (non-negotiable)

- Never feel "stupid": plans must carry life context as recurring, movable blocks (commute, meals, routines) — not everything is blocked, but ignoring transition time (e.g. homework scheduled right after school with no buffer) is the defining failure to avoid.
- Graceful degradation, not hard data gates: do as much as possible with whatever data exists rather than refusing to act.
- Never claim capabilities it doesn't have.
- Close out chats when it's natural to do so.

## Groundwork / architecture implications

- **Yoh-owned completion/event log**: checking a task deletes it from Notion; its record must live in Yoh itself, retaining due date + completion time. Feeds P4's completed-tasks list, minutes-worked, completion rate, streak, usage heatmap, and future self-calibration of estimates.
- **AD-3 generalization**: AD-3 currently names `chat-cli.ts` as the sole `apply(proposal)` caller. Web one-click approve (drag-reshuffle, /sandbox writes) requires this confirm-gate rule to become a surface-agnostic confirm path, not tied to one CLI file.
- **Reusable in-app notification system**: needed for research-ready pings and /sandbox-complete pings (and future async completions); surfaces on whatever page the user is on and can deep-link to the relevant page/doc.

## Explicitly deferred / dropped

- **Goals hub** — deferred to a later phase, not part of Phase 2.
- **Receipts folder** (spam-folder-style proof-of-action inbox) — dropped; user doesn't want to build it. Trust instead lives inside each action (sandbox pings only after the real write; reshuffle previews before apply).
- **P2 left menu bar contents** — ships empty as placeholder; contents deferred.
- **Estimated-vs-actual time bar** on completed-task rows — a coach spark, not a user decision; unconfirmed.

## Open questions

- /sandbox's high-impact fields beyond Estimated Duration, Focus level (Energy), Name, Area — remaining fields still TBD.
- How users learn/discover the full command set beyond the "/" palette already adopted — is the palette sufficient on its own?
- Off-white + neumorphism contrast/accessibility check not yet done.

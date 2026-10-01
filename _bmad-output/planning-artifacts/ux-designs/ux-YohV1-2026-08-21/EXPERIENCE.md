---
name: Yoh
status: draft
sources:
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/.memlog.md
  - _bmad-output/brainstorming/brainstorm-phase2-web-app-ui-2026-09-24/brainstorm-intent.md
  - _bmad-output/brainstorming/brainstorm-phase2-web-app-ui-2026-09-24/.memlog.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.memlog.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.working/ia-2026-09-25.excalidraw
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.working/color-themes-1.html
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.working/color-themes-2.html
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.working/type-compare-1.html
  - _bmad-output/planning-artifacts/briefs/brief-YohV1-2026-08-21/brief.md
  - _bmad-output/planning-artifacts/briefs/brief-YohV1-2026-08-21/addendum.md
  - _bmad-output/planning-artifacts/research/technical-yoh-voice-pipeline-and-notion-calendar-a-2026-08-21/research.md
  - _bmad-output/brainstorming/brainstorm-yoh-notion-daily-assistant-2026-08-21/brainstorm-intent.md
created: 2026-08-21
updated: 2026-09-29
---

# Yoh — Experience Spine

> Web-primary. The Phase 2 laptop web app is the main surface (PRD §5.9–§5.13, FR-30–FR-51). The Phase 1 CLI stays in a short legacy section at the end until FR-50 retires it. The Morning and Night Rituals, and their push/email channels, carry over unchanged. Phase 3 hardware and the Phase 4 iOS app are out of scope. Paired with `DESIGN.md`. Where the spines and the `.working/` explorations disagree, **the spines win**.

## Amendments (2026-09-27, Spencer) — read before the rest of this spine

- **Pages, in order: Home, Tasks, Desk, Research Hub.** There is no Chat page. Every "Chat" row/reference below that names it as a page or a swipe/Page-Indicator destination now means: the Chat panel, opened from a small bottom-center "Ask Yoh" pill (or ⌘K), covering the content area right of the sidebar over whatever page is open.
- **Swipe navigation retired 2026-09-27 (Spencer).** Every swipe / Page Indicator reference below is superseded. Navigation is a vertical page stack: smooth up/down arrow buttons, the ↑/↓ keys (and Page Up/Page Down) when no text field has focus, an edge-aware mouse wheel (fires only when the hovered scroll area is at its edge), and a left nav sidebar that jumps directly to any page.
- **Look:** a brighter cool-white base (`#EEF2F8` family, no warm off-white), stronger neumorphism (white highlight top-left, `#a3b1c6`-family shadow bottom-right), more Sky→Azure blue gradient use (the earlier two-moment gradient limit is lifted), and a bigger scale. See `DESIGN.md`'s matching amendment.
- **Home** also always shows today's Time Budget (editable in place) and a mini month, alongside the Google-Calendar-style day view.
- **Morning Plan delivery:** in-app only, no Pushover push. Pushover stays for the Night Ritual's push/email escalation and for operational/failure alerts. `/plan` builds today's Plan on demand; `/morning` still never generates one.
- **Tasks page** is pulled forward from Epic 11 and ships in this plan; a Task Spencer types himself there is a direct write (no confirm), same tier as FR-24. The single Research Box described below moves to the new **Research Hub** page; the async `/research` job and its offer stay Epic 11.
- **Chat transcript persistence:** OQ13 below is superseded — see PRD/ARCHITECTURE-SPINE and `epics.md`'s "Yoh remembers you" epic (persistent history plus Facts/Decisions/Ideas folders, queued after Epic 9).

## Amendments (2026-09-29, Epic 13 "Yoh remembers you") — read with the 2026-09-27 list

- **Pages, in order: Home, Tasks, Desk, Research Hub, Memory** (FR-59). The sidebar gains Memory; page announcements count five.
- **Chat history persists** (FR-52). The Chat panel opens on today's Conversation `[ASSUMPTION: one Conversation per calendar day in YOH_TIMEZONE; architecture may refine]`. Earlier Conversations are browsed, searched, and deleted on the Memory page. This supersedes OQ13.
- **New Chat-stream elements:** the Remembered Receipt (FR-54/55), the Rating Prompt (FR-60, replaces FR-17 Self-Check), and the Memory Proposal Card for rule changes (FR-57) and Patterns (FR-58). All three reuse existing shapes (receipt line, Structured Question); no new overlay type.
- **Commands:** `/remember` and `/forget` join the Command Palette (FR-55); the plain-word forms work too.
- Everything below that mentions Self-Check now means the Rating Prompt.

## Amendments (2026-10-01, Polish 6 — decided without Spencer, awaiting his glance)

Source: `sdd-plan-YohV1-polish-6.md` rulings P6-R6–R8 and P6-R12; visual side in DESIGN.md "Interaction states and control sizes".

- **Load errors offer a retry.** A first-load failure on Home, Tasks, Research Hub and Memory shows the error line plus "Try again". After a successful load, a failed refresh keeps the loaded content and shows "Couldn't refresh — showing … from {time}" (the time of the last successful load) — now on Home too, not only Tasks and Research Hub.
- **New or changed copy** (State Patterns table below is otherwise unchanged):
  - Desk, until it is built: "Desk isn't built yet."
  - Chat panel with no turns: "Ask about your day, add a Task, or type / for commands."
  - Tasks, Missing data filter with nothing to show: "No Tasks are missing data."
  - Tasks, no Tasks at all: "No Tasks yet. Type one below and press Enter."
  - Today's calendar with no blocks: "Nothing on the calendar" (as other days).
  - Command Palette: skeleton rows while loading; "Couldn't load commands." + "Try again" on failure; "No matching command" only after a successful load.
  - Task cell edit saved: the cell shows a check + "Saved" briefly.
  - Time Budget, invalid hours: "Enter hours above 0, up to 24."
  - Quick-add preview failed: "Couldn't preview that — you can still add it."
- **Sandbox Card:** Save is always enabled; pressing it with a Required field empty names the field inline and focuses it.
- **The current page is in the URL hash** (`#home`, `#tasks`, `#desk`, `#research`, `#memory`): reload stays on the page; browser Back/Forward move between visited pages, and Back closes the Chat panel first when it is open.
- **Chat panel is a true modal:** the page and sidebar behind it are inert; Tab stays within the panel plus any visible notification or Undo Toast; Escape closes it from anywhere; focus returns to what opened it (or the Ask Yoh pill).
- **Undo Toast:** after a check-off, the next Tab reaches Undo.
- **Landmarks:** one `main` region and a "Skip to content" link.
- **Plan row:** clicking the label checks the row, same as the checkbox.
- **Narrow windows / phone:** still not specified; proposal in `responsive-proposal-2026-10-01.md`.

→ Key-screen mock for these surfaces: `mockups/memory-key-screens-2026-09-29.html` (Memory page; Chat panel with receipt, rule-change card, Pattern card, Rating). The spines win on conflict; the mock's Needs review preview panel is illustrative only (it is a Memory Rail entry).

## Foundation

- **Surface:** a single-user web app in a laptop browser (home, class, desk) on **macOS and Windows**. No auth flow, account switching, or picker (FR-39 `[ASSUMPTION]` from the PRD: the session persists).
- **Pages:** ~~Home → Chat → Tasks → Desk (swipe order, confirmed)~~ *(amended 2026-09-27: Home → Tasks → Desk → Research Hub, in a vertical page stack — see Amendments above)*, plus a Screensaver, the Chat panel over any page, and cross-cutting overlays.
- **UI base:** shadcn/ui as the headless base, Tailwind for tokens, Motion and transitions.dev for animation (brainstorm stack; the PRD addendum owns the libraries). `DESIGN.md` is the visual contract.
- **Three usage contexts drive every call:** a home-morning start, a 30-second-to-two-minute classroom capture, and a longer after-school desk session.
- **Standing gates:** the three-action capture flow (FR-39) never gains a required click. The page never takes initiative mid-block (FR-9, FR-49). Every write is visibly acknowledged or visibly failed (§6 Data integrity).
- **Themes:** light and dark. A Theme Toggle sits in a page corner. `[ASSUMPTION]` The first launch follows the OS appearance, and a manual toggle persists after that. The toggle is a sanctioned exception to FR-46's no-redundant-buttons rule, because no theme slash command exists.

## Information Architecture

→ Wireframe: `.working/ia-2026-09-25.excalidraw` (Row 1 pages, Row 2 overlays). Its "?" boxes are now resolved by the decisions below. Spine wins on conflict.

| Surface | Reached from | Job | Key components | Journey |
|---|---|---|---|---|
| **Home** | Launch (after splash); sidebar / ↑↓ / wheel | What, in what order, and when | Plan Row + Checkbox, Calendar Day View + Calendar Block + Pin Control, Reshuffle Preview, Time Budget, mini month, Ask Yoh pill, Undo Toast | UJ-4, UJ-5 |
| **Chat panel** *(not a page — amended 2026-09-27)* | Ask Yoh pill / ⌘K, from any page; notification deep-links | Talk to Yoh; run commands; see what Yoh just remembered | Chat Message, Chat Input, Command Palette, Thinking Indicator, Structured Question, Sandbox Card, Sandbox Finale, Remembered Receipt, Rating Prompt, Memory Proposal Card *(2026-09-29)*; Skill Switcher (hidden in Phase 2, space reserved) | UJ-5, UJ-6, UJ-7 |
| **Tasks** | Sidebar / ↑↓ / wheel; research-ready deep-link | Find things | Task Group, Grouping Control, Needs-Data Indicator, quick-add | UJ-5 |
| **Desk** | Sidebar / ↑↓ / wheel | Reflect at the desk | Desk Widget (all variants) | UJ-6 |
| **Research Hub** *(new page, 2026-09-27)* | Sidebar / ↑↓ / wheel; research-ready deep-link | Find saved research | Research Box (moved from Tasks) | UJ-5 |
| **Memory** *(new page, 2026-09-29, FR-59)* | Sidebar / ↑↓ / wheel; "View in Memory" on a Remembered Receipt; links in "what do you remember about …" answers | See, fix, and search what Yoh remembers; browse chat history | Memory Rail, Memory Search, Memory Item, Needs Review List, Changed Settings, Chat History | UJ-7 |
| **Screensaver** | App launch (splash); 10 min idle | Aesthetic only; shows no data | Screensaver | UJ-5 (splash) |
| **Overlays** | Any page | Cross-cutting feedback | In-App Notification, Undo Toast, Command Palette, Birthday Confetti | UJ-4, UJ-5 |
| **Push / email** (outside the app) | Rituals, on schedule | Night close-out escalation, operational alerts *(Morning Plan removed 2026-09-27: in-app only)* | Push Notification | CLI legacy UJ-1, UJ-3 |

**Navigation.** ~~Horizontal trackpad swipe moves between adjacent pages (primary). The non-swipe fallback is a clickable Page Indicator plus the ← → arrow keys `[ASSUMPTION, per memlog; exact form pending]`.~~ *Swipe navigation retired 2026-09-27 (Spencer).* Pages sit in a vertical stack, moved between with smooth up/down arrow buttons, the ↑/↓ keys (and Page Up/Page Down) when no text field has focus, an edge-aware mouse wheel, and a left nav sidebar that jumps directly to any page. Every page is one gesture or click from every other (FR-39). The Theme Toggle sits in a corner of every page. Modal depth is one: the Command Palette is the only layered panel, and toasts never stack a modal.

**Need → surface closure.** FR-30–FR-35 → Home. FR-36–FR-38 → Chat panel. FR-39 → Screensaver → Home → Ask Yoh pill. FR-40/41 → Home. FR-42 → Chat panel. FR-43 → Tasks (Research Hub gets the former Research Box, 2026-09-27). FR-44/47 → Desk. FR-45 → Screensaver. FR-46 → all. FR-48 → Home (Approve), Chat panel (confirmations). FR-49 → overlays. FR-50 → CLI legacy. FR-51 → Chat panel → Research Hub. FR-52 → Chat panel (today) + Memory (history). FR-53, FR-56, FR-59 → Memory. FR-54, FR-55, FR-57 → Chat panel (receipt, commands, rule-change card) + Memory (Changed Settings). FR-58 → Chat panel (Pattern card) + Memory (Patterns folder). FR-60 → Chat panel. Every surface above has at least one journey.

## Voice and Tone

Governed by the PRD Glossary **Tone** and FR-18–FR-19: casual and peer-level by default, concise and educational for factual questions, never "it's not just X, it's Y." Urgency rises only via Escalate-Under-Strain. Yoh never claims a capability it doesn't have (FR-42) and closes a conversation when it naturally ends. Brand posture lives in `DESIGN.md`.

| Do | Don't |
|---|---|
| "Checked off Chem problem set · Undo" | "Great job! Task complete!" |
| "Streak: 1 day · Longest: 12 days" | "You broke your streak." / "Don't lose your streak!" |
| "3 need data" | "You have 3 incomplete tasks that need attention!" |
| "Moving Study block to 4:00. Dinner shifts 15 min; Read Ch. 6 moves to tomorrow." | A paragraph re-justifying the whole day |
| "Saved 4 of 5. Couldn't save Chem problem set — try again in /sandbox." | "All done!" when a write failed |
| "Research ready: AP Bio registration deadline" | "Your research has been completed successfully." |
| "Do you want to do research on this?" (offered once) | Running a search nobody asked for |
| "News unavailable · last updated 2:14 PM" | A blank widget, or an error stack |
| "Remembered: Chem club is a club, not a class · Corrections · Undo" | "Got it! I'll remember that forever." |
| "Removed from memory." | "Okay, I've forgotten all about it!" |
| "Change school-day work start from 3:15 PM to 2:30 PM?" | Quietly planning from 2:30 because a memory said so |
| "Yoh noticed History essays run about 30 min over. 5 times since Sep 3. Plan for that?" | "It looks like you're always late on essays." |
| "How is Yoh doing?" · "What was off?" | "We'd love your feedback!" / a star rating |
| Words and icons | Emoji, anywhere |

## Component Patterns

Behavioral rules. Visual specs are in `DESIGN.md` Components, under identical names.

| Component | Where | Behavioral rules |
|---|---|---|
| ~~Page Indicator~~ **Nav Sidebar + arrow buttons** *(amended 2026-09-27, swipe/indicator retired)* | Every page | Left sidebar (wordmark, Home/Tasks/Desk/Research Hub/Memory *(Memory added 2026-09-29)*, theme toggle) shows and sets the current page; the active item sits in a gradient pill. On-screen up/down arrow buttons, the ↑/↓ keys (no text field focused), and an edge-aware mouse wheel move one page in the vertical stack. Announces "Tasks, page 2 of 5". |
| **Theme Toggle** | Every page, corner | One click flips light and dark. The first launch follows the OS; after a manual toggle, the choice persists `[ASSUMPTION]`. |
| **Plan Row** | Home | Ordered exactly as the Plan (FR-2). It reflects an approved reshuffle without a reload (FR-40). A pinned Task shows a Pin Control badge. |
| **Checkbox** | Plan Row | Click → checkmark + strikethrough, the row dissolves immediately (§6 Latency), and an Undo Toast appears. The Notion Status write and Completion Log entry are **deferred until the toast closes**, and dropped if Undo is pressed (FR-41). The write is Status-only. |
| **Calendar Day View** | Home | Today only (FR-30). Shows Yoh-owned and non-Yoh events. It is where Drag-to-Reshuffle happens. |
| **Calendar Block** | Calendar Day View | Yoh-owned blocks (Work/Break, Routine) are draggable (FR-30, FR-35). Fixed anchors can't be picked up (FR-33). Dragging a Task out of a block pins it (FR-31). Completed and past blocks are read-only. Drag-release is the whole input and opens the Reshuffle Preview within ~2s. |
| **Pin Control** | Pinned Calendar Block; Plan Row badge | Clicking the pin icon on the calendar block unpins the Task (memlog, resolves OQ13) and produces a fresh Reshuffle Preview. The Plan Row badge is an indicator only `[ASSUMPTION]`. A Pin expires at the end of the day. |
| **Button** | Everywhere | Primary = the one confirming action (Approve, Save). Secondary = Discard, Skip, Undo. No button duplicates a slash command (FR-46). |
| **Reshuffle Preview** | Home | Animates the current layout to the proposed one. Moved and unchanged blocks are distinguishable, and deferred Tasks are named. Approve writes everything (confirm-then-write, FR-32/FR-48). Discard or navigating away writes nothing. A stale preview recomputes instead of applying. Success: the calendar settles. Failure: an In-App Notification. |
| ~~Chat Bubble~~ **Ask Yoh pill** *(amended 2026-09-27: Wispr-Flow-style pill, fixed bottom-center, ~46px tall)* | Every page | Compact, raised, never covers content. Click or ⌘K opens the Chat panel with input focused, the pressed message as the first turn (FR-40). Typing "/" opens the Command Palette in place `[ASSUMPTION]`. |
| **Chat Input** | Chat panel | Enter sends. "/" as the first character opens the Command Palette. Unsent text survives the Screensaver and panel close (FR-45); ~~and page swipes~~ *(swipe retired 2026-09-27)*. |
| **Chat Message** | Chat | Yoh's turns stream as they generate. A write triggered in Chat echoes a one-line receipt in the stream (§6). Yoh ends a conversation naturally and doesn't fish for more. |
| **Thinking Indicator** | Chat | Appears within a fraction of a second of sending, naming what Yoh is doing ("Searching Notion…"). It gives way to streaming text. |
| **Command Palette** | Chat Input, Ask Yoh pill | Lists `/morning`, `/plan` *(added 2026-09-27: builds today's Plan on demand; `/morning` never does)*, `/night`, `/sandbox`, `/research`, `/remember`, `/forget` *(added 2026-09-29, FR-55)*, each with a one-line description and an example. Filters as Spencer types. ↑↓ moves, Enter runs, Esc closes `[ASSUMPTION]`. It is the only command-discovery surface (FR-42). |
| **Structured Question** | Chat stream | Yoh asks a question with selectable options plus a free-text "Other". One pick answers it, and the answer is recorded as Spencer's turn. Used for clarifying questions, the one-time /research offer, and Proposal confirmations (FR-16/25/26/27, via FR-48) `[ASSUMPTION for Proposals]`. An unanswered question blocks conflicting writes but not unrelated chat `[ASSUMPTION]`. *Flagged for PRD update.* |
| **Skill Switcher** | Chat left bar | **Hidden in Phase 2**: only General chat exists, and Research is *not* a skill (`/research` is its only trigger, per FR-46's no-redundant-controls rule). The IA reserves the left-bar space. The switcher appears once a second real skill (Goals) exists: click to switch, with the active skill always indicated. It is a sanctioned nav element, not an FR-46 violation. *Flagged for PRD update.* |
| **Sandbox Card** | Chat stream | One Yoh message per Task missing a Required Field, soonest-due first (PRD `[ASSUMPTION]`, FR-36). Required fields: Due Date, Estimated Duration (Save stays disabled until both are filled). Refining fields are optional. Skip writes nothing and keeps the Task in the count. Save writes directly (FR-38), plays a visual pulse on that card (respecting reduced motion), and decrements the remaining counter live. The reward **sound plays once, when the batch is cleared**, not per card (respecting system mute). The next card appears below. Cards stay in chat history. An unresolvable select value re-prompts on that card. |
| **Sandbox Finale** | Chat stream | Plays at the end of the session while writes finish. It never adds a required click, and it is followed by an In-App Notification only once every write has succeeded. |
| **Undo Toast** | Home | "Checked off {Task} · Undo", visible ~5s. Undo restores the row and cancels the pending write. When it closes, the Status write and Completion Log entry commit. Several check-offs in quick succession: see Open Questions. |
| **In-App Notification** | Any page | Appears on whatever page is open. One click on it deep-links to the target (see In-App Notifications). It is never proactive (FR-49). |
| **Needs-Data Indicator** | Tasks `[ASSUMPTION: placement]` | A persistent count of Tasks missing Required Fields. Click → Chat with `/sandbox` started. It clears only when the count reaches zero (memlog; resolves the OQ13 tray question). |
| **Task Group** | Tasks | Groups every Notion Task by the active grouping. Every Task is findable (FR-43). A checked-off Task shows as completed, not deleted. |
| **Grouping Control** | Tasks | ~~Area (default), Due Date, Energy, or Status.~~ *Amended 2026-09-27 (Spencer, Task 6B, approved Tasks mockup):* **Due (default: Overdue / Today / This week / Later / No date)**, Area, or Status. `[ASSUMPTION]` The choice persists across visits. |
| **Research Box** | ~~Tasks~~ **Research Hub** *(moved 2026-09-27, Spencer: Tasks page ships standalone; a fourth Research Hub page holds this)* | The latest research output up front, with the Research Vault library browsable below, plus an "ask a research question" box that sends into the Chat panel. It is the only research surface (FR-43). A research-ready notification opens the new doc here. Output follows the dedicated research prompt's consistent, focused shape (FR-51). The async `/research` job and its offer stay Epic 11; only the page shell ships now. |
| **Remembered Receipt** *(2026-09-29, FR-54/55)* | Chat stream | One muted line directly under the Yoh reply of the turn it came from: "Remembered: {text} · {folder}", plus " · for {scope}" on Feedback items and " · until {date}" on items with an expiry, then Undo. Two items from one turn share the line, separated by " ; ". It fades in when filing finishes, after the reply has streamed; the reply never waits for it. Undo stays until Spencer sends his next message, then gives way to "View in Memory" (opens the item on the Memory page). Undo removes the item (or restores the version it replaced) and the line reads "Removed from memory." A memory command uses the same line ("Forgot: {text} · Undo"). `[ASSUMPTION]` placement, wording, and the " ; " join. |
| **Rating Prompt** *(2026-09-29, FR-60)* | Chat stream | A Structured Question variant after a substantive chat turn's reply (and after its receipt, if any): "How is Yoh doing?" with three chips, "1 Poor", "2 Okay", "3 Good", and a "Not now" text button. No free-text Other. One pick answers it and it collapses to "Rated 3 (good)". "Not now", or sending another message, dismisses it with no effect. A 1 adds one optional field, "What was off?", with Send and Skip; a sent answer files to Feedback and shows a Remembered Receipt. Substantive = a plan change or re-fit asked in chat, a researched answer, `/morning`, or `/night` `[ASSUMPTION: chat turns only; an Approve on Home doesn't trigger it]`. Frequency and pause rules are FR-60's. Never in a push. |
| **Memory Proposal Card** *(2026-09-29, FR-57/58)* | Chat stream; Patterns folder | A Yes/No Structured Question (no Other). **Rule change:** follows the Remembered Receipt in the same turn: "Change school-day work start from 3:15 PM to 2:30 PM?". Yes applies through the normal confirm path and replies "Changed school-day work start to 2:30 PM. Revert it on the Memory page."; No replies "Kept 3:15 PM. Your preference stays saved, marked declined." **Pattern:** the pattern in one line ("Yoh noticed History essays run about 30 min over."), then an evidence line in caption ("5 times since Sep 3: …"), then "Plan for that?". Yes files it to Patterns with a receipt; No files nothing. `[ASSUMPTION]` Pattern cards surface at most one per day: in the `/morning` view, else the next time Spencer opens the Chat panel that day. Never a push or In-App Notification. Pending Pattern cards also sit at the top of the Patterns folder, so an ignored one isn't lost. |
| **Memory Rail** *(2026-09-29, FR-59)* | Memory, left | `[ASSUMPTION: layout]` A vertical list: **Needs review** (with its count; hidden at zero), then the eight folders in PRD order (Feedback, Planning preferences, Corrections, About you, Patterns, Goals & projects, Decisions & commitments, Ideas & notes), each with a count, then **Changed settings** and **Chat history**. A small caption groups them: "Always used", "Used when relevant", "Only when asked". Selecting one shows its list on the right. The selection persists across visits. |
| **Memory Search** | Memory, top | One box searching memories and chat history by keyword (FR-59). Results replace the right-hand list while the box has text; each result shows its folder or Conversation date and opens in place (an item scrolls into view in its folder; a chat hit opens that Conversation at the turn). Esc or clearing the box returns to the selected folder. |
| **Memory Item** | Memory lists | The item's text, then a caption meta line: "Stated" or "Inferred" · last changed date · scope (Feedback) · "until {date}" (if it expires) · Source link (opens the Conversation at that turn; "source deleted" when gone). A "Not loaded" badge marks items over the cap or expired. "{n} earlier versions" expands the superseded history (read-only). Clicking the text edits it in place: Enter saves, Esc cancels; saving an inferred item makes it Stated; an edit that duplicates another item offers "Merge with '{other}'?" Yes/No. An overflow menu holds Move to folder, Set expiry / Clear expiry, and Delete. Edits and moves are direct writes that show "Saved" in the meta line or fail in place with the old text restored. Delete dissolves the row with an Undo Toast ("Deleted '{text}' · Undo"); the delete commits when the toast closes, same as check-off. |
| **Needs Review List** | Memory | Items that are expired, over the always-loaded cap, unused for 120 days, or in conflict with live data (FR-56). Each row says why ("Expired Dec 19", "Not loaded: over the cap", "Unused since May 2", "Notion now says Due Oct 4") and offers Renew, Edit, Delete, Keep as history. Renew is offered only where it applies (expiry, 120-day). Not a notification; it never badges the sidebar `[ASSUMPTION]`. |
| **Changed Settings** | Memory | Confirmed rule changes (FR-57): "School-day work start: 2:30 PM (was 3:15 PM) · changed Sep 29" with a Revert button. Revert is a direct write that restores the built-in value and replies in place "Reverted to 3:15 PM." Empty: "No planning rules changed." |
| **Chat History** | Memory | Conversations newest first, one row per day ("Tue Sep 29 · 14 turns · first line…"). Opening one shows the read-only transcript in the right pane, receipts included, with Delete conversation (Undo Toast, as for items). "Clear all history" sits at the bottom and asks inline: "Clear all chat history? This can't be undone. Memories stay." Clear / Cancel. Nothing in a stored transcript is clickable into an action: past Structured Questions and Proposals render as answered text. |
| **Desk Widget** | Desk | Yoh-data widgets read the Completion/Activity Log only (FR-47). **Worked** is a single merged widget. Its primary figure is today's minutes (sum of Estimated Duration of Tasks completed today); a secondary line shows all-time hours with Yoh on the same Completion Log basis (resolves OQ10). **Streak** shows current and longest, in neutral wording. **On-Time Rate** follows FR-44's definition. **Usage Heatmap** is weeks × 7 days with hover tooltips. **Feed widgets** fail independently, showing "Unavailable" plus the last value and timestamp. |
| **Screensaver** | Launch; 10-min idle | Launch: plays briefly and auto-fades into Home with no click (FR-39). Idle: any input dismisses it and returns to the prior page with unsent chat text intact. It never shows data or notifications. |
| **Birthday Confetti** | Home, Feb 19 | Plays once per Feb 19 `[ASSUMPTION: once per day]`. Skipped under reduced motion. It is the only named celebration. |
| **Icon** | Everywhere | Icons pair with a text label or accessible name. An icon never stands alone as the only signal of state. |
| **Push Notification** | Phone (Pushover) | ~~Exactly one Morning Plan push per day (FR-1).~~ *Amended 2026-09-27 (Spencer): the Morning Plan arrives in the app only — no Pushover push for it.* Pushover stays for the Night close-out (a push first, then an email escalation, capped at two attempts, FR-13) and for operational/failure alerts. Unchanged by the web app otherwise (FR-49, FR-50). |

## State Patterns

Copy shown is proposed wording `[ASSUMPTION]`; the rule is binding.

| State | Surface | Treatment |
|---|---|---|
| Launch / cold load | Screensaver → Home | The splash covers the load and fades into Home when ready. No click, no picker. |
| Cold data load | Home, Tasks, Desk | Skeleton rows or cards matching the layout (skeleton-reveal). Never a static spinner (FR-46). |
| No Plan yet today | Home | "No Plan yet today. Type /plan to build it now." *(amended 2026-09-27)* The Ask Yoh pill *(was Chat Bubble)* stays live; `/morning` opens the Ritual in the Chat panel. |
| All Tasks checked | Home | The empty checklist reads "Nothing left on today's Plan." The calendar stays. No celebration. |
| Unplaceable Task | Home | Not placed on the calendar. A needs-data In-App Notification appears, and the Needs-Data Indicator count rises (FR-34). |
| Reshuffle pending | Home | The Reshuffle Preview is open. Further drags are blocked until Approve or Discard `[ASSUMPTION]`. |
| Stale preview | Home | Approve recomputes and shows a fresh preview (FR-32). |
| Reshuffle apply failed | Home | The calendar shows the true state. An In-App Notification deep-links to Home. |
| Check-off pending | Home | The row is dissolved and the Undo Toast is visible. The write is not yet sent. |
| Check-off write failed | Home | The row returns, with an In-App Notification naming the Task. |
| Thinking / streaming | Chat | Thinking Indicator, then streaming text. |
| Offline / host unreachable | Any | `[ASSUMPTION]` An In-App Notification (operational problem, §6 Observability). Chat Input keeps unsent text. No silent failure. |
| /sandbox empty queue | Chat | "Nothing's missing a Due Date or Duration." The session ends with no finale `[ASSUMPTION]`. |
| /sandbox partial failure | Chat | The completion notification names the failed Tasks (FR-38). Failed Tasks stay in the count. |
| Command Palette no match | Chat | "No matching command" plus the full list of four `[ASSUMPTION]`. |
| Notion unreachable | Tasks | Last-loaded Tasks stay visible with a "last updated" time, and an operational-problem In-App Notification appears `[ASSUMPTION]`. |
| Empty group | Tasks | Groups with no Tasks are omitted `[ASSUMPTION]`. |
| /research running | Chat, any page | Spencer can leave. The result arrives as an In-App Notification. A failed search raises a failure notification (FR-51). |
| Needs-data count = 0 | Tasks | The indicator is hidden. |
| Empty Research Vault | ~~Tasks~~ **Research Hub** *(moved 2026-09-27)* | ~~"No research yet. Try /research in Chat."~~ "Nothing saved yet. Ask a question, then say "save that"." *(copy amended 2026-09-27)* |
| No completions yet | Desk | Widgets show 0 / "Streak: 0 days". No guilt copy. |
| Feed down | Desk | That widget shows "Unavailable" plus the last value and timestamp. The rest of Desk is unaffected (FR-44). |
| Idle 10 min | Any | Screensaver. Scroll and pointer movement count as input. Any input returns to the same page, scroll position, and state. |
| Receipt pending | Chat | Nothing shown while filing runs; the reply is already complete. |
| Filing failed / Memory down | Chat | Auto-filing: no receipt, nothing else. `/remember` or "forget …": "Couldn't save that to memory." / "Couldn't forget that right now." Chat itself keeps working (FR-54, FR-56). |
| Forget: several matches | Chat | A Structured Question listing the matches with their folders, plus "None of these". Nothing is deleted until Spencer picks. |
| Forget: no match | Chat | "Nothing in memory matches '{words}'." |
| Memory cold load | Memory | Skeleton rail counts and skeleton rows. |
| Empty folder | Memory | One neutral line per folder, e.g. "Nothing here yet. Say "remember that …" in Chat." Patterns: "No patterns yet. Yoh will ask before adding one." |
| Memory store or search down | Memory | "Couldn't load memory right now." in the list area; edits disabled; nothing shown as saved (FR-59). Chat history shows the same error state separately (FR-52). |
| No search results | Memory | "No memories or chats match '{words}'." |
| Chat history cleared | Memory, Chat panel | Chat History is empty ("No saved conversations."); the Chat panel opens empty. Memory items stay, their Source reads "source deleted". |
| Focus | Any | A `{spacing.focus-ring-width}` `{colors.accent-solid}` ring on the focused control, plus `{colors.accent-glow}` on the Ask Yoh pill *(was Chat Bubble)* / Chat Input. |

## Interaction Primitives

- ~~**Swipe:** a horizontal two-finger trackpad swipe moves one page...~~ **Swipe navigation retired 2026-09-27 (Spencer).** No swipe gesture is part of this spine. Navigation is a vertical stack: **arrow buttons** (on-screen up/down, smooth transition), **keys** (↑/↓, Page Up/Down, no text field focused), and an **edge-aware mouse wheel** — it moves a page only when the hovered scroll area is already at its scroll edge, so it never hijacks scrolling inside a page. The nav sidebar jumps directly to any page. Reduced motion makes transitions instant.
- **Keys:** ↑ / ↓ (and Page Up/Page Down) move pages (no text focus) *(amended 2026-09-27; was ← →)*. "/" opens the Command Palette in chat inputs. Enter sends or runs. Esc closes the Palette or collapses the Ask Yoh pill `[ASSUMPTION]`. Tab order follows reading order.
- **Click:** Nav Sidebar entries, up/down arrow buttons, Checkbox, Pin Control (unpin), Approve/Discard, Undo, notification deep-links, Skill Switcher entries, Grouping Control segments, Theme Toggle.
- **Drag:** Calendar Blocks only (Home), today only. Release opens the Reshuffle Preview. There is no drag anywhere else.
- **Hover/focus:** ~~expands the Chat Bubble~~ *(amended 2026-09-27: the Ask Yoh pill is a fixed-size pill, not an expand-on-hover bubble; hover/focus just shows its focus ring/glow)*. Shows heatmap tooltips.
- **Idle:** 10 minutes with no input → Screensaver. Scrolling and pointer movement count as input, not only key presses. The first input after the Screensaver returns to the same page and scroll position.
- **Banned:** proactive mid-block prompts, buttons that duplicate slash commands, emoji, auto-run research, modal stacks deeper than one.

## Accessibility Floor

Visual contrast values live in `DESIGN.md` Colors.

- **WCAG 2.2 AA** in both themes. Every interactive boundary meets 3:1 via the `{spacing.rim-width}` rim (`{colors.rim-interactive}` 3.20:1 light, `{colors.rim-interactive-dark}` 4.84:1 dark). Text meets 4.5:1. This resolves OQ9.
- **Never color or motion alone:** checked = glyph + strikethrough + fade; fixed = hatch + "(fixed)"; moved = outline + label; the reward = sound + pulse + counter text.
- **Reduced motion:** every animation falls back per `DESIGN.md` State-tied motion (fades or static). Confetti and the Screensaver drift stop.
- **Sound:** the /sandbox batch-cleared sound respects system mute and is never the only confirmation. The per-card pulse and counter text carry each save.
- **Screen readers:** In-App Notifications and the Undo Toast are announced via `aria-live="polite"`. The /sandbox counter change is announced. Page changes announce the page name. The Thinking Indicator status text is live.
- **Dragging alternative (WCAG 2.5.7):** `[ASSUMPTION]` A typed Chat request ("move my study block to 4") via Mid-Day Re-Flow is the non-drag path to the same Reshuffle Preview. See Open Questions.
- **Timing (WCAG 2.2.1):** `[ASSUMPTION]` The Undo Toast's ~5s timer pauses while it is hovered or focused.
- **Keyboard:** every control is reachable, and the Command Palette and Structured Question options are fully keyboard-operable.
- **Memory (2026-09-29):** the Remembered Receipt and "Removed from memory." are announced via `aria-live="polite"`; the Receipt's Undo is a real button reachable by Tab. Rating chips are a labeled radio-style group ("How is Yoh doing? 1 Poor, 2 Okay, 3 Good") answerable with keys 1–3 or arrows + Enter while focused. Memory Item inline edit has a visible "Edit" affordance on focus and hover, not click-only; the overflow menu is a proper menu button. Stated/Inferred and Not loaded are words, never color alone.

## Key Flows

Mirrors PRD UJ-4–UJ-6 (§3.3), with this pass's decisions layered in. Protagonist: Spencer.

### UJ-4. Spencer moves his study block, and Yoh rearranges the rest of the afternoon.

*Home, morning, at home.*

1. Spencer opens the laptop and clicks the Yoh icon. The Screensaver splash fades into Home.
2. Home shows the Plan checklist on the left and today's calendar on the right, with a 2:00 study block, the commute and dinner Routine Blocks, and a hatched "(fixed)" soccer practice.
3. He drags the study block to 4:00. It lifts with a gradient outline, "(dragging, from 2:00)".
4. On release, within ~2s, the Reshuffle Preview animates: later Tasks slide into the freed time, dinner shifts 15 minutes, and the summary names "Read Ch. 6 → tomorrow."
5. **Climax:** he clicks **Approve** once. The calendar settles into the new day, Google Calendar updates, and the Plan checklist reorders with no reload.
6. Later he drags the Chem problem set alone to 7:00. It becomes a Pin, a fresh preview reflows around it, and he approves.
7. After changing his mind, he clicks the pin icon on the 7:00 block. A new preview returns it to the flow, and he approves again.
8. Mid-afternoon he checks off the Chem set. The row dissolves and the toast reads "Checked off Chem problem set · Undo". He lets it close, and the Status write commits.

**Failure paths:** one Task lacks an Estimated Duration → it isn't placed, the rest still reshuffles, a needs-data In-App Notification offers /sandbox, and the Needs-Data Indicator on Tasks increments. The Calendar changed before Approve → the preview recomputes. Apply fails → an In-App Notification appears and the calendar shows the true state. He checks the wrong Task → Undo within ~5s, and nothing is written.

### UJ-5. Spencer fills in missing data in two minutes in class.

*Classroom, laptop open, two minutes free.*

1. Open laptop → click the Yoh icon → the splash fades into Home (no click).
2. He types "Lab report draft, due Thursday" into the ~~Chat Bubble~~ **Ask Yoh pill** and presses Enter. ~~He lands in Chat~~ *(amended 2026-09-27)* The Chat panel opens over Home with the message as the first turn, and Yoh confirms the Task was created with a one-line receipt.
3. He types "/". The Command Palette opens, he picks `/sandbox`, and presses Enter.
4. The first Sandbox Card appears inline: "Chem problem set — Due Date, Estimated Duration · 4 remaining". He fills both and clicks **Save**. The card pulses, and the counter reads "3 remaining".
5. He skips one he's unsure about (no cue, and it stays in the count), then saves two more. Each card stays in the chat history.
6. **Climax:** the batch is cleared, so the single reward sound plays. The Sandbox Finale bar runs while Notion writes land, and an In-App Notification appears: "Saved 3 Tasks." The Needs-Data Indicator on Tasks drops to 1.
7. Before closing the laptop he sends `/research when is the AP Bio registration deadline`. Yoh runs it immediately, with no narrowing questions.
8. Later, on any page, "Research ready: AP Bio registration deadline" appears. One click opens the doc in the Research Box ~~on Tasks~~ *(amended 2026-09-27: on Research Hub)*.

**Failure paths:** a Notion write fails → the completion notification names the failed Task instead of claiming success, and that Task stays in the count. The search fails → a failure notification, not a research-ready one. **Variant:** Spencer describes something obviously research-sized without the command → Yoh offers once, via a Structured Question ("Do you want to do research on this?"), and runs only if he accepts.

### UJ-6. Spencer reflects on the day at his desk.

*Desk, after school, a longer session.*

1. Spencer ~~swipes~~ *(swipe retired 2026-09-27)* moves from Home to Desk via the sidebar (or presses ↓ three times).
2. Desk shows Tasks Completed (a scrollable list of checked, struck-through rows), the Worked widget ("145 min today", with "212 h with Yoh" beneath) in tabular figures, the on-time rate, "Streak: 1 day · Longest: 12 days", the usage heatmap, and *(added 2026-09-27)* this month's Claude API spend. Next to these are ~~BTC/SOL/ETH tickers, weather, and top business and AI news~~ *(confirmed 2026-09-27)* BTC/ETH/SOL tickers, weather for Seattle WA, and the biggest business stories with an AI emphasis.
3. He hovers the heatmap to see last Tuesday's count.
4. **Climax:** he sees the day's work summed up in one glance, in neutral words, with no guilt about the streak reset.
5. When he's ready, he opens the Chat panel (Ask Yoh pill / ⌘K — *not a swipe to a Chat page, 2026-09-27*) and runs `/night`. The close-out runs interactively, and tonight's scheduled push and email escalation are cancelled (FR-42).

**Failure path:** the news feed is down → that widget reads "Unavailable · last updated 2:14 PM", and the rest of Desk is unaffected.

### UJ-7. Spencer corrects Yoh once, and it sticks. *(2026-09-29, Epic 13; UX journey `[ASSUMPTION]`, built from PRD §5.14's examples)*

Spencer, at his desk after school, Chat panel open.

1. He types "Chem club is a club, not a class. Don't plan homework for it." Yoh answers and fixes today's Plan reasoning.
2. A beat after the reply lands, one quiet line appears under it: "Remembered: Chem club is a club, not a class · Corrections · Undo".
3. He adds "and start my work at 2:30 on school days". The reply lands, then "Remembered: start work at 2:30 PM on school days · Planning preferences · Undo", then a card: "Change school-day work start from 3:15 PM to 2:30 PM?" He clicks Yes. "Changed school-day work start to 2:30 PM. Revert it on the Memory page."
4. Because this was a plan change, a small prompt follows: "How is Yoh doing?" He clicks 3. It folds to "Rated 3 (good)".
5. **Climax:** next week he asks Yoh to plan Thursday. The reasoning line doesn't mention Chem club homework, work starts at 2:30, and he never had to say either again.
6. Curious, he opens Memory (fifth page). Corrections shows the club item, Stated, with a link back to the Tuesday chat. Changed settings shows "School-day work start: 2:30 PM (was 3:15 PM)" with Revert. Needs review is empty, so it isn't shown.

## Chat Skills & Commands

| Command | Does | Example |
|---|---|---|
| `/morning` | Opens today's Morning Ritual in Chat: the Plan, its reasoning line, and pending questions or Proposals. It never re-sends the push or regenerates the Plan. | `/morning` |
| `/plan` *(added 2026-09-27, Spencer)* | Builds today's Plan on demand. `/morning` still never generates one (FR-1 stands). | `/plan` |
| `/night` | Runs the Night Ritual close-out interactively, and cancels that night's scheduled prompt and escalation. | `/night` |
| `/sandbox` | Starts the inline Sandbox Card flow. | `/sandbox` |
| `/remember <fact>` *(2026-09-29, FR-55)* | Files the fact now, as Stated, even if auto-filing would skip it. Shows a Remembered Receipt. Plain-word forms: "remember that …", "remember: …". "remember to …" and "remind me to …" still create Tasks. | `/remember Chem club is a club, not a class` |
| `/forget <what>` *(2026-09-29, FR-55)* | Deletes the matching item and its history, or the last one filed when nothing follows. Several matches → a Structured Question. Plain-word form: "forget …", "forget that". | `/forget the AP Bio deadline` |
| `/research <question>` | Queues research immediately. The result files to the Research Vault, and a notification follows. This is the only way research runs. | `/research AP Bio registration deadline` |

| Skill (Skill Switcher) | Status |
|---|---|
| General chat | Phase 2, the only skill, so the switcher is hidden |
| Goals | Future. When it arrives, the switcher appears; the Goals hub stays deferred (§9.4). |

Research is **not** a skill. `/research` is its only trigger (memlog subtraction; supersedes the earlier General chat + Research listing).

"what do you remember about …" (plain words only) replies with the matching items grouped by folder, each linking to it on the Memory page.

**Research trigger rule:** research never starts without Spencer's explicit confirmation. It runs on an explicit `/research`, or, for an obviously big task, after Yoh offers through a Structured Question ("Do you want to do research on this?") and Spencer accepts. Declining or ignoring the offer runs nothing (Propose-Don't-Impose, FR-16/FR-48).

## In-App Notifications

| Trigger (FR-49 consumer) | Message shape | Deep-link |
|---|---|---|
| Research ready (FR-51) | "Research ready: {topic}" | Research Box doc ~~on Tasks~~ *(amended 2026-09-27: on Research Hub)* |
| Research failed (FR-51) | "Couldn't finish research: {topic}" | Chat `[ASSUMPTION]` |
| /sandbox complete (FR-38) | "Saved {n} Tasks" | Chat |
| /sandbox partial/failed (FR-38) | "Couldn't save {Task}" | Chat → /sandbox |
| Needs data (FR-34) | "{n} Tasks need data to be placed" | Chat, with `/sandbox` started |
| Reshuffle apply failed (FR-32) | "Couldn't update your calendar" | Home |
| Operational problem (§6) | "{integration} unreachable" / "Notion sign-in expired" | `[ASSUMPTION]` none; message only |
| Check-off write failed (FR-41) | "Couldn't check off {Task}" | Home |

Rules: notifications appear only as a result of something Spencer started, or a system failure (FR-49). They are distinct from the Undo Toast, which is local feedback and not an FR-49 consumer. They never replace the Ritual push/email channels. Duration, stacking, and dismissal are open (see Open Questions).

## Inspiration & Anti-patterns

- **Lifted from Meta Muse:** the "Task Completed" list (checked, struck-through rows) on Desk. Muse is also the material inspiration for glass over soft surfaces.
- **Lifted from Apple's apps (feel only):** fluid, state-tied transitions and translucent floating layers.
- **Lifted from Claude:** asking clarifying questions with selectable options (the Structured Question).
- **Lifted from GitHub:** the contribution-style usage heatmap.
- **Lifted from transitions.dev:** checkbox dissolve, thinking-states, shimmer, streaming text, side-by-side page slides.
- **Rejected: an Apple imitation.** No SF Pro, no system blue, no cloned controls.
- **Rejected: guilt gamification.** No broken-streak alarms, badges, levels, or emoji. Stats are stated neutrally.
- **Rejected: action buttons for commands.** Slash commands keep pages clean (FR-46).
- **Rejected: a receipts folder.** Proof-of-action lives inside each action instead (preview-before-apply, notify-after-write).
- **Rejected: auto-research.** It runs only on command or an accepted offer.
- **Rejected: /sandbox taking over Chat.** It runs inline in the stream.

## Responsive & Platform

| Platform | Behavior |
|---|---|
| macOS laptop browser | Primary. ~~Trackpad swipe between pages~~ *(swipe retired 2026-09-27)* — vertical stack via sidebar, arrow buttons, ↑/↓ keys, edge-aware wheel. |
| Windows laptop browser | Must reach parity: self-hosted Figtree (no `system-ui`), ~~precision-touchpad swipe supported, or the Page Indicator and arrow keys carry navigation~~ *(amended 2026-09-27: same vertical-stack navigation as macOS — sidebar, arrow buttons, ↑/↓ keys, wheel; no swipe on either platform)*. `backdrop-filter` verified, with an opaque fallback `[ASSUMPTION]`. |
| Narrow windows / phone | Not specified. The iOS app is Phase 4. See Open Questions. |
| School network | The app must be reachable from class (PRD OQ12, architecture). |

## Rituals (carried over)

- **Morning Ritual:** runs unattended and builds the Plan with its reasoning line (FR-1). ~~sends one Pushover push~~ *Amended 2026-09-27 (Spencer): delivery is in-app only, no Pushover push.* In the web app, `/morning` views the same Plan in the Chat panel, and `/plan` (added 2026-09-27) builds it on demand.
- **Night Ritual:** a push first, then a single email escalation, and never a third attempt (FR-13). An unacknowledged night is marked unchecked, and mandatory Blockers roll into tomorrow (FR-14). `/night` in Chat pre-empts both.
- ~~**Self-Check** (FR-17)~~ *(superseded 2026-09-29 by the Rating Prompt, FR-60: Chat stream only)* and **Ritual-created Proposals** (FR-48/FR-50) must be resolvable in the web app once the CLI is retired. Where they surface is open (see Open Questions).
- Silence is still a feature: nothing appears between the Morning Plan and whatever Spencer starts next.

## Open Questions

1. **Page Indicator form and position:** unlabeled dots at the bottom (type exploration) or a labeled top-bar indicator (IA wireframe)?
2. **In-page wordmark:** the explorations and wireframe show a small "Yoh Meeseek" on every page, but the memlog scopes the Montserrat wordmark to the splash and Screensaver. Show it in-page or not?
3. **Type scale at full laptop size:** the sizes were lifted from a roughly half-width comparison frame.
4. **Error/failure color:** none is decided. Failures are currently carried by words only.
5. **Usage Heatmap color ramp:** not rendered yet.
6. **Home reaction on check-off** beyond fade/dissolve: unanswered (memlog).
7. **Rapid multiple check-offs:** does the Undo Toast queue, merge, or restart the timer? And does its timer pause on hover or focus?
8. **In-App Notification** duration, stacking, and manual dismissal.
9. **Where Ritual-created Proposals ~~, Self-Check prompts,~~ and the unchecked-day flag surface** *(Self-Check retired 2026-09-29; Pattern proposals resolved in Memory Proposal Card)* when Spencer isn't in Chat. There is no FR-49 consumer for them.
10. **/sandbox "batch cleared":** does the sound play when every card has been saved or skipped, or only when the needs-data count reaches zero?
11. **Non-drag reshuffle path (WCAG 2.5.7):** is the Chat request enough, or is a dedicated control needed?
12. **Narrow-window behavior:** there are no breakpoints yet.
13. ~~Chat history persistence across launches (Sandbox Cards "remain in history").~~ *Resolved 2026-09-29 by FR-52 (see the 2026-09-29 Amendments). Earlier note: superseded 2026-09-27 (Spencer): persistent chat history is now planned — the "Yoh remembers you" epic (persistent history plus Facts about me / Decisions & commitments / Ideas & notes folders), queued after Epic 9. See `epics.md`.*
14. **Routine declaration UI:** Chat only (PRD `[ASSUMPTION]`) or also a /sandbox step?
15. **Screensaver parameters and wordmark size:** dot count, speed, and size are unspecified.
16. **Reward sound asset** and its volume.
17. **Thinking shimmer legibility:** the gradient fills the status text, and its light stop measures 1.49:1 on the light surface. Is the shimmer decorative over already-legible text, or does it need a floor?
18. **Conversation boundary** (2026-09-29): one Conversation per calendar day is a UX `[ASSUMPTION]`; architecture confirms or replaces it (idle gap, explicit "new chat").
19. **Memory Rail at narrow widths:** the two-pane Memory page has no narrow layout yet (see OQ12).

**Flags for PRD update**

- **2026-09-29 (Epic 13):** the Rating Prompt fires only on chat turns (an Approve on Home is not a "plan change" for FR-60); Pattern proposals surface in `/morning` or the next Chat-panel open, at most one per day (FR-58 is silent on where). Both `[ASSUMPTION]` until Spencer confirms.

- **Structured Question** (Chat clarifying questions with selectable options): not in FR-42.
- **Skill switching in Chat's left bar:** hidden in Phase 2 but reserved in the IA. It appears with a second skill (Goals). This refines FR-42 ("ships empty as a placeholder") and §9.4 into "hidden until a second skill exists".
- **Desk "Worked" widget:** FR-44 lists "total minutes worked" and "total hours worked with Yoh" as separate widgets. The spine merges them into one widget: today's minutes as the primary figure, all-time hours as a secondary line, on the same Estimated-Duration basis. This also contradicts OQ10's premise that the two measure different things.
- **FR-46 extensions:** blue accent (gradient limited to the thinking shimmer and active nav pill), dark mode, glass on floating elements, and the Theme Toggle as a sanctioned persistent control. FR-46 reads "off-white and black" and "no persistent action button".
- **FR-37 reward cue:** a visual pulse per saved card plus one sound when the batch is cleared (the PRD says a "ping sound or haptic" after *each* completed card).
- **/research one-time offer:** a Propose-Don't-Impose offer next to FR-51's "never runs without the command".
- **Resolved here, for PRD §11 update:** OQ9 (rim rule), OQ10 (hours definition), and OQ13 (undo form, unpin gesture, grouping, needs-data persistence, /sandbox placement).
- **2026-09-27 (Spencer), recorded in this pass:** page order Home/Tasks/Desk/Research Hub, no Chat page (Chat is a panel), swipe retired in favor of a vertical stack (arrow buttons, ↑/↓, edge-aware wheel, sidebar), brighter/stronger neumorphic look with more blue gradient, Home's Time Budget + mini month, Morning Plan in-app-only delivery, `/plan` on demand, Tasks-page direct-write ruling, the Research Hub page shell, and Desk's Seattle/BTC-ETH-SOL/business-AI-news/Claude-spend tile. See `prd.md`, `DESIGN.md`, `epics.md`, `ARCHITECTURE-SPINE.md` for the corresponding amendments.

---

## CLI (until retirement)

The terminal chat (`chat-cli.ts`) remains an interactive surface until FR-42's parity list is complete, and then FR-50 retires it. Rituals keep running either way. Visual tokens are in `DESIGN.md` § CLI.

| Touchpoint | Reached from | Purpose |
|---|---|---|
| Morning Plan | Push Notification; on-demand chat query | Ordered Plan + reasoning line (FR-1–FR-3) |
| Data-Completeness prompt | Auto, mid-Morning-Ritual | Ask for exactly the missing Required Field(s) (FR-4) |
| Chat | Spencer types, any time | Re-Flow, Blockers, Time Budget, FR-24–FR-29 |
| Night close-out | Auto at day's end → email escalation | Confirm done/slipped; capped at 2 (FR-12–FR-14) |
| Self-Check | Auto, ~every 4 days | Score + written reason (FR-17) |
| Propose-Don't-Impose confirmation | Auto when Yoh has a proposal | Explicit yes/no before acting (FR-16) |

**CLI component patterns:**
- **CLI Plan Block:** delivered once and never split. It always carries the **CLI Reasoning Line**.
- **CLI Prompt:** asks only for what is needed now. It waits indefinitely, and a pending confirmation blocks conflicting input.
- **CLI Escalation Marker:** used once per occurrence (the unchecked-day flag in the next Plan). It escalates in directness, not volume.
- Free-text chat with no command grammar. Blocker replies are a single confirmation line. Silence between the Plan and Spencer's next message.

**Phase 1 flows (condensed):**
- **UJ-1. Spencer starts his day with a Plan he didn't have to build.** The push lands. He reads the ordered Plan and reasoning line from the notification alone (climax: under ten seconds, no app opened). Yoh then stays silent.
- **UJ-2. A Task slips, and Spencer adjusts mid-day without a fight.** He types that he's behind. Yoh re-fits only the remaining blocks in one reply (climax), and the slipped Task carries its Slip-Bump.
- **UJ-3. Spencer closes the day, or Yoh notices he didn't.** The close-out push goes unanswered, and one email escalation follows (FR-13; this corrects the earlier spine, which said a second push). There is no third attempt (climax). The next Plan opens with a one-time unchecked-day note and the rolled-forward Blockers.

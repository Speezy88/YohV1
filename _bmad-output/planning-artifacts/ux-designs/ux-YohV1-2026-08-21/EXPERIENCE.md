---
name: Yoh
status: draft
sources:
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md
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
updated: 2026-09-25
---

# Yoh — Experience Spine

> Web-primary. The Phase 2 laptop web app is the main surface (PRD §5.9–§5.13, FR-30–FR-51). The Phase 1 CLI stays in a short legacy section at the end until FR-50 retires it. The Morning and Night Rituals, and their push/email channels, carry over unchanged. Phase 3 hardware and the Phase 4 iOS app are out of scope. Paired with `DESIGN.md`. Where the spines and the `.working/` explorations disagree, **the spines win**.

## Foundation

- **Surface:** a single-user web app in a laptop browser (home, class, desk) on **macOS and Windows**. No auth flow, account switching, or picker (FR-39 `[ASSUMPTION]` from the PRD: the session persists).
- **Pages:** Home → Chat → Tasks → Desk (swipe order, confirmed), plus a Screensaver and cross-cutting overlays.
- **UI base:** shadcn/ui as the headless base, Tailwind for tokens, Motion and transitions.dev for animation (brainstorm stack; the PRD addendum owns the libraries). `DESIGN.md` is the visual contract.
- **Three usage contexts drive every call:** a home-morning start, a 30-second-to-two-minute classroom capture, and a longer after-school desk session.
- **Standing gates:** the three-action capture flow (FR-39) never gains a required click. The page never takes initiative mid-block (FR-9, FR-49). Every write is visibly acknowledged or visibly failed (§6 Data integrity).
- **Themes:** light and dark. A Theme Toggle sits in a page corner. `[ASSUMPTION]` The first launch follows the OS appearance, and a manual toggle persists after that. The toggle is a sanctioned exception to FR-46's no-redundant-buttons rule, because no theme slash command exists.

## Information Architecture

→ Wireframe: `.working/ia-2026-09-25.excalidraw` (Row 1 pages, Row 2 overlays). Its "?" boxes are now resolved by the decisions below. Spine wins on conflict.

| Surface | Reached from | Job | Key components | Journey |
|---|---|---|---|---|
| **Home** | Launch (after splash); swipe / Page Indicator / ← → | What, in what order, and when | Plan Row + Checkbox, Calendar Day View + Calendar Block + Pin Control, Reshuffle Preview, Chat Bubble, Undo Toast | UJ-4, UJ-5 |
| **Chat** | Chat Bubble Enter; swipe; notification deep-links | Talk to Yoh; run commands | Chat Message, Chat Input, Command Palette, Thinking Indicator, Structured Question, Sandbox Card, Sandbox Finale; Skill Switcher (hidden in Phase 2, space reserved) | UJ-5, UJ-6 |
| **Tasks** | Swipe; research-ready deep-link | Find things | Task Group, Grouping Control, Needs-Data Indicator, Research Box | UJ-5 |
| **Desk** | Swipe | Reflect at the desk | Desk Widget (all variants) | UJ-6 |
| **Screensaver** | App launch (splash); 10 min idle | Aesthetic only; shows no data | Screensaver | UJ-5 (splash) |
| **Overlays** | Any page | Cross-cutting feedback | In-App Notification, Undo Toast, Command Palette, Birthday Confetti | UJ-4, UJ-5 |
| **Push / email** (outside the app) | Rituals, on schedule | Morning Plan; Night close-out escalation | Push Notification | CLI legacy UJ-1, UJ-3 |

**Navigation.** Horizontal trackpad swipe moves between adjacent pages (primary). The non-swipe fallback is a clickable Page Indicator plus the ← → arrow keys `[ASSUMPTION, per memlog; exact form pending]`. Every page is one gesture or click from every other (FR-39) through the indicator. The Theme Toggle sits in a corner of every page. Modal depth is one: the Command Palette is the only layered panel, and toasts never stack a modal.

**Need → surface closure.** FR-30–FR-35 → Home. FR-36–FR-38 → Chat. FR-39 → Screensaver → Home → Chat Bubble. FR-40/41 → Home. FR-42 → Chat. FR-43 → Tasks. FR-44/47 → Desk. FR-45 → Screensaver. FR-46 → all. FR-48 → Home (Approve), Chat (confirmations). FR-49 → overlays. FR-50 → CLI legacy. FR-51 → Chat → Tasks. Every surface above has at least one journey.

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
| Words and icons | Emoji, anywhere |

## Component Patterns

Behavioral rules. Visual specs are in `DESIGN.md` Components, under identical names.

| Component | Where | Behavioral rules |
|---|---|---|
| **Page Indicator** | Every page | Shows the current page among four. Clicking a dot goes to that page. ← → keys move one page when no text field has focus `[ASSUMPTION]`. Announces "Chat, page 2 of 4". |
| **Theme Toggle** | Every page, corner | One click flips light and dark. The first launch follows the OS; after a manual toggle, the choice persists `[ASSUMPTION]`. |
| **Plan Row** | Home | Ordered exactly as the Plan (FR-2). It reflects an approved reshuffle without a reload (FR-40). A pinned Task shows a Pin Control badge. |
| **Checkbox** | Plan Row | Click → checkmark + strikethrough, the row dissolves immediately (§6 Latency), and an Undo Toast appears. The Notion Status write and Completion Log entry are **deferred until the toast closes**, and dropped if Undo is pressed (FR-41). The write is Status-only. |
| **Calendar Day View** | Home | Today only (FR-30). Shows Yoh-owned and non-Yoh events. It is where Drag-to-Reshuffle happens. |
| **Calendar Block** | Calendar Day View | Yoh-owned blocks (Work/Break, Routine) are draggable (FR-30, FR-35). Fixed anchors can't be picked up (FR-33). Dragging a Task out of a block pins it (FR-31). Completed and past blocks are read-only. Drag-release is the whole input and opens the Reshuffle Preview within ~2s. |
| **Pin Control** | Pinned Calendar Block; Plan Row badge | Clicking the pin icon on the calendar block unpins the Task (memlog, resolves OQ13) and produces a fresh Reshuffle Preview. The Plan Row badge is an indicator only `[ASSUMPTION]`. A Pin expires at the end of the day. |
| **Button** | Everywhere | Primary = the one confirming action (Approve, Save). Secondary = Discard, Skip, Undo. No button duplicates a slash command (FR-46). |
| **Reshuffle Preview** | Home | Animates the current layout to the proposed one. Moved and unchanged blocks are distinguishable, and deferred Tasks are named. Approve writes everything (confirm-then-write, FR-32/FR-48). Discard or navigating away writes nothing. A stale preview recomputes instead of applying. Success: the calendar settles. Failure: an In-App Notification. |
| **Chat Bubble** | Home | Small until hover or focus, then expands wide. Enter sends and moves to Chat with the message as the first turn (FR-40). Typing "/" opens the Command Palette in place `[ASSUMPTION]`. |
| **Chat Input** | Chat | Enter sends. "/" as the first character opens the Command Palette. Unsent text survives the Screensaver and page swipes (FR-45). |
| **Chat Message** | Chat | Yoh's turns stream as they generate. A write triggered in Chat echoes a one-line receipt in the stream (§6). Yoh ends a conversation naturally and doesn't fish for more. |
| **Thinking Indicator** | Chat | Appears within a fraction of a second of sending, naming what Yoh is doing ("Searching Notion…"). It gives way to streaming text. |
| **Command Palette** | Chat Input, Chat Bubble | Lists `/morning`, `/night`, `/sandbox`, `/research`, each with a one-line description and an example. Filters as Spencer types. ↑↓ moves, Enter runs, Esc closes `[ASSUMPTION]`. It is the only command-discovery surface (FR-42). |
| **Structured Question** | Chat stream | Yoh asks a question with selectable options plus a free-text "Other". One pick answers it, and the answer is recorded as Spencer's turn. Used for clarifying questions, the one-time /research offer, and Proposal confirmations (FR-16/25/26/27, via FR-48) `[ASSUMPTION for Proposals]`. An unanswered question blocks conflicting writes but not unrelated chat `[ASSUMPTION]`. *Flagged for PRD update.* |
| **Skill Switcher** | Chat left bar | **Hidden in Phase 2**: only General chat exists, and Research is *not* a skill (`/research` is its only trigger, per FR-46's no-redundant-controls rule). The IA reserves the left-bar space. The switcher appears once a second real skill (Goals) exists: click to switch, with the active skill always indicated. It is a sanctioned nav element, not an FR-46 violation. *Flagged for PRD update.* |
| **Sandbox Card** | Chat stream | One Yoh message per Task missing a Required Field, soonest-due first (PRD `[ASSUMPTION]`, FR-36). Required fields: Due Date, Estimated Duration (Save stays disabled until both are filled). Refining fields are optional. Skip writes nothing and keeps the Task in the count. Save writes directly (FR-38), plays a visual pulse on that card (respecting reduced motion), and decrements the remaining counter live. The reward **sound plays once, when the batch is cleared**, not per card (respecting system mute). The next card appears below. Cards stay in chat history. An unresolvable select value re-prompts on that card. |
| **Sandbox Finale** | Chat stream | Plays at the end of the session while writes finish. It never adds a required click, and it is followed by an In-App Notification only once every write has succeeded. |
| **Undo Toast** | Home | "Checked off {Task} · Undo", visible ~5s. Undo restores the row and cancels the pending write. When it closes, the Status write and Completion Log entry commit. Several check-offs in quick succession: see Open Questions. |
| **In-App Notification** | Any page | Appears on whatever page is open. One click on it deep-links to the target (see In-App Notifications). It is never proactive (FR-49). |
| **Needs-Data Indicator** | Tasks `[ASSUMPTION: placement]` | A persistent count of Tasks missing Required Fields. Click → Chat with `/sandbox` started. It clears only when the count reaches zero (memlog; resolves the OQ13 tray question). |
| **Task Group** | Tasks | Groups every Notion Task by the active grouping. Every Task is findable (FR-43). A checked-off Task shows as completed, not deleted. |
| **Grouping Control** | Tasks | Area (default), Due Date, Energy, or Status. `[ASSUMPTION]` The choice persists across visits. |
| **Research Box** | Tasks | The latest research output up front, with the Research Vault library browsable below. It is the only research surface (FR-43). A research-ready notification opens the new doc here. Output follows the dedicated research prompt's consistent, focused shape (FR-51). |
| **Desk Widget** | Desk | Yoh-data widgets read the Completion/Activity Log only (FR-47). **Worked** is a single merged widget. Its primary figure is today's minutes (sum of Estimated Duration of Tasks completed today); a secondary line shows all-time hours with Yoh on the same Completion Log basis (resolves OQ10). **Streak** shows current and longest, in neutral wording. **On-Time Rate** follows FR-44's definition. **Usage Heatmap** is weeks × 7 days with hover tooltips. **Feed widgets** fail independently, showing "Unavailable" plus the last value and timestamp. |
| **Screensaver** | Launch; 10-min idle | Launch: plays briefly and auto-fades into Home with no click (FR-39). Idle: any input dismisses it and returns to the prior page with unsent chat text intact. It never shows data or notifications. |
| **Birthday Confetti** | Home, Feb 19 | Plays once per Feb 19 `[ASSUMPTION: once per day]`. Skipped under reduced motion. It is the only named celebration. |
| **Icon** | Everywhere | Icons pair with a text label or accessible name. An icon never stands alone as the only signal of state. |
| **Push Notification** | Phone (Pushover) | Exactly one Morning Plan push per day (FR-1). The Night close-out is a push first, then an email escalation, capped at two attempts (FR-13). Unchanged by the web app (FR-49, FR-50). |

## State Patterns

Copy shown is proposed wording `[ASSUMPTION]`; the rule is binding.

| State | Surface | Treatment |
|---|---|---|
| Launch / cold load | Screensaver → Home | The splash covers the load and fades into Home when ready. No click, no picker. |
| Cold data load | Home, Tasks, Desk | Skeleton rows or cards matching the layout (skeleton-reveal). Never a static spinner (FR-46). |
| No Plan yet today | Home | "No Plan yet today." The Chat Bubble stays live; `/morning` opens the Ritual in Chat. |
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
| Empty Research Vault | Tasks | "No research yet. Try /research in Chat." |
| No completions yet | Desk | Widgets show 0 / "Streak: 0 days". No guilt copy. |
| Feed down | Desk | That widget shows "Unavailable" plus the last value and timestamp. The rest of Desk is unaffected (FR-44). |
| Idle 10 min | Any | Screensaver. Scroll and pointer movement count as input. Any input returns to the same page, scroll position, and state. |
| Focus | Any | A `{spacing.focus-ring-width}` `{colors.accent-solid}` ring on the focused control, plus `{colors.accent-glow}` on the Chat Bubble / Chat Input. |

## Interaction Primitives

- **Swipe:** a horizontal two-finger trackpad swipe moves one page (macOS and Windows precision touchpads). The browser's own two-finger back/forward swipe is suppressed on the app surface (`overscroll-behavior-x: none` on the root), so a page swipe never leaves the app. A page swipe fires only when the gesture starts outside a horizontally scrollable region (calendar, ticker row, heatmap). The Page Indicator and ← → fallback stay visible at all times. Verified on macOS and Windows before swipe ships. OS-level gestures (e.g. swiping between desktops or full-screen apps) are outside the page's control.
- **Keys:** ← → move pages (no text focus). "/" opens the Command Palette in chat inputs. Enter sends or runs. Esc closes the Palette or collapses the Chat Bubble `[ASSUMPTION]`. Tab order follows reading order.
- **Click:** Page Indicator dots, Checkbox, Pin Control (unpin), Approve/Discard, Undo, notification deep-links, Skill Switcher entries, Grouping Control segments, Theme Toggle.
- **Drag:** Calendar Blocks only (Home), today only. Release opens the Reshuffle Preview. There is no drag anywhere else.
- **Hover/focus:** expands the Chat Bubble. Shows heatmap tooltips.
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
2. He types "Lab report draft, due Thursday" into the Chat Bubble and presses Enter. He lands in Chat with the message as the first turn, and Yoh confirms the Task was created with a one-line receipt.
3. He types "/". The Command Palette opens, he picks `/sandbox`, and presses Enter.
4. The first Sandbox Card appears inline: "Chem problem set — Due Date, Estimated Duration · 4 remaining". He fills both and clicks **Save**. The card pulses, and the counter reads "3 remaining".
5. He skips one he's unsure about (no cue, and it stays in the count), then saves two more. Each card stays in the chat history.
6. **Climax:** the batch is cleared, so the single reward sound plays. The Sandbox Finale bar runs while Notion writes land, and an In-App Notification appears: "Saved 3 Tasks." The Needs-Data Indicator on Tasks drops to 1.
7. Before closing the laptop he sends `/research when is the AP Bio registration deadline`. Yoh runs it immediately, with no narrowing questions.
8. Later, on any page, "Research ready: AP Bio registration deadline" appears. One click opens the doc in the Research Box on Tasks.

**Failure paths:** a Notion write fails → the completion notification names the failed Task instead of claiming success, and that Task stays in the count. The search fails → a failure notification, not a research-ready one. **Variant:** Spencer describes something obviously research-sized without the command → Yoh offers once, via a Structured Question ("Do you want to do research on this?"), and runs only if he accepts.

### UJ-6. Spencer reflects on the day at his desk.

*Desk, after school, a longer session.*

1. Spencer swipes from Home to Desk (or presses → three times).
2. Desk shows Tasks Completed (a scrollable list of checked, struck-through rows), the Worked widget ("145 min today", with "212 h with Yoh" beneath) in tabular figures, the on-time rate, "Streak: 1 day · Longest: 12 days", and the usage heatmap. Next to these are BTC/SOL/ETH tickers, weather, and top business and AI news.
3. He hovers the heatmap to see last Tuesday's count.
4. **Climax:** he sees the day's work summed up in one glance, in neutral words, with no guilt about the streak reset.
5. When he's ready, he swipes to Chat and runs `/night`. The close-out runs interactively, and tonight's scheduled push and email escalation are cancelled (FR-42).

**Failure path:** the news feed is down → that widget reads "Unavailable · last updated 2:14 PM", and the rest of Desk is unaffected.

## Chat Skills & Commands

| Command | Does | Example |
|---|---|---|
| `/morning` | Opens today's Morning Ritual in Chat: the Plan, its reasoning line, and pending questions or Proposals. It never re-sends the push or regenerates the Plan. | `/morning` |
| `/night` | Runs the Night Ritual close-out interactively, and cancels that night's scheduled prompt and escalation. | `/night` |
| `/sandbox` | Starts the inline Sandbox Card flow. | `/sandbox` |
| `/research <question>` | Queues research immediately. The result files to the Research Vault, and a notification follows. This is the only way research runs. | `/research AP Bio registration deadline` |

| Skill (Skill Switcher) | Status |
|---|---|
| General chat | Phase 2, the only skill, so the switcher is hidden |
| Goals | Future. When it arrives, the switcher appears; the Goals hub stays deferred (§9.4). |

Research is **not** a skill. `/research` is its only trigger (memlog subtraction; supersedes the earlier General chat + Research listing).

**Research trigger rule:** research never starts without Spencer's explicit confirmation. It runs on an explicit `/research`, or, for an obviously big task, after Yoh offers through a Structured Question ("Do you want to do research on this?") and Spencer accepts. Declining or ignoring the offer runs nothing (Propose-Don't-Impose, FR-16/FR-48).

## In-App Notifications

| Trigger (FR-49 consumer) | Message shape | Deep-link |
|---|---|---|
| Research ready (FR-51) | "Research ready: {topic}" | Research Box doc on Tasks |
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
| macOS laptop browser | Primary. Trackpad swipe between pages. |
| Windows laptop browser | Must reach parity: self-hosted Figtree (no `system-ui`), precision-touchpad swipe supported, or the Page Indicator and arrow keys carry navigation. `backdrop-filter` verified, with an opaque fallback `[ASSUMPTION]`. |
| Narrow windows / phone | Not specified. The iOS app is Phase 4. See Open Questions. |
| School network | The app must be reachable from class (PRD OQ12, architecture). |

## Rituals (carried over)

- **Morning Ritual:** runs unattended and sends one Pushover push with the Plan and reasoning line (FR-1). In the web app, `/morning` views the same Plan in Chat.
- **Night Ritual:** a push first, then a single email escalation, and never a third attempt (FR-13). An unacknowledged night is marked unchecked, and mandatory Blockers roll into tomorrow (FR-14). `/night` in Chat pre-empts both.
- **Self-Check** (FR-17) and **Ritual-created Proposals** (FR-48/FR-50) must be resolvable in the web app once the CLI is retired. Where they surface is open (see Open Questions).
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
9. **Where Ritual-created Proposals, Self-Check prompts, and the unchecked-day flag surface** when Spencer isn't in Chat. There is no FR-49 consumer for them.
10. **/sandbox "batch cleared":** does the sound play when every card has been saved or skipped, or only when the needs-data count reaches zero?
11. **Non-drag reshuffle path (WCAG 2.5.7):** is the Chat request enough, or is a dedicated control needed?
12. **Narrow-window behavior:** there are no breakpoints yet.
13. **Chat history persistence** across launches (Sandbox Cards "remain in history").
14. **Routine declaration UI:** Chat only (PRD `[ASSUMPTION]`) or also a /sandbox step?
15. **Screensaver parameters and wordmark size:** dot count, speed, and size are unspecified.
16. **Reward sound asset** and its volume.
17. **Thinking shimmer legibility:** the gradient fills the status text, and its light stop measures 1.49:1 on the light surface. Is the shimmer decorative over already-legible text, or does it need a floor?

**Flags for PRD update**

- **Structured Question** (Chat clarifying questions with selectable options): not in FR-42.
- **Skill switching in Chat's left bar:** hidden in Phase 2 but reserved in the IA. It appears with a second skill (Goals). This refines FR-42 ("ships empty as a placeholder") and §9.4 into "hidden until a second skill exists".
- **Desk "Worked" widget:** FR-44 lists "total minutes worked" and "total hours worked with Yoh" as separate widgets. The spine merges them into one widget: today's minutes as the primary figure, all-time hours as a secondary line, on the same Estimated-Duration basis. This also contradicts OQ10's premise that the two measure different things.
- **FR-46 extensions:** blue accent (gradient limited to the thinking shimmer and active nav pill), dark mode, glass on floating elements, and the Theme Toggle as a sanctioned persistent control. FR-46 reads "off-white and black" and "no persistent action button".
- **FR-37 reward cue:** a visual pulse per saved card plus one sound when the batch is cleared (the PRD says a "ping sound or haptic" after *each* completed card).
- **/research one-time offer:** a Propose-Don't-Impose offer next to FR-51's "never runs without the command".
- **Resolved here, for PRD §11 update:** OQ9 (rim rule), OQ10 (hours definition), and OQ13 (undo form, unpin gesture, grouping, needs-data persistence, /sandbox placement).

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

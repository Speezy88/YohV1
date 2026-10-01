# Yoh — SDD Plan: Polish 6 (UI audit follow-up, 2026-09-30)

Source: `ui-audit-2026-09-30.md` (same folder). Spencer approved the order "glitch/correctness batch → control-and-state design → responsive later" and asked for an autonomous run; every design choice below is a `Ruling:` made without him and listed in the ledger for his glance.

Precedent and constraints: `AGENTS.md` binds (tokens only, `useReducedMotion`, skeletons not spinners, WCAG 2.2 AA, copy rules, no emoji). DESIGN.md / EXPERIENCE.md (`_bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/`) stay the visual and behaviour spec; this plan closes drift from them and adds the interaction states they don't define. Web-only: no `src/` server change in any task. One commit per task, trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Each task ≤ ~7 source files plus their tests.

Test order for every task: focused Vitest files while iterating → `npm run check` ONCE → ONE full `cd web && npx playwright test` → rerun only failing specs by file. Existing tests that assert an old class string are updated to the new one, never deleted.

Already done (commit `a06348b`, "UI audit batch 1"): see the audit file's "Batch 1" section.

## Rulings (autonomous — for Spencer's glance)

- **P6-R1 Controls are class-string constants, not new components.** One file, `web/src/lib/controlStyles.ts`, exports them; components compose them into `className`. Matches the repo's existing idiom (`FOCUS`, `PRIMARY_BUTTON`, `LINK_BUTTON` constants) and removes the ~8 duplicated `FOCUS` copies. Cost if wrong: swap constants for components later; call sites already centralised.
- **P6-R2 Motion tokens.** `--duration-control: 150ms`, `--ease-control: cubic-bezier(0.2, 0, 0, 1)` in `tokens.css`. Control transitions cover colour, background, border colour, box-shadow, opacity and filter only (never `all`, never layout). Under `prefers-reduced-motion: reduce` the transition is removed in CSS (state still changes, instantly).
- **P6-R3 Interaction states.**
  - Raised/secondary controls (rimmed or extruded): hover = label to `ink-primary` and one shadow step up (`extruded-sm` → `extruded-md`); pressed = `shadow-inset`.
  - Primary (accent gradient): hover = `brightness-105`; pressed = `brightness-95`.
  - Text buttons: hover = underline.
  - Rows that are clickable (Research rows, Memory items, Command Palette options, MiniMonth days): hover = `bg-surface-sunken` for flat rows, shadow step up for raised rows.
  - Focus: the existing 2px `accent-solid` outline, offset 2px, on every interactive element; the Ask Yoh pill and Chat Input keep their glow.
  - Disabled: `opacity-50` + `cursor-not-allowed`, everywhere (replaces 40/50/60).
  - Pointer cursor on every enabled button, option and link via one base rule in `tokens.css`.
- **P6-R4 Shapes follow DESIGN.md.** Buttons are `rounded-sm` (Primary and Secondary). Pills (`rounded-full`) stay only on things that float or navigate: Ask Yoh pill, Chat Input, sidebar active item, Theme Toggle, toggles/segmented controls, Pin Control, badges. Primary keeps the accent gradient fill (DESIGN.md Do's, amended 2026-09-27).
- **P6-R5 Sizes.** Three control heights: `sm` 36px (`h-9`), `md` 44px (`h-11`), `lg` 48px (`h-12`). Icon-only buttons are square at the same steps. Nothing interactive is smaller than 24×24px; where the glyph is smaller the button pads out to it. Existing 42px → 44px, 46px → 48px, 34/38/40px → 36 or 44 by nearest role. The Ask Yoh pill keeps its specified ~46px.
- **P6-R6 State pattern.** One component, `web/src/components/StateMessage.tsx`: `variant="empty"` = one `ink-secondary` body line (optional second line); `variant="error"` = alert glyph (1.8px stroke) + `ink-primary` line + optional Secondary "Try again" button. Errors never use colour alone and never show a raw thrown message.
- **P6-R7 Stale beats blank.** A failed refetch on Home keeps the loaded page and shows the same "Couldn't refresh…" line Tasks uses; only a first load can show the full error state.
- **P6-R8 Copy (invented, awaiting Spencer's glance).**
  - Desk: "Desk isn't built yet."
  - Chat, empty: "Ask about your day, add a Task, or type / for commands."
  - Tasks, Missing data filter with no results: "No Tasks are missing data."
  - Today's calendar, empty: "Nothing on the calendar" (the line other days already use).
  - Error button: "Try again". Home refresh failure: "Couldn't refresh — showing Home from {time}."
  - Command Palette while loading: skeleton rows, no text. After a failed load: "Couldn't load commands." + "Try again".
  - Task edit saved: the cell shows a check glyph + "Saved" for ~1.5s (visible form of the existing sr-only receipt).
- **P6-R9 Type.** No new font file: only Figtree 500 and 700 ship, so `font-semibold` → `font-bold` and `font-normal` → `font-medium`. Sentences and form labels are never below `text-caption-lg` (12.5px); `text-caption`/`text-label` stay for uppercase section labels, badges and counters.
- **P6-R10 Spacing.** Named scale only: steps 1–6 as defined (4/8/12/16/24/32). `p-7`, `gap-7` and `*-4.5` / `*-[18px]` are replaced by the nearest named step (28 → 24 or 32 by context; 18 → 16). Page title → content gap is 24px on every page. Page cards are `rounded-2xl` + `p-6`; nested cards are `rounded-lg`.
- **P6-R11 Icons.** Every stroked glyph is 1.8px (DESIGN.md). Repeated glyphs (chevron, search, pin, close, check, alert) move into `web/src/components/icons/`.
- **P6-R12 Page in the URL hash.** `#home`, `#tasks`, `#desk`, `#research`, `#memory`: reload stays on the page, Back/Forward move between visited pages. No router, no server change.
- **P6-R13 Responsive is planned, not built here.** EXPERIENCE.md lists narrow windows/phone as unspecified; Spencer plans phone use. Task 10 writes the proposal for his decision.
- **P6-R14 Review policy (lean).** No per-task review; one whole-branch review at the end, then a fix round. Implementers are Sonnet.

## Task 1: Control styles foundation + shared chrome

**Owns:** new `web/src/lib/controlStyles.ts` (+ test), `web/src/tokens.css`, `web/src/components/Sidebar.tsx`, `ThemeToggle.tsx`, `AskYohPill.tsx`, `Checkbox.tsx`, `ChatInput.tsx` (+ their tests).

**Behavior:**
1. `tokens.css`: add `--duration-control` and `--ease-control` (P6-R2); a base rule giving enabled `button`, `[role="button"]`, `[role="option"]`, `a[href]`, `summary` a pointer cursor and disabled ones `not-allowed`; a `@media (prefers-reduced-motion: reduce)` rule that removes control transitions.
2. `controlStyles.ts` exports, each defined once: `FOCUS_RING`, `CONTROL_TRANSITION`, `CONTROL_DISABLED`, `CONTROL_SM` / `CONTROL_MD` / `CONTROL_LG` (height + horizontal padding + type size), `BUTTON_PRIMARY`, `BUTTON_SECONDARY`, `BUTTON_TEXT`, `ICON_BUTTON` (square, rimmed, extruded), `ROW_HOVER_FLAT`, `ROW_HOVER_RAISED`. Values per P6-R3/R4/R5. A unit test pins that every button constant includes the focus ring, the transition and the disabled treatment, and that none contains `transition-all`.
3. Adopt in the shared chrome: Sidebar nav items and arrow buttons (hover, pressed, focus ring; inactive nav item hover = `bg-surface-sunken`), Theme Toggle, Ask Yoh pill (hover shadow step, pressed inset, focus glow), Checkbox (hover rim to `accent-solid`; both sizes get a ≥24px hit area without changing the drawn box), Chat Input Send.
4. Theme Toggle's accessible name contains its visible text ("Dark mode" / "Light mode").

**Tests:** constants test above; each adopted component has the focus-ring class on its interactive element; Theme Toggle name matches visible text; Checkbox hit area.

**Commit:** `feat(web): shared control styles (hover, pressed, focus, disabled) + adopt in app chrome`

## Task 2: Controls on Home

Depends on Task 1.

**Owns:** `web/src/pages/Home.tsx`, `web/src/components/MiniMonth.tsx`, `TimeBudgetWidget.tsx`, `ReshufflePreviewCard.tsx`, `PlanChecklist.tsx`, `CalendarDayView.tsx` (+ tests).

**Behavior:**
1. Every button on these surfaces uses the Task 1 constants: Day/Month toggle, day-nav arrows (≥ `sm` size), "Retry", MiniMonth day buttons and month arrows (hover, focus ring, pressed), Time Budget pill (hover affordance) and its Save (Primary `sm`) / Cancel (Text), Reshuffle Approve (Primary) / Discard (Secondary), calendar Unpin (≥24px target).
2. Plan row: clicking the row's label toggles its checkbox (label and box share one hit target); read-only rows stay inert.
3. MiniMonth: today carries `aria-current="date"`; weekday header cells have full-name accessible labels.
4. Time Budget: an empty or invalid hours value shows an inline line under the field ("Enter hours between 0 and 24." — use the validation the code already applies; state its real bounds) instead of silently returning; Save shows "Saving…" while pending.
5. Numeric columns (plan times, month days, hour labels, budget figures) use `tabular-nums`.

**Tests:** label click checks the row; `aria-current`; invalid budget shows the inline message and does not call the API; focus-ring presence on each control group.

**Commit:** `feat(web): Home controls adopt shared styles; plan-row label target; Time Budget validation feedback`

## Task 3: Controls in Chat

Depends on Task 1.

**Owns:** `web/src/components/ChatPanel.tsx`, `CommandPalette.tsx`, `StructuredQuestion.tsx`, `SandboxCard.tsx`, `RatingPrompt.tsx`, `RememberedReceipt.tsx`, `UndoToast.tsx` (+ tests). `NotificationOverlay.tsx` is Task 8's.

**Behavior:**
1. Shared constants on: missing-data chip, Close, Jump to latest (ChatPanel); option chips + Send (StructuredQuestion: Secondary, selected → Primary); Skip (Secondary) / Save (Primary) and the field inputs (SandboxCard — inputs keep their rim, gain the focus ring; buttons become `rounded-sm` per P6-R4); rating chips + "Not now"; receipt Undo; toast Undo.
2. Command Palette: moving the mouse over a row highlights it (the same highlight the arrow keys move), so mouse and keyboard never show two different selections.
3. SandboxCard: Save stays enabled; pressing it with a required field empty shows which field is missing inline (existing error line styling, `text-caption-lg` or larger) and focuses it. Field labels and the error line are ≥12.5px (P6-R9). Enter in a field saves.
4. Local `FOCUS`/button constants in these files are deleted in favour of the shared ones.

**Tests:** palette mouse-move highlight; SandboxCard empty-required save shows the message, focuses the field, makes no API call; Enter saves; chips flip to Primary when selected.

**Commit:** `feat(web): Chat controls adopt shared styles; palette hover highlight; Sandbox save feedback`

## Task 4: Controls on Tasks and Research Hub

Depends on Task 1.

**Owns:** `web/src/pages/Tasks.tsx`, `web/src/components/TaskRow.tsx`, `TaskQuickAdd.tsx`, `web/src/pages/ResearchHub.tsx` (+ tests).

**Behavior:**
1. Shared constants on: Missing data toggle, group-by segmented control, TaskRow cell buttons and "Add …" badges (hover, focus, pressed; ≥24px tall), cell editors (focus ring), Research rows (`ROW_HOVER_RAISED`), the Research ask box and Tasks quick-add (visible focus on the wrapping field, same treatment as the Tasks search).
2. Task edit confirmation (P6-R8): when a cell's save succeeds, that cell shows a check glyph + "Saved" for ~1.5s, then the value. Uses the existing `saved` override state in `Tasks.tsx`; the sr-only receipt stays.
3. Tasks with the Missing data filter on and no results reads "No Tasks are missing data." (not "No Tasks yet…").
4. TaskQuickAdd: a failed preview shows one caption line ("Couldn't preview that — you can still add it.") instead of nothing.
5. Date and duration columns use `tabular-nums`.

**Tests:** saved indicator appears then clears (fake timers); missing-data empty copy; quick-add preview failure line; focus-ring presence.

**Commit:** `feat(web): Tasks and Research controls adopt shared styles; visible saved state; filter-aware empty copy`

## Task 5: Controls on Memory

Depends on Task 1. The Memory page was not audited; this task applies the same rules there and reports anything else it finds (don't fix beyond the list).

**Owns:** `web/src/pages/Memory.tsx`, `web/src/components/memory/MemoryItemRow.tsx`, `ItemOverflowMenu.tsx`, `ChatHistoryPane.tsx`, `NeedsReviewPane.tsx`, `MemorySearch.tsx`, `MemoryRail.tsx`, `ChangedSettingsPane.tsx` (+ tests). If that is too many for one run, do Memory.tsx + MemoryItemRow + ItemOverflowMenu + MemoryRail first and report `PARTIAL` with the rest listed.

**Behavior:**
1. Every button, menu item, rail row and search hit uses the shared constants (hover, pressed, focus ring, disabled, sizes per P6-R5); local `FOCUS`/`BUTTON`/`LINK_BUTTON` constants are replaced.
2. Memory items use `ROW_HOVER_RAISED` (DESIGN.md: "Extruded-sm, md on hover").
3. `font-semibold` → `font-bold` in these files (P6-R9).
4. Report (in the task report, not as code): any empty/loading/error state on Memory that doesn't match P6-R6, any text under 12.5px carrying a sentence, any hit target under 24px.

**Tests:** focus-ring presence per control group; existing Memory tests stay green.

**Commit:** `feat(web): Memory controls adopt shared styles`

## Task 6: State pattern — errors with retry, stale-over-blank, matching skeletons

Depends on Task 1.

**Owns:** new `web/src/components/StateMessage.tsx` (+ test), new `web/src/components/icons/` glyphs it needs, `web/src/pages/Home.tsx`, `web/src/lib/homeView.ts`, `web/src/pages/Tasks.tsx`, `web/src/pages/ResearchHub.tsx` (+ tests). Re-anchor on names: Tasks 2 and 4 changed Home/Tasks/Research before this.

**Behavior:**
1. `StateMessage` per P6-R6 (`variant`, `message`, optional `detail`, optional `onRetry`). `role="alert"` for errors, none for empties.
2. First-load errors on Home, Tasks and Research Hub render `StateMessage` error + "Try again" wired to that page's existing refetch. Server-supplied `message` text (the Result envelope's user copy) may be shown as `detail`; a thrown error's own message never is — `homeView.ts` stops storing `err.message`.
3. Home: a failed refetch after a successful load keeps the loaded view and shows "Couldn't refresh — showing Home from {time}." (P6-R7), cleared by the next successful load. Mirror `lib/tasks.ts`'s `refreshFailed` shape.
4. Home's loading skeleton mirrors the loaded layout: header block, Plan card with heading + rows, Calendar card — same grid and paddings, so nothing jumps when data arrives. Skeletons honour `useReducedMotion`.
5. Empty states on Home ("No Plan yet today…", "Nothing left on today's Plan."), Tasks and Research Hub render through `StateMessage` empty; copy unchanged except where P6-R8 says.

**Tests:** StateMessage variants; each page's error shows the button and it refetches; Home keeps data after a failed refetch and shows the line; `homeView` never stores a thrown message; skeleton structure has the same landmarks as the loaded page.

**Commit:** `feat(web): shared empty/error states with retry; Home keeps data when a refresh fails`

## Task 7: Unfinished surfaces — Chat welcome, Desk, calendar empties, Command Palette loading

Depends on Task 6.

**Owns:** `web/src/components/ChatPanel.tsx`, `web/src/pages/Desk.tsx`, `web/src/components/CalendarDayView.tsx`, `web/src/components/CommandPalette.tsx`, `web/src/lib/commands.ts` (+ tests; Playwright specs that assert the old Desk or palette text).

**Behavior:**
1. Chat with no turns shows the P6-R8 welcome line (StateMessage empty) centred in the stream; it disappears with the first turn. No buttons that duplicate slash commands (EXPERIENCE.md "Banned").
2. Desk shows "Desk isn't built yet." via StateMessage empty in the same page frame as other pages (title, then card) — no reference to epics.
3. Today's calendar, when it has no blocks, shows "Nothing on the calendar" like other days.
4. Command Palette: while commands load, 3 skeleton rows (no "No matching command"); a failed load shows "Couldn't load commands." + "Try again" and is NOT cached — the next open or the button refetches. "No matching command" appears only after a successful load with no match.

**Tests:** welcome line present with zero entries and gone with one; Desk copy; today-empty calendar line; palette loading / failed / retry / no-match paths; `commands.ts` does not cache a failure.

**Commit:** `feat(web): Chat welcome state, Desk placeholder copy, calendar and palette empty/loading states`

## Task 8: Accessibility structure

Depends on Task 1.

**Owns:** `web/src/App.tsx`, `web/src/components/PageShell.tsx`, `ChatPanel.tsx`, `ChatInput.tsx`, `NotificationOverlay.tsx`, `UndoToast.tsx` (+ tests).

**Behavior:**
1. One `<main>` landmark around the active page; a "Skip to content" link, first in tab order, visible on focus.
2. Chat panel as a real modal: while open, everything outside it is `inert` (and restored on close); Tab cycles within the panel; focus returns to the element that opened it.
3. Chat Input exposes the palette correctly: `role="combobox"`, `aria-expanded`, `aria-controls` pointing at the listbox, `aria-activedescendant` only while open.
4. NotificationOverlay: the card is no longer a `role="button"` wrapping buttons — the message is the primary button, Show more / Dismiss are siblings; Dismiss has a ≥24px target, focus ring and hover; the stack does not cover the Chat panel's header controls (move it below the header band while the panel is open, or offset it — pick the smaller change and say which).
5. Undo Toast: Undo is reachable without tabbing through the page — it is the next Tab stop after the control that triggered it (or focus moves to it; pick one, keep the timer-pause behaviour).
6. z-index: the chat panel, Ask Yoh pill and confetti no longer share one value; define the layers once (tokens or one constants file) and use them.

**Tests:** main + skip link; inert on open/close and focus return; combobox attributes; notification structure (no nested interactive, by role query); Undo reachable.

**Commit:** `feat(web): landmarks, modal chat panel, combobox semantics, notification and toast accessibility`

## Task 9: Spacing, type and icon cleanup + page in the URL hash

Depends on Tasks 2–8 (touches many files last, mechanically). Two commits allowed for this task only.

**Owns (a):** every non-test `.tsx` under `web/src/pages` and `web/src/components`, `web/src/tokens.css`. **Owns (b):** `web/src/lib/pages.ts`, `web/src/components/PageShell.tsx` (+ tests).

**Behavior (a) — P6-R9/R10/R11:**
1. Replace `p-7`/`gap-7`/`*-4.5`/`*-[18px]` per P6-R10; page title gap 24px on all pages; page cards `rounded-2xl p-6`; nested cards `rounded-lg`.
2. `font-semibold` → `font-bold`, `font-normal` → `font-medium`.
3. Sentences/labels at `text-caption`/`text-label` move to `text-caption-lg` or `text-small` (list each in the report).
4. All glyph strokes 1.8px; duplicated chevron/search/pin/close/check glyphs come from `components/icons/`.
5. `CalendarDayView`'s pin size constant and its `size-*` class agree.
6. `tokens.css`: remove the duplicated dark-mode shadow block and the unused `--color-rim-highlight` if grep confirms no use.
7. No visual regressions beyond the listed changes: take before/after screenshots of each page in both themes with the fixture server and attach the paths in the report.

**Behavior (b) — P6-R12:** page id in `location.hash`; initial page from the hash (unknown or empty → Home); navigating updates the hash with `history.pushState`; `popstate` moves the page; existing navigation (sidebar, arrows, keys, wheel) unchanged.

**Tests:** (b) initial page from hash, hash updates on navigate, popstate navigates, unknown hash → Home. (a) grep-style test that no component uses `font-semibold`, `p-7`, `gap-7` or a stroke width other than 1.8 on a glyph (allow-list any justified exception in the test).

**Commits:** `refactor(web): spacing, type and icon consistency` and `feat(web): keep the current page in the URL hash`

## Task 10: Responsive proposal (document only — coordinator writes it)

Write `_bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/responsive-proposal-2026-10-01.md`: breakpoints, what the sidebar becomes at narrow widths, Home's column stacking, the task row at narrow widths, the chat panel as a full-screen sheet, touch targets, `theme-color`, and the open questions only Spencer can answer. No code.

## Out of scope
Month-view day markers (needs new server data), a persistent connection indicator (needs a decision on where it lives), list virtualization, any `src/` change, the responsive build.

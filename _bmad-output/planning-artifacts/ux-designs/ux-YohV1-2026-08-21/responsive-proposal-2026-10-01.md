# Yoh — responsive layout proposal (2026-10-01)

Status: **proposal, not approved.** EXPERIENCE.md "Responsive & Platform" lists narrow windows and phone as not specified, with a native iOS app in Phase 4. Spencer (2026-09-30): not used on a phone today, but planned. Nothing here is built. Evidence: `_bmad-output/implementation-artifacts/ui-audit-2026-09-30.md`, finding 3.

## What breaks today

No breakpoint exists in `web/`. Four fixed widths set a floor of roughly 1300px:

| Fixed width | Where | Effect below the floor |
|---|---|---|
| 248px sidebar | `Sidebar.tsx` | Always present; at 390px it takes 64% of the screen |
| 520px calendar column | `Home.tsx` grid | At 1024px the Plan card is squeezed to a sliver |
| ~800px of fixed task columns | `TASK_ROW_GRID` in `TaskRow.tsx` | At 768px the title column reaches 0 and titles vanish |
| `left: 268px` chat panel | `ChatPanel.tsx` | Panel is offset past a sidebar that should not be there |

Pages are `overflow-hidden` by design (one page in view), so overflow is clipped, not scrollable.

## Proposed breakpoints

Three layouts, switched on viewport width:

| Name | Width | Who it is for |
|---|---|---|
| Wide | ≥ 1280px | Today's layout, unchanged |
| Medium | 768–1279px | Small laptop window, split screen, tablet |
| Narrow | < 768px | Phone |

## Proposed behaviour per layout

**Navigation**
- Wide: sidebar as now.
- Medium: sidebar collapses to an icon rail (~72px): icons with accessible names, active item keeps the gradient pill, Theme Toggle becomes icon-only, the up/down arrow buttons stay.
- Narrow: a bottom tab bar with the five pages (icon + short label). The up/down arrow buttons are dropped (tabs replace them). Theme Toggle moves into a small menu at the top right. The Ask Yoh pill sits above the tab bar.

**Home**
- Wide: Plan left, Calendar right (520px).
- Medium: same two columns, calendar column shrinks to a fraction (about 40%) with a floor near 360px.
- Narrow: one column — greeting, Time Budget, Plan, then Calendar, in one vertical scroll. This is the one place the "page never scrolls as a whole" rule would be relaxed.

**Tasks**
- Wide: the eight-column row as now.
- Medium: drop to title + Due + Duration + Status; Area, Energy and Priority move into a second line under the title.
- Narrow: each Task is a two-line card — checkbox and title on line one; due, duration and status as a wrapped meta line on line two; tapping a value opens the same editor. The quick-add and search dock stays at the bottom; group-by becomes a single menu button.

**Research Hub, Memory, Desk**
- Research Hub rows already flex; only the page padding changes.
- Memory: Medium keeps rail + list; Narrow turns the rail into a horizontal scrolling set of chips above the list.
- Desk: its widget grid should be built responsive from the start (Epic 12).

**Chat panel**
- Wide/Medium: as now, offset by the sidebar or rail width.
- Narrow: a full-screen sheet with safe-area padding; the composer stays above the on-screen keyboard.

**Calendar drag**
- Blocks use `touch-none`, which blocks scrolling when a finger lands on a block. On touch, dragging should start only after a long press, so a swipe over a block still scrolls the day.

**Touch and platform**
- Controls: Polish-6 already raises targets to at least 24px; on Narrow the working minimum should be 44px.
- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding on the tab bar, chat sheet and Ask Yoh pill.
- `theme-color`: follow the active theme's page background instead of the brand accent (the Theme Toggle updates the meta tag).
- Hover-only affordances (Memory "Edit" on hover) need an always-visible form on touch.
- Tasks auto-focuses quick-add on arrival; on touch that pops the keyboard on every page change and should be skipped.
- Wheel-driven page changes do not exist on touch; the tab bar is the only page navigation on Narrow.

## Questions only Spencer can answer

1. **Is the web app the phone experience, or a stopgap until the Phase 4 iOS app?** A stopgap argues for Narrow-only essentials (Home, check-off, chat, quick-add) and nothing else.
2. **Which pages matter on the phone?** Home + Chat + quick-add are the obvious three. Are Tasks editing, Memory and Research Hub needed there?
3. **Bottom tab bar or a menu button?** Five destinations fit a tab bar; a sixth (Desk widgets later) still fits, a seventh would not.
4. **Does Medium matter?** If Yoh is only ever full-screen on the laptop or on the phone, Medium can be the cheapest possible fallback (icon rail, nothing else).
5. **Install to the home screen?** The manifest already exists; this decides how much safe-area and standalone-mode work is worth doing.

## Rough size

- Narrow shell (tab bar, chat sheet, safe areas, Home single column): one task.
- Tasks narrow card + Medium row: one task.
- Memory rail, touch drag, hover-only affordances, auto-focus: one task.
- Medium icon rail: one small task.

Four implementer tasks plus Playwright coverage at 390px and 1024px, after the questions above are answered.

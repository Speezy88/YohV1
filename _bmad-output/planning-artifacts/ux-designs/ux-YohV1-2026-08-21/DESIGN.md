---
name: Yoh
description: A personal daily-planning assistant whose primary surface is a single-user laptop web app — warm off-white neumorphism, glass only on what floats, one blue accent whose gradient is kept for two signature moments, motion tied to state. The Phase 1 CLI is kept as a short legacy section until FR-50 retires it.
status: draft
created: 2026-08-21
updated: 2026-09-25
sources:
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md
  - _bmad-output/brainstorming/brainstorm-phase2-web-app-ui-2026-09-24/brainstorm-intent.md
  - _bmad-output/brainstorming/brainstorm-phase2-web-app-ui-2026-09-24/.memlog.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.memlog.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.working/color-themes-1.html
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.working/color-themes-2.html
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.working/type-compare-1.html
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/.working/ia-2026-09-25.excalidraw
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/imports/proxima-nova-specimen.png
  - _bmad-output/planning-artifacts/briefs/brief-YohV1-2026-08-21/brief.md
colors:
  # Light values unsuffixed; dark values carry the -dark suffix. 8-digit hex = alpha.
  # Base: Variation 1 "Neumorphism-forward" (color-themes-1.html). Accent: Option A "Sky -> Azure" (color-themes-2.html).
  surface-base: '#E7E1D7'
  surface-base-dark: '#201C17'
  surface-raised: '#E7E1D7'
  surface-raised-dark: '#241F19'
  surface-sunken: '#DDD6C9'
  surface-sunken-dark: '#1B1712'
  ink-primary: '#262220'
  ink-primary-dark: '#EDE7DC'
  ink-secondary: '#6A645A'
  ink-secondary-dark: '#A69C8C'
  rim-interactive: '#807C72'
  rim-interactive-dark: '#7A7367'
  rim-structural: '#807C72'
  rim-structural-dark: '#6E675B'
  rim-highlight: '#FFFFFF00'
  rim-highlight-dark: '#FFFFFF0F'
  shadow-light: '#FFFFFFB3'
  shadow-light-dark: '#FFFFFF0D'
  shadow-dark: '#A3968273'
  shadow-dark-dark: '#0000008C'
  glass-fill: '#FFFFFF8C'
  glass-fill-dark: '#FFFFFF0F'
  accent-gradient-start: '#7FC1F5'
  accent-gradient-start-dark: '#8FCBFA'
  accent-gradient-end: '#1E6FD9'
  accent-gradient-end-dark: '#3E8CF0'
  accent-solid: '#1E6FD9'
  accent-solid-dark: '#3E8CF0'
  on-accent-solid: '#FFFFFF'
  on-accent-solid-dark: '#14120F'
  accent-glow: '#1E6FD959'
  accent-glow-dark: '#3E8CF059'
  event-fixed-stripe-a: '#DCD4C4'
  event-fixed-stripe-a-dark: '#2E2820'
  event-fixed-stripe-b: '#D2C8B4'
  event-fixed-stripe-b-dark: '#282219'
  event-fixed-ink: '#4A4235'
  event-fixed-ink-dark: '#C9BDA8'
typography:
  # Figtree (SIL OFL, self-hosted) for every feature page and overlay; sizes as rendered in type-compare-1.html panel 1.
  display:
    fontFamily: Figtree
    fontSize: 26px
    fontWeight: '700'
    lineHeight: '1.25'
  title:
    fontFamily: Figtree
    fontSize: 17px
    fontWeight: '700'
    lineHeight: '1.25'
  body:
    fontFamily: Figtree
    fontSize: 13.5px
    fontWeight: '500'
  label:
    fontFamily: Figtree
    fontSize: 11.5px
    fontWeight: '700'
    letterSpacing: 0.01em
  caption:
    fontFamily: Figtree
    fontSize: 10.6px
    fontWeight: '700'
    letterSpacing: 0.06em
    note: 'uppercase'
  numerals:
    fontFamily: Figtree
    fontSize: 13.6px
    fontWeight: '600'
    note: 'font-variant-numeric: tabular-nums — every Desk figure, times, counters'
  wordmark:
    fontFamily: Montserrat
    fontWeight: '700'
    note: '"Yoh Meeseek" only — splash / Screensaver (FR-45). Size not yet specified.'
rounded:
  xs: 5px
  sm: 8px
  md: 10px
  lg: 16px
  xl: 24px
  full: 9999px
spacing:
  # [ASSUMPTION] 4px base normalizing the explorations' 6–24px paddings; confirm on key-screen mocks.
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  rim-width: 1.5px
  focus-ring-width: 2px
components:
  neumorphic-card:
    background: '{colors.surface-raised}'
    radius: '{rounded.lg}'
    shadow: '7px 7px 14px {colors.shadow-dark}, -7px -7px 14px {colors.shadow-light}'
    shadow-dark-mode: '7px 7px 16px {colors.shadow-dark-dark}, -3px -3px 10px {colors.shadow-light-dark}'
  glass-surface:
    background: '{colors.glass-fill}'
    blur: '16px (toast) / 14px (Chat Bubble), saturate 140%'
    blur-dark: '18px (toast) / 16px (Chat Bubble), saturate 140%'
    rim: '{spacing.rim-width} {colors.rim-interactive}'
  page-indicator:
    dot: '6px circle, {colors.ink-primary} at 35% opacity'
    active: '16px x 6px, {rounded.xs} corners, 135deg {colors.accent-gradient-start} -> {colors.accent-gradient-end}'
  theme-toggle:
    size: 30px
    radius: '{rounded.full}'
    border: '1px {colors.accent-solid}'
  plan-row:
    background: '{colors.surface-raised}'
    radius: '{rounded.md}'
    typography: '{typography.body}'
  checkbox:
    size: 17px
    radius: '{rounded.xs}'
    border: '{spacing.rim-width} {colors.rim-interactive}'
    checked-fill: '{colors.accent-solid}'
    checked-mark: '{colors.on-accent-solid}'
  calendar-block:
    radius: '{rounded.sm}'
    yoh-owned: '{colors.surface-raised} + small extruded shadow'
    fixed-anchor: 'stripes {colors.event-fixed-stripe-a}/{colors.event-fixed-stripe-b}, ink {colors.event-fixed-ink}, 1px {colors.rim-structural}'
    dragging: '{spacing.rim-width} {colors.accent-solid} outline'
  pin-control:
    background: '{colors.surface-sunken}'
    foreground: '{colors.event-fixed-ink}'
    radius: '{rounded.full}'
  button-primary:
    background: '{colors.accent-solid}'
    foreground: '{colors.on-accent-solid}'
    radius: '{rounded.sm}'
    typography: '{typography.label}'
  button-secondary:
    background: 'transparent'
    foreground: '{colors.ink-primary}'
    border: '{spacing.rim-width} {colors.rim-interactive}'
    radius: '{rounded.sm}'
  reshuffle-preview:
    background: '{colors.surface-raised}'
    border: '1px {colors.rim-interactive} (light) / {spacing.rim-width} {colors.rim-interactive-dark} + inset {colors.rim-highlight-dark} (dark)'
    radius: '{rounded.md}'
  chat-bubble:
    material: '{components.glass-surface}'
    radius: '{rounded.full}'
    focus: '0 0 0 {spacing.focus-ring-width} {colors.accent-solid}, 0 0 16px {colors.accent-glow}'
  chat-input:
    material: '{components.glass-surface}'
    radius: '{rounded.full}'
    focus: '0 0 0 {spacing.focus-ring-width} {colors.accent-solid}, 0 0 16px {colors.accent-glow}'
  thinking-indicator:
    text: '{typography.body}, shimmer 90deg {colors.accent-gradient-start} -> {colors.accent-gradient-end} -> {colors.accent-gradient-start}'
  undo-toast:
    material: '{components.glass-surface}'
    accent-bar: '3px left, {colors.accent-solid}'
    radius: '{rounded.md}'
  in-app-notification:
    material: '{components.glass-surface}'
    accent-bar: '3px left, {colors.accent-solid}'
    radius: '{rounded.md}'
  icon:
    stroke: '1.8px'
    neutral: '{colors.ink-secondary}'
    active: '{colors.accent-solid} stroke + 1.4px {colors.accent-solid} ring on chip'
---

## Brand & Style

Yoh is a competent peer's desk, not a productivity app's dashboard. The Phase 2 web app is where Spencer meets Yoh every day — a home-morning start, a 30-second classroom capture, a longer after-school desk session — so the surface has to feel **high-tech but minimalistic**, and every capability has to show at its best without the page getting louder (PRD §5.12). The bar the brainstorm set is "miles better than any other AI product," which in practice means *crafted*, not *busy*.

The material is **neumorphism-forward**: a warm off-white (or warm near-black) field where cards are soft extrusions of the page itself and controls are soft insets. **Glass** — translucency and blur — is reserved for the things that float above the page: the Chat Bubble, toasts, notifications. One **blue accent** runs through the system, never as a surface. Its full gradient is reserved for two signature moments (thinking, the active nav pill), and everywhere else it is a single solid blue. Motion shows what Yoh is doing (thinking, streaming, reshuffling, checking off) and is "cool, but not too much."

Inspiration named by Spencer: Meta's Muse and Apple's own apps — for *feel*. The guardrail is equally explicit: **Yoh must not read as an Apple imitation.** No SF Pro, no `system-ui` body text, no borrowed system blue, no copied control shapes.

The Phase 1 posture against gamification is **relaxed, not abandoned** (memlog override): Desk may show a streak, an on-time completion rate, and a usage heatmap, and /sandbox gives a small reward cue per card. Wording stays neutral and guilt-free. Emoji remain banned everywhere; icons and graphic UI elements are allowed. The only named celebration is a confetti moment on Spencer's birthday, February 19.

## Colors

Every color has a light and a dark value (dark mode is in scope; both modes meet WCAG 2.2 AA). The palette is two neutral families plus one accent — anything else has to earn its way in.

→ Material and base values: `.working/color-themes-1.html`, Variation 1 "Neumorphism-forward". Accent, rim specs, and measured contrasts: `.working/color-themes-2.html`, Option A "Sky → Azure" (it predates the two-use gradient limit, so it still shows the gradient on the dragging outline, icons, and toast bar). The spines win on conflict.

| Token (light / dark) | Light | Dark | Role |
|---|---|---|---|
| `{colors.surface-base}` / `-dark` | `#E7E1D7` | `#201C17` | Page field. In light mode the page and cards share one color — depth comes from shadow, as neumorphism requires. |
| `{colors.surface-raised}` / `-dark` | `#E7E1D7` | `#241F19` | Cards, Plan rows, calendar blocks. |
| `{colors.surface-sunken}` / `-dark` | `#DDD6C9` | `#1B1712` | Inset wells: segmented controls, Pin Control badge. |
| `{colors.ink-primary}` / `-dark` | `#262220` | `#EDE7DC` | All body text and labels. |
| `{colors.ink-secondary}` / `-dark` | `#6A645A` | `#A69C8C` | Captions, timestamps, placeholder, neutral icons. |
| `{colors.rim-interactive}` / `-dark` | `#807C72` | `#7A7367` | The neutral boundary on every interactive surface in both modes (see rim rule). Blue is reserved for focus and primary elements. |
| `{colors.rim-structural}` / `-dark` | `#807C72` | `#6E675B` | Non-interactive seams only (calendar rail, fixed-event outline). |
| `{colors.rim-highlight}` / `-dark` | transparent | `rgba(255,255,255,.06)` | Dark-mode inset top-edge highlight that softens the neutral rim. |
| `{colors.shadow-light}` / `-dark` | `rgba(255,255,255,.70)` | `rgba(255,255,255,.05)` | Neumorphic highlight (top-left). |
| `{colors.shadow-dark}` / `-dark` | `rgba(163,150,130,.45)` | `rgba(0,0,0,.55)` | Neumorphic shade (bottom-right). |
| `{colors.glass-fill}` / `-dark` | `rgba(255,255,255,.55)` | `rgba(255,255,255,.06)` | Floating elements only. |
| `{colors.accent-gradient-start}` → `{colors.accent-gradient-end}` | `#7FC1F5` → `#1E6FD9` | `#8FCBFA` → `#3E8CF0` | "Sky → Azure," 135°, matching the neumorphic light source. |
| `{colors.accent-solid}` / `-dark` | `#1E6FD9` | `#3E8CF0` | The gradient's dark end, clamped to one stop — for anything that carries text or a glyph. |
| `{colors.on-accent-solid}` / `-dark` | `#FFFFFF` | `#14120F` | Label/checkmark on an accent-solid fill. |
| `{colors.accent-glow}` / `-dark` | `rgba(30,111,217,.35)` | `rgba(62,140,240,.35)` | Soft glow around a focused Chat Bubble / Chat Input. |
| `{colors.event-fixed-stripe-a}` / `-b` / `-ink` | `#DCD4C4` / `#D2C8B4` / `#4A4235` | `#2E2820` / `#282219` / `#C9BDA8` | Cross-hatch + ink for non-Yoh fixed Calendar events. |

**Gradient rule.** The full two-stop sweep has exactly **two signature uses**: the Thinking Indicator shimmer and the active Page Indicator pill (the active nav pill). Every other accent uses `{colors.accent-solid}`: the dragging/moved-block outline, active icon strokes, toast accent bars, the Sandbox Finale bar, focus rings, and every text-bearing accent (the Approve button, a checked Checkbox). This supersedes the explorations' five-use list (memlog subtraction). White on the gradient's light stop measures 1.74–1.94:1 and can never pass. **Caveat:** the shimmer fills the status *text* itself, and the light stop `#7FC1F5` on `{colors.surface-raised}` measures 1.49:1 ‡. The shimmer's legibility is an open accessibility question (EXPERIENCE.md Open Questions).

**Hairline rim rule (resolves PRD OQ9).** Neumorphic shadow alone measures ~1.2:1 at the edge and fails WCAG 1.4.11. *Shadows carry depth; the rim carries the boundary.* Every interactive surface gets a `{spacing.rim-width}` rim:

- **Light:** `{colors.rim-interactive}` `#807C72`, 3.20:1 against the surface.
- **Dark:** `{colors.rim-interactive-dark}` `#7A7367` (neutral) plus an inset `{colors.rim-highlight-dark}` top edge: 3.48:1 on `{colors.surface-raised}`, 3.05:1 on glass ‡. Spencer chose the neutral 3:1 rim over the earlier accent-blue rim (pre-mortem: a blue rim on every surface drowns the accent). `{colors.accent-solid}` marks only focus and primary elements. The neutral `#6E675B` (2.92:1) is only for non-interactive seams.

**Measured contrast (load-bearing pairs).** Values marked † were measured in the `.working/` explorations; values marked ‡ were computed for this spine with the same WCAG relative-luminance method.

| Pair | Light | Dark | Threshold |
|---|---|---|---|
| ink-primary on surface-raised | 12.12:1 † | 13.28:1 ‡ | 4.5 |
| ink-secondary on surface-raised | 4.51:1 † | 6.04:1 ‡ | 4.5 |
| rim-interactive vs surface-raised | 3.20:1 † | 3.48:1 ‡ | 3.0 |
| accent-solid vs surface-raised (focus ring, checkbox) | 3.73:1 † | 4.84:1 † | 3.0 |
| on-accent-solid on accent-solid (Approve label) | 4.85:1 † | 5.53:1 † | 4.5 |
| ink-primary on glass (composited `#F4F2ED` / `#2D2A25`) | 14.09:1 ‡ | 11.61:1 ‡ | 4.5 |
| ink-secondary on glass | 5.24:1 ‡ | 5.28:1 ‡ | 4.5 |
| rim-interactive vs glass | 3.72:1 ‡ | 3.05:1 ‡ | 3.0 |
| event-fixed-ink on fixed stripe | 6.72:1 ‡ | 7.86:1 ‡ | 4.5 |

Note: the explorations rendered the light Approve label as `#FAF7F2` (4.54:1 ‡, a thin pass); the memlog decision is white `#FFFFFF` at 4.85:1, which this spine adopts.

**Avoid:** the gradient as a page or card background; a second accent hue; color as the only signal (checked = glyph + strikethrough + fade; fixed = hatch + "(fixed)" label; dragging = outline + label). No error/warning color is decided yet (see EXPERIENCE.md Open Questions).

## Typography

**Figtree** (SIL OFL, self-hosted) sets every feature page and overlay. It was chosen from `.working/type-compare-1.html` panel 1 as the free stand-in for Proxima Nova, which is out because Spencer has no webfont license (`imports/proxima-nova-specimen.png` shows the reference: near-round bowls, open apertures, grotesque-flavored numerals). Self-hosting makes it render the same on macOS and Windows; `system-ui` is never in the body stack, because on Windows it resolves to Segoe and on Mac to SF Pro (which is also the rejected Apple look). **Loading:** Figtree is preloaded, and the fallback face in the stack carries metric overrides (`size-adjust`, `ascent-override`) matched to Figtree, so the swap on a cold load causes no visible jump or layout shift.

| Role | Token | Use |
|---|---|---|
| Display | `{typography.display}` | Page heading ("Today"). One per page. |
| Title | `{typography.title}` | Card and widget headings, Sandbox Card Task name. |
| Body | `{typography.body}` | Plan rows, messages, research text. Medium weight (500), as rendered. |
| Label | `{typography.label}` | Button labels. |
| Caption | `{typography.caption}` | Uppercase section labels ("PLAN", "CALENDAR · 12–6PM"), metadata. |
| Numerals | `{typography.numerals}` | Tabular figures for every Desk metric, times, and the /sandbox remaining counter, so digits don't jitter as they update. |
| Wordmark | `{typography.wordmark}` | "Yoh Meeseek" in bold **Montserrat**, on the launch splash and Screensaver only. Montserrat never sets UI text. |

Sizes were lifted from a comparison frame roughly half the width of a laptop viewport. `[ASSUMPTION]` they carry over 1:1 to the full-size app; confirm on key-screen mocks (EXPERIENCE.md Open Questions).

## Layout & Spacing

Laptop browser, one page in view at a time, pages side by side in swipe order (Home → Chat → Tasks → Desk). Spacing uses `{spacing.1}`–`{spacing.6}` (4–32px). `[ASSUMPTION]` The 4px base normalizes the explorations' 6–24px paddings, which followed no stated scale.

- **Page frame:** `{spacing.5}` padding, `{rounded.xl}` corners on the page surface.
- **Home:** Plan checklist left, calendar day view right, Chat Bubble docked bottom-center, Page Indicator below it. (Composition: IA wireframe `.working/ia-2026-09-25.excalidraw`.)
- **Chat:** Skill Switcher as a left vertical bar, conversation stream center, Chat Input bottom.
- **Tasks:** grouped Task list left, Research Box right.
- **Desk:** widget grid. Yoh-data widgets (Tasks Completed, Worked, On-Time Rate, Streak, Usage Heatmap) and public-feed widgets (tickers, weather, news).
- **Corner chrome:** Theme Toggle in a top corner of every page.
- Rows stack at `{spacing.2}` (Plan rows at 6px as rendered); cards separate at `{spacing.3}`–`{spacing.4}`.

## Elevation & Depth

Depth comes from light, not from layering color. The light source is top-left (135°), and the gradient uses the same angle.

| Level | Recipe (light) | Recipe (dark) | Used by |
|---|---|---|---|
| Inset | `inset 1px 1px 3px {colors.shadow-dark}` | `inset 1px 1px 3px rgba(0,0,0,.5)` | Checkbox well, surface-sunken wells |
| Extruded-sm | `3px 3px 7px shadow-dark, -3px -3px 7px shadow-light` | `3px 3px 8px shadow-dark-dark, -2px -2px 6px shadow-light-dark` | Calendar blocks, icon chips |
| Extruded-md | `4px 4px 10px …, -4px -4px 10px …` | `4px 4px 12px …, -2px -2px 8px …` | Reshuffle Preview, Chat Bubble, toasts |
| Extruded-lg | `7px 7px 14px …, -7px -7px 14px …` | `7px 7px 16px …, -3px -3px 10px …` | Page cards, Desk widgets |
| Glass | `{colors.glass-fill}` + backdrop blur 14–18px, saturate 140% + rim | same with `-dark` tokens | **Floating elements only:** Chat Bubble, Chat Input, Undo Toast, In-App Notification, Command Palette |

Rules: the shadow is never the only boundary (rim rule); glass is never a page or card material; `backdrop-filter` must be verified on Windows Chromium/Edge. `[ASSUMPTION]` Where blur is unsupported, fall back to an opaque `{colors.surface-raised}` fill with the same rim.

## Shapes

Soft but not bubbly. The scale runs `{rounded.xs}` 5px (Checkbox), `{rounded.sm}` 8px (buttons, calendar blocks, icon chips), `{rounded.md}` 10px (Plan rows, toasts, Reshuffle Preview, Sandbox Card), `{rounded.lg}` 16px (cards, widgets), `{rounded.xl}` 24px (page surface), and `{rounded.full}` (Chat Bubble, Chat Input, Page Indicator active pill, Theme Toggle, Pin Control). Pills are only for things that float or navigate. Content cards are never pills.

## Components

Visual anatomy only. Behavior lives in EXPERIENCE.md Component Patterns, which uses the same names.

| Component | Visual spec |
|---|---|
| **Page Indicator** | Four 6px dots in `{colors.ink-primary}` at 35%. The active one stretches to a 16px pill filled with the accent gradient. Each dot is clickable. `[ASSUMPTION]` Position and labels are unsettled: the type exploration puts unlabeled dots at the page bottom, while the IA wireframe puts a labeled "Home · Chat · Tasks · Desk" indicator in the top bar (see EXPERIENCE.md Open Questions). |
| **Theme Toggle** | 30px circle, 1px `{colors.accent-solid}` border, Extruded-sm. Sun glyph in light mode, moon glyph in dark, stroked in `{colors.ink-primary}`. |
| **Plan Row** | `{components.plan-row}`: Checkbox, Task label in `{typography.body}`, optional Pin Control badge. Checked: checkmark + strikethrough + 50% opacity, then it fades out. |
| **Checkbox** | 17px, `{rounded.xs}`, inset well, `{spacing.rim-width}` `{colors.rim-interactive}` rim. Checked: `{colors.accent-solid}` fill with a `{colors.on-accent-solid}` checkmark. |
| **Calendar Day View** | Hour labels in `{typography.caption}` with a `{colors.rim-structural}` rail and faint hour lines. Today only. |
| **Calendar Block** | Three variants. **Yoh-owned** (Task / Work-Break / Routine): `{colors.surface-raised}`, Extruded-sm. **Fixed anchor** (non-Yoh): cross-hatch stripes, `{colors.event-fixed-ink}`, label suffixed "(fixed)", no shadow, since it can't be lifted. **Dragging**: `{colors.accent-solid}` outline at `{spacing.rim-width}` with a label "(dragging, from 2:00)". |
| **Pin Control** | A small pin glyph on a pinned Calendar Block (and a "pinned" badge on its Plan Row): `{colors.surface-sunken}` pill, `{colors.event-fixed-ink}` glyph. Clickable on the calendar block. |
| **Button** | **Primary** (Approve, Save): solid `{colors.accent-solid}`, `{colors.on-accent-solid}` label. **Secondary** (Discard, Skip, Undo): transparent, `{colors.ink-primary}` label, `{colors.rim-interactive}` rim. Never gradient-filled. |
| **Reshuffle Preview** | `{components.reshuffle-preview}` card under the calendar: one-line summary (`{typography.body}` 600), then Primary "Approve" and Secondary "Discard". `[ASSUMPTION]` Moved blocks reuse the dragging accent-solid outline and unchanged blocks stay plain. Deferred Tasks are listed by name in the summary. |
| **Chat Bubble** | Home only. A glass pill with a "/" chip and the placeholder "Ask Yoh, or type / for commands". Collapsed, it is small and centered; it expands wide on hover or focus. Focus adds a 2px accent-solid ring plus `{colors.accent-glow}`. |
| **Chat Input** | Chat page composer, with the same material and focus treatment as the Chat Bubble. Always wide. |
| **Chat Message** | Spencer's turns are right-aligned on `{colors.surface-sunken}`. Yoh's turns are left-aligned, flat on the page in `{typography.body}`. `[ASSUMPTION]` alignment follows chat convention and has not been mocked. Write receipts are one line in `{typography.caption}`. |
| **Thinking Indicator** | A dot-matrix loader plus status text ("Thinking…", "Searching Notion…") in a shimmering accent gradient. Reduced motion: static `{colors.ink-secondary}` text. |
| **Command Palette** | A glass panel rising from the Chat Input. Each row shows the command in `{typography.body}` 600, a one-line description, and an example in `{typography.caption}`. The highlighted row has a `{colors.accent-solid}` 1.5px rim. |
| **Structured Question** | Inline in the stream: the question in `{typography.body}`, selectable option chips, and a free-text "Other" field. `[ASSUMPTION]` Chips use the Secondary button style and flip to Primary when selected. |
| **Skill Switcher** | **Hidden in Phase 2** (only General chat exists). Chat's layout reserves the left-bar space. When a second skill (Goals) exists, it becomes a left vertical bar of entries (icon + label) using the active Icon treatment for the active skill. |
| **Sandbox Card** | A Yoh message card (`{components.neumorphic-card}` at `{rounded.md}`): Task name in `{typography.title}`, Required fields (Due Date, Estimated Duration) with rims, optional Refining fields (Area, Energy), Secondary "Skip" and Primary "Save", and a "N remaining" counter in `{typography.numerals}`. Saved: a single accent-solid pulse on the rim, then a settled "Saved" state. |
| **Sandbox Finale** | A horizontal loading bar filled with `{colors.accent-solid}`, right-aligned in the stream. Ends when the writes confirm. |
| **Undo Toast** | Glass, 3px accent-solid left bar: "Checked off Chem problem set · Undo". `[ASSUMPTION]` Undo is a Secondary button. accent-solid text would fail at 3.73:1. |
| **In-App Notification** | Glass, 3px accent-solid left bar, pulsing accent dot, one-line message, whole surface clickable. Failure variants use the same shape; the words carry the failure (no color decided). |
| **Needs-Data Indicator** | `[ASSUMPTION]` A persistent count on Tasks ("3 need data") in `{typography.numerals}`, inside a Secondary-button-style rim. |
| **Task Group** | A Tasks page section: `{typography.caption}` group header (e.g. "AREA: SCHOOL") over Task rows (name + due date in `{typography.body}`). |
| **Grouping Control** | `[ASSUMPTION]` A segmented control, reusing the explorations' inset nav-pill styling, in a `{colors.surface-sunken}` well: Area · Due Date · Energy · Status. The active segment is a `{colors.accent-solid}` pill with an `{colors.on-accent-solid}` label (it carries text). |
| **Research Box** | A card on Tasks: the latest research output up front (`{typography.title}` heading, body text, source list), then the Research Vault library as rows below. |
| **Desk Widget** | A `{components.neumorphic-card}` with a `{typography.caption}` header and a value in `{typography.numerals}` (larger values may use `{typography.display}` size with tabular figures). Variants: Tasks Completed (a scrollable list of checked, struck-through rows), Worked (a single widget: today's minutes as the primary figure, all-time hours with Yoh as a secondary `{typography.caption}` line), On-Time Rate, Streak ("Streak: 1 day" / "Longest: 12 days"), Usage Heatmap (weeks × 7 days; `[ASSUMPTION]` accent-solid at stepped opacities, not yet rendered), and Feed widgets (tickers, weather, news). An unavailable feed shows "Unavailable · last updated 2:14 PM" in `{colors.ink-secondary}`. |
| **Screensaver** | Full-bleed `{colors.surface-base}` field of drifting gradient dots at varied transparency (FR-45; `[ASSUMPTION]` colored from the accent stops), with the "Yoh Meeseek" wordmark centered in `{typography.wordmark}`. Shows no data. |
| **Birthday Confetti** | On Feb 19 only: a one-shot confetti burst on Home. `[ASSUMPTION]` Confetti uses `{colors.accent-solid}` plus neutral inks. No emoji. |
| **Icon** | A line icon set, 1.8px stroke, round caps. Neutral in `{colors.ink-secondary}`; active in a `{colors.accent-solid}` stroke. Icons only, never emoji. |
| **Push Notification** | OS-level phone notification (Pushover), carried over from Phase 1. Plain text, so no Yoh styling applies. The title names the Ritual; the body is the Plan reasoning line or a close-out cue. |

**State-tied motion.** Every animation corresponds to a state change. The durations below are as rendered in the explorations.

| Motion | Trigger | Spec | Reduced motion |
|---|---|---|---|
| Check-off dissolve | Checkbox checked | fade/dissolve of the Plan Row | instant hide |
| Reshuffle animation | Drag release → preview | blocks glide to proposed slots; dragging block gently bobs (2.6s ease-in-out, 1.5px) | cross-fade to final layout |
| Thinking shimmer | Yoh working | gradient sweep across status text, 2.8s linear loop | static text |
| Streaming text | Yoh responding | text renders as it arrives | same (not decorative) |
| Toast enter | toast / notification appears | 0.55s ease-out, 5px drop + fade; dot pulse 2.2s | fade only, no pulse |
| Page transition | swipe / indicator / arrow key | pages slide side-by-side, following the swipe direction | cross-fade |
| Sandbox reward pulse | every card saved | single rim pulse in accent-solid (a sound plays once, when the batch is cleared, not per card; mute respected) | no pulse; "Saved" text only |
| Screensaver drift | launch / 10-min idle | slow fluid dot movement | static dot field |
| Birthday confetti | Feb 19 on Home (`[ASSUMPTION]` first Home view that day) | one short burst | skipped |

## Do's and Don'ts

| Do | Don't |
|---|---|
| Give every interactive edge a neutral `{spacing.rim-width}` rim (light `#807C72`, dark `#7A7367` + highlight); keep blue for focus and primary | Rely on neumorphic shadow alone for a boundary (~1.2:1) |
| Use the full gradient only for the thinking shimmer and active nav pill | Use it anywhere else, put a label on a gradient fill, or use it as a page/card background |
| Use `{colors.accent-solid}` + `{colors.on-accent-solid}` for text-bearing accents | Add a second accent hue |
| Reserve glass for floating elements | Make cards or pages glass |
| Set UI in self-hosted Figtree with tabular figures on Desk numerals | Use `system-ui`, SF Pro, or anything that renders differently on Windows vs Mac |
| Use Montserrat bold only for the "Yoh Meeseek" wordmark | Set body or headings in Montserrat |
| Use icons and graphic elements | Use emoji anywhere |
| Show streak, completion rate, heatmap, and the /sandbox pulse in neutral wording ("Streak: 1 day · Longest: 12 days") | Add guilt copy, broken-streak alarms, badges, levels, or celebrations beyond the Feb 19 confetti |
| Tie every animation to a state change and honor reduced motion | Animate for decoration, or convey information by motion alone |
| Take Apple and Muse as inspiration for feel | Copy Apple: system blue, SF Pro, cloned control shapes |
| Verify rendering on Windows Chromium/Edge and macOS | Ship a blur-, font-, or swipe-dependent detail untested on Windows |
| Pair every color cue with a glyph or word | Let color alone mean checked, fixed, moved, or failed |

---

## CLI (until retirement)

The Phase 1 terminal surface stays live until FR-50's parity checklist (FR-42) is complete. **Rituals are unaffected by retirement:** the Morning Plan Push Notification (FR-1) and the Night Ritual's push-then-email escalation (FR-13) keep running unattended. These tokens apply only to terminal output. They are advisory, and they degrade to the nearest 256-color ANSI entry or to plain text.

| CLI token | Value | Role |
|---|---|---|
| text-default | terminal-inherited | Body text. Yoh never overrides it. |
| accent | `#5FAFFF` | Section labels only (Plan header, prompt label). |
| attention | `#D08A3E` | Escalation moments only (unchecked-day flag). An amber, deliberately not red. |
| muted | `#6B6B6B` | The Plan reasoning line (FR-3) and the between-turns rule in `chat-cli.ts`. |

- **Rendering:** 256-color ANSI escapes (not truecolor, which Terminal.app renders unreliably). No font is set. Wrap at ~80ch with one blank line between units. Chat replies render markdown bold, italic, and headings as real terminal styling. A muted full-width rule between chat turns is the only divider allowed.
- **CLI components:** **CLI Plan Block** (one line per item: time range, then item; label in accent), **CLI Reasoning Line** (muted, under the block list), **CLI Prompt** (accent-labeled line, then an inline wait), **CLI Escalation Marker** (attention color, once per occurrence).
- **CLI rules:** no emoji, no ASCII art, no progress bars, and color is never the only signal. The Phase 1 no-gamification ban still applies *inside the CLI*; the relaxed rule covers the web app only.

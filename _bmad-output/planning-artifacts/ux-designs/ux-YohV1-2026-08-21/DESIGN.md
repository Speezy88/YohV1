



1
---
name: Yoh
description: A personal daily-planning CLI. Plain-spoken, unhurried, no gamification — output reads like a peer's summary, not a dashboard.
status: draft
created: 2026-08-21
updated: 2026-08-22
colors:
  text-default: 'terminal-inherited'
  accent: '#5FAFFF'
  attention: '#D08A3E'
  muted: '#6B6B6B'
typography:
  body:
    note: 'Terminal-inherited — Yoh does not set a font. Output assumes a monospace terminal at the user'"'"'s own theme (light or dark).'
spacing:
  wrap-width: '80ch'
  block-gap: '1 blank line'
components:
  plan-block:
    label-color: '{colors.accent}'
    body-color: '{colors.text-default}'
  reasoning-line:
    color: '{colors.muted}'
  prompt:
    label-color: '{colors.accent}'
  escalation-marker:
    color: '{colors.attention}'
  notification:
    title-emphasis: '{colors.accent}'
---

## Brand & Style

Yoh looks like a competent peer's morning text, not a productivity app. There is no dashboard, no progress bar, no streak counter, no celebratory flourish when a task completes — the brief and PRD are explicit that gamification and nagging are exactly the failure modes this rebuild is designed against, and the visual register has to hold that line as much as the behavior does. Output is plain, scannable, and quiet by default; it earns attention through clarity and a good reasoning line, not through color, emoji, or decoration. `[ASSUMPTION: no source material states a visual philosophy directly — this is inferred from the brief's "What's Different From Version One" and the PRD's Tone requirements (FR-18–FR-19), which describe the voice this visual language has to match. Confirm or correct.]`

## Colors

Because Yoh renders in whatever terminal and theme Spencer is already using, these are **advisory** tokens, not guaranteed pixels — they render close-enough on a truecolor terminal and degrade to the nearest ANSI color (or plain text) on anything more limited. Rationale per token:

- `{colors.text-default}` — inherits the terminal's own foreground. Yoh never overrides base body text color; this is a deliberate non-decision, not an oversight.
- `{colors.accent}` — a single blue, used only for section labels (a Plan's header, a prompt's label) so the eye finds structure fast. Not used for emphasis within body text.
- `{colors.attention}` — a warm amber reserved for the one moment escalation is visually marked (Night Ritual's second attempt, an unchecked-day flag). Deliberately not red — Yoh escalates under strain (per the Glossary's Escalate-Under-Strain), it doesn't alarm.
- `{colors.muted}` — used only for the one-line Plan reasoning (FR-3), so the "why" reads as a quiet aside under the Plan, not a competing headline.

**Do not** use color as the *only* signal for anything meaningful (escalation, a slipped task, an unchecked day) — some terminals and some color-vision types won't render or distinguish it. Pair every color cue with plain-text wording that carries the same meaning on its own.

## Typography

No font is set — Yoh inherits whatever monospace font and size the terminal is configured with. The only typographic tool available is structure: bold (via the terminal's own bold rendering) for the section label, plain weight for everything else. `[ASSUMPTION: whether Yoh uses terminal bold/underline at all, or renders everything at a single weight, is unconfirmed — default assumed here is a single bold label per section, nothing else.]`

## Layout & Spacing

- `{spacing.wrap-width}` — body text wraps at roughly 80 characters so output stays readable in a standard terminal window without the user resizing.
- `{spacing.block-gap}` — one blank line separates each structural unit (the Plan header from its block list, the block list from the reasoning line, one prompt from the next) — enough to scan, not so much that a short Plan feels sparse.
- No box-drawing characters, rules, or ASCII dividers by default — structure comes from blank-line spacing and the accent-colored label, not decoration. `[ASSUMPTION: confirm this preference — some CLI tools do use a light box-drawing rule under a header; Yoh's brand posture argues against it, but it's a real style choice worth explicitly signing off on.]`

## Components

- **Plan block** (`{components.plan-block}`) — one line per Task or fixed Calendar event, in Plan order: time range, then the item, nothing else on the line. The Plan's label ("Today's Plan," or similar) renders in `{colors.accent}`; each block line renders in `{colors.text-default}`.
- **Reasoning line** (`{components.reasoning-line}`) — the one required sentence explaining what leads the Plan (FR-3), rendered in `{colors.muted}` directly under the block list, not interleaved with it.
- **Prompt** (`{components.prompt}`) — any place Yoh asks for input (a missing field, a close-out confirmation, a Self-Check score) opens with a `{colors.accent}`-labeled line naming what it needs, then waits inline — no separate modal or multi-step wizard framing.
- **Escalation marker** (`{components.escalation-marker}`) — the visual cue used exactly once per occurrence: the Night Ritual's second attempt, and an unchecked-day flag the next morning. Never used for routine Plan content.
- **Notification** (`{components.notification}`) — the phone-side push notification's title uses `{colors.accent}` where the platform supports styled notification text; body text is the Plan's reasoning line or a short close-out cue. `[ASSUMPTION: the notification's exact rendering depends on the still-open delivery mechanism (see EXPERIENCE.md Foundation) — this spec covers intended content and emphasis, not a guaranteed rendering, since the transport isn't chosen yet.]`

## Do's and Don'ts

- **Do** keep every screen's worth of output scannable in one glance — a Plan, a prompt, a close-out summary should each read in a few seconds, not require scrolling back up.
- **Do** pair any color cue with plain wording — never let color alone carry meaning.
- **Do** reserve `{colors.attention}` for genuine escalation moments (§Components) — using it more broadly would blunt the one signal it's meant to carry.
- **Don't** use emoji, ASCII art, or celebratory flourishes on task completion — this is the specific gamification failure mode the brief names as part of why v1 was abandoned.
- **Don't** introduce a third accent color, a progress bar, or any persistent status widget — Yoh's output is a message, not a dashboard.
- **Don't** assume truecolor terminal support — everything must degrade gracefully to plain text with no color at all.

---
name: Yoh
status: draft
sources:
  - _bmad-output/planning-artifacts/briefs/brief-YohV1-2026-08-21/brief.md
  - _bmad-output/planning-artifacts/briefs/brief-YohV1-2026-08-21/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md
  - _bmad-output/planning-artifacts/research/technical-yoh-voice-pipeline-and-notion-calendar-a-2026-08-21/research.md
  - _bmad-output/brainstorming/brainstorm-yoh-notion-daily-assistant-2026-08-21/brainstorm-intent.md
created: 2026-08-21
updated: 2026-08-22
---

# Yoh — Experience Spine

> Phase 1 only. Single-user, terminal/CLI, typed-text interaction — no voice, no GUI. Web app (Phase 2), physical hardware (Phase 3), and iOS app (Phase 4) are explicitly out of scope for this pass; this spine will be extended via Update mode once Spencer brings visual/interaction context for those. Paired with `DESIGN.md`.

## Foundation

Single primary surface: the **terminal/CLI**, typed text only. No GUI framework, no voice input in Phase 1 (confirmed directly with Spencer — the PRD's "voice or chat" language for Time Budget changes is roadmap phrasing that doesn't apply yet). No UI system — this is raw terminal output; `DESIGN.md` is the visual identity reference (colors, spacing, component rendering).

A **secondary touchpoint** exists: a phone push notification, used for the Morning Plan alert (FR-1) and the Night Ritual's second escalation attempt (FR-13). `[ASSUMPTION / OPEN: the delivery mechanism for this notification is unresolved — confirmed open with Spencer, mirrors the PRD's existing FR-13 dependency gap (Open Questions §11.1). This spine specifies the notification's content and behavior; the transport (Pushover, ntfy, a Shortcut, etc.) is an architecture decision, not a UX one, and should be resolved before FR-1/FR-13 are built.]`

Single-user means no auth flow, no account switching, no permissions model — every journey below starts from "Spencer, already the only user there is."

## Information Architecture

Not screens — **touchpoints**, since the surface is a CLI:

| Touchpoint | Reached from | Purpose |
|---|---|---|
| Morning Plan | Auto-delivered (push notification) each morning; also viewable on demand via a `yoh` chat query (e.g., "what's my plan") | Deliver the day's ordered Plan + one-line reasoning (FR-1–FR-3) |
| Data-Completeness prompt | Auto-triggered mid-Morning-Ritual when a Task is missing a required field | Ask for exactly the missing field(s), nothing more (FR-4) |
| Chat / command interaction | Spencer opens the terminal and types, any time | Free-text home for Mid-Day Re-Flow, Blocker reports, Time Budget changes, general questions (FR-5, FR-9, FR-10) |
| Night close-out prompt | Auto-triggered at day's end; escalates via push notification if unacknowledged | Confirm what completed/slipped; escalate (capped at 2) if ignored (FR-12–FR-14) |
| Self-Check prompt | Auto-triggered ~every 4 days, randomized time | Collect a score + short reason on how Yoh is doing (FR-17) |
| Propose-Don't-Impose confirmation | Auto-triggered whenever Yoh has a learned pattern, budget suggestion, or Blocker-handling decision to surface | Get explicit yes/no before acting (FR-16) |

`[ASSUMPTION: exact CLI invocation syntax (a persistent chat session vs. discrete commands like `yoh plan` / `yoh close`) is not specified anywhere in the sources. This spine assumes an always-available, persistent chat-style session — matching the "casual peer-level secretary" framing (Glossary: Tone) more than a command-flag tool would. Confirm before this becomes an interaction contract for architecture.]`

Surface closure check: every FR in the PRD's §5 Features lands on one of the six touchpoints above; every touchpoint above is reached by at least one Key Flow below.

## Voice and Tone

Governed entirely by the PRD's Glossary **Tone** definition and FR-18–FR-19 — this section adds the CLI-specific behavior, not a new voice:

- **Default register:** casual, peer-level — like a competent friend giving you the rundown, not a corporate assistant or a drill sergeant.
- **Factual/intellectual questions:** switches to concise, educational register. Explicitly avoids the "it's not just X, it's Y" rhetorical framing (a specific brainstorm decision — treat this as a hard style rule, not a preference).
- **Escalation:** urgency rises *only* as a function of Slip-Bump / Escalate-Under-Strain (FR-19) — never from a fixed schedule, randomness, or how the CLI session "feels." Two identical slip histories must read with identical urgency, regardless of day or mood.
- **What Yoh never does:** nag about an already-acknowledged slip, editorialize on a reported Blocker (FR-10 — reschedule only, no commentary), or use urgency language before Escalate-Under-Strain actually warrants it.
- **Silence is a feature.** Per the Morning Ritual (FR-1) and Mid-Day Re-Flow (FR-9): Yoh disengages after delivering the Plan and does not fill the silence with check-ins. In a chat-style CLI, this means literally no output between the Morning Plan and whatever Spencer next initiates — resist the urge to add ambient "still there" messages.

## Component Patterns

Behavioral specs — visual anatomy lives in `DESIGN.md` Components.

- **Plan delivery:** one notification, one CLI-viewable Plan, always includes the reasoning line (FR-3). Never split across multiple messages; never sent twice.
- **Data-Completeness prompt:** asks for exactly the field(s) missing on the Task(s) actually in play for today — never a bulk "clean up your whole database" request. One prompt can cover multiple missing fields across multiple Tasks if more than one is incomplete, but never asks about a field Yoh doesn't currently need.
- **Mid-Day Re-Flow:** Spencer-initiated only (no proactive check-in, FR-9). On trigger, Yoh re-fits only the remaining, not-yet-completed blocks and shows the updated remainder — it does not re-explain or re-justify the whole day.
- **Blocker report:** Spencer states the blocker in plain language; Yoh's response is limited to the schedule change it makes (FR-10) — a single confirmation line, not a discussion.
- **Night close-out:** first attempt is a simple confirm prompt. If unacknowledged, the second (capped, FR-13) attempt escalates in channel and in `DESIGN.md`'s `{colors.attention}` marker — but the wording escalates in directness, not in volume of text or alarm language.
- **Unchecked-day flag:** the next Morning Plan visibly marks that last night wasn't closed and states which mandatory Blocker(s) rolled forward (FR-14) — this is informational, delivered once, not a standing reminder that repeats every morning until dismissed.
- **Self-Check prompt:** requires both a number and a short written reason to be considered answered (FR-17) — a bare number is treated as incomplete.
- **Propose-Don't-Impose confirmation:** every instance follows the same shape — state what Yoh wants to do, wait for explicit yes/no, never assume silence means consent (distinct from the Morning Ritual's intentional silence, which is the *absence* of a question, not an unanswered one).

## State Patterns

- **Cold start:** first run has no Hot Memory and a near-empty Cold Memory. `[ASSUMPTION: no source material describes first-run behavior — treated as an open item, not invented. Does Yoh say anything different on day one, or does the Morning Ritual just run as normal with fewer inputs? Flagged for confirmation.]`
- **Day states:** a day is exactly one of *planned* → *in-progress* → *closed* or *unchecked*. `Unchecked` is a real, visible terminal state (FR-14) — not silently equivalent to `closed`.
- **Task states (within a Plan):** *scheduled*, *completed*, *slipped*. A slipped Task carries its Slip-Bump forward until it completes, at which point the bump clears (FR-11) — the CLI should be able to show this lineage if asked ("why is X prioritized today"), consistent with the Plan reasoning line's transparency principle (FR-3).
- **Confirmation-pending state:** whenever a Propose-Don't-Impose prompt is open (FR-16), Yoh treats that as a blocking question in the chat flow — it doesn't queue silently in the background waiting for a reply while also accepting unrelated commands, since that risks Spencer answering the wrong question.

## Interaction Primitives

- **Input:** free-text typed chat, not a fixed command grammar. `[ASSUMPTION — see Information Architecture — natural-language chat assumed over discrete slash-style commands; unconfirmed.]`
- **Output:** structured plain text per `DESIGN.md` Components — a labeled block, then content, then (where relevant) a reasoning line.
- **Confirmation:** yes/no in plain language (Propose-Don't-Impose, Self-Check acceptance) — no numbered menus or keybinding shortcuts implied anywhere in the source material.
- **Interruption:** Spencer can always initiate (Mid-Day Re-Flow, a Blocker report, a question) — Yoh never has to be "exited" from a mode to do this, consistent with a persistent chat session rather than modal states.

## Accessibility Floor

- Plain monospace text is inherently screen-reader-compatible — no image-only content, no meaning conveyed through layout alone.
- Per `DESIGN.md`: no meaning is carried by color alone; every colored cue (accent labels, the attention marker) has plain-text wording that stands on its own if color doesn't render.
- Output wraps at a readable width (`DESIGN.md` `{spacing.wrap-width}`) rather than relying on terminal auto-wrap mid-word.
- No timing-dependent interactions — every prompt (Data-Completeness, Night close-out, Self-Check, Propose-Don't-Impose) waits indefinitely for Spencer's response within its own escalation rules (FR-13's cap is about *retries*, not a response deadline that expires the prompt itself).

## Key Flows

Mirrors the PRD's UJ-1–UJ-3 (§3.3) with CLI-specific texture; IDs kept identical for traceability.

- **UJ-1. Spencer starts his day with a Plan he didn't have to build.**
  Phone buzzes with the Morning Plan notification before Spencer's even out of bed. He doesn't open the terminal — the notification's own text is enough: today's ordered blocks and the one-line reason leading them. **Climax:** he reads it in the time it takes to sit up, not a full app open. **Resolution:** he puts the phone down; Yoh says nothing else all day unless he starts something.

- **UJ-2. A task slips, and Spencer adjusts mid-day without a fight.**
  Late morning, a task ran long. Spencer opens the terminal (not because Yoh asked — nothing did) and types that it's running behind. Yoh re-fits the rest of the day in one reply — no re-litigating the morning's choices. **Climax:** the updated remainder appears in one short block, and Spencer's back to work in seconds. **Resolution:** the slipped task is already carrying its Slip-Bump toward tomorrow; nothing further to do tonight.

- **UJ-3. Spencer closes the day, or Yoh notices he didn't.**
  Evening: a close-out prompt lands. Spencer's out; it goes unanswered. A couple hours later, a second, more direct notification lands (`DESIGN.md` `{colors.attention}` marker) — then nothing more that night. **Climax:** no third ping, no growing pile of unanswered notifications by morning. **Resolution:** tomorrow's Plan opens with a plain note that last night was unchecked and what's rolling forward — read once, not re-shown.

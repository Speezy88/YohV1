---
title: Input Reconciliation — Phase 2 Web App UI Brainstorm vs. PRD/Addendum
created: 2026-09-24
status: findings only — no PRD/addendum edits made
---

**Superseded 2026-09-27: swipe retired; Chat is a panel; pages are Home, Tasks, Desk, Research Hub.**

# Input Reconciliation: Phase 2 Brainstorm → PRD + Addendum

Scope: compares `_bmad-output/brainstorming/brainstorm-phase2-web-app-ui-2026-09-24/brainstorm-intent.md` (primary) and its `.memlog.md` (raw source) against `prd.md` §5.9–§5.13 (FR-30–FR-51) + related §1/§2/§3.3/§4/FR-2/FR-4/FR-23/FR-24/§6–§12, and `addendum.md` § Phase 2: Web App — Technical Notes. Per instructions, the following are **deliberate, memlogged overrides** and are NOT reported as gaps below: checked tasks are not deleted from Notion (C-3); `/sandbox` requires only Due Date + Estimated Duration (O-1); drag only moves Yoh-owned blocks (C-1); Pins are today-only (Pin decision); Routines are Yoh-stored (C-4); feeds are free-tier only with BTC/SOL/ETH + business/AI news (C-6).

Method: read both brainstorm files line-by-line, traced every idea/insight/decision to a PRD/addendum location, and flagged (a) qualitative content the FR structure lost or flattened, (b) PRD/addendum claims with no traceable source or memlog decision, and (c) consistency against `epics.md` and the PRD's own FR-27/FR-22.

---

## Gaps and Distortions

### 1. General inter-page navigation mechanism is unspecified — HIGH

- **Source:** raw `.memlog.md` line 12 — `(direction) Swipe left moves between pages.` This was the stated general navigation mechanism between P1–P4 in the raw brainstorm.
- **PRD location:** absent. §5.11 (FR-39–FR-45) specifies how Home→Chat happens (chat-bubble Enter, FR-40) and how notifications deep-link to a target page (FR-49, FR-34, FR-51), but nowhere specifies how Spencer reaches Tasks (P3) or Desk (P4) under ordinary use — there is no click path, swipe, tab bar, or menu item that gets him there absent a notification. FR-42's "left vertical menu bar ships empty as a placeholder" (§9.4) is the only candidate surface, and its contents are explicitly deferred, not filled by a nav affordance.
- **Why it matters:** without *some* general navigation mechanism, three of the four pages (Tasks, Desk, and Chat when not entered via the bubble) are only reachable by notification — which contradicts the "one job per page" model's premise that Spencer deliberately visits Desk to reflect (UJ-6) or Tasks to browse (UJ-5's implicit browsing use). This also isn't listed among §11 Open Question 13's "design details deferred to UX" (Command Palette depth, undo window, unpin gesture, Tasks grouping, needs-data tray) — the omission itself was never flagged as an open question, so a future reader won't know to resolve it.
- **Suggested fix:** add general navigation to Open Question 13 (or its own item), and add a consequence bullet to FR-40 or a new FR under §5.11 stating a navigation mechanism exists (even if its exact form — menu bar, tabs, swipe — is left to `bmad-ux`).

### 2. Competitive/ambition framing behind the anti-clutter strategy is dropped — MEDIUM

- **Source:** raw `.memlog.md` lines 53–54 — `[Red Hat] Never want the feeling that Yoh is 'stupid / not smart' - the effort invested must pay off as miles better than any other AI product` and `[Red Hat] Every capability built must be exhibited at the highest level, right in front of the user, without the UI getting cluttered`.
- **PRD location:** the *mechanic* survives (§5.11 Description: "one job per page"; §5.12: "anti-clutter strategy is structural: one job per page... and slash commands instead of buttons"; FR-44 Desk: "surface everything the system can provide"), but the *stakes* behind it — that Phase 2 must read as decisively better than competing AI products, not merely "uncluttered" — never appears in §1 Vision, §2 Why Now, or §5.11/§5.12. The "stupid" framing that *did* survive (§2: "the 'stupid plan' failure") is about plan quality/life-context, a different Red Hat insight from this one; the competitive-bar insight is a separate idea that didn't make the same trip.
- **Why it matters:** this is exactly the kind of qualitative, motivating context an FR checklist tends to lose — it changes how "done" should be judged (a competent-but-generic Phase 2 would technically satisfy every FR while still failing this bar).
- **Suggested fix:** a line in §1 Vision or §5.11's Description carrying the "must read as decisively better, not just tidy" ambition forward, even non-testably (matching how §1 already carries similar aspirational framing for Phase 1).

### 3. "Feel high-tech but minimalistic" is not preserved as a design goal — LOW/MEDIUM

- **Source:** raw `.memlog.md` line 9 — `(direction) Must integrate seamlessly with all built and planned Yoh features; feel high-tech but minimalistic`. This is a top-level direction for the whole Phase 2 surface, stated before any page-specific detail.
- **PRD location:** absent from both `brainstorm-intent.md` (already dropped at the distillation stage) and the PRD. §5.12 Design System describes tokens (off-white/black, neumorphism, Montserrat, motion) but never states the "high-tech" register those tokens are supposed to produce — a reader implementing §5.12 literally could land on "minimalistic" without "high-tech," or vice versa, and the FR text wouldn't catch it.
- **Suggested fix:** one line in §5.12's Description naming the target feel ("high-tech, minimalistic") alongside the token list, so it's checkable against the finished UI even without a numeric test.

### 4. `epics.md`/shipped Epic 1 still encodes the pre-Phase-2 FR-4 (all five fields gating) — LOW/MEDIUM

- **Source:** PRD's own FR-4 Notes: *"Changed 2026-09-24: through Phase 1.5 all five fields... were gating; the two-tier split replaces that so one missing Energy value no longer keeps a Task off the Plan."*
- **PRD/epics location:** `epics.md` line 30 still reads `FR-4: Data-Completeness Gate — before including a Task in a Plan, verify required fields (Estimated Duration, Area, Due Date, Status, Energy) are set` — the old all-gating description, matching the already-shipped Epic 1 code, not the new Required/Refining split.
- **Why it matters:** this is a genuine behavior change to an already-`done` epic (not just new Phase 2 surface), yet §11 Open Question 8 ("architecture spine is stale for Phase 2") only names AD-3/AD-5/AD-12 — it doesn't flag that shipped FR-4 behavior itself now diverges from the PRD. A future `bmad-architecture` or `bmad-create-epics-and-stories` pass could miss it if working only from Open Question 8's list.
- **Suggested fix:** add FR-4's behavior change to Open Question 8 (or a new item) so it's picked up as a rework item against Epic 1, not just new Phase 2 epics.

---

## PRD Claims Not Directly Sourced (invented specificity)

None of these contradict the brainstorm — they're reasonable PM judgment calls — but unlike similar Phase 2 specifics elsewhere in the PRD, they are **not** tagged `[ASSUMPTION]` or listed in §12's Phase 2 inline-assumptions list, which is otherwise fairly complete. Flagging for consistency with the PRD's own tagging discipline, not as scope errors.

### 5. WCAG 2.2 AA as the specific accessibility standard — LOW

- **Source:** brainstorm only says "needs a contrast/accessibility check" (`brainstorm-intent.md`, Open Questions) — no standard named.
- **PRD location:** §6 Accessibility NFR: "must still meet WCAG 2.2 AA contrast." Reasonable, but invented relative to the source and not tagged, while the adjacent numeric targets in the same NFR paragraph *are* tagged `[ASSUMPTION]`.
- **Suggested fix:** either tag it or note in §12 that the specific WCAG version is a PM-supplied standard, not a brainstorm output.

### 6. On-time completion rate's operational definition — LOW

- **Source:** brainstorm only says "task on-time completion rate" widget (`brainstorm-intent.md` §Confirmed page map, P4) — no definition given.
- **PRD location:** FR-44 consequence: "counts a completed Task as on-time when its completion time is on or before its Due Date." Reasonable default, invented, untagged (unlike FR-44's sibling Open Question 10 on "hours worked with Yoh," which *is* tracked).
- **Suggested fix:** add to §12 or §11 alongside Open Question 10 for symmetry, or explicitly confirm with Spencer since it's a scoring rule people can disagree about (e.g., "due by end of day" vs. "due by declared time").

---

## Consistency Checks (as requested)

- **FR-27 vs. FR-22 vs. new Phase 2 FRs:** no contradiction found. FR-33 explicitly reconciles the new reshuffle mechanic with the existing ownership boundary — "A reshuffle never moves, resizes, or deletes a Calendar event Yoh did not create... Editing a non-Yoh event remains possible only through FR-27's chat path" — and FR-32's consequence states FR-27's per-event confirmation "never triggers here" because reshuffles only ever touch Yoh-owned blocks. This matches memlog decision C-1 exactly. Confirmed consistent.
- **`epics.md` vs. Phase 2 FRs generally:** no Phase 2 epics/stories exist yet (expected — `bmad-create-epics-and-stories` hasn't run for FR-30–FR-51; PRD's own Open Question 8 already flags the architecture spine as stale for Phase 2). The one concrete divergence found beyond that expected staleness is item 4 above (FR-4's shipped-vs-current behavior gap on an already-`done` epic).

---

## Summary Count

- 4 gaps/distortions (1 high, 1 medium, 2 low/medium)
- 2 untagged-invented-specificity findings (both low)
- 2 consistency checks run, both resolved (1 confirmed-consistent, 1 pre-existing-and-tracked staleness with one refinement suggested)

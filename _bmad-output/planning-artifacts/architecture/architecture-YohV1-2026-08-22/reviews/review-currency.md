---
review: currency (web-verification vs. training-data assertion)
target: ARCHITECTURE-SPINE.md + .memlog.md
date: 2026-08-22
reviewer: claude (subagent)
---

# Currency Review — Yoh Architecture Spine

## Verdict

Every Stack-table entry does have a corresponding `(version)` memlog entry claiming a web search, and five independent live spot-checks today (nodemailer, TypeScript 7.0.2, Node 24.12 type-stripping, better-sqlite3, @googleapis/calendar + google-auth-library) all confirm the claimed numbers were real and current as of 2026-08-22 — this is genuinely web-verified work, not training-data pattern-matching, and that includes several facts (TS7 GA, its exact 7.0.2 patch, Node 24.12 stripping going stable) that would be essentially impossible to fabricate correctly by coincidence given the model's pre-2026 training cutoff. The gaps that exist are minor: one Stack row (`node:test`/`node:assert`) has only a `(decision)` entry with no web-verification trail, the memlog's verification entries record no source URLs (so the trail is asserted, not auditable), and the TypeScript GA date cited (2026-08-05) doesn't match the date range found in today's spot-check (July 8 RC / Aug 3 GA per most sources) — a precision slip, not a fabrication.

## Stack-by-stack trace

| Stack entry | Memlog backing | Type | Spot-check today | Result |
| --- | --- | --- | --- | --- |
| Node.js 24.12+ | line 14 | `(version)` "Verified 2026-08-22 via web search" | WebSearch: Node 24.12.0 shipped type-stripping as Stable | **Confirmed.** LTS-through-Apr-2028 claim also matches Node's standard 30-month LTS math from an Oct-2025 LTS start — internally consistent, not fabricated. |
| TypeScript 7.0.2 | line 14 | `(version)` | WebSearch + WebFetch (InfoQ) + npm/GitHub issue #63649 | **Confirmed** as real, current, GA, Go-native, ~10x. **GA date discrepancy:** memlog says 2026-08-05; live sources today say July 8 (RC) / Aug 3 (GA per InfoQ). Minor precision issue, not evidence of fabrication (version number and status are independently corroborated by npm and a GitHub issue, not just blog copy). |
| @notionhq/client ^5.22.0 | line 14 | `(version)` | WebSearch: 5.22.0 released 2026-05-19; npm's absolute latest today is 5.25.0 | **Confirmed accurate at verification time.** Expected/harmless drift since — a `^5.22.0` range still resolves forward, so this isn't a functional problem, just evidence the field moves fast. |
| @googleapis/calendar ^16.0.0 | line 20 | `(version)` | WebSearch: latest = 16.0.0 | **Confirmed.** Note line 14 separately mentions "googleapis npm latest v175.0.0" — a *different* package (the monolith, not `@googleapis/calendar`). Not a contradiction since the spine correctly picked the dedicated package, but worth noting the first pass checked the wrong package before the second pass (line 20) checked the right one. |
| google-auth-library ^11.0.2 | line 20 | `(version)` | WebSearch: latest = 11.0.2 | **Confirmed.** |
| better-sqlite3 ^13.0.3 | line 20 (+ decision line 15 re: node:sqlite RC status) | `(version)` | WebSearch: latest = 13.0.3, v13 line is N-API-based | **Confirmed.** The node:sqlite-vs-better-sqlite3 rationale (node:sqlite still RC/Stability 1.2 on Node 24) is a reasonable, checkable claim; not independently re-verified here but plausible and appropriately hedged as a decision rather than dressed up as fact. |
| nodemailer ^9.0.5 | line 20 | `(version)` | WebSearch: latest = 9.0.5, published ~15 days prior | **Confirmed** — and this was the entry most worth spot-checking: nodemailer historically sat on major v6 for years, so a jump to v9 reads like a plausible-but-suspicious pattern-matched guess. It checked out as real. |
| Pushover (no SDK) | line 18 (decision) + line 20 (version-adjacent confirmation) | `(decision)`/`(version)` | Not independently re-checked (no package/version to verify; "HTTPS POST via fetch" is a stable, low-risk architectural fact) | **Adequate.** No SDK version exists to go stale. |

**Node.js/TypeScript/`@notionhq/client` share one `(version)` entry (line 14); `@googleapis/calendar`/`google-auth-library`/`better-sqlite3`/`nodemailer` share a second (line 20).** So the eight Stack rows are backed by exactly two verification passes — not eight separate checks, but every row is covered by one or the other.

## Gap found: `node:test` / `node:assert` row

The Stack table's ninth row, `node:test / node:assert | built-in (no separate dependency)`, is **not** backed by any `(version)` memlog entry. It's covered only by a `(decision)` entry (line 16: "stable since Node 20, production-quality by 2026. No external test framework dependency…") with no web search noted, no source, no date. This is lower-risk than the versioned npm packages (it's a Node built-in, not a dependency that can drift or vanish), but it's the one Stack-table row that breaks the pattern of "every stack claim has a matching verification entry" the rest of the table follows — worth a one-line fix (either add a version-entry-style confirmation, or explicitly note in the spine that built-ins were reality-checked differently than npm packages).

## Process observations (not blocking, but worth flagging)

1. **No source URLs preserved.** Both `(version)` entries (lines 14, 20) say "Verified … via web search" but record no URLs, snippet quotes, or search queries — only conclusions. Today's spot-checks corroborate the conclusions, but the memlog itself gives no way to re-verify without redoing the search from scratch. A future reader can't tell *which* search results were trusted.
2. **TypeScript GA date is off by ~2-4 weeks** relative to what live sources report today (Aug 5 claimed vs. Aug 3/July 8 found). Everything else about the TS7 claim (version 7.0.2, Go-native rewrite, GA status, ~10x speedup, no-build-step positioning) is independently corroborated via npm and a GitHub issue, so this reads as a minor transcription/rounding slip in a fast-moving news cycle, not a hallucinated date. Low severity.
3. **@googleapis/calendar vs. googleapis mix-up in the trail.** Line 14 records a version check against the wrong package (`googleapis` monolith, v175.0.0) before line 20 correctly checks `@googleapis/calendar` (v16.0.0), the package actually named in the Stack table. The end result is correct, but the memlog shows the first check was pointed at the wrong artifact — a minor sloppiness signal, not a spine defect.
4. **Deferred section is well-calibrated.** In contrast to the confidently-stated Stack versions, the spine's Deferred section correctly flags several claims as *not* verified and needing a docs check before build: exact 2026 Google Calendar OAuth scope names, Notion internal-integration-token auth pattern ("medium-confidence"), and Notion's UTC-default timezone-filter/formula-property read-only behavior ("search-snippet-level confidence only"). This is good practice — the author distinguished between what was actually confirmed (Stack table) and what wasn't (Deferred), rather than asserting everything with uniform confidence.
5. **Today's date (2026-08-22) was handled appropriately.** The specific version numbers claimed (TypeScript 7.0.2 as a GA Go-native rewrite; Node 24.12+ type-stripping going stable; better-sqlite3 13.0.3; nodemailer jumping to a v9 line despite years of historical stability at v6; @notionhq/client at v5.22; @googleapis/calendar at v16; google-auth-library at v11) are all real, current facts as of today — several of which (TS7 GA in particular) would be very unlikely to guess correctly by pattern-matching from pre-2026 training data. This is strong evidence the author actually ran web searches rather than extrapolating plausible-sounding future version numbers.

## Bottom line

The Stack table is well-grounded: every entry traces to a `(version)`-tagged memlog entry, and live re-verification today confirms all the checkable facts were accurate at the time they were recorded. The two things worth fixing before this spine is treated as final: (a) add or note verification for the `node:test`/`node:assert` row so the pattern is complete, and (b) either drop the specific TypeScript GA date or correct it, since it doesn't match what's independently findable today. Everything else is minor process hygiene (keep source URLs in future memlog `(version)` entries) rather than a substantive currency problem.

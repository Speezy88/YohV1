# Currency Review — Phase 2 Web App Stack (ARCHITECTURE-SPINE.md)

**Reviewer date:** 2026-09-25
**Scope:** Stack table + AD-15/AD-17/AD-18, as updated for Phase 2 (Hono, React 19, Vite 8, Tailwind CSS 4/@tailwindcss/vite, shadcn/ui, Motion, @dnd-kit/react, Figtree/Montserrat, Tailscale, PWA installability), plus better-sqlite3 WAL under two processes on a Pi. The authoring sandbox could not reach the npm registry (per `.memlog.md`), so this pass re-verifies via live web search.

## Verdict

Mostly holds up — one genuine gap and one item that can now be upgraded from "check at install" to a confirmed fact; nothing found that invalidates a committed decision.

## Findings

1. **`@tailwindcss/vite` + Vite 8 — now confirmed compatible, spine's hedge is stale.** Vite 8.0.0 shipped 2026-03-12, and `@tailwindcss/vite` merged Vite 8 support the same day, released in **v4.2.2 (2026-03-18)** — the peer range is now `^5.2.0 || ^6 || ^7 || ^8`. **Fix:** change the Stack-table cell from "Check `@tailwindcss/vite`'s peer range covers Vite 8 at install; if it doesn't, pin Vite 7" to "confirmed: `@tailwindcss/vite` ≥4.2.2 supports Vite 8 as a peer (verified 2026-09-25); pin `@tailwindcss/vite` ^4.2.2 explicitly since only versions ≥4.2.2 support Vite 8." Also note there was a LightningCSS-config interaction from the Vite 8 migration (tailwindlabs/tailwindcss#19792) — worth a one-line watch-for at install, not a blocker.
2. **Hono version claim is already one minor behind and will keep drifting; the "verified current" framing invites re-checking a moving target.** Current npm latest is **4.13.9** (spine/memlog cite 4.12.16/4.12.18 as "current 2026-09-25"). `^4.12` in the Stack table still resolves 4.13.x correctly under caret ranges, and `streamSSE` + `hono/client` RPC both exist and are unchanged in shape — so no functional problem — but the table's parenthetical "verified current 2026-09-25" will read as false within days given Hono's release cadence (patches ~weekly). **Fix:** reword to "^4.12 (caret covers current 4.13.x; streamSSE and hono/client RPC confirmed present as of 2026-09-25 — re-check exact patch at install, don't rely on this date implying latest)."
3. **Motion's version was left deliberately unverified in the spine ("not version-verified in this run") but is now cheaply confirmable.** Current npm `motion` is **13.4.x** (multiple releases/day cadence). No compatibility issue found with React 19. **Fix:** update the Stack-table Motion row from "current major, pin at install (not version-verified in this run)" to "13.x confirmed current 2026-09-25 via npm; pin exact version at install (frequent releases)."
4. **AD-18's SSE design has no heartbeat/keepalive, and no source confirms `tailscale serve` is buffering- or idle-timeout-safe for a long-held SSE connection.** General SSE literature (not Tailscale-specific — no Tailscale+SSE gotcha was found in search) confirms two real risks that apply to any reverse proxy in the path: response buffering delaying delivery, and idle-timeout disconnection on a quiet stream (e.g., Envoy/Istio defaults ~5 min). `tailscale serve` proxies locally over the tailnet rather than through a public CDN/ingress, which reduces but doesn't eliminate this risk, and no test or doc citation confirms it. AD-18 already polls the outbox every ~2s and could piggyback a periodic SSE comment/ping on that same timer at near-zero cost. **Fix:** add one line to AD-18: "the SSE stream sends a periodic keep-alive comment (piggybacked on the ~2s outbox poll) so a quiet connection is never mistaken for idle by any intermediary — Tailscale-specific SSE behavior wasn't found documented and hasn't been tested." Also add a Deferred item: "confirm `tailscale serve` doesn't buffer or time out a long-idle SSE connection in practice."
5. **better-sqlite3 WAL + two OS processes sharing one file is a well-supported pattern, but the spine doesn't mention the one operational failure mode that matters for this exact shape (long-lived server + periodic cron one-shots): checkpoint starvation.** WAL mode supports one writer/many readers across processes via the `-wal`/`-shm` files (needs real shared-memory support — fine on a Pi's local SD/SSD-backed ext4, not guaranteed over NFS/some network filesystems, which isn't this deployment's case). The documented risk is that if a long-running read transaction (or many overlapping readers) never lets the WAL checkpoint, the WAL file grows unboundedly; the fix is either automatic checkpointing (SQLite's default) or an explicit `pragma wal_checkpoint` on a schedule. This is plausible here because the server process may hold connections open across the same window a cron one-shot writes. **Fix:** add one line to AD-15 or AD-10's Phase 2 revision: "the server does not hold a long-lived read transaction across ritual-cli writes; if WAL file growth is ever observed, add a scheduled `PRAGMA wal_checkpoint(TRUNCATE)` — not needed pre-emptively, but the mechanism is the thing to reach for."

## Supporting checks (no fix needed)

- **Vite 8**: current, released 2026-03-12, latest patch line 8.3.x. Matches spine.
- **React 19**: current release is 19.3 (2026-09-09). Matches spine's "19.x".
- **@dnd-kit/react**: 0.5.0 remains the current maintained pre-1.0 line (last published ~3 months ago as of this check); `@dnd-kit/core` 6.3.1 confirmed as the separate legacy/unmaintained line. Matches spine's characterization and Deferred pin-and-isolate note.
- **Tailscale free (Personal) plan**: MagicDNS and HTTPS-certificate provisioning (which `tailscale serve` depends on) are available on all plans including free; unlimited devices for a single user. `tailscale serve` itself is not Funnel (no public exposure), matching AD-15's "never exposed via Funnel" claim.
- **PWA install from a `*.ts.net` origin**: multiple independent sources confirm a Tailscale-issued HTTPS cert on a MagicDNS name satisfies browser PWA-installability criteria (valid cert + HTTPS origin) — consistent with the spine's "should work" framing. The spine's own Deferred item (test on the real school network / Windows browser, because DERP-over-443 traversal is "confirmed in principle only") is correctly left open — nothing found resolves that empirically, so it should stay Deferred, not be promoted to confirmed.
- **Node.js 24 LTS, TypeScript 7, better-sqlite3, @notionhq/client, @googleapis/calendar, google-auth-library, nodemailer, @anthropic-ai/sdk**: out of this review's assigned scope (already covered by prior currency passes per `.memlog.md` lines 14/20/30); not re-verified here.

## Sources

- [hono 4.12.4 on Node.js NPM](https://newreleases.io/project/npm/hono/release/4.12.4)
- [hono - npm](https://www.npmjs.com/package/hono)
- [RPC - Hono](https://hono.dev/docs/guides/rpc)
- [streaming - @hono/hono - JSR](http://jsr.io/@hono/hono/doc/streaming)
- [Vite 7 incompatible with @tailwindcss/vite due to strict peer dependency · Issue #20284](https://github.com/vitejs/vite/issues/20284)
- [`@tailwindcss/vite` incompatible with Vite 8 dependency · Issue #19798](https://github.com/tailwindlabs/tailwindcss/issues/19798)
- [Support vite@8 by @tailwindcss/vite · Issue #19789](https://github.com/tailwindlabs/tailwindcss/issues/19789)
- [LightningCSS breaking change with Vite 8? · Issue #19792](https://github.com/tailwindlabs/tailwindcss/issues/19792)
- [Tailwind CSS moves quickly on Vite 8 support](https://benjamincrozat.com/tailwind-css-vite-8-support)
- [@tailwindcss/vite - npm](https://www.npmjs.com/package/@tailwindcss/vite)
- [Vite 8.0 is out! | Vite](https://vite.dev/blog/announcing-vite8)
- [Releases | Vite](https://vite.dev/releases)
- [React 19.3 – React](https://react.dev/blog/2026/09/09/react-19-3)
- [motion - npm](https://www.npmjs.com/package/motion)
- [Motion & Framer Motion upgrade guide](https://motion.dev/docs/react-upgrade-guide)
- [@dnd-kit/react - npm](https://www.npmjs.com/package/@dnd-kit/react)
- [Changelog - dnd kit](https://dndkit.com/changelog/)
- [Tailscale Serve · Tailscale Docs](https://tailscale.com/kb/1312/serve)
- [MagicDNS · Tailscale Docs](https://tailscale.com/docs/features/magicdns)
- [Enabling HTTPS · Tailscale Docs](https://tailscale.com/docs/how-to/set-up-https-certificates)
- [Free pricing plans and discounts · Tailscale Docs](https://tailscale.com/docs/account/manage-plans/free-plans-discounts)
- [Is Tailscale free? What the plans cover · SSD Nodes](https://www.ssdnodes.com/learn/is-tailscale-free-plan-limits)
- [Without even owning a domain, I enabled HTTPS to secure my self-hosted apps with Tailscale - XDA](https://www.xda-developers.com/enabled-https-secure-self-hosted-apps-tailscale/)
- [fix(fcc): install PWA from Tailscale HTTPS only · PR #775](https://github.com/cvolkernick/personal-workspace/pull/775)
- [Diagnosing Buffered SSE Output in App Servers](https://www.server-sent-events.com/backend-stream-generation-connection-management/buffer-management-chunked-transfer-encoding/diagnosing-buffered-sse-output-in-app-servers/)
- [How to Configure Server-Sent Events (SSE) Through Istio](https://oneuptime.com/blog/post/2026-02-24-how-to-configure-server-sent-events-sse-through-istio/view)
- [better-sqlite3 performance.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)
- [Multiprocess access to database · Issue #250](https://github.com/WiseLibs/better-sqlite3/issues/250)
- [Write-Ahead Logging - SQLite](https://www.sqlite.org/wal.html)
- [SQLite User Forum: Using WAL mode with multiple processes](https://sqlite.org/forum/forumpost/c4dbf6ca17)

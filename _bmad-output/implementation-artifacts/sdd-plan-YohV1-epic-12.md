# SDD plan — Epic 12: Desk (Stories 12.1–12.5)

Written 2026-10-04 from `epics.md` (Epic 12) against `main` at `8f93afb`.
Branch `epic-12-decisions`, worktree `.claude/worktrees/epic-12-decisions`.
Ledger: `~/Documents/Yoh-previews/ledgers/epic-12/progress.md`.
The stories' acceptance criteria in `epics.md` are the requirement; this plan splits
them into tasks and records what the stories leave open. Spencer's decisions of
2026-10-04 (on-time rate, streak rule, heatmap steps, Bklit UI) are already in
Stories 12.1 and 12.2.

Order: Tasks 1–4 need nothing more from Spencer. Task 5 (heatmap) waits for his
answer on the Bklit finding below. Tasks 6–7 (feeds) wait for his choice of providers.

## What the code already has (checked at `8f93afb`)

- `completions` table (`src/adapters/completion-log.ts`): `task_name`, `due_date`, `estimated_minutes`, `completed_at`, `source`. It has no read that returns every row and no activity-day table.
- A Plan per date: `getPlan(store, date)` (`src/adapters/memory-store.ts`); Plan records are kept (the Pi has 13, from 2026-08-24).
- **No per-day record of a finished night close-out.** The `night-prompt` `RitualRun` marker is one row, overwritten each night, and it is also written when Tasks were skipped. `UncheckedDay` rows exist only for nights that were escalated (the Pi has none). So past close-outs cannot be reconstructed: **the streak starts on the first night closed out after this epic is deployed.**
- `llm_usage` rows and `costForRows` + the one price table (`src/core/llm-cost.ts`). The Pi has rows from 2026-09-27, for `claude-haiku-4-5-20251001` and `claude-sonnet-5`; both are in the price table. `costForRow` throws for a model with no price.
- `web/src/pages/Desk.tsx` is a placeholder ("Desk isn't built yet."). No `/api/desk` route.

## Bklit spike (2026-10-04, read from the registry JSON at `https://ui.bklit.com/r/`)

- License: MIT (the `packages/ui` chart components).
- Size: `@bklit/heatmap-chart` plus its seven registry dependencies is 58 files, about 8,700 lines, copied into `web/`.
- npm dependencies: `motion`, six `@visx/*` packages pinned to `4.0.1-alpha.0`, `@number-flow/react`, `d3-array`, `clsx`, `tailwind-merge`.
- shadcn: the files import `@/lib/utils`; `web/` has no `@/` alias and no `components.json`. Both can be added without running `shadcn init` (a hand-written `components.json`, the alias in `vite.config.ts` and `tsconfig`, then `npx shadcn@latest add`), or the files can be copied by hand.
- CSP: nothing loads from another host; no `<style>` injection.
- Tokens: colors come from `--chart-*` CSS variables (set them from `tokens.css`) and the `levelColors` prop. Left over: one hard-coded color (`#e879f9`, a pattern preset the heatmap does not need), `zinc-*` classes on the loading label, a `duration-200` class, and enter durations in `heatmap-animation.ts` (overridable by props).
- Reduced motion: the heatmap does not read the setting itself. Pass `animate={!reducedMotion}` from `web/src/hooks/useReducedMotion.ts`.
- **Keyboard and screen reader: not met as shipped.** The chart `<svg>` is `aria-hidden`, cells react only to pointer events, there is no `tabIndex`, no label, no key handling. Story 12.2 requires a focusable cell with an accessible label and a tooltip on focus. Meeting it means changing the copied cell code (or laying a focusable grid over it). This is the open question for Spencer; Task 5 does not start before he answers.

## Rulings (made without Spencer; they bind until he overrules)

- **E12-R1 Close-out record.** New record kind `night-close-out-done`, keyed by the close-out's date, `{ date, completedAt, via: "answered" | "nothing-to-ask" }`, with `putNightCloseOutDone` / `listNightCloseOutDone` in `src/adapters/memory-store.ts`. Written where a close-out for a day with a Plan finishes with no Task skipped: the "done" branch of `answer-night-close-out.ts` when `skippedTaskIds` is empty; `runNightPromptRitual` and `startNightCloseOut` when the Plan has no Task left to ask about. Not written when a Task was skipped, when the day has no Plan, or when the request is still open. A close-out answered the next morning counts for the night it was about. No backfill.
- **E12-R2 Streak.** A streak day = a Plan record for D and a `night-close-out-done` record for D. Current streak = the run of consecutive streak days ending today, or ending yesterday when today is not a streak day yet. Longest = the longest run over all records. Pure function in `src/core/desk-metrics.ts` over two date lists.
- **E12-R3 Activity days.** Table `activity_days (date TEXT PRIMARY KEY, first_seen_at TEXT)` in `completion-log.ts`; `recordActivityDay(connection, date)` is `INSERT OR IGNORE`. A middleware on `/api/*` in `createApp` calls one app function, `recordActivity` (`src/app/desk.ts`), for every request except `GET /api/health`; the date is today in the host timezone. The real dependency remembers the last date it wrote, so there is one write per day per process. A failure is logged and never fails the request. No outbox row.
- **E12-R4 Metrics** (all pure, in `src/core/desk-metrics.ts`, dates in the host timezone):
  - Completed today: every completion whose local date is today, newest first (`taskName`, `completedAt`).
  - Minutes today: the sum of `estimatedMinutes` for those rows; a null estimate adds 0.
  - Hours with Yoh: the sum of `estimatedMinutes` over all completions ÷ 60, rounded to the nearest whole hour.
  - On-time rate: over completions with a due date; on time when the completion's local date ≤ the due date. Returns `{ onTime, counted, percent }`; `percent` is a rounded whole number, or `null` when `counted` is 0.
- **E12-R5 Heatmap data.** 26 week columns ending with the current week; weeks start on Sunday; days after today are left out. Each day is `{ date, completed, level }`: level 0 = no activity day and no completion; 1 = an activity day with nothing completed; 2 = 1–2 completed; 3 = 3–4; 4 = 5 or more. A day with completions counts even without an activity-day row (days before this epic have none).
- **E12-R6 Spend.** This month = rows whose `at` falls in the current calendar month in the host timezone, summed with `costForRows`. A row whose model has no price is left out of the sum and counted in `unpricedCalls` (logged once per request); it never makes Desk fail. The tile covers Claude calls only (not Perplexity).
- **E12-R7 API.** One route, `GET /api/desk`, one app function `getDesk(deps, {})` in `src/app/desk.ts`, returning `DeskResponse` (`src/types/api.ts`): `{ today, completedToday, minutesToday, hoursWithYoh, onTime, streak: { current, longest }, heatmap: { weeks }, spend: { monthUsd, unpricedCalls } }`. Feed fields are added by Tasks 6–7. `completion-log.ts` gains `listCompletions(connection)` and `listActivityDays(connection)`.
- **E12-R8 Desk page.** A responsive grid of `DeskWidget` cards (the card classes `Desk.tsx` uses today: `rounded-2xl bg-surface-raised shadow-extruded-lg`, `data-wheel-nav="off"`), each with a caption header and a tabular-numeral value. Loading = skeleton cards in the grid's shape; a failed load = `StateMessage` error with `Try again`. Data comes from a module-level store trio in `web/src/lib/desk.ts` (copy `web/src/lib/homeView.ts`), refetched on a `tasks` hint and when the page becomes visible again.
- **E12-R9 Copy** (invented; for Spencer's glance):
  - Tasks Completed: header `Tasks completed today`, the count, then the rows; none: `0` and `Nothing completed yet today.`
  - Worked: `{n} min today` and `{h} h with Yoh`.
  - On-Time Rate: `{p}%` and `{onTime} of {counted} Tasks with a due date`; nothing counted: `—` and `No Tasks with a due date completed yet.`
  - Streak: `Streak: {n} day(s) · Longest: {m} day(s)`, and under it `A day counts when it has a Plan and a finished night close-out.`
  - Spend: header `Claude API spend this month`, `${x.xx}`, caption `Estimated from recorded calls.`; with unpriced calls add `{n} calls not priced.`
  - Load failure: `Couldn't load Desk.` + `Try again`.

Added during the build (2026-10-04):
- **E12-R10** "Nothing left to ask" counts whenever the day's Plan has no unfinished Task when night-prompt or `/night` runs, including a Plan with no Task blocks.
- **E12-R11** A close-out for date D that finishes with a skip removes D's `night-close-out-done` record if one exists (an early `/night` no longer fixes the day as done).
- **E12-R12 News sources (Spencer: free publisher RSS, "choose the best source").** NPR Business `https://feeds.npr.org/1006/rss.xml` and TechCrunch AI `https://techcrunch.com/category/artificial-intelligence/feed/`. The newest 4 from each, merged newest first, each with its source name and a link out; title, link and time only. Neither publisher's full terms page was read; NPR's feed carries "For Personal Use Only".
- **Spencer, 2026-10-04:** keep Bklit and patch the copied cell code for keyboard focus, labels and a tooltip on focus; crypto = Kraken public ticker; weather = NWS `api.weather.gov`.
- **Spencer, 2026-10-04 (answers to review I2 and M1):**
  - **E12-R13** A completion recorded by a night close-out is dated to the night the close-out was about, not to when it was answered.
  - **E12-R14** Only real interaction counts as an activity day; a tab left open, polling and stream reconnects do not.

## Task 1: Planning-doc amendments (coordinator, inline)

Amend in place with a dated note, under `_bmad-output/planning-artifacts/`:
- PRD: on-time rate is decided (line ~647), the streak comes from Plan + finished close-out and activity days feed the heatmap only (line ~692), the open question on the on-time definition is resolved (line ~1031).
- Architecture spine AD-23: the streak reads Plan records and `night-close-out-done` records (E12-R1/R2), not activity days; on-time is no longer an assumption.
- UX (`DESIGN.md` Desk Widget row, `EXPERIENCE.md` Desk Widget row and open question 5): done after Spencer answers the Bklit question, so the amendment says what is built.

**Commit:** `docs(planning): the PRD and AD-23 carry the Epic 12 decisions; the Epic 12 plan`

## Task 2: The records Desk needs (Story 12.1, server)

Behaviour: E12-R1 and E12-R3. `initCompletionLogSchema` creates `activity_days`. The fixture server (`tests/e2e/fixture-server.ts`) wires the same middleware with its own connection.

Tests (node): `recordActivityDay` is idempotent and `listActivityDays` returns dates in order; the middleware records on `/api/home`, not on `/api/health`, writes once per day, and a throwing dependency still returns the route's response; the close-out record is written on a fully answered close-out, on a night with nothing left to ask (ritual and `/night`), and not on a skip, an open request or a day with no Plan; a close-out for last night answered today is keyed to last night.

Per-task Sonnet review (it changes the night close-out paths).

**Commit:** `feat(desk): the server records activity days and finished night close-outs`

## Task 3: Desk metrics and `GET /api/desk` (Stories 12.1, 12.2 data, 12.5 data)

Behaviour: E12-R2, R4, R5, R6, R7. `src/core/desk-metrics.ts` holds every computation as pure functions over plain rows (its own row shapes; no adapter import). `getDesk` reads completions, activity days, Plan dates, close-out records and usage rows, and converts a thrown store error to a `Result` failure with `errorCopyForThrown`. Dependencies go on `ServerDeps` via a `buildDeskDeps` in `src/shell/server-wiring.ts`. The fixture server serves fixed Desk data: completions today and on earlier days (enough for every heatmap level), a three-day streak, usage rows this month — exported for specs.

Tests (node): a table per metric including zero rows, null estimates, a completion on its due day / the day after / with no due date, a completion just before and just after local midnight, streak cases (today closed out; today pending; a gap; a weekend gap; a Plan with no close-out; longest longer than current), heatmap levels and the 26-week shape across a year boundary, spend across a month boundary and with an unpriced model; the route's success and failure envelopes.

**Commit:** `feat(desk): the server computes Desk metrics, heatmap days and this month's Claude spend`

## Task 4: Desk page — metric widgets and the spend tile (Stories 12.1, 12.5)

Behaviour: E12-R8 and R9, and the 12.1 / 12.5 acceptance criteria that are visible on the page: Tasks Completed (a scrollable list of checked, struck-through rows), Worked, On-Time Rate, Streak, Claude API spend. Tabular numerals on every figure. Controls and states use `web/src/lib/controlStyles.ts` and `StateMessage.tsx`; tokens only. The heatmap's place in the grid stays empty until Task 5.

Tests: Vitest for `web/src/lib/desk.ts` and the page (each widget's value, the zero states, skeleton, error + retry, refetch on a `tasks` hint); replace the placeholder test in `Desk.test.tsx`. Playwright `web/e2e/desk.spec.ts`: the widgets show the fixture's values; axe passes in light and dark. Computed-style proof for the struck-through rows and tabular numerals.

**Commit:** `feat(web): Desk shows completed Tasks, time worked, on-time rate, streak and Claude spend`

- **E12-R15 (coordinator)** `POST /api/activity` returns `{ date, timeZone }` (the host's today and zone); the web compares the host day of "now" in that zone with `date` to decide when to ping again. A backed-off write answers as a failure, so the web pings again on a later input.
- **E12-R16 (coordinator) Bklit copy-in.** The files are copied by hand (no shadcn CLI) into `web/src/components/charts/`, trimmed to what the heatmap imports, with an `@/` alias, a hand-written `web/components.json` and `web/src/components/charts/NOTICE.md` (source, MIT, local changes; each marked `// Yoh:`). The legend is Yoh's own (None, Opened, 1–2, 3–4, 5+). The grid is one Tab stop with arrow keys, Home and End.

Feed rulings (coordinator, 2026-10-04; made without Spencer):
- **E12-R17 Feed contract.** `FeedResult<T> = { status: "ok" | "stale" | "unavailable"; value?: T; fetchedAt?: IsoDateTime }` (`src/types/api.ts`). Each adapter exports `create<Name>Feed({ fetch, now, log, … })` returning `{ read(): Promise<FeedResult<T>> }`. `read` takes no argument (AD-22) and never throws.
  - Cache in memory only (lost on restart). A value younger than the feed's refresh interval is returned as `ok` without a request.
  - Otherwise one request with an 8 s timeout (`AbortSignal.timeout`). Concurrent reads share the one request in flight.
  - Success → `ok`, new value and `fetchedAt`. Failure (network, non-2xx, timeout, unparseable body) → `stale` with the last good value and its `fetchedAt` when one exists and is under 24 h old; otherwise `unavailable` (with `fetchedAt` of the expired value when there was one).
  - After a failure, no new request for 60 s.
  - Refresh intervals, each exported once from its adapter: crypto 5 min, weather 30 min, news 60 min.
  - Each failure is logged once per state change (`<feed>.unavailable`, `<feed>.recovered`), not on every read. No response body is logged.
  - The adapters import nothing from the Notion, Calendar, LLM or search adapters and share no client with them. Tests use a fake `fetch`; no test calls a provider.
- **E12-R18 Crypto (Kraken).** `GET https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD`. Value: `{ tickers: [{ symbol: "BTC" | "SOL" | "ETH", priceUsd: number, changePercent: number | null }] }`, in the order BTC, SOL, ETH. `priceUsd` = `c[0]`; `changePercent` = (last − `o`) ÷ `o` × 100 where `o` is Kraken's open for the day (the day starts at 00:00 UTC), `null` when `o` is missing or 0. Result keys vary (`XXBTZUSD`, `XETHZUSD`, `SOLUSD`): match the key containing `XBT`, `ETH`, `SOL`. A non-empty `error` array, or any of the three missing or not a finite number, fails the whole read.
- **E12-R19 Weather (NWS).** Location is one exported constant: Seattle, WA, `47.6062,-122.3321`. `GET https://api.weather.gov/points/47.6062,-122.3321` → `properties.forecastHourly` and `properties.forecast` URLs, cached for the life of the process and looked up again after a 404 from either. Value: `{ location: "Seattle, WA", temperatureF: number, conditions: string, next: { name: string, temperatureF: number, summary: string } | null }` — `temperatureF`/`conditions` from the first hourly period (`temperature`, `shortForecast`), `next` from the first period of the daily forecast whose `name` differs from "now" (e.g. "Tonight"). A period in Celsius (`temperatureUnit: "C"`) is converted. Every request sends `User-Agent` from `YOH_FEED_USER_AGENT`, default `Yoh/1.0 (personal dashboard)`, and `Accept: application/geo+json`. Forecast-period values are used, not station observations (those are sometimes null).
- **E12-R20 News (RSS, per E12-R12).** NPR Business and TechCrunch AI, fetched independently. A small pure RSS 2.0 parser in `src/core/rss.ts` (no new dependency): `<item>` → `title`, `link`, `pubDate`; handles CDATA and the XML entities; strips tags from titles; titles cut at 160 characters; items without an `http(s)` link or a parseable date are dropped. Value: `{ items: [{ title, url, source: "NPR" | "TechCrunch", publishedAt }] }` — the newest 4 from each source, merged newest first. A source that fails keeps its last good items. Status: `ok` when both sources are fresh; `stale` when any shown item comes from a last good set; `unavailable` when there is nothing to show. Nothing but the two fixed URLs goes out.
- **E12-R21 API and web.** A separate route, so a slow provider never delays the metrics: `GET /api/desk/feeds` → `getDeskFeeds(deps, {})` (`src/app/desk-feeds.ts`) → `DeskFeedsResponse { timeZone, crypto, weather, news }`, each a `FeedResult`. The three reads run together; the Result is always `ok` (a feed's failure is its own `status`). Deps on `ServerDeps.deskFeeds`, built by `buildDeskFeedsDeps` (real `fetch`); the fixture server supplies fake feeds with fixed values. Task 6 adds the route with `crypto`; Task 7 adds `weather` and `news`. Web: `web/src/lib/deskFeeds.ts` store trio; fetched when Desk becomes the current page and every 5 min while Desk is current and the document is visible; never from another page; no outbox hint. The browser never contacts a provider.
- **E12-R22 Widget copy (invented; for Spencer's glance).**
  - Crypto: header `Crypto`; one row per coin: `BTC`, the price (`$67,123` whole dollars at 1,000 and above, `$142.57` below), the change with its sign in text (`+1.2%`, `−0.8%`; nothing when `null`); caption `Kraken · change since 00:00 UTC · updated {time}`.
  - Weather: header `Weather · Seattle, WA`; figure `{t}°F`; `{conditions}`; then `{name}: {t}°F, {summary}`; caption `National Weather Service · updated {time}`.
  - News: header `Business and AI news`; each row the title as a link (`target="_blank" rel="noopener noreferrer"`), then `{source} · {Mon D, h:mm AM/PM}`.
  - `stale`: the last values stay on screen and the caption is replaced by `Unavailable · last updated {time}` in `ink-secondary`. `unavailable`: only `Unavailable` (or `Unavailable · last updated {time}` when an expired value existed). Times are in the host time zone. A change is never shown by color alone.
  - Loading: a skeleton card per feed widget; a failed `/api/desk/feeds` request shows `Unavailable` in each feed widget and leaves the metric widgets alone.

## Task 4b: Close-out dates and real-interaction activity days (Spencer's answers; built 2026-10-04, `feb005e` + `927ef1a`)

- **E12-R13.** In `src/app/answer-night-close-out.ts`, when the answer's local date is later than the close-out's date, the completion's `completedAt` is the last minute of the close-out's date in the host timezone (23:59 local); answered on the same day, it stays the answer time. The helper that turns a local date into that instant is pure, in `src/core/local-time.ts`. Existing rows are not rewritten. Tests: answered the same night; answered the next morning (on-time for a Task due that day, listed under that day, not under the next); across a DST change.
- **E12-R14.** Remove the record-on-every-request middleware. Add `POST /api/activity` (JSON, empty body) → `recordActivity`. The web sends it on the first pointer or key input after load and again on the first input of each later host day (`web/src/lib/hostTime.ts` for the day), from one module-level listener; never on a timer, visibility change or stream event. A failed ping is retried on the next input, silently. A day with completions still counts on the heatmap without a ping. The fixture's seeded activity-only day stays seeded directly. Tests: node (route records; `GET` routes no longer record) and Vitest (one ping per day, none without input, retry after failure).

## Task 5: Usage Heatmap (Story 12.2) — Spencer keeps Bklit, patched (built 2026-10-04, `d75c4ea`)

Outline: add the `@/` alias and `components.json`; add `@bklit/heatmap-chart`; map `--chart-*` and the five `levelColors` to `tokens.css` (`accent-solid` at four stepped opacities plus the rimmed empty step); `animate={!reducedMotion}`; make each cell focusable with a label (`{date}: {n} Tasks completed`) and show the tooltip on focus; legend; horizontal scroll region with `data-wheel-nav="off"`. Remove the unused pattern preset color and the `zinc-*` loading label. Vitest + Playwright (keyboard reaches a cell and shows its tooltip; axe; computed style for the five levels). Then the UX amendment from Task 1.

## Tasks 6–7: Feeds (Stories 12.3, 12.4) — providers chosen (2026-10-04)

Kraken public ticker, NWS (needs a `User-Agent`; cache the grid lookup), and the two RSS feeds of E12-R12. The provider research is in the ledger folder (`feed-providers.md`); the Kraken and NWS terms pages were not read, only their API docs. Task 6 = `adapters/crypto-feed.ts` + the ticker widget; Task 7 = `adapters/weather-feed.ts`, `adapters/news-feed.ts` + their widgets. Each adapter keeps its own cache and last-good value, never throws, and takes no argument that could carry Task, Calendar or usage data (AD-22). Rulings for these are written when the providers are known.

## Review and gate
Per-task Sonnet review for Task 2. One Opus whole-branch review after Task 4 (and again after the last of Tasks 5–7 if they land later), a fix round, a Sonnet re-review of the fixes. Gate: `npm run check` and `cd web && npx playwright test`.

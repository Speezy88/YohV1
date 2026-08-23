---
name: review-adversarial
type: architecture-review
lens: adversarial
target: _bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md
created: '2026-08-22'
---

# Adversarial Review — ARCHITECTURE-SPINE.md (Yoh)

## Method

For each pair below: two (or three) implementation tasks, each described concretely enough that it could be
handed to a build agent one level down from the spine, each checked line-by-line against every AD/Rule/Convention
in the spine and found individually compliant, yet whose outputs do not compose — a type mismatch, a double
owner of one entity, a signature two callers would each reasonably assume differently, or a race neither AD
forbids. Each pair ends with the smallest AD/Rule-wording change that would close the hole.

---

## Pair 1 — `TimeBudget` shape forked between two `core/` consumers (types/domain.ts)

**Task A:** build `core/time-budget.ts` (FR-5, FR-7). Needs a `TimeBudget` type to track and adjust Spencer's
daily allotment. Declares (or adds to `types/domain.ts`):
```ts
interface TimeBudget { dailyCapMinutes: number; consumedMinutes: number; }
```

**Task B:** build `core/work-break-fit.ts` (FR-6, FR-8). Needs the same *named* type to compute work/break
cycles against the same budget. Declares (or adds to `types/domain.ts`):
```ts
interface TimeBudget { workMinutes: number; breakMinutes: number; cycles: number; }
```

Both tasks satisfy AD-1 (import only from `types/`/`core/`), AD-2 (pure, no module-level state, prior state
passed as a parameter), AD-9 (each task only edits its own `core/*.ts` file — neither touches a file "owned"
by the other capability), and the naming convention (PascalCase in `domain.ts`). Nothing in the spine says who
is the single author of the *shape* of a name in `domain.ts`, nor forbids a `core/*.ts` file from locally
declaring an interface with the same name instead of importing the canonical one. AD-9 assigns file ownership
by *behavior*, but `types/domain.ts` is the shared home for seven types that many unrelated behaviors need
simultaneously — the spine names the seven types but pins none of their fields. Run these two tasks in
parallel (which is the whole premise the spine is built to enable) and you get two incompatible `TimeBudget`
definitions, either colliding in `domain.ts` or silently diverging because each file locally shadowed the name.

The same root cause reappears for `Task`, `Plan`, `PlanBlock`, `Proposal<T>`, and `YohError` — anywhere two
tasks are dispatched before the field-level shape of a shared type is fixed.

**Fix:** Tighten AD-9 (or add AD-11) — `types/domain.ts`'s field-level shapes for `Task`, `Plan`, `PlanBlock`,
`TimeBudget`, `Proposal<T>`, `Result<T,E>`, and `YohError` must be fully specified (not just named) in the
spine or in a companion doc *before* any consuming task is dispatched, `types/domain.ts` itself is built/locked
as a prerequisite task, and every consuming file must `import` these types — never locally redeclare an
interface/type of the same name.

---

## Pair 2 — Two owners of `PlanBlock` identity (`rituals/mid-day-reflow.ts` vs `rituals/night-ritual.ts`)

**Task A:** build `rituals/mid-day-reflow.ts` (FR-9–10). On a Slip-Bump it re-fits and re-prioritizes the
day's blocks, then persists the change through `storage-adapter.ts` keyed by a stable `planBlock.id: string`,
since a slip can reorder or drop blocks and an index would go stale.

**Task B:** build `rituals/night-ritual.ts` (FR-12–14). At close-out it iterates today's `Plan.blocks` array
and writes a `completed`/`slipped` status back through `storage-adapter.ts` keyed by `(planId, blockIndex)` —
a reasonable reading of the spine's own ER diagram (`PLAN ||--|{ PLAN_BLOCK : contains`), which shows
containment but asserts no identity field for `PLAN_BLOCK`.

Both obey AD-1/AD-2 (mutation only via an adapter call, no direct external-state mutation from `rituals/*`
itself — actually per the Conventions table, "External state changes only through an adapter call," which
both respect), AD-8 (both go through `storage-adapter.ts` and handle `Result`), and AD-9 (each owns its own
ritual file, no co-editing). Neither AD forbids two different rituals from choosing two different addressing
schemes for the same entity. If Mid-Day Re-Flow has already reordered or removed a slipped block earlier that
day, Night Ritual's index-keyed write lands on the wrong `PlanBlock` — a silent correctness bug, not a crash,
and nothing in `Result<T, YohError>`'s error-kind list (`missing-field`, `auth-expired`, `unreachable`,
`rate-limited`, `validation`) would even flag it.

**Fix:** Same fix as Pair 1's AD-11, plus one explicit line: "`PlanBlock.id` is a stable, ritual-assigned
identifier; no file may address a `PlanBlock` by array position once persisted." This single sentence in the
domain-type contract closes both the schema fork and this addressing race at once.

---

## Pair 3 — `computeEscalation`'s signature and `strainSignal` meaning left to three separate guesses (AD-6)

AD-6 pins only `computeEscalation(strainSignal, curveParams) -> level`, dispatched to three independently
buildable tasks:

**Task A — `core/slip-bump.ts` (FR-11):** assumes `strainSignal: number` = "count of slips today" (integer,
resets nightly), `curveParams: { cap: number; step: number }`, and reads the numeric `level` return as "minutes
to bump the next block by."

**Task B — `core/tone.ts` (FR-18–19):** assumes `strainSignal: number` = its own independently-computed
0–1 "rough day" score (an average of slip count, self-check history, and blockers), and reads `level` as an
*index into a fixed tone-phrase ladder* (`'steady' | 'firm' | 'blunt'`), i.e. expects `computeEscalation` to
return an enum, not a number.

Both are individually valid readings of AD-6's four-word contract (`strainSignal, curveParams) -> level`) — the
spine never states `level`'s type, never states whether `strainSignal` is a raw count or a normalized score,
and explicitly says each caller supplies "their own curve parameters" without requiring the *signal* itself to
be commensurable across callers. Whichever task actually lands `core/escalate-under-strain.ts` first fixes one
concrete signature (say, numeric signal in, numeric level out); the other caller's task was built against a
different mental model and either fails to typecheck or — worse — coerces its enum/score into the wrong shape
and compiles fine while being semantically wrong. Even if all three do typecheck against whatever
`escalate-under-strain.ts` lands with, the PRD's implied "same strain → same escalation" experience still
doesn't hold: `slip-bump.ts`'s signal (raw slip count) and `tone.ts`'s signal (a differently-derived rough-day
score) can diverge on the very same bad day, so Spencer can get a big Slip-Bump while Yoh's tone stays "steady,"
or vice versa — nothing in AD-6 requires the three callers to derive `strainSignal` from one shared, named
quantity.

**Fix:** In AD-6 itself, pin the exact exported signature, e.g. `computeEscalation(strainSignal: number,
curveParams: { cap: number; step: number }): number` (a single canonical numeric scale, with each consumer
mapping the returned number into its own vocabulary downstream — not inside the shared function), and add one
clause: "`strainSignal` for all three consumers is computed by one shared `core/` function from the same
underlying signals (slip count, self-check score, blocker count) — no caller derives its own independent
strain metric." That turns "one shared curve" into "one shared curve over one shared signal," which is what
FR-19's invariant actually needs.

---

## Pair 4 — `Proposal<T>` session boundary: in-process hand-off vs. cross-process persistence (AD-3)

**Task A — `rituals/mid-day-reflow.ts` (FR-10, Blocker resolution):** built assuming a `Proposal<T>` is
produced and consumed within one `chat-cli.ts` process lifetime — Spencer is already mid-conversation when a
Blocker is reported, so the proposal object is handed directly, in memory, to the confirmation prompt in the
same call stack. "Same session" = one REPL process.

**Task B — `core/time-budget.ts` (FR-5, budget-change suggestion):** built assuming a budget-change
`Proposal<T>` can be generated during an *unattended* `ritual-cli.ts` Morning Ritual run (no Spencer present,
no `chat-cli.ts` process even running), so it must be persisted (via `storage-adapter.ts`) with an id/timestamp
so a *later*, separate `chat-cli.ts` invocation can fetch and resurface it for a yes/no answer. "Same session"
= a logical thread of interaction spanning process restarts.

Both readings are compliant with AD-3's literal text — "any function that would suggest a ... change returns a
`Proposal<T>`" and "only `chat-cli.ts`, after an explicit yes/no from Spencer in that same session, may call
`apply(proposal)`" — because AD-3 never defines what a "session" *is* (one process? one logical thread of
Spencer interaction?) or how a `Proposal<T>` produced outside `chat-cli.ts`'s own process (task B's case, since
Morning Ritual runs under `ritual-cli.ts`, per AD-5) physically reaches `chat-cli.ts` at all. Whoever builds
`chat-cli.ts`'s single `apply(proposal)` call site must pick one transport; the other producer task's
assumption silently breaks (its proposals are never surfaced, or are surfaced through an ad hoc path the spine
never sanctioned). Worse: AD-3 also never requires `apply(proposal)` to revalidate the proposal's precondition
against current state before applying it. If Task B's persisted proposal sits unanswered for days while the
underlying `TimeBudget` is edited another way, and Spencer eventually answers "yes," `apply(proposal)` can
silently overwrite a `TimeBudget` that has already drifted from the one the proposal was computed against —
a genuine stale-proposal state-clobber that no AD forbids.

**Fix:** Add to AD-3: "Every `Proposal<T>` is persisted by `storage-adapter.ts` with a creation timestamp and
the id + version/hash of the entity it was computed from, regardless of which ritual produced it. `chat-cli.ts`
is the only reader/answerer of pending proposals, and `apply(proposal)` must re-fetch the current entity and
reject (re-propose, don't silently apply) if its version/hash no longer matches the proposal's captured
baseline." This pins the transport, the session boundary, and closes the staleness gap in one clause.

---

## Pair 5 — Concurrent `ritual-cli.ts` and `chat-cli.ts` racing on the same day's Plan (AD-5, AD-10)

**Task A — `rituals/night-ritual.ts` (FR-12–14), invoked from `ritual-cli.ts` on a 9pm cron:** reads today's
`Plan` from SQLite via `storage-adapter.ts`, computes close-out/escalation across several sequential adapter
calls, and writes the final `Plan` state back — treating the whole read-compute-write sequence as implicitly
atomic because it is "the" nightly close-out.

**Task B — `rituals/mid-day-reflow.ts` (FR-9–10), invoked from an interactive `chat-cli.ts` session Spencer
left open past 9pm:** reads today's `Plan`, applies a Slip-Bump/Blocker `Proposal<T>` Spencer just confirmed,
and writes the updated `Plan` back through the same `storage-adapter.ts` — treating its own read-compute-write
as atomic for the same reason.

Both comply with AD-5 to the letter (`ritual-cli.ts` is the only path running unattended Morning/Night Ritual
orchestration; `chat-cli.ts` is the only path for Mid-Day Re-Flow/confirmations; neither shell file contains
ritual/core logic itself), with AD-1/AD-8 (all mutation flows through `rituals/* → adapters/*`, `Result` types
at the boundary), and with AD-10 (neither adapter touches the OAuth token). Nothing in AD-5, AD-9, or AD-10 —
or anywhere else in the spine — states whether the two shell entry points may run concurrently, and nothing
requires `storage-adapter.ts` to serialize or version-check a read-modify-write cycle on a single `Plan` row.
`better-sqlite3` is synchronous per connection but gives no cross-process safety for free; two separate Node
processes each doing read-then-write on the same day's `Plan` can interleave, and whichever writes last wins —
Night Ritual's close-out can silently clobber Mid-Day Re-Flow's just-confirmed Slip-Bump, or vice versa, with
no thrown error and no `YohError.kind` (none of `missing-field | auth-expired | unreachable | rate-limited |
validation` covers "lost update") to surface it.

**Fix:** Add an AD (or extend AD-10) requiring `storage-adapter.ts` to wrap every ritual's entire
read-compute-write cycle on a `Plan`/`PlanBlock` in a single transaction (`BEGIN IMMEDIATE` or equivalent) and
to perform an optimistic-concurrency check (an `updated_at`/version column compared at write time), failing
with a new `YohError.kind: 'conflict'` that the calling ritual must surface (an AD-7-style alert from
`ritual-cli.ts`, a re-prompt from `chat-cli.ts`) rather than silently overwrite. Alternatively, state explicitly
that the two entry points must never run concurrently (e.g. an app-level lock file `storage-adapter.ts` takes
at start and releases at exit) — either resolves the race, but the spine currently mandates neither.

---

## Pair 6 — Who constructs the Google `OAuth2Client`: `calendar-adapter.ts` vs. `storage-adapter.ts` (AD-10)

AD-10's rule: "the Google OAuth refresh token — is persisted exclusively by `storage-adapter.ts`, rewritten
immediately after every refresh; no other adapter caches or persists it." This pins *who writes the token to
disk*, but not *who constructs and holds the live `google-auth-library` `OAuth2Client` object* — and that
object inherently holds the refresh token (and current access token) in memory as its `credentials`, and is
the thing that fires the `on('tokens', ...)` refresh event. Someone has to own that object.

**Task A — `adapters/calendar-adapter.ts` (FR-21, FR-22):** since it is the only file that imports
`@googleapis/calendar` (per the Stack table) and `@googleapis/calendar` needs an authenticated client, this
task builds `calendar-adapter.ts` to construct its own `OAuth2Client`, read the current refresh token once at
startup via a call to `storageAdapter.getRefreshToken(): string`, attach its own `on('tokens')` listener, and
call `storageAdapter.saveRefreshToken(token: string): void` whenever the library refreshes. This satisfies
AD-10's letter exactly: `storage-adapter.ts` is still the only file that *persists* the token, and
`calendar-adapter.ts`'s in-memory hold is transient/inherent to using the OAuth2Client, arguably not the kind
of "caching" AD-10 means to forbid (or arguably is — the wording doesn't distinguish "persist" from "hold in
memory for one process's lifetime").

**Task B — `adapters/storage-adapter.ts` (FR-15, FR-20–23 token persistence):** built independently, reads
AD-10 as assigning it full ownership of the OAuth *token lifecycle*, not just the write. It constructs the
`OAuth2Client` itself, attaches the refresh listener internally, and exposes only
`storageAdapter.getCalendarClient(): OAuth2Client` (or `withFreshAccessToken<T>(fn)`) to `calendar-adapter.ts`
— deliberately never exposing a raw `getRefreshToken()`/`saveRefreshToken()` pair, to make it structurally
impossible for another file to hold the token.

Both tasks are individually defensible under AD-10's actual wording — it never says which file constructs the
`OAuth2Client`, and never says whether "no other adapter caches" bans an in-memory hold necessary to make an
API call at all. But their `storage-adapter.ts` public interfaces are mutually exclusive: Task A's
`calendar-adapter.ts` calls `getRefreshToken()`/`saveRefreshToken()`, which Task B's `storage-adapter.ts` never
exports; Task B's `calendar-adapter.ts` (built by whoever actually wins the real `storage-adapter.ts` shape)
would instead need to call `getCalendarClient()`, which Task A's version never exports. Whichever
`storage-adapter.ts` actually lands, one `calendar-adapter.ts` implementation fails to compile against it — a
direct AD-9 file-ownership collision (two tasks each assumed they owned "who constructs the OAuth2Client")
that AD-10 doesn't assign to either file by name.

**Fix:** Name the owner explicitly in AD-10: "`storage-adapter.ts` is the sole file that imports
`google-auth-library` and constructs the process's one `OAuth2Client` instance; it exposes only a narrow
accessor (e.g. `getCalendarClient(): OAuth2Client`) to `calendar-adapter.ts`. `calendar-adapter.ts` must never
import `google-auth-library`, construct an `OAuth2Client`, or read/hold the raw refresh-token string in any
form." This resolves both the interface-shape collision and the "is holding it in memory forbidden" ambiguity
by making the in-memory hold legal in exactly one named file.

---

## Verdict

The spine's ADs are individually sound but under-specify four things a build-time task split needs and will
independently guess at: (1) the field-level shape and identity semantics of the shared `domain.ts` types, (2)
the exact signature and input semantics of the one shared function AD-6 mandates, (3) what a Propose/Apply
"session" is and how a proposal crosses process boundaries, and (4) who owns a live stateful object
(`OAuth2Client`, or the SQLite write lock) versus who owns merely persisting/reading its data. None of the six
pairs above requires bending or misreading an AD — each task is a reasonable, letter-compliant build of its
own file in isolation.

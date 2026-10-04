# Claude export import — design

Date: 2026-10-03
Status: awaiting Spencer's review

## Problem

Spencer has years of conversations with Claude (claude.ai) that hold durable
facts about him: preferences, goals, decisions, how he likes to plan. Yoh's
memory (`memory_items`) starts from only what he has told Yoh directly, so
Yoh knows far less about him than Claude does.

Yoh's memory is a small curated set, not an archive: items are at most 280
characters (`MEMORY_ITEM_MAX_CHARS`), the always-loaded folders are capped at
60 items in total (`ALWAYS_LOADED_CAP`), and the rest are matched by
full-text search. A raw import of transcripts would not fit and would drown
recall.

## Goal

Distil the Claude data export into a few dozen durable facts, reviewed by
Spencer line by line, and file them as memory items.

Success: after one import, the Memory page shows the approved facts in the
right folders, each traceable to the import batch; nothing Spencer did not
approve is filed; nothing he told Yoh directly is replaced.

## Decisions (Spencer, 2026-10-03)

- Outcome: "know me better". Facts go into Yoh's memory. No archive, no Notion mining.
- Review: Spencer edits a plain file; a second step files what is left.
- Sources: everything, staged. Claude's saved memory and project instructions first, then conversations, merged.
- Approach: an extractor script on the Mac plus an import route on the server.

## Flow

1. Spencer unzips the export outside the repo. The export is never committed.
2. On the Mac: `node --env-file=.env src/shell/claude-export-cli.ts <export-dir> --out candidates.md`.
3. Spencer edits `candidates.md`: deletes lines, rewords, moves lines between folder headings.
4. Spencer sends the file to `POST /api/memory/import?dryRun=1` on the Pi over the tailnet, reads the report, then sends it again without `dryRun`.

## Extractor (`src/shell/claude-export-cli.ts`)

A one-shot CLI beside `backup-cli.ts` (it lives under `src/` because only `src/` and `tests/` are typechecked). Its pure logic is in `src/core/claude-export.ts` and its one model call in `src/adapters/claude-export-llm.ts`. It opens no Yoh database and calls no Yoh route.

**Step 0 — confirm the layout.** The export's file names and JSON shapes are
confirmed against the real export before any parsing code is written. The
expected contents are conversations (with full message history), projects
(instructions and attached docs) and, if enabled, Claude's saved memory.
The readers for each are isolated in one module so a layout difference is a
one-place change. A missing source (e.g. no saved memory) is reported and
skipped, not an error.

**Stage 1 — already-distilled sources.** Claude's saved memory and project
instructions go through one Haiku call that rewrites them as Yoh-shaped
candidates.

**Stage 2 — conversations.** Conversations are batched by size. Only
Spencer's own messages are sent as evidence; Claude's replies are dropped, so
its guesses never become facts about him. Haiku returns candidates:

| Field | Rule |
|---|---|
| `folder` | one of the eight `MemoryFolder` values |
| `text` | at most 280 characters, a standalone fact |
| `sensitive` | `health`, `emotion` or `finance`, when it applies |
| `sourceDate` | the date of the conversation the fact came from |

The prompt tells the model to return durable facts only (not one-off
requests, not facts about other people, not anything time-bound that has
passed) and to return nothing for a batch with none.

**Merge.** Near-duplicate candidates collapse to one. The newest wording
wins; a stage 1 fact wins over a stage 2 fact.

**Output (`candidates.md`).** One line per fact under a heading per folder
(the labels from `memoryFolderLabel`), each line ending with its source date
and `[sensitive]` where flagged. A header shows the count per folder and the
always-loaded total against the cap of 60, so Spencer can see how many to
cut before importing.

**Resumable.** Each batch's result is cached on disk next to the output. A
rerun or a crash does not repeat a paid call. The script prints total tokens
and cost at the end (`src/core/llm-cost.ts`).

**Secrets.** The API key is read from `.env` and never printed. The model is
Haiku 4.5, from the existing exported model constant.

## Import

### Parser (`src/core/memory-import.ts`, pure)

Turns the file text into candidates: folder from the heading, text from the
line, `sensitive` from the marker. Returns the candidates and a list of
unparseable lines with their line numbers. An unknown heading is an
unparseable line, not a guess.

### Validation (`src/core/memory-filing.ts`)

`validateFiling` stops at `MEMORY_FILING_MAX_ITEMS` (2) per chat turn, which
is right for chat and wrong for an import. The per-candidate check is split
out as its own pure function; `validateFiling` and the import both call it.
Chat behaviour does not change.

### App function (`src/app/import-memory.ts`)

`importMemory(deps, { candidates, dryRun }) => Promise<Result<ImportMemoryResponse, YohError>>`

It computes the batch tag from today in `YOH_TIMEZONE` and returns it in the report.

- **Origin.** `inferred` by default. A candidate under a stated-only folder
  (`feedback`, `planning-preferences`) or flagged sensitive is filed as
  `stated`: the existing rules reject inferred items in both cases, and
  Spencer approved the line by hand.
- **Duplicates.** A candidate whose normalized text matches a current memory
  item is skipped. Imports never supersede existing memory.
- **Rule changes.** Never produced by an import. An import cannot alter
  planning settings.
- **Cap.** If filing would take the always-loaded folders past
  `ALWAYS_LOADED_CAP`, the whole import is refused with a validation error
  naming how many to cut. Nothing is written.
- **Write.** One `writeTx`. Each item's `source_turn_id` is the batch tag
  (`import:claude-<YYYY-MM-DD>`), so a batch can be found later with no
  schema change. One outbox row on `MEMORY_TOPIC` in the same transaction,
  through a new `insertMany` on the memory item store.
- **Memory page.** An item whose source is an import tag shows no source
  link (without this it would read as "source deleted").
- **Report.** `filed`, `skippedDuplicate` and `rejected` (with reason), each
  as a count and the lines. `dryRun` returns the same report and writes
  nothing.

### Route (`POST /api/memory/import`)

In `createApp`. The shell reads the body as text, runs the parser, and
returns a validation envelope naming the line if any line is unparseable.
Otherwise it calls `importMemory` once and returns
`c.json(wire(result), httpStatus(result))`. `dryRun` comes from the query
string. The response type goes in `src/types/api.ts`.

## Errors and undo

- Unparseable file: validation error naming the line; nothing written.
- Over the cap: validation error with the number to cut; nothing written.
- Memory not configured: the existing `MEMORY_NOT_CONFIGURED` envelope.
- Repeating an import is harmless: every line is skipped as a duplicate.
- Single items are edited or deleted in the Memory page as today. Bulk
  removal of a batch by tag is not built.

## Tests

- `tests/core-memory-import.test.ts`: headings, markers, unparseable lines, unknown headings.
- `tests/core-memory-filing.test.ts`: the split-out check; `validateFiling` unchanged for chat.
- `tests/app-import-memory.test.ts` with fake stores: dry run writes nothing, duplicates skipped, cap refusal, stated promotion, no rule changes, batch tag set, one outbox row.
- Route test: unparseable body, dry run, real run.
- Extractor: a small fabricated export fixture and a fake LLM client; covers source readers, own-messages-only, merge order, cache reuse.
- No real export data in the repo. No real Anthropic calls in tests. No web changes, so no Playwright.

## Cost

Stage 1 is one call. Stage 2 depends on the export's size, which is unknown
until it arrives; the script reports the estimate before the first batch and,
when it is over $5, stops until it is run again with `--yes`.

## Out of scope

- A searchable archive of the conversations.
- Mining old chats for Notion tasks or projects.
- A review queue in the web UI.
- Exports from other assistants.
- Bulk removal of an import batch.

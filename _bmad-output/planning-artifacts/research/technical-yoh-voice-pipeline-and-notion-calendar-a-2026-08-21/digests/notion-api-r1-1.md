# Digest: Notion API integration — Round 1

## Claims

- The Notion API uses date-based versioning via the required `Notion-Version` request header; a new version is issued only for backwards-incompatible changes, older versions keep working with no stated sunset. Current version per live official docs is **2026-03-11**.
  - Source: https://developers.notion.com/reference/versioning — Publisher: Notion (official docs) — pub_date: live/undated — accessed: 2026-08-21 — confidence: high — class: version

- A third-party blog (Fazm) claimed 2026-04-01 is the current version ("Views API" addition) — **conflicts** with the official docs value (2026-03-11) fetched directly. Flagged as unresolved contradiction; lean toward the direct official-docs fetch.
  - Source: https://fazm.ai/blog/notion-api-updates-2026 — Publisher: Fazm Blog (third-party) — pub_date: unclear — accessed: 2026-08-21 — confidence: low — class: version

- Largest confirmed breaking change in the last 12 months: the **2025-09-03 "data sources" migration** — databases become containers holding multiple data sources, each with its own schema; pages reference a `data_source_id` (not just `database_id`) as parent; new `/v1/data_sources` endpoint family. Old version (2022-06-28) still works for single-data-source databases but errors (`multiple_data_sources_for_database`) if a database gains multiple sources. Notion states no current deprecation process for old versions.
  - Source: https://developers.notion.com/docs/upgrade-faqs-2025-09-03 — Publisher: Notion (official docs) — pub_date: ~2025-08/09 — accessed: 2026-08-21 — confidence: high — class: version

- Notion added native **webhooks** (real-time event delivery instead of polling): create a subscription with a public HTTPS endpoint, verify via `verification_token`, validate payloads with HMAC-SHA256 (JS SDK ships `verifyWebhookSignature()`). Event types include `page.content_updated` (aggregated/delayed for rapid edits), `comment.created`, `database.schema_updated`/`data_source.schema_updated`, `page.locked`. Webhook URLs cannot be localhost, must be public/SSL. A secondary source ties this to API version 2026-03-01/public-beta — not reconciled with official docs.
  - Source: https://developers.notion.com/reference/webhooks — Publisher: Notion (official docs) — accessed: 2026-08-21 — confidence: high — class: pattern
  - Secondary (beta-timing detail only): https://fazm.ai/blog/notion-api-webhooks-support-2026 — confidence: low

- Notion also has a separate no-code "automations" webhook trigger (Slack/Zapier-style) distinct from the REST API webhook subscription system — two different mechanisms.
  - Source: hookdeck.com Notion webhooks guide (via search synthesis, not independently fetched) — confidence: low — class: pattern

- **Auth pattern**: Internal integrations use a static integration-secret token, scoped to a single workspace, no Notion review required, requires manually sharing each page/database with the integration. Correct pattern for a single-user personal automation. Public/OAuth integrations use full OAuth 2.0, work across arbitrary workspaces — unnecessary overhead for a personal script.
  - Source: https://developers.notion.com/guides/get-started/authorization (via search snippet, not independently fetched) — Publisher: Notion (official docs) — confidence: medium — class: auth

- **Rate limits (two-source confirmed)**: ~3 requests/second average per integration/connection, with some burst allowance; separate per-workspace shared limit scaled to plan. Rate-limited requests return HTTP 429 (`rate_limited`) or 529 (`service_overload`), both carry `Retry-After` header. Secondary source (citing a Notion engineer) restates as "2,700 calls per 15 minutes per token" — arithmetically consistent with 3 req/s.
  - Source: https://developers.notion.com/reference/request-limits — Publisher: Notion (official docs) — confidence: high — class: rate-limit
  - Secondary: https://dev.to/kanta13jp1/notion-api-rate-limits-are-breaking-your-automation-heres-the-real-fix-o5p — confidence: medium

- Public/reviewed integrations can request higher throughput (up to 100 req/s) for Enterprise workspaces via Notion sales — not relevant to a personal internal integration.
  - Source: dev.to (same as above) — single-source, not corroborated — confidence: low — class: rate-limit

- **Payload/size limits** (official): 1000 block elements / 500KB overall payload cap; URL strings 2000 chars, email strings 200 chars, rich-text/array-type properties 100 elements max per request.
  - Source: https://developers.notion.com/reference/request-limits — Publisher: Notion (official docs) — confidence: high — class: rate-limit

- **Pagination**: page-property retrieval defaults to 100 items/page with `start_cursor`; must loop until `has_more` is false. The "forgetting to paginate → silent truncation" gotcha is plausible but not independently verified via a forum post this round.
  - Source: https://developers.notion.com/reference/retrieve-a-page-property (via search snippet, not independently fetched) — confidence: medium — class: pattern

- **Date/timezone quirk**: a date filter value with a time component but no explicit timezone defaults to UTC comparison — commonly cited source of off-by-hours bugs. Not independently fetched this round (search-snippet only).
  - confidence: low-medium — class: pattern

- **Rollup/formula properties**: computed/derived, not directly settable via page-property updates (only source properties are writable) — consistent with widely-repeated developer knowledge but not freshly confirmed via a dedicated official-docs fetch this round.
  - confidence: low-medium — class: pattern

- **SDKs**: Official `notion-sdk-js` (JS/TS, `makenotion/notion-sdk-js`) with built-in `Notion-Version` default + webhook signature helper. No first-party Python SDK; `notion-client` (PyPI, `ramnes/notion-sdk-py`) is the de facto community "official-style" port; other unofficial wrappers exist with varying maintenance.
  - Source: https://github.com/makenotion/notion-sdk-js — confidence: high — class: other
  - Source: https://pypi.org/project/notion-client/ — confidence: medium — class: other

## Leads

- Fetch `reference/filter-data-source-entries` / `reference/post-database-query` (or 2025-09-03+ successors) directly for exact current filter/sort/pagination JSON shapes.
- Fetch `reference/patch-page` directly to confirm exact property-update JSON shape and get an authoritative rollup/formula read-only statement.
- Dedicated official-docs fetch to reconcile "two webhook systems" (REST webhooks vs. no-code automations) — currently only from third-party (Hookdeck) synthesis.
- `stackscout.net` "Notion API Integrations Guide (2026)" surfaced as directly on-topic — not fetched this round.
- Notion community forum + `makenotion/notion-sdk-js` GitHub issues as sources for corroborated dated "implementation reality" gotchas (pagination truncation, timezone bugs) — not reached this round.
- Confirm whether internal integrations share the same 3 req/s limit or a different one — official doc as fetched didn't split this out explicitly by integration type.

## Gaps

- No independently-fetched forum/GitHub-issue-level account of pagination bugs, timezone bugs, or rollup/formula read-only errors — currently resting on search-engine summaries of official-doc pages, not direct fetches or genuine community posts.
- Version discrepancy unresolved: official docs (direct fetch) say 2026-03-11; a third-party blog says 2026-04-01 with a "Views API" addition — not resolved via a second official-source fetch within budget.
- Webhook public-beta-vs-GA status not independently confirmed beyond one official fetch (no beta designation mentioned there) vs. secondary blog's 2026-03-01/beta claim.
- Budget spent before a direct fetch of database-query and page-property-update reference pages — those two endpoint-shape claims rest on search snippets only.

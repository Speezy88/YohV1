# Digest: Notion API integration — Round 2 (lead-following)

## Claims

1. Notion's official current API version is **2026-03-11** (not 2026-04-01). The blog's "2026-04-01" claim appears to be a misattribution — the "Views API" it cites actually launched March 19, 2026 as a feature addition under the existing 2026-03-11 version, not as a new version number. No API version named 2026-04-01 exists in Notion's own changelog.
   - Source: https://developers.notion.com/reference/versioning ; https://developers.notion.com/page/changelog — Publisher: Notion (official docs) — accessed: 2026-08-21 — confidence: high — class: version (contradiction from R1 now resolved)

2. Post-2026-03-11 changelog activity (Views API Mar 19; tab blocks Mar 25; heading-4/tab icons/'me' filters Mar 30; Developer Terms update Apr 2; markdown param for comments Apr 7; comment update/delete + multi-value filters Apr 17; query pagination depth cap of 10,000 results Apr 20; pagination cursor improvements Apr 22) all shipped as feature/endpoint additions without triggering a new dated API version beyond 2026-03-11.
   - Source: https://developers.notion.com/page/changelog — confidence: high — class: version

3. `POST /v1/databases/{id}/query` is explicitly marked **deprecated** as of version 2025-09-03; Notion directs developers to the "Query a data source" endpoint instead. Filters use and/or compound objects; sorts are ordered arrays where earlier entries take precedence.
   - Source: https://developers.notion.com/reference/post-database-query — confidence: high — class: pattern

4. The current "Query a data source" endpoint accepts `sorts`, `filter`, `start_cursor`, `page_size`, `is_archived`, `result_type`. Response: `{object:"list", next_cursor, has_more, results:[...], request_status:{type, incomplete_reason}}`. Pagination caps at **10,000 results per query** (per an Apr 20, 2026 changelog entry).
   - Source: https://developers.notion.com/reference/query-a-data-source — confidence: high — class: pattern

5. For `PATCH /v1/pages/{id}`: select properties take `{"select":{"id"|"name","color"}}`, status properties mirror this under `"status"`, date properties take `{"date":{"start","end","time_zone"}}`, number properties take `{"number": <float>}`. Docs explicitly state under Limitations: **"Updating rollup property values is not supported."** No equivalent explicit statement was found prohibiting formula-property updates — formulas being read-only is implied by their computed nature, not stated outright on this page.
   - Source: https://developers.notion.com/reference/patch-page — confidence: high (rollup) / medium (formula gap, absence not confirmed exhaustively) — class: pattern

6. Notion's rate-limit reference states an average of **3 requests/second per integration/connection**, bursts allowed, plus a separate workspace-level cap scaled to paid plan. The page does **not** explicitly differentiate the rate limit between internal (single-workspace) and public/OAuth integrations — framed by "per integration" and "per workspace," not integration type. `rate_limit_reason` can be `public_api_request_rate_limit` or `public_api_space_request_rate_limit`, but no internal-vs-public split is stated.
   - Source: https://developers.notion.com/reference/request-limits — confidence: high — class: rate-limit (resolves R1 lead — same limit applies regardless of integration type, per the absence of any stated split)

## Leads

- GitHub issue `makenotion/notion-sdk-js#334` ("v2 SDK does not return page properties") — pagination/query-related, not fetched directly.
- GitHub issue `makenotion/notion-sdk-js#480` ("Notion Formula Has a Bug Regarding Time Formatting") — timezone-adjacent, about formulas not date properties, not fetched.
- Community post on community.notionapps.com (third-party, not Notion's own forum): "Timezone Issue: Formula results with formatDate() display in UTC instead of local time (JST)" — directly on-topic for the UTC-default timezone bug, only seen via snippet.
- Changelog notes a new "timezone" field for `@now`/`@today` template variables in Create/Update page endpoints (defaults to UTC unless specified) — an implicit official acknowledgment that UTC-default timezone behavior was a known pain point, corroborating (once verified directly) the R1 UTC-default finding.

## Gaps

- Question about a genuine community/GitHub-sourced pagination or timezone bug report was not conclusively resolved — budget exhausted before a direct fetch of any of the three leads above; this violates the "prefer direct confirmation over snippets" preference and should be the first thing chased in any future refresh.
- Could not confirm whether Notion's docs anywhere explicitly state formula properties are read-only (only rollups were explicitly confirmed non-updatable on the patch-page reference).
- Did not independently verify the original fazm.ai blog's exact wording to characterize precisely how it arrived at "2026-04-01" — the reconstruction (conflating the Mar 19 Views API launch with a fictitious version bump) is a reasonable inference from the official changelog timeline, not a direct quote-level rebuttal.
- Dimension budget reached (max_depth=2 cap) — no further rounds; remaining gaps carry forward as open questions.

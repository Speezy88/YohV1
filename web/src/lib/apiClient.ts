/**
 * web/src/lib/apiClient.ts
 *
 * Story 7.5, AD-17: the ONE way `web/` talks to the server. `hc<AppType>`
 * gives every `/api/*` call compiler-checked request/response shapes from
 * the server's own route type — `AppType` is imported `import type` only
 * (Ruling R2), so this file holds no runtime dependency on `src/`.
 *
 * Fix (Story 7.7, the first real caller): `shell/server.ts`'s routes are
 * registered as literal full paths (`.get("/api/health", …)`, never a Hono
 * `.basePath("/api")`), so `AppType`'s generated client type nests every
 * route under an `api` segment (`apiClient.api.health.$get`,
 * `apiClient.api.notifications.$get`, …) — the base URL passed to `hc()`
 * is a plain string prefix, unrelated to that type-level nesting. Passing
 * `"/api"` here as originally written double-prefixed every request to
 * `/api/api/...` (a real request never exercised it before this story). The
 * base is `""` (site root) and every call site spells the segment itself:
 * `apiClient.api.<route>...`.
 */
import { hc } from "hono/client";
import type { AppType } from "../../../src/types/api.ts";

// The server refuses any non-GET `/api/*` request that isn't sent as JSON (its cross-origin POST guard),
// so body-less POSTs such as `plan.sync.$post()` carry the header too.
export const apiClient = hc<AppType>("", { headers: { "Content-Type": "application/json" } });

/**
 * web/src/lib/apiClient.ts
 *
 * Story 7.5, AD-17: the ONE way `web/` talks to the server. `hc<AppType>`
 * gives every `/api/*` call compiler-checked request/response shapes from
 * the server's own route type — `AppType` is imported `import type` only
 * (Ruling R2), so this file holds no runtime dependency on `src/`.
 */
import { hc } from "hono/client";
import type { AppType } from "../../../src/types/api.ts";

export const apiClient = hc<AppType>("/api");

/**
 * src/adapters/search-adapter.ts
 *
 * FR-28, AD-14: Yoh's ONLY web-search capability — read-only end to end,
 * structurally incapable of writing anything (this file imports nothing
 * from `notion-adapter.ts`/`calendar-adapter.ts`, and never may). Calls
 * Perplexity's Agent API (`/v1/responses`) directly via Node's built-in
 * `fetch`, mirroring `notification-adapter.ts`'s minimal-dependency
 * `FetchLike` seam — no SDK. Targets the Agent API deliberately, not
 * Sonar's `/v1/chat/completions`, which is deprecated 2026-09-27 (AD-14).
 *
 * `search`'s signature here is `(config, query)` — the injectable-
 * config-first shape every adapter in this codebase uses. AD-14's own
 * quoted "exactly `search(query: string): Promise<Result<SearchAnswer,
 * YohError>>`" describes the bound, zero-config closure a `shell/*.ts`
 * caller threads through (`chat-cli.ts` binds one from its own env-loaded
 * config) — the same "quoted signature names the bound dependency, not the
 * raw export" reading `notion-adapter.ts`'s own `setTaskStatus`
 * Implementer note already established for this spine.
 *
 * **Documented assumption (no live Perplexity account is available in this
 * environment to confirm against — the same situation
 * `notification-adapter.ts`/`email-adapter.ts` already operate under for
 * their own providers):** the Agent API's JSON response carries an
 * `output` array; a `message`-typed item holds the answer text in its
 * `content[].text`, and a `search_results`-typed item holds citation URLs
 * in its own `search_results[].url` — there is no top-level `citations`
 * field (AD-14). If the real shape differs once a live account is
 * available, only `parseSearchResponse` below needs to change.
 */
import type { Result, SearchAnswer, YohError } from "../types/domain.ts";

// ============================================================================
// Injectable HTTP call (mirrors notification-adapter.ts's FetchLike)
// ============================================================================

export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string },
) => Promise<HttpResponseLike>;

// ============================================================================
// Config
// ============================================================================

export const PERPLEXITY_RESPONSES_ENDPOINT = "https://api.perplexity.ai/v1/responses";

/** The cheapest Perplexity model tier that still returns citations — per the Architecture Spine's own Deferred guidance ("pick the cheapest tier/preset that still returns usable citations"). Overridable via `SearchAdapterConfig.model`. */
export const DEFAULT_PERPLEXITY_MODEL = "sonar";

export interface SearchAdapterConfig {
  readonly apiKey: string;
  readonly fetch?: FetchLike;
  readonly endpoint?: string;
  readonly model?: string;
}

/**
 * Loads `SearchAdapterConfig` from `PERPLEXITY_API_KEY` — the same
 * "throw rather than silently run with a half-populated config" convention
 * `notification-adapter.ts`'s `loadPushoverConfigFromEnv` already uses.
 */
export function loadSearchAdapterConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SearchAdapterConfig {
  const apiKey = env["PERPLEXITY_API_KEY"];
  if (!apiKey) {
    throw new Error("search-adapter: missing required environment variable PERPLEXITY_API_KEY");
  }
  return { apiKey };
}

// ============================================================================
// Response parsing (see module docstring's documented assumption)
// ============================================================================

interface PerplexityOutputItem {
  readonly type?: string;
  readonly content?: ReadonlyArray<{ readonly text?: string }>;
  readonly search_results?: ReadonlyArray<{ readonly url?: string }>;
}

function parseSearchResponse(body: unknown): SearchAnswer {
  const output = (body as { readonly output?: readonly PerplexityOutputItem[] } | undefined)?.output ?? [];
  const answerParts: string[] = [];
  const citations: string[] = [];

  for (const item of output) {
    if (item.type === "message" && item.content) {
      for (const block of item.content) {
        if (typeof block.text === "string" && block.text.length > 0) answerParts.push(block.text);
      }
    }
    if (item.type === "search_results" && item.search_results) {
      for (const result of item.search_results) {
        if (typeof result.url === "string" && result.url.length > 0) citations.push(result.url);
      }
    }
  }

  return { answer: answerParts.join("\n").trim(), citations };
}

// ============================================================================
// search (AD-9's primary export)
// ============================================================================

/**
 * Runs one Perplexity Agent API search for `query`. A legitimate zero-result
 * answer (an `output` with no usable message/citations) is a successful
 * `Result` carrying `{ answer: "", citations: [] }` — never a `YohError`
 * (AD-14: "found nothing" and "failed" are not the same event). A real
 * transport failure, an HTTP 429, or any other non-2xx response are the
 * only `YohError` cases.
 */
export async function search(config: SearchAdapterConfig, query: string): Promise<Result<SearchAnswer, YohError>> {
  const httpFetch = config.fetch ?? (globalThis.fetch as FetchLike);
  const endpoint = config.endpoint ?? PERPLEXITY_RESPONSES_ENDPOINT;
  const model = config.model ?? DEFAULT_PERPLEXITY_MODEL;

  let response: HttpResponseLike;
  try {
    response = await httpFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model, input: query }),
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `search-adapter: could not reach Perplexity — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }

  if (response.status === 429) {
    return { ok: false, error: { kind: "rate-limited", message: "search-adapter: Perplexity rate-limited this request" } };
  }
  if (!response.ok) {
    return { ok: false, error: { kind: "unreachable", message: `search-adapter: Perplexity returned HTTP ${response.status}` } };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `search-adapter: could not parse Perplexity's response — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }

  return { ok: true, value: parseSearchResponse(body) };
}

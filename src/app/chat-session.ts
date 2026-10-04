/**
 * src/app/chat-session.ts
 *
 * Story 8.1 (C3). `ChatSession` is a mutable per-conversation holder the
 * SHELL creates as a plain literal — one per server-side chat session
 * (Story 8.9: originally also one per `chat-cli.ts` run) — and threads into every `app/*.ts` call that
 * needs it (`surfaceOpenItems`/`buildOpenItemQuestion`'s FR-25 inference,
 * and later `app/chat-turn.ts`'s "save that" search-answer lookup). No
 * exported functions here: this file only owns the shape and its one
 * tuning constant.
 */
import type { SearchAnswer } from "../types/domain.ts";

export interface ChatSession {
  recentMessages: string[];
  lastSearchAnswer: { readonly query: string; readonly answer: SearchAnswer } | undefined;
  /** Story 11.4: normalized messages already offered "Do you want to do research on this?" — each is offered once per session. */
  researchOffered: Set<string>;
}

/** The largest number of Spencer's own recent (non-blank) chat lines kept for FR-25 inference — mirrors `chat-cli.ts`'s pre-Epic-8 `RECENT_MESSAGES_WINDOW`. */
export const RECENT_MESSAGES_WINDOW = 20;

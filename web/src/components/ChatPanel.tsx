/**
 * web/src/components/ChatPanel.tsx
 *
 * Task 6A, Spencer's information-architecture decisions (2026-09-27): Chat
 * moves from `pages/Chat.tsx` into a panel shared by every page, opened
 * from the Ask Yoh pill or ⌘K (`PageShell.tsx`). The panel is large: it
 * covers the whole content area to the right of the sidebar, inset ~24px,
 * with only the sidebar still visible — the page behind is dimmed context,
 * not functional (`PageShell.tsx` marks it `inert`/`aria-hidden` while this
 * is open). Everything Epic 8 built keeps working unchanged, just moved:
 * streaming, the Thinking Indicator, inline Structured Questions, the
 * Command Palette, receipts, the three-region no-overlap layout (Task 0),
 * and the draft/transcript surviving a panel close (`chatStore.ts` is
 * untouched — this component only mounts/unmounts around it).
 *
 * Esc closes the panel (unless the Command Palette is open and consumes it
 * first, via its own capture-phase document listener + `stopPropagation` —
 * this component's Esc handler is a plain bubble-phase `onKeyDown`, so it
 * never fires once the palette has already stopped the event). Opening
 * focuses the Chat Input; closing returns focus to wherever it was
 * (`chatPanel.ts`).
 *
 * Real-use fixes plan, Task 2 (Spencer: "get rid of the 'waiting on you'
 * section in the chat"): the top-of-Chat `OpenItems` list is gone from this
 * panel entirely — a proposal or question that arrives as part of THIS
 * turn's own reply still renders inline in the stream (`ChatMessage.tsx`'s
 * `message.question`), unchanged. The header's top-right now shows a quiet
 * "N need data" chip instead (`lib/missingData.ts`, re-pointed to the
 * sandbox queue by Story 9.4 chunk B), which runs `/sandbox` in this same
 * panel on click.
 *
 * Task 6 addendum (Spencer): Task 2 removed "Waiting on you" and left
 * ritual-raised open interaction requests (data-completeness,
 * night close-out) with NO surface at all. This panel now surfaces them
 * itself: every open request `GET /api/open-items` reports appears as its
 * own Yoh message in the stream (`chatStore.ts`'s `appendPendingOpenItem`),
 * answerable inline exactly like any other Structured Question
 * (`ChatMessage.tsx`). `lib/openItems.ts`'s `startOpenItemsStream` runs only
 * while the panel is open (fetches once, then refetches on the shared
 * event bus's `"open-items"` hint — never a second `EventSource`, AD-18);
 * each fetch's items are handed to `appendPendingOpenItem`, which is itself
 * the "shown once per request id per session" dedupe, so this effect can
 * run on every render without tracking what it already showed. `OpenItems.tsx`
 * is gone (nothing else used it); the server route/store it read stay.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { appendPendingOpenItem, hydrateChatHistory, useChatStore } from "../lib/chatStore.ts";
import { useChatPanel, closeChatPanel } from "../lib/chatPanel.ts";
import { useMissingDataCount, missingDataChipLabel, openMissingData } from "../lib/missingData.ts";
import { startOpenItemsStream, useOpenItems } from "../lib/openItems.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { ChatMessage } from "./ChatMessage.tsx";
import { ChatInput } from "./ChatInput.tsx";
import { SandboxCard } from "./SandboxCard.tsx";
import { offerTodaysPattern } from "../lib/patternOffer.ts";
import { SandboxFinale } from "./SandboxFinale.tsx";
import { YohMark } from "./YohMark.tsx";

/** Once within this many px of the stream's bottom, it still counts as "at the bottom" — avoids auto-scroll flapping off/on from sub-pixel rounding while text streams in. */
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;

export function ChatPanel(): React.JSX.Element | null {
  const { open } = useChatPanel();
  const { entries } = useChatStore();
  const missingDataCount = useMissingDataCount();
  const openItems = useOpenItems();
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Story 13.1: restore today's Conversation on the first open (a no-op after).
  useEffect(() => {
    if (open) void hydrateChatHistory();
  }, [open]);

  // Task 6 addendum: only fetch/subscribe while the panel is actually open.
  useEffect(() => {
    if (!open) return;
    return startOpenItemsStream();
  }, [open]);

  // Task 6 addendum: hand every currently-open request to the chat store —
  // a no-op for one already shown this session (dedupe lives there).
  useEffect(() => {
    if (!open || openItems.status !== "loaded") return;
    for (const item of openItems.items) appendPendingOpenItem(item);
  }, [open, openItems]);

  // Story 13.13: the day's one Pattern card (the server enforces once per day across /morning and this).
  useEffect(() => {
    if (open) void offerTodaysPattern();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Focus the Chat Input the instant the panel opens (capture flow: click
    // the pill/⌘K, type, Enter — this is what makes "type" possible without
    // a fourth action). Scoped to the Chat Input's own textarea specifically
    // — a generic "first textarea or input" would instead grab an inline
    // Structured Question's free-text field when one renders above it in
    // the stream.
    panelRef.current?.querySelector<HTMLElement>('textarea[aria-label="Message Yoh"]')?.focus();
  }, [open]);

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream || !autoScroll || !open) return;
    if (typeof stream.scrollTo === "function") {
      stream.scrollTo({ top: stream.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    } else {
      stream.scrollTop = stream.scrollHeight;
    }
  }, [entries, autoScroll, reducedMotion, open]);

  const handleScroll = useCallback((): void => {
    const stream = streamRef.current;
    if (!stream) return;
    const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    setAutoScroll(distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX);
  }, []);

  const jumpToLatest = useCallback((): void => setAutoScroll(true), []);

  if (!open) return null;

  const chipLabel = missingDataChipLabel(missingDataCount);

  return (
    <>
      <div
        data-testid="chat-panel-backdrop"
        aria-hidden="true"
        onClick={closeChatPanel}
        className={`fixed inset-0 z-30 bg-scrim${reducedMotion ? "" : "transition-opacity"}`}
      />
      <div
        ref={panelRef}
        data-testid="chat-panel"
        role="dialog"
        aria-label="Chat with Yoh"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          closeChatPanel();
        }}
        className="fixed bottom-6 left-[268px] right-6 top-6 z-30 flex flex-col gap-4 rounded-2xl border-[length:var(--rim-width)] border-rim-structural bg-surface-raised p-8 shadow-extruded-lg"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <YohMark className="size-[34px] rounded-md" />
            <span className="font-body text-title font-bold text-ink-primary">Yoh</span>
          </div>
          <div className="flex items-center gap-3">
            {chipLabel && (
              // Real-use fixes plan, Task 2: the "N need data" chip
              // (Story 9.4, chunk B, re-points it at the sandbox queue).
              // `openMissingData` is its ONE click handler.
              <button
                type="button"
                data-testid="missing-data-chip"
                onClick={() => openMissingData()}
                className="rounded-full border-[length:var(--rim-width)] border-rim-interactive px-3 py-1.5 font-body text-small tabular-nums text-ink-secondary shadow-extruded-sm hover:text-ink-primary"
              >
                {chipLabel}
              </button>
            )}
            <button
              type="button"
              aria-label="Close chat"
              onClick={closeChatPanel}
              className="flex size-[42px] items-center justify-center rounded-md border-[length:var(--rim-width)] border-rim-interactive text-ink-secondary shadow-extruded-sm hover:text-ink-primary"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={streamRef} data-testid="chat-stream" onScroll={handleScroll} className="h-full min-h-0 flex-1 overflow-y-auto">
            <div role="log" aria-label="Conversation" className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-end gap-4 px-1 py-2">
              {entries.map((entry) =>
                entry.kind === "message" ? (
                  <ChatMessage key={entry.id} message={entry.message} />
                ) : entry.kind === "sandbox-card" ? (
                  <SandboxCard key={entry.id} view={entry.view} status={entry.status} {...(entry.receipt ? { receipt: entry.receipt } : {})} />
                ) : (
                  <SandboxFinale
                    key={entry.id}
                    status={entry.status}
                    {...(entry.savedCount !== undefined ? { savedCount: entry.savedCount } : {})}
                    {...(entry.failedTitles ? { failedTitles: entry.failedTitles } : {})}
                    {...(entry.summaryFailed ? { summaryFailed: entry.summaryFailed } : {})}
                  />
                ),
              )}
            </div>
          </div>
          {!autoScroll && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <button
                type="button"
                data-testid="jump-to-latest"
                onClick={jumpToLatest}
                className="notification-glass pointer-events-auto rounded-full px-4 py-1 font-body text-small font-bold text-ink-primary"
              >
                Jump to latest
              </button>
            </div>
          )}
        </div>

        <div data-testid="chat-input-region" className="mx-auto w-full max-w-2xl">
          <ChatInput />
        </div>
      </div>
    </>
  );
}

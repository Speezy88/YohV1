/**
 * web/src/pages/Chat.tsx
 *
 * Story 8.5, UX-DR36/40: the conversation stream, centered, with the Chat
 * Input pinned below it. The left bar is reserved for the Skill Switcher,
 * which Phase 2 hides, so it stays in the layout as an empty column. Chat
 * registers no launch-splash gate (AD-17: Home's "home-data" is the only
 * one). The transcript and draft live in `chatStore.ts`, so they outlast a
 * swipe or the Screensaver.
 *
 * Story 8.6 (Task 7), UX-DR36: every open interaction request/Proposal
 * renders above the transcript via `OpenItems.tsx`, fetched and kept live by
 * `openItems.ts` (fetch on mount, then a `topic: "open-items"` hint via the
 * shared event bus — never a second `EventSource`, AD-18). Answering one, or
 * an inline `turn.question` inside the transcript itself
 * (`ChatMessage.tsx`), never gates the Chat Input: `chatTurn` itself never
 * blocks on an open item (contract C4), and this page adds no disable
 * condition of its own.
 *
 * Task 0 (real-use fix, 2026-09-27): once a conversation runs long, this
 * page is a full-height column of three regions that must never overlap —
 * (1) open items at the top, in their own capped/collapsible region
 * (`OpenItems.tsx` owns its own scroll cap and collapse, Chat only keeps
 * that region from growing via `shrink-0`); (2) the message stream, the
 * ONE flexible, scrollable region (`min-h-0 flex-1 overflow-y-auto`); (3)
 * the Chat Input, pinned below in normal flow (never absolutely
 * positioned). Auto-scroll keeps the newest turn in view unless Spencer has
 * scrolled up, which pauses it and surfaces "Jump to latest" — this layout
 * is self-contained to Chat's own components (not PageShell) so it carries
 * over unchanged when Chat becomes a panel shown over every page.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatStore } from "../lib/chatStore.ts";
import { startOpenItemsStream, useOpenItems } from "../lib/openItems.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { ChatMessage } from "../components/ChatMessage.tsx";
import { ChatInput } from "../components/ChatInput.tsx";
import { OpenItems } from "../components/OpenItems.tsx";

/**
 * Once within this many px of the stream's bottom, it still counts as "at
 * the bottom" — without this, a sub-pixel rounding delta while text streams
 * in could flip auto-scroll off and on every frame.
 */
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;

export default function ChatPage(): React.JSX.Element {
  const { messages } = useChatStore();
  const openItems = useOpenItems();
  const reducedMotion = useReducedMotion();
  const streamRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => startOpenItemsStream(), []);

  // Keep the newest turn in view as turns are added and text streams in —
  // unless Spencer has scrolled up to read back, in which case this is a
  // no-op until he scrolls back down himself or clicks "Jump to latest".
  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream || !autoScroll) return;
    if (typeof stream.scrollTo === "function") {
      stream.scrollTo({ top: stream.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    } else {
      // jsdom (the test environment) has no `Element.scrollTo` at all — an
      // instant fallback is also the right behavior for reduced motion.
      stream.scrollTop = stream.scrollHeight;
    }
  }, [messages, autoScroll, reducedMotion]);

  const handleScroll = useCallback((): void => {
    const stream = streamRef.current;
    if (!stream) return;
    const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    setAutoScroll(distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX);
  }, []);

  const jumpToLatest = useCallback((): void => setAutoScroll(true), []);

  const hasOpenItems = openItems.status === "loaded" && openItems.items.length > 0;

  return (
    <div className="flex h-full">
      <div data-testid="skill-switcher-reserved" aria-hidden="true" className="hidden w-14 shrink-0 sm:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        {hasOpenItems && (
          <div data-testid="open-items-region" className="mx-auto w-full max-w-2xl shrink-0 px-4 pt-4">
            <OpenItems items={openItems.status === "loaded" ? openItems.items : []} />
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          <div ref={streamRef} data-testid="chat-stream" onScroll={handleScroll} className="h-full min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-end gap-3 px-4 py-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
            </div>
          </div>
          {!autoScroll && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <button
                type="button"
                data-testid="jump-to-latest"
                onClick={jumpToLatest}
                className="notification-glass pointer-events-auto rounded-full px-4 py-1 font-body text-body font-bold text-ink-primary"
              >
                Jump to latest
              </button>
            </div>
          )}
        </div>
        {/* Bottom padding clears the fixed Page Indicator dots below the input. */}
        <div data-testid="chat-input-region" className="mx-auto w-full max-w-2xl px-4 pb-10">
          <ChatInput />
        </div>
      </div>
    </div>
  );
}

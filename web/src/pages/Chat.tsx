/**
 * web/src/pages/Chat.tsx
 *
 * Story 8.5, UX-DR36/40: the conversation stream, centered, with the Chat
 * Input pinned below it. The left bar is reserved for the Skill Switcher,
 * which Phase 2 hides, so it stays in the layout as an empty column. Chat
 * registers no launch-splash gate (AD-17: Home's "home-data" is the only
 * one). The transcript and draft live in `chatStore.ts`, so they outlast a
 * swipe or the Screensaver.
 */
import { useLayoutEffect, useRef } from "react";
import { useChatStore } from "../lib/chatStore.ts";
import { ChatMessage } from "../components/ChatMessage.tsx";
import { ChatInput } from "../components/ChatInput.tsx";

export default function ChatPage(): React.JSX.Element {
  const { messages } = useChatStore();
  const streamRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as turns are added and text streams in.
  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [messages]);

  return (
    <div className="flex h-full">
      <div data-testid="skill-switcher-reserved" aria-hidden="true" className="hidden w-14 shrink-0 sm:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={streamRef} data-testid="chat-stream" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-end gap-3 px-4 py-4">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
          </div>
        </div>
        {/* Bottom padding clears the fixed Page Indicator dots below the input. */}
        <div className="mx-auto w-full max-w-2xl px-4 pb-10">
          <ChatInput />
        </div>
      </div>
    </div>
  );
}

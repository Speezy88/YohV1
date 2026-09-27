/**
 * web/e2e/chat-long-conversation.spec.ts — Task 0 (real-use fix, reported
 * 2026-09-27): once a conversation grows, the message stream, the open
 * items region, and the Chat Input must never overlap. Runs ≥30 turns
 * through the fixture's scripted `runChatTurn` (`tests/e2e/fixture-server.ts`)
 * and checks real bounding boxes in a real browser (Vitest/jsdom can't lay
 * out pixels).
 *
 * This spec deliberately runs BEFORE `open-items.spec.ts` in file-name
 * order — the fixture seeds exactly one open item (a Time Budget proposal)
 * before the page ever loads, and `open-items.spec.ts` later answers it
 * (permanently consuming it, since the fixture server is one shared
 * process for the whole suite). So this spec only OBSERVES that seeded
 * item — it never answers it — to leave it intact for that later spec.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE_PROPOSAL_TEXT = "Move your Time Budget to 7 hours today?";
const FIXTURE_CHAT_REPLY = "Hello, Spencer. This is a fixture reply, streamed in three chunks.";
const TURNS = 30;

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByTestId("page-chat")).not.toHaveAttribute("aria-hidden", "true");
}

/**
 * Sends one turn and waits for its own reply (the `replyOccurrence`-th,
 * 0-based, match of the fixture's reply text — identical every turn, so
 * only counting occurrences proves THIS turn's own reply landed, not an
 * earlier turn's).
 *
 * Retries the `fill()`+Enter itself, not just the wait: this environment
 * occasionally drops an Enter press as a genuine no-op with no visible
 * trace (confirmed: no request even reaches the server) — a pre-existing
 * platform/automation quirk, reproducible even against the unmodified base
 * commit and via a bare `playwright-core` script outside any Chat.tsx
 * change, so it is out of this task's scope to chase further. A retry
 * (re-`fill()` the same text, re-press Enter) reliably unsticks it.
 */
async function sendTurnAndAwaitReply(input: Locator, stream: Locator, line: string, replyOccurrence: number): Promise<void> {
  const reply = stream.getByText(FIXTURE_CHAT_REPLY).nth(replyOccurrence);
  for (let attempt = 1; attempt <= 5; attempt++) {
    await input.fill(line);
    await input.press("Enter");
    try {
      await expect(reply).toBeVisible({ timeout: 3_000 });
      return;
    } catch {
      if (attempt === 5) throw new Error(`turn "${line}" never landed after ${attempt} attempts`);
    }
  }
}

test("a long conversation never lets the stream, open items, or the last message overlap the Chat Input", async ({ page }) => {
  test.setTimeout(120_000);
  await openChat(page);
  const chat = page.getByTestId("page-chat");

  // The fixture's one seeded open item is still here (see file comment) —
  // Task 0's "plus an open item" case, covered without touching it.
  await expect(chat.getByTestId("open-items-region")).toBeVisible();
  await expect(chat.getByText(FIXTURE_PROPOSAL_TEXT)).toBeVisible();

  const input = chat.getByRole("textbox", { name: "Message Yoh" });
  const stream = chat.getByTestId("chat-stream");
  for (let i = 0; i < TURNS; i++) {
    // eslint-disable-next-line no-await-in-loop -- turns are inherently
    // sequential here: only one is ever in flight (chatStore's `sending`
    // guard), so the next turn can't be sent until this one settles.
    await sendTurnAndAwaitReply(input, stream, `Testing overlap fix, turn ${i + 1}`, i);
  }

  // Genuinely 30 round-tripped turns landed (not just the last one, with
  // earlier attempts silently no-op'd) — a user + assistant message pair each.
  await expect(chat.locator('[data-testid^="chat-message-"]')).toHaveCount(TURNS * 2);

  const chatInputBox = await chat.getByTestId("chat-input").boundingBox();
  const openItemsBox = await chat.getByTestId("open-items-region").boundingBox();
  const streamBox = await chat.getByTestId("chat-stream").boundingBox();
  const lastMessageBox = await chat.locator('[data-testid^="chat-message-"]').last().boundingBox();

  expect(chatInputBox).not.toBeNull();
  expect(openItemsBox).not.toBeNull();
  expect(streamBox).not.toBeNull();
  expect(lastMessageBox).not.toBeNull();

  // The last message's bounding box sits fully above the Chat Input's.
  expect(lastMessageBox!.y + lastMessageBox!.height).toBeLessThanOrEqual(chatInputBox!.y);
  // No card (open items region, or the stream's own container box) ever
  // intersects the input.
  expect(openItemsBox!.y + openItemsBox!.height).toBeLessThanOrEqual(chatInputBox!.y);
  expect(streamBox!.y + streamBox!.height).toBeLessThanOrEqual(chatInputBox!.y);
});

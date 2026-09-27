/**
 * web/e2e/chat.spec.ts — Story 8.5's Playwright smoke, against
 * `tests/e2e/fixture-server.ts`, whose scripted chat turn (the
 * `runChatTurn` seam, never a real Claude call) emits a status event,
 * pauses, then streams FIXTURE_CHAT_REPLY in three deltas over the real
 * `POST /api/chat` SSE response.
 */
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_CHAT_REPLY = "Hello, Spencer. This is a fixture reply, streamed in three chunks.";

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByTestId("page-chat")).not.toHaveAttribute("aria-hidden", "true");
}

test("Enter shows Spencer's turn and the Thinking Indicator at once, then Yoh's reply streams in over POST /api/chat", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("page-chat");
  const input = chat.getByRole("textbox", { name: "Message Yoh" });
  await input.fill("Hello Yoh");

  const chatResponse = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  await input.press("Enter");

  await expect(chat.getByText("Hello Yoh")).toBeVisible();
  await expect(chat.getByTestId("thinking-indicator")).toBeVisible();
  await expect(input).toHaveValue("");

  const response = await chatResponse;
  expect(response.headers()["content-type"]).toContain("text/event-stream");

  await expect(chat.getByText(FIXTURE_CHAT_REPLY)).toBeVisible({ timeout: 5_000 });
  await expect(chat.getByTestId("thinking-indicator")).toHaveCount(0);
  // Scoped to the Chat Input's own Send button, not just any "Send" in the
  // page — the fixture server's `webServer` process is shared across every
  // spec file in the suite (Story 8.6's own `open-items.spec.ts` may leave
  // its seeded proposal's Structured Question — which also has a "Send"
  // button, for its free-text "Other" field — open or answered depending on
  // run order).
  await expect(chat.getByTestId("chat-input").getByRole("button", { name: "Send" })).toBeDisabled(); // blank draft, turn finished
});

test("the unsent draft and the transcript survive a swipe to another page and back", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("page-chat");
  const input = chat.getByRole("textbox", { name: "Message Yoh" });
  await input.fill("First message");
  await input.press("Enter");
  await expect(chat.getByText(FIXTURE_CHAT_REPLY)).toBeVisible({ timeout: 5_000 });

  await input.fill("Draft that never got sent");
  await page.getByRole("button", { name: "Home" }).click();
  await expect(chat).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Chat" }).click();

  await expect(input).toHaveValue("Draft that never got sent");
  await expect(chat.getByText("First message")).toBeVisible();
  await expect(chat.getByText(FIXTURE_CHAT_REPLY)).toBeVisible();
});

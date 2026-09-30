/**
 * web/e2e/chat.spec.ts — Story 8.5's Playwright smoke, against
 * `tests/e2e/fixture-server.ts`, whose scripted chat turn (the
 * `runChatTurn` seam, never a real Claude call) emits a status event,
 * pauses, then streams FIXTURE_CHAT_REPLY in three deltas over the real
 * `POST /api/chat` SSE response.
 *
 * Task 6A (2026-09-27) rewrite: Chat is a panel, not a page — opened via
 * the Ask Yoh pill or ⌘K, closed via Esc/the Close button/the backdrop.
 */
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_CHAT_REPLY = "Hello, Spencer. This is a fixture reply, streamed in three chunks.";

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("Enter shows Spencer's turn and the Thinking Indicator at once, then Yoh's reply streams in over POST /api/chat", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
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
  await expect(chat.getByTestId("chat-input").getByRole("button", { name: "Send" })).toBeDisabled(); // blank draft, turn finished
});

test("Esc closes the Chat panel; the unsent draft and the transcript survive close and reopen", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  const input = chat.getByRole("textbox", { name: "Message Yoh" });
  await input.fill("First message");
  await input.press("Enter");
  await expect(chat.getByText(FIXTURE_CHAT_REPLY)).toBeVisible({ timeout: 5_000 });

  await input.fill("Draft that never got sent");
  await page.keyboard.press("Escape");
  await expect(chat).not.toBeVisible();

  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(input).toHaveValue("Draft that never got sent");
  await expect(chat.getByText("First message")).toBeVisible();
  await expect(chat.getByText(FIXTURE_CHAT_REPLY)).toBeVisible();
});

test("the Close button closes the panel; focus returns to the Ask Yoh pill", async ({ page }) => {
  await openChat(page);
  await page.getByRole("button", { name: "Close chat" }).click();
  await expect(page.getByTestId("chat-panel")).not.toBeVisible();
  await expect(page.getByRole("button", { name: /ask yoh/i })).toBeFocused();
});

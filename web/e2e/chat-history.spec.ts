/**
 * web/e2e/chat-history.spec.ts — Story 13.1: the server owns today's
 * Conversation, so a reload (or a second device) restores it.
 */
import { expect, test } from "@playwright/test";

const FIXTURE_CHAT_REPLY = "Hello, Spencer. This is a fixture reply, streamed in three chunks.";

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("a message and its reply are still shown after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  const chat = page.getByTestId("chat-panel");
  await chat.getByRole("combobox", { name: "Message Yoh" }).fill("Remember this exchange");
  await chat.getByRole("combobox", { name: "Message Yoh" }).press("Enter");
  await expect(chat.getByText(FIXTURE_CHAT_REPLY)).toBeVisible({ timeout: 5_000 });

  await page.reload();
  await page.getByRole("button", { name: /ask yoh/i }).click();
  const restored = page.getByTestId("chat-panel");
  await expect(restored.getByText("Remember this exchange")).toBeVisible();
  // .first(): a previous spec's late reply can land after this spec's reset.
  await expect(restored.getByText(FIXTURE_CHAT_REPLY).first()).toBeVisible();
});

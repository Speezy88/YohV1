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
  await page.getByRole("button", { name: /ask meeseek/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("Enter shows Spencer's turn and the Thinking Indicator at once, then Meeseek's reply streams in over POST /api/chat", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  const input = chat.getByRole("combobox", { name: "Message Meeseek" });
  await input.fill("Hello Meeseek");

  const chatResponse = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  await input.press("Enter");

  await expect(chat.getByText("Hello Meeseek")).toBeVisible();
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
  const input = chat.getByRole("combobox", { name: "Message Meeseek" });
  await input.fill("First message");
  await input.press("Enter");
  await expect(chat.getByText(FIXTURE_CHAT_REPLY)).toBeVisible({ timeout: 5_000 });

  await input.fill("Draft that never got sent");
  await page.keyboard.press("Escape");
  await expect(chat).not.toBeVisible();

  await page.getByRole("button", { name: /ask meeseek/i }).click();
  await expect(input).toHaveValue("Draft that never got sent");
  await expect(chat.getByText("First message")).toBeVisible();
  await expect(chat.getByText(FIXTURE_CHAT_REPLY)).toBeVisible();
});

test("the Close button closes the panel; focus returns to the Ask Meeseek pill", async ({ page }) => {
  await openChat(page);
  await page.getByRole("button", { name: "Close chat" }).click();
  await expect(page.getByTestId("chat-panel")).not.toBeVisible();
  await expect(page.getByRole("button", { name: /ask meeseek/i })).toBeFocused();
});

// Polish-6 final-review fixes (S1, S2, S3, S5, skip link, Back): keyboard and focus in a real browser.

const NOTIFICATION = { id: "n-e2e", kind: "operational", title: "E2E notice", body: "E2E notice body", deepLink: null, createdAt: new Date().toISOString() };

test("S1: after the missing-data chip runs /sandbox, Escape returns focus to the Ask Meeseek pill", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await chat.getByTestId("missing-data-chip").click();
  await expect(chat.getByTestId("sandbox-card").or(chat.getByText("Nothing's missing a Due Date or Duration."))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chat).not.toBeVisible();
  await expect(page.getByRole("button", { name: /ask meeseek/i })).toBeFocused();
});

test("S2: Escape closes the panel after a click on the transcript left focus on body", async ({ page }) => {
  await openChat(page);
  await page.getByTestId("chat-stream").click({ position: { x: 5, y: 5 } });
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chat-panel")).not.toBeVisible();
});

test("S3: with the panel open, Tab reaches a notification's buttons", async ({ page }) => {
  await page.route("**/api/notifications", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { ok: true, value: { notifications: [NOTIFICATION] } } }) : route.continue(),
  );
  await page.goto("/");
  await expect(page.getByTestId("notification-card")).toBeVisible();
  await page.getByRole("button", { name: /ask meeseek/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  const dismiss = page.getByRole("button", { name: "Dismiss notification" });
  let reached = false;
  for (let i = 0; i < 8 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await dismiss.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
});

test("S5: after Try again the commands load and focus is back on the Chat Input", async ({ page }) => {
  let fail = true;
  await page.route("**/api/commands", (route) => {
    if (!fail) return route.continue();
    fail = false;
    return route.fulfill({ status: 500, json: { ok: false, error: { kind: "unreachable", message: "no" } } });
  });
  await openChat(page);
  const input = page.getByRole("combobox", { name: "Message Meeseek" });
  await input.fill("/");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.getByRole("listbox").getByRole("alert")).toHaveCount(0);
});

test("the skip link is not tabbable while the panel is open", async ({ page }) => {
  await openChat(page);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent)).not.toBe("Skip to content");
  }
});

test("browser Back with the panel open closes the panel and keeps the page", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => page.evaluate(() => location.hash)).not.toBe("#home");
  const hash = await page.evaluate(() => location.hash);
  await page.getByRole("button", { name: /ask meeseek/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("chat-panel")).not.toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe(hash);
});

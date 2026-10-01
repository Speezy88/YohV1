/**
 * web/e2e/rating.spec.ts — Story 13.11: after a substantive turn (`/morning`
 * in the fixture) the occasional "How is Yoh doing?" prompt appears; the fixture
 * forces the probability draw, so the day's one prompt shows on the first
 * substantive turn and never on a non-substantive one.
 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FIXTURE_RATING_NOTE } from "../../tests/e2e/fixture-memory-seed.ts";

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

async function say(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("chat-panel").getByRole("combobox", { name: "Message Yoh" });
  await input.fill(text);
  await input.press("Enter");
}

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("a substantive turn shows the prompt; a 3 folds to Rated 3 (good); no second prompt that day", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await say(page, "/morning");
  await expect(chat.getByText("Fixture morning.")).toBeVisible({ timeout: 10_000 });
  await expect(chat.getByRole("radiogroup", { name: "How is Yoh doing?" })).toBeVisible();

  // Scan after the fade-in finishes (finite animations only), so contrast is measured at full opacity.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number)).map((a) => a.finished)));
  const results = await new AxeBuilder({ page }).include('[data-testid="rating-prompt"]').analyze();
  expect(results.violations).toEqual([]);

  await chat.getByRole("radio", { name: "3 Good" }).click();
  await expect(chat.getByText("Rated 3 (good)")).toBeVisible();
  await expect(chat.getByRole("radio")).toHaveCount(0);

  await say(page, "/morning");
  await expect(chat.getByText("Fixture morning.")).toHaveCount(2, { timeout: 10_000 });
  await expect(chat.getByRole("radiogroup")).toHaveCount(0);
});

test("a 1 asks What was off?; the note files to Feedback with a receipt and Undo", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await say(page, "/morning");
  await chat.getByRole("radio", { name: "1 Poor" }).click();
  await expect(chat.getByText("Rated 1 (poor)")).toBeVisible();
  await chat.getByRole("textbox", { name: "What was off?" }).fill(FIXTURE_RATING_NOTE);
  await chat.getByTestId("rating-prompt").getByRole("button", { name: "Send" }).click();
  const receipt = chat.getByTestId("remembered-receipt");
  await expect(receipt).toHaveText(`Remembered: ${FIXTURE_RATING_NOTE} · Feedback · for this kind of request · Undo`, { timeout: 10_000 });
  await expect(chat.getByRole("textbox", { name: "What was off?" })).toHaveCount(0);
  await expect(chat.getByText("Rated 1 (poor)")).toBeVisible();
});

test("key 2 on the focused group answers", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await say(page, "/morning");
  const radio = chat.getByRole("radio", { name: "1 Poor" });
  await expect(radio).toBeVisible();
  await radio.focus();
  await page.keyboard.press("2");
  await expect(chat.getByText("Rated 2 (okay)")).toBeVisible();
});

test("Not now removes the prompt", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await say(page, "/morning");
  await chat.getByRole("button", { name: "Not now" }).click();
  await expect(chat.getByRole("radiogroup")).toHaveCount(0);
  await expect(chat.getByText("How is Yoh doing?")).toHaveCount(0);
});

test("a non-substantive message never prompts", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await say(page, "Hello there");
  await expect(chat.getByText("This is a fixture reply, streamed in three chunks.")).toBeVisible({ timeout: 10_000 });
  await expect(chat.getByRole("radiogroup")).toHaveCount(0);
});

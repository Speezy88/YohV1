/**
 * web/e2e/missing-data-chip.spec.ts — real-use fixes plan, Task 2; re-pointed
 * by Story 9.4 (chunk B) to the sandbox queue.
 *
 * Deliberately count-agnostic (a prior ruling: specs must not depend on
 * whether `sandbox.spec` ran first — every spec file shares ONE fixture
 * server/DB for the whole Playwright run, `web/playwright.config.ts`'s own
 * `workers: 1`). This spec asserts the chip's shape ("N need data") and its
 * click behavior (opens Chat with `/sandbox` already running — either the
 * first Sandbox Card or the empty-queue reply, since run order changes the
 * queue) without asserting an exact count, and never saves anything itself.
 */
import { expect, test, type Page } from "@playwright/test";

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("the Chat header's chip shows the sandbox queue count and never a 'Waiting on you' section", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");

  expect(await chat.getByText(/waiting on you/i).count()).toBe(0);
  await expect(chat.getByTestId("missing-data-chip")).toHaveText(/^\d+ need data$/);
});

test("clicking the chip runs /sandbox in the same Chat panel", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await chat.getByTestId("missing-data-chip").click();

  // Still the same Chat panel — the chip never closes/navigates away.
  await expect(chat).toBeVisible();

  // Either the first Sandbox Card appears, or the queue is already empty —
  // run order across the shared fixture DB decides which, and this spec
  // asserts neither by saving/skipping.
  await expect(chat.getByTestId("sandbox-card").or(chat.getByText("Nothing's missing a Due Date or Duration."))).toBeVisible();
});

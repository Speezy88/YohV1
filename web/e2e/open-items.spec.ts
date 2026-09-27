/**
 * web/e2e/open-items.spec.ts — Story 8.6's Playwright smoke, against
 * `tests/e2e/fixture-server.ts`, which seeds one open `"proposal"`
 * interaction request (a Time Budget change) directly via
 * `putOpenInteractionRequest` — exactly as a ritual would, never through
 * `chatTurn` — before the page ever loads (Review Focus #1).
 */
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PROPOSAL_TEXT = "Move your Time Budget to 7 hours today?";

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

// Order matters: the fixture server is one shared process for the whole
// suite, and answering the seeded proposal clears it permanently — so the
// non-destructive case runs FIRST, and the chip-answers-it case (which
// consumes the fixture's one seeded item) runs LAST.

test("unrelated chat still sends while an open item is visible (Review Focus #5)", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await expect(chat.getByText(FIXTURE_PROPOSAL_TEXT)).toBeVisible();

  const input = chat.getByRole("textbox", { name: "Message Yoh" });
  await expect(input).toBeEnabled();
  await input.fill("what's on my plan today");
  await input.press("Enter");

  await expect(chat.getByText("what's on my plan today")).toBeVisible();
  // The open item is still there — answering chat never touches it.
  await expect(chat.getByText(FIXTURE_PROPOSAL_TEXT)).toBeVisible();
});

test("an open item seeded before the page loads renders at the top of Chat, and a chip pick answers it", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await expect(chat.getByText(FIXTURE_PROPOSAL_TEXT)).toBeVisible();

  await chat.getByRole("button", { name: "Yes" }).click();

  // The card leaves the top-of-Chat list once answered, and the exchange
  // (Spencer's "yes", then Yoh's receipt) appears in the transcript below.
  await expect(chat.getByText(FIXTURE_PROPOSAL_TEXT)).toHaveCount(0);
  await expect(chat.getByText("yes")).toBeVisible();
  await expect(chat.getByText(/updated your Time Budget/i)).toBeVisible();
});

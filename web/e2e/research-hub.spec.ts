/**
 * web/e2e/research-hub.spec.ts — Task 6C's Playwright smoke for the
 * Research Hub page, against `tests/e2e/fixture-server.ts`'s fake Research
 * Vault data source (no real Notion). Covers the real end-to-end path: the
 * seeded list renders with its title/date/source count and links out to
 * the item's own Notion page, and the ask box opens the Chat panel with
 * the typed question, which runs the real `POST /api/chat` (the fixture's
 * scripted `runChatTurn`). The empty-vault state's exact copy is a Vitest
 * concern (`ResearchHub.test.tsx`) — this fixture always seeds two rows.
 */
import { expect, test, type Page } from "@playwright/test";

async function openResearchHub(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Research Hub", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Research Hub", level: 1 })).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-research").boundingBox())?.y).toBe(0);
}

test("the recent Research Vault list renders title, date, and source count, each linking to its own Notion page", async ({ page }) => {
  await openResearchHub(page);

  const apBio = page.getByTestId("research-row").filter({ hasText: "AP Bio registration deadline" });
  await expect(apBio).toBeVisible();
  await expect(apBio).toContainText("Sep 20, 2026");
  await expect(apBio).toContainText("2 sources");
  await expect(apBio).toHaveAttribute("href", "https://notion.so/rv-ap-bio");
  await expect(apBio).toHaveAttribute("target", "_blank");

  const hiking = page.getByTestId("research-row").filter({ hasText: "Best hiking boots under $150" });
  await expect(hiking).toContainText("1 source");
});

test("the ask box opens the Chat panel with the typed question, as Spencer's own turn", async ({ page }) => {
  await openResearchHub(page);
  // Once the Chat panel opens, `PageShell.tsx` marks every page `inert`/
  // `aria-hidden` (defense-in-depth over the panel) — `getByRole` excludes
  // an aria-hidden subtree from the accessibility tree entirely, so the
  // post-submit assertion below needs a plain CSS locator, not a role one.
  const ask = page.locator('input[aria-label="Ask a research question"]');
  await ask.fill("AP Bio registration deadline");

  const chatResponse = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  await ask.press("Enter");

  const chat = page.getByTestId("chat-panel");
  await expect(chat).toBeVisible();
  // `.last()`: the fixture server keeps chat history for the whole run, so a
  // retry (or an earlier ask of the same question) leaves stored turns with
  // the same text above the new one.
  await expect(chat.getByText("AP Bio registration deadline").last()).toBeVisible();
  await expect(ask).toHaveValue("");
  await chatResponse;
});

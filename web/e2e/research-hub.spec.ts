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
import AxeBuilder from "@axe-core/playwright";

// Mirrors the fixture's exports (`tests/e2e/fixture-server.ts`); not imported, because importing that file starts the fixture server.
const FIXTURE_RESEARCH_AP_BIO = { title: "AP Bio registration deadline", body: ["Registration closes October 1, 2026.", "Late registration adds a fee of $40."] } as const;
const FIXTURE_RESEARCH_HIKING = { title: "Best hiking boots under $150", body: "Pick a mid-cut boot with a waterproof liner." } as const;
const FIXTURE_RESEARCH_PAGE_2_TITLE = "Filler research 02";

async function openResearchHub(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Research Hub", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Research Hub", level: 1 })).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-research").boundingBox())?.y).toBe(0);
}

test("the Research Box shows the newest document, and the library rows show title, date and source count", async ({ page }) => {
  await openResearchHub(page);

  const box = page.getByRole("region", { name: "Research document" });
  await expect(box.getByRole("heading", { name: FIXTURE_RESEARCH_AP_BIO.title })).toBeVisible();
  await expect(box).toContainText("Sep 20, 2026");
  await expect(box).toContainText(FIXTURE_RESEARCH_AP_BIO.body[0]);
  await expect(box).toContainText(FIXTURE_RESEARCH_AP_BIO.body[1]);
  await expect(box.getByRole("link", { name: "https://example.com/ap-bio-1" })).toHaveAttribute("target", "_blank");
  await expect(box.getByRole("link", { name: "Open in Notion" })).toHaveAttribute("href", "https://notion.so/rv-ap-bio");

  const apBio = page.getByTestId("research-row").filter({ hasText: FIXTURE_RESEARCH_AP_BIO.title });
  await expect(apBio).toContainText("Sep 20, 2026");
  await expect(apBio).toContainText("2 sources");
  await expect(apBio).toHaveAttribute("aria-current", "true");
  const hiking = page.getByTestId("research-row").filter({ hasText: FIXTURE_RESEARCH_HIKING.title });
  await expect(hiking).toContainText("1 source");
});

test("clicking a library row opens that document in the box, in place, and marks the row", async ({ page }) => {
  await openResearchHub(page);
  const box = page.getByRole("region", { name: "Research document" });
  const hiking = page.getByTestId("research-row").filter({ hasText: FIXTURE_RESEARCH_HIKING.title });
  await hiking.click();
  await expect(box.getByRole("heading", { name: FIXTURE_RESEARCH_HIKING.title })).toBeVisible();
  await expect(box).toContainText(FIXTURE_RESEARCH_HIKING.body);
  await expect(hiking).toHaveAttribute("aria-current", "true");
  await expect(hiking).toContainText("Viewing");
  // The marker is not colour alone: the current row has a visible left rim in its computed style.
  const rim = await hiking.evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(parseFloat(rim)).toBeGreaterThan(0);
  await expect(page.getByTestId("research-row").filter({ hasText: FIXTURE_RESEARCH_AP_BIO.title })).not.toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { name: "Research Hub", level: 1 })).toBeVisible();
});

test("Show more adds the rest of the vault and then disappears; axe passes", async ({ page }) => {
  await openResearchHub(page);
  const rows = page.getByTestId("research-row");
  await expect(rows).toHaveCount(20);
  await expect(page.getByRole("button", { name: "Show more" })).toBeVisible();
  await expect(page.getByText(FIXTURE_RESEARCH_PAGE_2_TITLE)).toHaveCount(0);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(rows).toHaveCount(23);
  await expect(page.getByTestId("research-row").filter({ hasText: FIXTURE_RESEARCH_PAGE_2_TITLE })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);

  const results = await new AxeBuilder({ page }).include('[data-testid="page-research"]').analyze();
  expect(results.violations).toEqual([]);
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
  // Strict on purpose: exactly one turn carries the question. The panel loads
  // stored history while this send is in flight, and a duplicate here means
  // the stored copy was shown beside the live one (`hydrateChatHistory`).
  await expect(chat.getByText("AP Bio registration deadline")).toBeVisible();
  await expect(ask).toHaveValue("");
  await chatResponse;
});

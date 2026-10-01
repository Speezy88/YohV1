/**
 * web/e2e/pattern.spec.ts — Story 13.13 (T14b): a pending Pattern card reaches Spencer once per day,
 * on /morning or the first Chat-panel open, and sits at the top of the Memory Patterns folder.
 * The fixture server calls the REAL offerPattern, so the once-per-day rule is the server's own.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATTERN, FIXTURE_PATTERN_EVIDENCE, FIXTURE_PATTERN_HEADLINE, FIXTURE_PATTERN_QUESTION } from "../../tests/e2e/fixture-memory-seed.ts";

const AREA = FIXTURE_PATTERN.area;
const rail = (page: Page) => page.getByRole("navigation", { name: "Memory" });

async function seedPattern(request: import("@playwright/test").APIRequestContext): Promise<void> {
  expect((await request.post("/__fixture/seed-pattern")).ok()).toBe(true);
}

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

async function openPatternsFolder(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Memory", level: 1 })).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-memory").boundingBox())?.y).toBe(0);
  await rail(page).getByRole("button", { name: /^Patterns/ }).click();
}

async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
}

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("first Chat open shows the Pattern card; Yes files a receipt and a padding override", async ({ page, request }) => {
  await seedPattern(request);
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  const card = chat.getByTestId("structured-question");
  await expect(card.getByText(FIXTURE_PATTERN_HEADLINE)).toBeVisible({ timeout: 10_000 });
  await expect(card.getByText(FIXTURE_PATTERN_EVIDENCE)).toBeVisible();
  await expect(card.getByText(FIXTURE_PATTERN_QUESTION)).toBeVisible();
  await expect(card.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "No", exact: true })).toBeVisible();
  await expect(card.getByRole("textbox")).toHaveCount(0);

  await card.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(chat.getByText(`Planning 30 extra min for ${AREA} Tasks. Revert it on the Memory page.`)).toBeVisible({ timeout: 10_000 });
  const receipt = chat.getByTestId("remembered-receipt");
  await expect(receipt).toContainText("Remembered:");
  await expect(receipt).toContainText("Patterns");
  await expect(chat.getByRole("button", { name: "Undo" })).toHaveCount(0);

  await page.getByRole("button", { name: "Close chat" }).click();
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect.poll(async () => (await page.getByTestId("page-memory").boundingBox())?.y).toBe(0);
  await rail(page).getByRole("button", { name: /^Changed settings/ }).click();
  await expect(page.getByText(new RegExp(AREA))).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^Revert .*${AREA}`, "i") }).click();
  await expect(page.getByText(/^Reverted/)).toBeVisible();
});

test("/morning carries the card and reopening the panel shows no second one that day", async ({ page, request }) => {
  await seedPattern(request);
  // Keep the panel-open offer from consuming the day's one offer before /morning runs.
  await page.route("**/api/memory/pattern-offer", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, value: {} }) }),
  );
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  const input = chat.getByRole("combobox", { name: "Message Yoh" });
  await input.fill("/morning");
  await input.press("Enter");
  await expect(chat.getByText("Fixture morning.")).toBeVisible({ timeout: 10_000 });
  await expect(chat.getByText(FIXTURE_PATTERN_HEADLINE)).toHaveCount(1);
  await expect(chat.getByText(FIXTURE_PATTERN_QUESTION)).toBeVisible();

  // Answer it, then close and reopen against the real server: the day's offer is spent.
  await chat.getByTestId("structured-question").getByRole("button", { name: "No", exact: true }).click();
  await expect(chat.getByText("Okay. I won't ask about that again for a while.")).toBeVisible({ timeout: 10_000 });
  await page.unroute("**/api/memory/pattern-offer");
  await page.getByRole("button", { name: "Close chat" }).click();
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByTestId("structured-question")).toHaveCount(0);
});

test("one card per day across surfaces: the panel's offer is spent by /morning's, server side", async ({ page, request }) => {
  await seedPattern(request);
  const first = await (await request.get("/api/memory/pattern-offer")).json();
  expect(first.value.question.requestId).toMatch(/^proposal:pattern-/);
  const second = await (await request.get("/api/memory/pattern-offer")).json();
  expect(second.value.question).toBeUndefined();
  await openChat(page);
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByTestId("structured-question")).toHaveCount(0);
});

test("No on the Memory Patterns folder removes the card and files nothing", async ({ page, request }) => {
  await seedPattern(request);
  await page.goto("/");
  await openPatternsFolder(page);
  const list = page.getByRole("list", { name: "Patterns" });
  const card = list.getByTestId("structured-question");
  await expect(card.getByText(FIXTURE_PATTERN_HEADLINE)).toBeVisible();
  await expect(card.getByText(FIXTURE_PATTERN_EVIDENCE)).toBeVisible();
  await expect(card.getByRole("button", { name: "Yes", exact: true })).not.toBeFocused();
  await card.getByRole("button", { name: "No", exact: true }).click();
  await expect(list.getByText("Okay. I won't ask about that again for a while.")).toBeVisible({ timeout: 10_000 });
  await expect(list.getByTestId("structured-question")).toHaveCount(0);
  await expect(list.getByTestId("memory-item")).toHaveCount(0);

  const memory = await (await request.get("/api/memory")).json();
  expect(memory.value.pendingPatterns).toEqual([]);
  const patterns = memory.value.folders.find((f: { folder: string }) => f.folder === "patterns");
  expect(patterns.items).toEqual([]);
});

test("no pending pattern: opening Chat shows nothing extra", async ({ page }) => {
  await openChat(page);
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByTestId("structured-question")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: the Memory Patterns folder with a pending card is clean in ${scheme}`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await seedPattern(request);
    await page.goto("/");
    await openPatternsFolder(page);
    await expect(page.getByTestId("structured-question")).toBeVisible();
    await settleAnimations(page);
    const results = await new AxeBuilder({ page }).include('[data-testid="page-memory"]').analyze();
    expect(results.violations).toEqual([]);
  });
}

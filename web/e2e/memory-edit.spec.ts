/**
 * web/e2e/memory-edit.spec.ts — Story 13.10 (T11b): editing on the Memory page against the fixture
 * server's seeded items (`POST /__fixture/seed-memory`). Edit / duplicate merge / move / expiry /
 * delete with and without Undo, Needs review Renew and Keep, Revert, the rule-change chain from
 * Chat to Changed settings and back, a reduced-motion delete, and axe on the editing states.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_MEMORY_ITEMS, FIXTURE_RULE_TEXT } from "../../tests/e2e/fixture-memory-seed.ts";

const ITEM = (key: string) => FIXTURE_MEMORY_ITEMS.find((m) => m.key === key)!;
const rail = (page: Page) => page.getByRole("navigation", { name: "Memory" });
const rowOf = (page: Page, text: string) => page.getByTestId("memory-item").filter({ hasText: text });

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
  expect((await request.post("/__fixture/seed-memory")).ok()).toBe(true);
});

async function openMemory(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Memory", level: 1 })).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-memory").boundingBox())?.y).toBe(0);
}

/** Axe reads the blended color of a fading element; let entrance fades finish first. */
async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
}

async function openFolder(page: Page, label: RegExp): Promise<void> {
  await rail(page).getByRole("button", { name: label }).click();
}

async function openMenu(page: Page, text: string) {
  await page.getByRole("button", { name: `More actions for ${text}` }).click();
}

test("edit an Inferred item: Enter saves it, it shows Saved and is now Stated", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Ideas & notes/);
  const row = rowOf(page, ITEM("inferred").text);
  await expect(row).toContainText("Inferred");
  await row.getByRole("button", { name: ITEM("inferred").text, exact: true }).click();
  const field = page.getByRole("textbox", { name: "Edit memory" });
  await field.fill("Prefers deep work before noon");
  await field.press("Enter");
  const saved = rowOf(page, "Prefers deep work before noon");
  await expect(saved).toContainText("Saved");
  await expect(saved).toContainText("Stated");
});

test("Esc cancels an edit and keeps the old text", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Ideas & notes/);
  await rowOf(page, ITEM("inferred").text).getByRole("button", { name: ITEM("inferred").text, exact: true }).click();
  const field = page.getByRole("textbox", { name: "Edit memory" });
  await field.fill("something else");
  await field.press("Escape");
  await expect(page.getByRole("textbox", { name: "Edit memory" })).toHaveCount(0);
  await expect(rowOf(page, ITEM("inferred").text)).toBeVisible();
});

test("a duplicate edit offers a merge; Yes merges into the other item", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Ideas & notes/);
  await rowOf(page, ITEM("inferred").text).getByRole("button", { name: ITEM("inferred").text, exact: true }).click();
  const field = page.getByRole("textbox", { name: "Edit memory" });
  await field.fill("keep answers short in the morning.");
  await field.press("Enter");
  await expect(page.getByText(`Merge with '${ITEM("feedback").text}'?`)).toBeVisible();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  // The two items become one, holding the edited words.
  await expect(rowOf(page, ITEM("inferred").text)).toHaveCount(0);
  await expect(rowOf(page, "keep answers short in the morning.")).toHaveCount(1);
  await openFolder(page, /^Feedback/);
  await expect(page.getByTestId("memory-item")).toHaveCount(0);
});

test("move an item to another folder from the overflow menu", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Feedback/);
  await openMenu(page, ITEM("feedback").text);
  await page.getByRole("menuitem", { name: "Move to folder" }).click();
  await page.getByRole("menuitem", { name: "About you" }).click();
  await expect(rowOf(page, ITEM("feedback").text)).toHaveCount(0);
  await openFolder(page, /^About you/);
  await expect(rowOf(page, ITEM("feedback").text)).toContainText("Saved");
});

test("set an expiry, then clear it", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Feedback/);
  const row = rowOf(page, ITEM("feedback").text);
  await openMenu(page, ITEM("feedback").text);
  await page.getByRole("menuitem", { name: "Set expiry" }).click();
  await page.getByLabel("Expires on").fill("2099-01-15");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row).toContainText("Expires Jan 15");
  await openMenu(page, ITEM("feedback").text);
  await page.getByRole("menuitem", { name: "Clear expiry" }).click();
  await expect(row).not.toContainText("Expires");
});

test("delete with Undo brings the row back and sends no request", async ({ page }) => {
  const deletes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/memory/delete")) deletes.push(r.url());
  });
  await openMemory(page);
  await openFolder(page, /^Feedback/);
  await openMenu(page, ITEM("feedback").text);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByTestId("undo-toast")).toContainText(`Deleted '${ITEM("feedback").text}'`);
  await expect(rowOf(page, ITEM("feedback").text)).toHaveAttribute("data-dissolving", "true");
  await expect(rowOf(page, ITEM("feedback").text)).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rowOf(page, ITEM("feedback").text)).toBeVisible();
  await page.waitForTimeout(500);
  expect(deletes).toEqual([]);
});

test("delete without Undo: the row is gone once the toast closes", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Feedback/);
  await openMenu(page, ITEM("feedback").text);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByTestId("undo-toast")).toHaveCount(0, { timeout: 15_000 });
  await expect(rowOf(page, ITEM("feedback").text)).toHaveCount(0);
  await expect.poll(async () => {
    const body = await (await page.request.get("/api/memory")).json();
    return JSON.stringify(body).includes(ITEM("feedback").text);
  }).toBe(false);
});

test("reduced motion: the deleted row is gone at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMemory(page);
  await openFolder(page, /^Feedback/);
  await openMenu(page, ITEM("feedback").text);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(rowOf(page, ITEM("feedback").text)).toHaveCount(0, { timeout: 500 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rowOf(page, ITEM("feedback").text)).toBeVisible();
});

test("Needs review: Renew an expired item with a new expiry, and the rail row goes away", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Needs review/);
  const row = rowOf(page, ITEM("expired").text);
  await expect(row).toContainText("Expired");
  await row.getByRole("button", { name: "Renew" }).click();
  await row.getByLabel("New expiry").fill("2099-03-01");
  await row.getByRole("button", { name: "Set new expiry" }).click();
  await expect(rail(page).getByRole("button", { name: /^Needs review/ })).toHaveCount(0);
  await openFolder(page, /^Goals & projects/);
  await expect(rowOf(page, ITEM("expired").text)).toContainText("Expires Mar 1");
});

test("Needs review: Keep as history moves the item out of the list", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Needs review/);
  await rowOf(page, ITEM("expired").text).getByRole("button", { name: "Keep as history" }).click();
  await expect(rail(page).getByRole("button", { name: /^Needs review/ })).toHaveCount(0);
  await openFolder(page, /^Goals & projects/);
  await expect(rowOf(page, ITEM("expired").text)).toContainText("History");
});

test("Changed settings: Revert the seeded override", async ({ page }) => {
  await openMemory(page);
  await openFolder(page, /^Changed settings/);
  await expect(page.getByText(/^School-day work start: 4:00 PM \(was 3:15 PM\) - changed /)).toBeVisible();
  await page.getByRole("button", { name: "Revert School-day work start" }).click();
  await expect(page.getByText("Reverted to 3:15 PM.")).toBeVisible();
  await expect(page.getByText("No planning rules changed.")).toBeVisible({ timeout: 10_000 });
});

test("rule change chain: remember, Yes on the card, Changed settings, Revert", async ({ page, request }) => {
  await request.post("/__fixture/reset");
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  const chat = page.getByTestId("chat-panel");
  const input = chat.getByRole("textbox", { name: "Message Yoh" });
  await input.fill("remember that I want to start work at 2:30 on school days");
  await input.press("Enter");
  await expect(chat.getByTestId("remembered-receipt")).toContainText(`Remembered: ${FIXTURE_RULE_TEXT}`, { timeout: 10_000 });
  await expect(chat.getByText("Change school-day work start from 3:15 PM to 2:30 PM?")).toBeVisible({ timeout: 10_000 });
  await chat.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(chat.getByText("Changed school-day work start to 2:30 PM. Revert it on the Memory page.")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Close chat" }).click();
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect.poll(async () => (await page.getByTestId("page-memory").boundingBox())?.y).toBe(0);
  await openFolder(page, /^Changed settings/);
  await expect(page.getByText(/^School-day work start: 2:30 PM \(was 3:15 PM\)/)).toBeVisible();
  await page.getByRole("button", { name: "Revert School-day work start" }).click();
  await expect(page.getByText("Reverted to 3:15 PM.")).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: editing states are clean in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    // A failing edit shows the server's copy in text-ink-danger; axe covers its contrast.
    await page.route("**/api/memory/edit", (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: { kind: "conflict", message: "That item changed. Reload the page and try again." } }) }),
    );
    await openMemory(page);
    const scan = async (): Promise<void> => {
      await settleAnimations(page);
      const results = await new AxeBuilder({ page }).include('[data-testid="page-memory"]').analyze();
      expect(results.violations).toEqual([]);
    };

    await openFolder(page, /^Ideas & notes/);
    await rowOf(page, ITEM("inferred").text).getByRole("button", { name: ITEM("inferred").text, exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Edit memory" })).toBeVisible();
    await scan();
    await page.getByRole("textbox", { name: "Edit memory" }).fill("Changed words");
    await page.getByRole("textbox", { name: "Edit memory" }).press("Enter");
    await expect(page.getByRole("alert")).toContainText("That item changed");
    await scan();

    await openMenu(page, ITEM("inferred").text);
    await expect(page.getByRole("menu", { name: "Item actions" })).toBeVisible();
    await scan();
    await page.keyboard.press("Escape");

    await openFolder(page, /^Needs review/);
    await rowOf(page, ITEM("expired").text).getByRole("button", { name: "Renew" }).click();
    await expect(page.getByLabel("New expiry")).toBeVisible();
    await scan();

    await openFolder(page, /^Changed settings/);
    await expect(page.getByRole("button", { name: "Revert School-day work start" })).toBeVisible();
    await scan();
  });
}

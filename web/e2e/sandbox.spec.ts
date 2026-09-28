/**
 * web/e2e/sandbox.spec.ts — Story 9.2's Playwright smoke, against
 * `tests/e2e/fixture-server.ts`'s fake Notion Tasks data source.
 *
 * The fixture's Tasks seed has TWO Tasks missing a Required field (Due
 * Date and/or Estimated Duration): "College essay brainstorm" (`tp-nodate`,
 * missing both, Area "School"/Energy "Deep" already set) and the dedicated
 * "E2E Sandbox Task" (`e2e-sandbox`, also missing both, no Area/Energy).
 * `sandboxQueue`'s sort is soonest-due-first with no-due-date last, tied by
 * title (`app/sandbox-queue.ts`'s `compareItems`) — both have no due date,
 * and "College essay brainstorm" < "E2E Sandbox Task" alphabetically, so
 * IT is the first `/sandbox` card, not "E2E Sandbox Task" (verified against
 * the real fixture data and the real `compareItems`/`firstCardView`
 * sources rather than assumed).
 *
 * Deliberately SKIPS "College essay brainstorm" rather than saving it:
 * `tp-nodate` is also `web/e2e/tasks.spec.ts`'s ("No date · 2", the
 * "College essay brainstorm" row's own "Add due date"/"Add time" badges)
 * and `web/e2e/missing-data-chip.spec.ts`'s ("3 tasks missing data") fixture
 * Task, and every spec file shares ONE fixture server/DB for the whole
 * Playwright run (`web/playwright.config.ts`'s own `workers: 1` doc
 * comment) — actually writing `tp-nodate`'s Due Date/Duration here would
 * silently break those two already-committed specs' counts. `e2e-sandbox`
 * ("E2E Sandbox Task") has no such cross-spec assertion depending on it
 * staying incomplete, so it's this spec's own Save target — matching the
 * per-story plan's original intent (`tests/e2e/fixture-server.ts`'s own
 * comment: "Story 9.2: dedicated to /sandbox"). Skip never writes, so
 * `tp-nodate` stays exactly as those other specs expect it.
 *
 * Covers, in one session (Test 1): /sandbox opens the first card inline in
 * Chat ("College essay brainstorm", "1 remaining"); Skip advances without
 * writing, and the next card ("E2E Sandbox Task", "0 remaining") appears
 * below; filling both required fields there and Save writes to (fake)
 * Notion and the card settles "Saved", with no further card (the queue is
 * now empty). Test 2: a fresh `/sandbox` session afterward re-offers
 * "College essay brainstorm" (skipped, not saved, so still eligible) —
 * Skip there again confirms it was never written.
 */
import { expect, test, type Page } from "@playwright/test";

interface FixtureTaskRow {
  readonly id: string;
  readonly dueDate?: string;
  readonly minutes?: number;
}

async function openChatAndRunSandbox(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  const input = page.getByTestId("chat-panel").getByRole("textbox", { name: "Message Yoh" });
  await input.fill("/sandbox");
  // The Command Palette (Story 8.7) mounts as soon as the draft starts with
  // "/" and fetches the command registry (`GET /api/commands`) on its OWN
  // mount; its capture-phase keydown listener (`CommandPalette.tsx`)
  // unconditionally swallows Enter while it's mounted, whether or not that
  // fetch has resolved yet — so pressing Enter before the "/sandbox" row
  // itself is showing (the fetch race) is a silently dropped keystroke, not
  // a send. Waiting for the exact row first matches how a human actually
  // uses it (type, see the match highlighted, then Enter).
  await page.getByTestId("command-row-/sandbox").waitFor();
  await input.press("Enter");
}

async function fixtureTaskRow(page: Page, taskId: string): Promise<FixtureTaskRow | undefined> {
  const res = await page.request.get("/__fixture/state?taskId=none");
  const rows = ((await res.json()) as { tasksRows: FixtureTaskRow[] }).tasksRows;
  return rows.find((r) => r.id === taskId);
}

test("/sandbox: Skip on the first card writes nothing and advances; Save on the next writes to Notion and settles 'Saved'", async ({ page }) => {
  await openChatAndRunSandbox(page);
  const chat = page.getByTestId("chat-panel");
  const firstCard = chat.getByTestId("sandbox-card");
  await expect(firstCard).toBeVisible();
  await expect(firstCard.getByText("College essay brainstorm")).toBeVisible();
  await expect(firstCard.getByText("1 remaining")).toBeVisible();

  const skipResponse = page.waitForResponse((r) => r.url().includes("/api/sandbox/") && r.url().endsWith("/skip"));
  await firstCard.getByRole("button", { name: "Skip" }).click();
  await skipResponse;
  await expect(firstCard.getByText("Skipped", { exact: true })).toBeVisible();

  // Nothing written for the skipped Task.
  const skippedRow = await fixtureTaskRow(page, "tp-nodate");
  expect(skippedRow?.dueDate).toBeUndefined();
  expect(skippedRow?.minutes).toBeUndefined();

  // The next (and only remaining) card: the fixture's dedicated
  // "E2E Sandbox Task", "0 remaining".
  const nextCard = chat.getByTestId("sandbox-card").last();
  await expect(nextCard.getByText("E2E Sandbox Task")).toBeVisible();
  await expect(nextCard.getByText("0 remaining")).toBeVisible();

  const save = nextCard.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  await nextCard.getByLabel("Due Date").fill("2026-10-05");
  await nextCard.getByLabel("Estimated Duration").fill("30");
  await expect(save).toBeEnabled();

  const saveResponse = page.waitForResponse((r) => r.url().includes("/api/sandbox/") && r.url().endsWith("/save"));
  await save.click();
  await saveResponse;

  await expect(nextCard.getByText("Saved", { exact: true })).toBeVisible();
  await expect.poll(async () => (await fixtureTaskRow(page, "e2e-sandbox"))?.dueDate).toBe("2026-10-05");
  await expect.poll(async () => (await fixtureTaskRow(page, "e2e-sandbox"))?.minutes).toBe(30);

  // The queue is empty now — no third card is appended.
  await expect(chat.getByTestId("sandbox-card")).toHaveCount(2);
});

test("a fresh /sandbox session re-offers the earlier-skipped Task, still with nothing written", async ({ page }) => {
  // Runs after the test above (Playwright config: workers: 1, one shared
  // fixture server/DB) — `e2e-sandbox` is now complete, so
  // "College essay brainstorm" (only skipped, never saved) is the only,
  // and therefore first, card again.
  await openChatAndRunSandbox(page);
  const chat = page.getByTestId("chat-panel");
  const card = chat.getByTestId("sandbox-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("College essay brainstorm")).toBeVisible();
  await expect(card.getByText("0 remaining")).toBeVisible();

  const skipResponse = page.waitForResponse((r) => r.url().includes("/api/sandbox/") && r.url().endsWith("/skip"));
  await card.getByRole("button", { name: "Skip" }).click();
  await skipResponse;

  await expect(card.getByText("Skipped", { exact: true })).toBeVisible();
  const row = await fixtureTaskRow(page, "tp-nodate");
  expect(row?.dueDate).toBeUndefined();
  expect(row?.minutes).toBeUndefined();

  // Nothing left in the queue — no next card is appended.
  await expect(chat.getByTestId("sandbox-card")).toHaveCount(1);
});

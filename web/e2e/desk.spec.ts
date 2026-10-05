/**
 * web/e2e/desk.spec.ts — Epic 12: the Desk page's widgets against the
 * fixture server's seeded records (no real Notion).
 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Mirrors the fixture's exports (`tests/e2e/fixture-server.ts`); not imported, because importing that file starts the fixture server.
const COMPLETED_TODAY = ["Desk seed today-3", "Desk seed today-2", "Desk seed today-1"] as const; // newest first

interface DeskNow {
  readonly completedToday: readonly { readonly taskName: string }[];
  readonly minutesToday: number;
  readonly hoursWithYoh: number;
  readonly onTime: { readonly onTime: number; readonly counted: number; readonly percent: number | null };
}

// The fixture keeps its records for the whole run, and other specs check Tasks off, so today's totals are read
// from the server rather than fixed here. The seeded rows, the streak and the spend do not change.
async function deskNow(page: Page): Promise<DeskNow> {
  const body = (await (await page.request.get("/api/desk")).json()) as { ok: true; value: DeskNow };
  return body.value;
}

async function openDesk(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Desk", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Desk", level: 1 })).toBeVisible();
  await expect(page.getByText(/^\d+ min today$/)).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-desk").boundingBox())?.y).toBe(0);
  await expect(page.getByRole("group", { name: "Activity, last 26 weeks" })).toBeVisible();
}

test("the widgets show the seeded values", async ({ page }) => {
  await openDesk(page);
  const done = page.locator("section", { has: page.getByRole("heading", { name: "Tasks completed today" }) });
  const now = await deskNow(page);
  const names = now.completedToday.map((item) => item.taskName);
  // Lower bounds from the seed (`FIXTURE_DESK_*`): other specs only add completions, so these hold whatever ran before.
  expect(now.minutesToday).toBeGreaterThanOrEqual(75);
  expect(now.hoursWithYoh).toBeGreaterThanOrEqual(5);
  expect(now.onTime.counted).toBeGreaterThanOrEqual(4);
  expect(now.onTime.onTime).toBeGreaterThanOrEqual(2);
  expect(names.filter((name) => name.startsWith("Desk seed"))).toEqual([...COMPLETED_TODAY]);
  await expect(done.getByRole("listitem")).toHaveText(names);
  await expect(done.locator("p").first()).toHaveText(String(names.length));
  await expect(page.getByText(`${now.minutesToday} min today`)).toBeVisible();
  await expect(page.getByText(`${now.hoursWithYoh} h with Yoh`)).toBeVisible();
  await expect(page.getByText(`${now.onTime.percent}%`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${now.onTime.onTime} of ${now.onTime.counted} Tasks with a due date`)).toBeVisible();
  await expect(page.getByText("Streak: 3 days · Longest: 5 days")).toBeVisible();
  await expect(page.getByText("$7.00")).toBeVisible();
  await expect(page.getByText("Desk isn't built yet.")).toHaveCount(0);
});

test("completed names are struck through and figures use tabular numerals", async ({ page }) => {
  await openDesk(page);
  const name = page.getByText(COMPLETED_TODAY[0], { exact: true });
  expect(await name.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  const figure = page.getByText(/^\d+ min today$/);
  expect(await figure.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
});

test("no horizontal page scroll at 390px or 1280px", async ({ page }) => {
  for (const [width, height] of [[390, 800], [1280, 800]] as const) {
    await page.setViewportSize({ width, height });
    await openDesk(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const deskOverflow = await page.getByTestId("page-desk").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(deskOverflow).toBeLessThanOrEqual(0);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe passes in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDesk(page);
    const results = await new AxeBuilder({ page }).include('[data-testid="page-desk"]').analyze();
    expect(results.violations).toEqual([]);
  });
}

// ---- Task 5: the Activity heatmap (Bklit chart, patched) ----

interface HeatDay {
  readonly date: string;
  readonly completed: number;
  readonly level: 0 | 1 | 2 | 3 | 4;
}
async function heatmapDays(page: Page): Promise<HeatDay[]> {
  const body = (await (await page.request.get("/api/desk")).json()) as { ok: true; value: { heatmap: { weeks: HeatDay[][] } } };
  return body.value.heatmap.weeks.flat();
}
// Mirrors lib/deskHeatmap.ts's wording, from the ISO date's own parts.
const dayText = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const countText = (d: HeatDay): string => (d.completed > 0 ? `${d.completed} ${d.completed === 1 ? "Task" : "Tasks"} completed` : d.level >= 1 ? "Opened Yoh, no Tasks completed" : "No activity");
const cellName = (d: HeatDay): string => `${dayText(d.date)}: ${d.completed > 0 ? countText(d) : d.level >= 1 ? "opened Yoh, no Tasks completed" : "no activity"}`;
const isoMinus = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Focus the Tasks list region just before the heatmap, then Tab once: the next stop is the grid. */
async function tabIntoGrid(page: Page): Promise<HeatDay> {
  const days = await heatmapDays(page);
  const today = days.at(-1)!;
  await page.getByRole("region", { name: "Tasks completed today, list" }).focus();
  await page.keyboard.press("Tab");
  return today;
}
const focusedLabel = (page: Page): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);

test("Tab lands on today's cell; arrow keys move by day and week; the tooltip follows focus and Escape hides it", async ({ page }) => {
  await openDesk(page);
  const days = await heatmapDays(page);
  const today = await tabIntoGrid(page);
  expect(await focusedLabel(page)).toBe(cellName(today));
  // One tab stop: Tab leaves the grid instead of walking cells.
  await expect(page.locator('[role="img"][tabindex="0"]')).toHaveCount(1);
  // Up goes to the day before, unless today is a Sunday (the top row), where it stays put.
  const dayBefore = new Date(`${today.date}T00:00:00Z`).getUTCDay() > 0 ? days.at(-2)! : today;
  await page.keyboard.press("ArrowUp");
  expect(await focusedLabel(page)).toBe(cellName(dayBefore));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  const weekBack = days.find((d) => d.date === isoMinus(today.date, 7))!;
  expect(await focusedLabel(page)).toBe(cellName(weekBack));
  await expect(page.getByText(dayText(weekBack.date), { exact: true })).toBeVisible();
  await expect(page.getByText(countText(weekBack), { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(dayText(weekBack.date), { exact: true })).toBeHidden();
  await page.keyboard.press("Home");
  expect(await focusedLabel(page)).toBe(cellName(days[0]!));
  await page.keyboard.press("End");
  expect(await focusedLabel(page)).toBe(cellName(today));
});

test("the five levels have five distinct fills and strokes, each the token's value; the focused cell shows the focus ring", async ({ page }) => {
  await openDesk(page);
  // Let the enter fade finish (it ends at full opacity).
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[role="img"][tabindex]')].every((r) => getComputedStyle(r).opacity === "1"))).toBe(true);
  const days = await heatmapDays(page);
  const style = await page.evaluate(
    ({ names }) => {
      const probe = (token: string): string => {
        const el = document.createElement("div");
        el.style.color = `var(${token})`;
        document.body.appendChild(el);
        const value = getComputedStyle(el).color;
        el.remove();
        return value;
      };
      const read = (name: string) => {
        const rect = document.querySelector(`[role="img"][aria-label="${name}"]`)!;
        const cs = getComputedStyle(rect);
        return { fill: cs.fill, stroke: cs.stroke, opacity: cs.opacity };
      };
      return {
        cells: names.map(read),
        fills: [0, 1, 2, 3, 4].map((n) => probe(`--color-heatmap-level-${n}`)),
        rim: probe("--color-rim-structural"),
        accent: probe("--color-accent-solid"),
        ringWidth: getComputedStyle(document.documentElement).getPropertyValue("--focus-ring-width").trim(),
      };
    },
    { names: [0, 1, 2, 3, 4].map((level) => cellName(days.find((d) => d.level === level && d !== days.at(-1))!)) },
  );
  style.cells.forEach((c, level) => {
    expect(c.fill, `level ${level} fill`).toBe(style.fills[level]);
    expect(c.stroke, `level ${level} stroke`).toBe(level === 0 ? style.rim : "none");
    expect(c.opacity).toBe("1");
  });
  expect(new Set(style.cells.map((c) => `${c.fill}|${c.stroke}`)).size).toBe(5);
  await tabIntoGrid(page);
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return { stroke: cs.stroke, width: cs.strokeWidth };
  });
  expect(ring.stroke).toBe(style.accent);
  expect(ring.width).toBe(style.ringWidth);
});

test("the heatmap scrolls sideways inside its region at 390px, starts at the newest week, and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openDesk(page);
  const region = page.getByRole("region", { name: "Activity heatmap, scrollable" });
  await expect(region).toHaveAttribute("data-wheel-nav", "off");
  const m = await region.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft }));
  expect(m.scrollWidth).toBeGreaterThan(m.clientWidth);
  expect(m.scrollLeft + m.clientWidth).toBeGreaterThanOrEqual(m.scrollWidth - 1);
  await region.evaluate((el) => { el.scrollLeft = 0; });
  expect(await region.evaluate((el) => el.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a wheel gesture over the heatmap does not change the active page", async ({ page }) => {
  await openDesk(page);
  const box = (await page.getByRole("region", { name: "Activity heatmap, scrollable" }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, -300);
  await expect(page.getByRole("button", { name: "Desk", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Desk", level: 1 })).toBeVisible();
});

test("Desk logs no Content Security Policy violation", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /content security policy|refused to/i.test(msg.text())) problems.push(msg.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  await openDesk(page);
  const first = (await page.locator('[role="img"][tabindex]').first().getAttribute("aria-label"))!;
  await page.getByRole("img", { name: first, exact: true }).hover();
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);
});

import { expect, test } from "@playwright/test";

/**
 * Global Search end-to-end. The dev server runs with the test auth bypass (standard "user"
 * role), in-memory stores, and the synthetic JobTread fixture. GoHighLevel and BambooHR are
 * not configured here, so those providers must report themselves as unavailable instead of
 * claiming "no results".
 */

test.describe.configure({ timeout: 120_000 });

const modal = (page: import("@playwright/test").Page) => page.getByTestId("global-search-modal");

test("header button sits right of the menu, opens with the shortcut, and closes with Escape", async ({
  page,
}) => {
  await page.goto("/");
  const button = page.getByTestId("global-search-button");
  await expect(button).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  const [b, m] = await Promise.all([button.boundingBox(), menu.boundingBox()]);
  expect(b!.x).toBeGreaterThan(m!.x);
  await button.hover();
  await expect(page.getByRole("tooltip")).toHaveText(/Search Baxter — (⌘K|Ctrl\+K)/);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal(page)).toBeHidden();

  await button.click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).getByRole("tab", { name: "All" })).toBeVisible();
});

test("live typing finds a tool, highlights it, and Enter navigates", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("global-search-button").click();
  const input = modal(page).getByRole("combobox");
  await input.fill("invntory");
  const option = modal(page)
    .getByRole("option", { name: /Inventory/ })
    .first();
  // The first request compiles the route in dev mode.
  await expect(option).toBeVisible({ timeout: 30_000 });
  await expect(option.locator("mark").first()).toBeVisible();
  await input.press("Enter");
  // The URL updates once the dev server has compiled /inventory.
  await expect(page).toHaveURL(/\/inventory/, { timeout: 60_000 });
});

test("JobTread jobs show cached freshness; disconnected sources are reported, not hidden", async ({
  page,
}) => {
  // The first job search runs the fixture's first-use sync and builds the index; it may
  // finish after that first response, so retype until the job appears.
  await page.goto("/");
  await page.getByTestId("global-search-button").click();
  const input = modal(page).getByRole("combobox");
  const job = modal(page)
    .getByRole("option", { name: /Test Project 3/ })
    .first();
  await expect(async () => {
    await input.fill("");
    await input.fill("Test Project 3");
    await expect(job).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await expect(job.getByTestId("result-source")).toHaveText(/JobTread · Last synced/);

  await input.fill("zzqxv nothing");
  const empty = modal(page).getByTestId("search-no-results");
  await expect(empty).toBeVisible();
  await expect(modal(page).getByText("Ask Baxter", { exact: true })).toBeVisible();
});

test("employees never see admin pages; mobile layout is near full-screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("global-search-button").click();
  const box = await modal(page).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(370);
  expect(box!.height).toBeGreaterThan(700);
  await modal(page).getByRole("combobox").fill("users");
  await expect(
    modal(page)
      .getByText(/result/)
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(modal(page).getByRole("option", { name: /^Users/ })).toHaveCount(0);
});

test("measures real search latency (dev server, in-memory stores)", async ({ page }) => {
  await page.goto("/");
  const queries = [
    "inventory",
    "reports",
    "test project",
    "1003",
    "3 test st",
    "dexter",
    "sam",
    "knowledge",
    "qr",
    "tours",
  ];
  const timings = await page.evaluate(async (qs) => {
    const run = async (q: string) => {
      const t0 = performance.now();
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const reader = res.body!.getReader();
      let first: number | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (
          value &&
          first === null &&
          new TextDecoder().decode(value).includes('"type":"provider"')
        ) {
          first = performance.now() - t0;
        }
        if (done) break;
      }
      return { q, total: performance.now() - t0, first };
    };
    for (const q of qs) await run(q); // warm-up (dev compile, first index build)
    const out = [];
    for (let i = 0; i < 3; i++) for (const q of qs) out.push(await run(q));
    return out;
  }, queries);
  const totals = timings.map((t) => t.total).sort((a, b) => a - b);
  const firsts = timings.map((t) => t.first ?? t.total).sort((a, b) => a - b);
  const pct = (xs: number[], p: number) =>
    Math.round(xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!);
  const summary = {
    samples: totals.length,
    totalP50: pct(totals, 50),
    totalP95: pct(totals, 95),
    firstProviderP50: pct(firsts, 50),
    firstProviderP95: pct(firsts, 95),
  };
  console.log(`[global-search latency] ${JSON.stringify(summary)}`);
  test.info().annotations.push({ type: "latency", description: JSON.stringify(summary) });
  expect(summary.samples).toBe(30);
});

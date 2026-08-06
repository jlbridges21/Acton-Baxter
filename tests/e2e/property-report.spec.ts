import { expect, test } from "@playwright/test";

/**
 * E2E uses a test-only auth bypass (E2E_TEST_AUTH_BYPASS=true and NODE_ENV=test)
 * configured in playwright.config.ts. Never enable that bypass outside test.
 */

/** Printed report must stay at the PEM-friendly target length. */
const MAX_PRINTED_PAGES = 6;

/** Chromium writes one `/Type /Page` object per printed page. */
function countPdfPages(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page(?![s/])/g);
  return matches ? matches.length : 0;
}

test("create mock property report and open completed report", async ({ page }) => {
  // Dev-server compilation plus the mock research wait exceeds the default budget.
  test.setTimeout(180_000);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Baxter", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Property Research" })).toBeVisible();

  await page.getByRole("link", { name: "Open Property Research" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("link", { name: "New Property Research" }).click();
  await expect(page.getByLabel("Property address")).toBeVisible();

  await page.getByLabel("Property address").fill("655 13th St, San Jose, CA");
  await page.getByRole("button", { name: "Research Property" }).click();

  await expect(page.getByText("Confirm this property address")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Confirm address" }).click();
  await page.getByRole("button", { name: "Research Property" }).click();

  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]+\/processing/);
  await expect(page.getByText("Researching property")).toBeVisible();

  await page.waitForURL(/\/reports\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /655 13th St, San Jose, CA/ })).toBeVisible();
  await expect(page.getByText("47222019").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "PEM preparation" })).toBeVisible();

  // --- At-a-glance chips ---------------------------------------------------
  const chips = page.locator("[data-chip]");
  await expect(chips).toHaveCount(9);
  await expect(page.locator('[data-chip="jurisdiction"]')).toBeVisible();
  await expect(page.locator('[data-chip="conflicts"]')).toBeVisible();

  // --- Sticky section nav (desktop) ---------------------------------------
  const sectionNav = page.getByRole("navigation", { name: "Report sections" });
  await expect(sectionNav).toBeVisible();
  await expect(sectionNav.getByRole("link", { name: "Parcel & lot lines" })).toBeVisible();

  // Every nav target must exist as a rendered section anchor.
  const navTargets = await sectionNav
    .locator("a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")?.replace("#", "") ?? ""));
  expect(navTargets.length).toBeGreaterThan(8);
  for (const target of navTargets) {
    await expect(page.locator(`#${target}`)).toHaveCount(1);
  }

  // Chips jump to the matching section.
  await page.locator('[data-chip="hydrant"]').click();
  await expect(page.locator("#fire-access")).toBeInViewport();

  // --- Mobile spot-check ---------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sectionNav).toBeHidden();
  await expect(page.getByLabel("Jump to section")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });

  // --- Print integrity ----------------------------------------------------
  await page.emulateMedia({ media: "print" });
  await expect(page.locator('[data-chip="jurisdiction"]')).toBeHidden();
  await expect(sectionNav).toBeHidden();
  await expect(page.getByLabel("Jump to section")).toBeHidden();
  await expect(page.getByRole("button", { name: /Download \/ Print PDF/ })).toBeHidden();
  // Sources are collapsed on screen but must print in full.
  await expect(page.locator("#sources-list")).toBeVisible();
  await page.emulateMedia({ media: null });

  const pdf = await page.pdf({ format: "Letter", printBackground: true });
  const pages = countPdfPages(pdf);
  expect(pages).toBeGreaterThan(0);
  expect(pages, `printed report is ${pages} pages`).toBeLessThanOrEqual(MAX_PRINTED_PAGES);
});

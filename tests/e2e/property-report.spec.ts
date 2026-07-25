import { expect, test } from "@playwright/test";

/**
 * E2E uses a test-only auth bypass (E2E_TEST_AUTH_BYPASS=true and NODE_ENV=test)
 * configured in playwright.config.ts. Never enable that bypass outside test.
 */
test("create mock property report and open completed report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Baxter", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Property Research" })).toBeVisible();

  await page.getByRole("link", { name: "Open Property Research" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("link", { name: "New Research" }).click();
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
  await expect(page.getByText("PEM preparation")).toBeVisible();
});

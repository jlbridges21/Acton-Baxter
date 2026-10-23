import { expect, test } from "@playwright/test";

/**
 * Reports (JobTread) end-to-end checks. The dev server runs with JOBTREAD_E2E_FIXTURE=true,
 * so data comes from the synthetic organization in src/lib/jobtread/fixture.ts — JobTread
 * is never called and no real customer data is involved. The E2E user has the standard
 * "user" role: project information only, no customer or financial fields.
 */

test.describe.configure({ timeout: 120_000 });

test("Reports hub lists templates and the Active Projects template computes from JobTread data", async ({
  page,
}) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create with Dexter" }).first()).toBeVisible();
  for (const name of ["Design Handoff", "Product Library", "Active Projects"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  const activeCard = page
    .locator("div", { has: page.getByText("Active Projects", { exact: true }) })
    .filter({ has: page.getByRole("link", { name: "Open" }) })
    .last();
  await activeCard.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Active Projects", level: 1 })).toBeVisible();

  const kpi = page.getByRole("region", { name: "Active projects" }).first();
  await expect(kpi.getByText("4", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/JobTread data synced/)).toBeVisible();

  // Filter by project manager → the KPI recalculates on the server.
  await page.getByRole("button", { name: "Project manager", exact: true }).click();
  await page.getByRole("checkbox", { name: /Maxx/ }).check();
  await page.keyboard.press("Escape");
  await expect(kpi.getByText("2", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/f=/);

  // Provenance is one click away.
  await kpi.getByRole("button", { name: /How "Active projects" is calculated/ }).click();
  await expect(page.getByText(/Count across 2 records/)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Copying a template, editing the layout, and saving creates a new version", async ({
  page,
}) => {
  await page.goto("/reports");
  const activeCard = page
    .locator("div", { has: page.getByText("Active Projects", { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Make a copy" }) })
    .last();
  await activeCard.getByRole("button", { name: "Make a copy" }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}/);
  await expect(page.getByText("Version 1")).toBeVisible();

  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByLabel("Report title").fill("My E2E report");
  const firstWidth = page.getByLabel("Width").first();
  await expect(firstWidth).toHaveValue("3");
  await firstWidth.selectOption("12");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(firstWidth).not.toHaveValue("12");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(firstWidth).toHaveValue("12");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Saved version 2/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "My E2E report", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("dialog").getByText(/^Version 2/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The new report is private to its owner and shows up under My reports.
  await page.goto("/reports");
  await page.getByRole("button", { name: "My reports" }).click();
  await expect(page.getByText("My E2E report")).toBeVisible();
});

test("Financial figures stay hidden from people without financial access", async ({ page }) => {
  await page.goto("/reports");
  const card = page
    .locator("div", { has: page.getByText("Product Library", { exact: true }) })
    .filter({ has: page.getByRole("link", { name: "Open" }) })
    .last();
  await card.getByRole("link", { name: "Open" }).click();
  const price = page.getByRole("region", { name: "Average base price" });
  await expect(price.getByText(/Requires "Financial figures" access/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("region", { name: "Models" }).getByText("3", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("$368,621")).toHaveCount(0);
});

test("Dexter's chat panel opens from a report and old routes redirect", async ({ page }) => {
  await page.goto("/reports");
  await page.getByRole("link", { name: "Open" }).first().click();
  await page.getByRole("button", { name: "Ask Dexter" }).click();
  await expect(page.getByRole("region", { name: "Chat with Dexter" })).toBeVisible();
  await expect(page.getByLabel("Message Dexter")).toBeVisible();
  await page.getByRole("button", { name: "Close chat" }).click();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/property-research$/);
});

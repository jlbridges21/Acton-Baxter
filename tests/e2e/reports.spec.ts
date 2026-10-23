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
    page.getByRole("region", { name: "Models", exact: true }).getByText("3", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("$368,621")).toHaveCount(0);
});

test("Dexter's chat panel opens from a report and old routes redirect", async ({ page }) => {
  await page.goto("/reports");
  await page.getByRole("link", { name: "Open" }).first().click();
  await page.getByRole("button", { name: /Ask Dexter$/ }).click();
  await expect(page.getByRole("region", { name: "Chat with Dexter" })).toBeVisible();
  await expect(page.getByLabel("Message Dexter")).toBeVisible();
  await page.getByRole("button", { name: "Close chat" }).click();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/property-research$/);
});

test("A blank report offers Dexter and the widget builder, and saves a first widget", async ({
  page,
}) => {
  await page.goto("/reports");
  await page.getByRole("button", { name: "Blank report" }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}/);
  await expect(page.getByText("This report is empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Dexter to build it" })).toBeVisible();

  await page.getByRole("button", { name: "Add a widget" }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("kpi");
  await page.getByLabel("Title", { exact: true }).fill("All jobs");
  await page.getByRole("dialog").getByRole("button", { name: "Add widget" }).click();
  await expect(
    page.getByRole("region", { name: "All jobs", exact: true }).getByText("6", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Saved version 2/)).toBeVisible();

  await page.getByRole("button", { name: "Ask Dexter to build it" }).waitFor({ state: "detached" });
});

test("Unknown report ids show a Reports not-found page that links back to Reports", async ({
  page,
}) => {
  await page.goto("/reports/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Report not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Reports" }).click();
  await expect(page).toHaveURL(/\/reports$/);
});

test("The Data Catalog shows verified JobTread entities, fields, and what's possible", async ({
  page,
}) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Suggested reports" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "Data catalog" }).click();
  await expect(page.getByRole("heading", { name: "Data catalog", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Financial documents/ }).click();
  await expect(page.getByText("Amount paid")).toBeVisible();
  await page.getByRole("button", { name: /Payments/ }).click();
  await expect(page.getByText(/no records in Acton/)).toBeVisible();

  await page.getByRole("button", { name: "Fields", exact: true }).click();
  await page.getByPlaceholder("Search fields").fill("phase");
  await expect(page.getByRole("cell", { name: /Phase/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "What's possible", exact: true }).click();
  const payments = page.getByRole("row", { name: /Customer payment dates/ });
  await expect(payments.getByText("Not in JobTread")).toBeVisible();
  await expect(payments.getByText(/Enter the payment/)).toBeVisible();
  // A standard user can't see financial capabilities' values.
  await expect(
    page.getByRole("row", { name: /Gross profit \(projected\)/ }).getByText("Restricted for you"),
  ).toBeVisible();
});

test("Dexter chat accepts attachments and is honest when a screenshot can't be analyzed", async ({
  page,
}) => {
  await page.goto("/reports/new");
  await expect(page.getByRole("region", { name: "Chat with Dexter" })).toBeVisible();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    {
      name: "rates.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Salesperson,Rate\nKevin,5%\n"),
    },
    {
      name: "dashboard.png",
      mimeType: "image/png",
      buffer: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 1)]),
    },
    { name: "notes.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
  ]);
  await expect(page.getByTitle("rates.csv")).toContainText(/KB/, { timeout: 30_000 });
  await expect(page.getByTitle(/No vision model is configured/)).toBeVisible();
  await expect(page.getByTitle(/isn't supported/)).toBeVisible();
  await page.getByRole("button", { name: "Remove notes.exe" }).click();
  await expect(page.getByText("notes.exe")).toHaveCount(0);
});

test("The Sales Commissions template hides compensation data from people without financial access", async ({
  page,
}) => {
  await page.goto("/reports");
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("link", { name: /Sales Commissions/ }).click();
  await expect(page.getByRole("heading", { name: "Sales Commissions", level: 1 })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Calculated commissions" })
      .getByText(/Requires "Financial figures" access/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByRole("region", { name: "Commission rates" })
      .getByText(/Requires "Financial figures" access/),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "About these numbers" })).toContainText(
    "JobTread has no recorded customer payments",
  );
});

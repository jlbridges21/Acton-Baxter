import { expect, test } from "@playwright/test";

const SAMPLE_TRANSCRIPT = `
Advisor: Thanks for meeting today. The purpose is to see if Acton is the right partner for an ADU project and to understand your goals, budget, decision process, and timing.
Prospect: We want an ADU because Mom is increasingly vulnerable living alone. We want her nearby while preserving independence. Our working budget is about four hundred thousand dollars all-in. Another builder verbally estimated around three hundred eighty thousand. My spouse and I both decide. Spouse is not on this call. We can reconnect in two weeks after we talk. Previously a contractor stopped communicating and costs jumped, so transparency matters. We would like to start this year if the process is clear.
Advisor: Based on what you shared, I recommend we reconnect after you speak with your spouse and then decide on a design next step. I will send a follow-up email summarizing what we discussed.
Prospect: Sounds good — let's reconnect in two weeks.
`.repeat(2);

test("PEM NEAT create, generate, reopen from library", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Baxter", exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open PEM NEAT|Partnership Evaluation Meeting NEAT/i }),
  ).toBeVisible();

  await page.getByRole("link", { name: /Open PEM NEAT/i }).click();
  await expect(page).toHaveURL(/\/pem-neats$/);
  await expect(
    page.getByRole("heading", { name: "Partnership Evaluation Meeting NEAT" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Add PEM NEAT" }).first().click();
  await expect(page).toHaveURL(/\/pem-neats\/new/);

  await page.getByLabel("Prospect Name").fill("Alex Prospect");
  await page.getByLabel("Partnership Evaluation Meeting Transcript").fill(SAMPLE_TRANSCRIPT);
  await page.getByRole("button", { name: "Generate PEM NEAT" }).click();

  await expect(page.getByText("Analyzing Partnership Evaluation Meeting")).toBeVisible();
  await page.waitForURL(/\/pem-neats\/[0-9a-f-]+$/, { timeout: 60_000 });

  await expect(page.getByRole("heading", { name: "Alex Prospect" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "NEAT" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /BuilderTrend Custom Fields/ })).toBeVisible();
  await expect(page.getByText(/Customer Story|SALES INTELLIGENCE/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /BuilderTrend Custom Fields/ }).click();
  await expect(page.getByText("Notes for internal users").first()).toBeVisible();
  await expect(page.getByText(/Copy All|copy\/paste|handoff/i).first()).toBeVisible();

  await page.getByRole("tab", { name: "NEAT" }).click();
  await expect(page.getByText(/Customer Story|SALES INTELLIGENCE/i).first()).toBeVisible();

  const detailUrl = page.url();
  await page.goto("/pem-neats");
  await expect(page.getByText("Alex Prospect")).toBeVisible();
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: "Alex Prospect" })).toBeVisible();
  await expect(page.getByText(/Customer Story|SALES INTELLIGENCE/i).first()).toBeVisible();
});

test("PEM NEAT edit transcript marks needs regeneration, then delete", async ({ page }) => {
  await page.goto("/pem-neats/new");
  await page.getByLabel("Prospect Name").fill("Edit Delete Prospect");
  await page.getByLabel("Partnership Evaluation Meeting Transcript").fill(SAMPLE_TRANSCRIPT);
  await page.getByRole("button", { name: "Generate PEM NEAT" }).click();
  await page.waitForURL(/\/pem-neats\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Edit Delete Prospect" })).toBeVisible();

  const detailUrl = page.url();
  const editUrl = `${detailUrl.replace(/\/$/, "")}/edit`;
  await page.goto(editUrl);
  await expect(page).toHaveURL(/\/pem-neats\/[0-9a-f-]+\/edit/);
  await expect(page.getByRole("heading", { name: "Edit PEM NEAT" })).toBeVisible();

  await page.getByLabel("Prospect Name").fill("Edit Delete Prospect Updated");
  const transcript = await page.getByLabel("Transcript").inputValue();
  await page.getByLabel("Transcript").fill(`${transcript}\nProspect: We prefer email.`);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText(/Transcript updated/i)).toBeVisible();
  await page.getByRole("link", { name: "Later" }).click();
  await expect(page.getByText(/Transcript Updated/i)).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Delete PEM NEAT?" })).toBeVisible();
  await page.getByRole("button", { name: "Delete PEM NEAT" }).click();
  await expect(page).toHaveURL(/\/pem-neats/);
  await expect(page.getByText("Edit Delete Prospect Updated")).toHaveCount(0);
});

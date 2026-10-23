import { expect, test, type BrowserContext } from "@playwright/test";

/**
 * Sam Operations Studio smoke test against the in-memory stores. Synthetic data only; test mode
 * only — nothing external is called.
 */

async function asRole(context: BrowserContext, role: "admin" | "user") {
  await context.clearCookies();
  await context.addCookies([
    { name: "baxter_e2e_role", value: role, domain: "localhost", path: "/" },
  ]);
}

test.describe.configure({ mode: "serial" });

test("admin sees setup gaps, honest integration status, and unofficial starter workflows", async ({
  page,
  context,
}) => {
  await asRole(context, "admin");
  await page.goto("/ai/operations");
  await expect(page.getByRole("heading", { name: "Sam Operations" })).toBeVisible();
  await expect(page.getByText(/Setup isn.t finished/)).toBeVisible();

  await page.getByRole("button", { name: "Library & editor" }).click();
  await expect(page.getByText("Employee onboarding")).toBeVisible();
  await expect(page.getByText("Unofficial").first()).toBeVisible();

  await page.getByRole("button", { name: "Integrations" }).click();
  await expect(page.getByText("No supported API — manual").first()).toBeVisible();

  await page.getByRole("button", { name: "Setup" }).click();
  await expect(page.getByText("Confirm the CEO's Baxter account")).toBeVisible();
});

test("an employee sees only their own tasks", async ({ page, context }) => {
  await asRole(context, "user");
  await page.goto("/ai/operations");
  await expect(page.getByText("You see only tasks and workflows that involve you.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Setup" })).toHaveCount(0);
  const res = await context.request.post("/api/ops", {
    data: {
      op: "decision",
      key: "ceo_account",
      status: "confirmed",
      value: "00000000-0000-4000-8000-000000000001",
    },
  });
  expect(res.status()).toBe(403);
});

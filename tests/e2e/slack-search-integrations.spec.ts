import { expect, test } from "@playwright/test";

test("integrations settings shows Slack Search connect UI", async ({ page }) => {
  await page.goto("/settings/integrations");
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slack Search" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Connect Slack Search|Reconnect Slack Search/ }),
  ).toBeVisible();
});

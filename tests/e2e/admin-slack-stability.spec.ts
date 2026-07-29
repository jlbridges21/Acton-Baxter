import { expect, test } from "@playwright/test";

/**
 * Admin Slack page must hydrate without React #418 and keep Refresh button responsive.
 * Relies on E2E_TEST_AUTH_BYPASS + baxter_e2e_role=admin cookie (test-only).
 */
test("admin slack page hydrates without React #418 and shows directory controls", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "baxter_e2e_role",
      value: "admin",
      domain: "localhost",
      path: "/",
    },
  ]);

  const hydrationErrors: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (
      msg.type() === "error" &&
      (/Minified React error #418/i.test(text) ||
        /Hydration failed/i.test(text) ||
        /did not match/i.test(text))
    ) {
      hydrationErrors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    if (/Minified React error #418/i.test(err.message) || /Hydration/i.test(err.message)) {
      hydrationErrors.push(err.message);
    }
  });

  await page.goto("/admin/slack");
  await expect(page.getByRole("heading", { name: "Slack", exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Health" }).click();
  await expect(page.getByText("Slack Search", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh Slack Directory" })).toBeVisible();

  // Button should not be permanently stuck in Refreshing without a click.
  await expect(page.getByRole("button", { name: "Refreshing…" })).toHaveCount(0);

  expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
});

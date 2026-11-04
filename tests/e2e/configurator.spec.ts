import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Acton ADU Configurator, end to end, against the in-memory store seeded by the import
 * (`node_modules/.bin/jiti scripts/configurator-import.ts --target=local`). Skipped when that
 * local seed (made from the 2.8 GB Models folder) is not present. Nothing external is called:
 * GHL and Can I Build iframes/scripts are blocked.
 */

const SEED = path.join(process.cwd(), ".configurator-local", "seed.json");
test.skip(
  !existsSync(SEED),
  "Run the configurator import (--target=local) to create the E2E seed.",
);
test.describe.configure({ mode: "serial" });
// First requests compile large routes in dev mode.
test.setTimeout(240_000);

const SHOTS = path.join("test-results", "configurator");

async function asRole(context: BrowserContext, role: "admin" | "user") {
  await context.clearCookies();
  await context.addCookies([
    { name: "baxter_e2e_role", value: role, domain: "localhost", path: "/" },
  ]);
}

async function blockThirdParties(page: Page) {
  await page.route(
    /leadconnectorhq\.com|msgsndr\.com|canibuild\.com|googletagmanager\.com|googleapis\.com/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>stub</body></html>",
      }),
  );
}

type Catalog = { models: Record<string, unknown>[] } & Record<string, unknown>;

/** Mark every price reviewed and allow the 8-ft fallback on Manzanita, then publish. */
async function preparePublish(page: Page) {
  const draft = (await (await page.request.get("/api/admin/configurator/draft")).json()) as {
    catalog: Catalog;
  };
  const review = (p: { needsReview: boolean }) => ({ ...p, needsReview: false });
  const changes = draft.catalog.models.map((raw) => {
    const m = raw as Record<string, unknown> & {
      id: string;
      rev: number;
      basePrice: { needsReview: boolean };
    };
    const list = (k: string) =>
      (m[k] as { price: { needsReview: boolean } }[]).map((i) => ({
        ...i,
        price: review(i.price),
      }));
    return {
      op: "put",
      collection: "models",
      expectedRev: m.rev,
      value: {
        ...m,
        basePrice: review(m.basePrice),
        options: list("options"),
        exteriors: list("exteriors"),
        interiors: list("interiors"),
        appliances: list("appliances"),
        upgrades: list("upgrades"),
        bathrooms: list("bathrooms"),
        ceilingFallback: m.id === "manzanita-i448-a1" ? true : (m.ceilingFallback as boolean),
      },
    };
  });
  const save = await page.request.post("/api/admin/configurator/draft", { data: { changes } });
  expect(save.status()).toBe(200);
  const publish = await page.request.post("/api/admin/configurator/publish", {
    data: { notes: "E2E" },
  });
  expect(publish.status()).toBe(200);
}

async function setLocation(page: Page, city: string) {
  const res = await page.request.post("/api/public/configurator/location", {
    data: { address: "1 Main St", city, state: "CA", postalCode: "" },
  });
  const body = (await res.json()) as {
    status: string;
    city?: string;
    state?: string;
    regionName?: string;
    token?: string;
  };
  if (body.token) {
    // Compile/warm the quote route so the page's own request answers quickly in dev mode.
    const warm = await page.request.post("/api/public/configurator/quote", {
      data: { model: "nutmeg-s498-a1", token: body.token },
    });
    expect(warm.status()).toBe(200);
  }
  await page.evaluate(
    (loc) => localStorage.setItem("acton-configurator-location", JSON.stringify(loc)),
    body.status === "supported" ? { ...body, status: "supported" } : { status: "outside", city },
  );
  return body;
}

const src = (page: Page, step: string) =>
  page.getByTestId(`image-${step}`).getAttribute("data-src");

test("non-admins cannot open the admin workspace or its API", async ({ page, context }) => {
  await asRole(context, "user");
  expect((await page.request.get("/api/admin/configurator/draft")).status()).toBe(403);
  // The root loading boundary streams, so the redirect is sent in the page rather than as a 307.
  const res = await page.request.get("/configurator", { maxRedirects: 0 });
  const body = await res.text();
  expect(res.status() >= 300 && res.status() < 400 ? res.headers()["location"] : body).toMatch(
    /NEXT_REDIRECT|^\/$/,
  );
  expect(body).not.toContain("Configurator Admin");
  expect(body).not.toContain("Manzanita");
});

test("admin dashboard lists the imported models and the draft is not public yet", async ({
  page,
  context,
}) => {
  await asRole(context, "admin");
  await page.goto("/configurator");
  await expect(page.getByRole("heading", { name: "Configurator" })).toBeVisible();
  await expect(page.getByTestId("model-card-cypress-s748-b1")).toBeVisible();
  await expect(page.getByTestId("model-card-manzanita-i448-a1")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${SHOTS}/admin-dashboard.png` });

  await page.goto("/configurator/models/cypress-s748-b1?tab=exteriors");
  await page.getByTestId("style-card-half-moon-bay-coastal").getByRole("button").first().click();
  await expect(page.getByTestId("style-editor")).toBeVisible();
  await expect(page.getByTestId("slot-ext-porch-8")).toHaveAttribute("data-filled", "true");
  await page.screenshot({ path: `${SHOTS}/admin-style-editor.png` });
});

test("publish, then customers see renderings and gated pricing that match the live site", async ({
  page,
  context,
}) => {
  await asRole(context, "admin");
  await preparePublish(page);
  await blockThirdParties(page);
  await page.setViewportSize({ width: 1600, height: 900 });

  await page.goto("/design?series=signature&model=nutmeg-s498-a1");
  await expect(page.getByTestId("configurator")).toBeVisible();
  // Prices are hidden and not in the page before the location is verified.
  await expect(page.getByTestId("price-card")).toHaveAttribute("data-priced", "false");
  expect(await page.content()).not.toContain("383,000");
  await expect(page).toHaveURL(/modelOption=standard/);
  const sections = await page
    .locator("section[data-section]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
  expect(sections).toEqual([
    "ChooseModel",
    "ModelOptions",
    "ExteriorStyles",
    "InteriorStyles",
    "Appliances",
    "Upgrades",
    "Bathroom",
    "FreeQuote",
  ]);
  await page.screenshot({ path: `${SHOTS}/customer-nutmeg-locked.png` });

  await page.getByTestId("price-card").click();
  await expect(page.getByTestId("location-form")).toBeVisible();
  await page.keyboard.press("Escape");

  const loc = await setLocation(page, "San Jose");
  expect(loc.regionName).toBe("Bay Area");
  await page.reload();
  await expect(page.getByTestId("price-card")).toHaveAttribute("data-priced", "true", {
    timeout: 60_000,
  });
  // Same numbers the live design.actonadu.com shows for Nutmeg (default Santa Barbara Spanish).
  await expect(page.getByTestId("price-total")).toHaveText("$396,500");
  await expect(page.getByTestId("price-monthly")).toHaveText("$2,377");

  const standardExterior = await src(page, "exterior");
  await page.getByTestId("option-with-porch").click();
  await expect(page.getByTestId("price-total")).toHaveText("$403,200");
  await expect(page.getByTestId("price-monthly")).toHaveText("$2,417");
  expect(await src(page, "exterior")).not.toBe(standardExterior);

  const daylight = await src(page, "upgrades");
  await page.getByTestId("upgrade-lighting-upgrade").click();
  await expect(page.getByTestId("price-total")).toHaveText("$404,700");
  await expect(page.getByTestId("price-monthly")).toHaveText("$2,426");
  expect(await src(page, "upgrades")).not.toBe(daylight);

  // Appliance tiers use different renderings.
  const lifestyle = await src(page, "appliances");
  await page.getByTestId("appliance-premium").click();
  expect(await src(page, "appliances")).not.toBe(lifestyle);
  await expect(page).toHaveURL(/appliances=premium/);

  // Changing the model keeps compatible choices and reprices.
  await page.getByTestId("exterior-berkeley-modern").click();
  await page.getByTestId("model-Santa-Lucia-s658-A1").click();
  await expect(page).toHaveURL(/model=Santa-Lucia-s658-A1/);
  await expect(page).toHaveURL(/exterior=berkeley-modern/);
  await expect(page).toHaveURL(/modelOption=with-porch/);
  await expect(page.getByTestId("price-card")).toHaveAttribute("data-priced", "true", {
    timeout: 60_000,
  });
  await page.screenshot({ path: `${SHOTS}/customer-santa-lucia-priced.png` });
});

test("investor models skip Model Options and 9-ft ceilings change earlier renderings", async ({
  page,
}) => {
  await blockThirdParties(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/design?series=investor&model=manzanita-i448-a1&exterior=half-moon-bay-coastal");
  const sections = await page
    .locator("section[data-section]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
  expect(sections).not.toContain("ModelOptions");
  expect(sections[1]).toBe("ExteriorStyles");

  const ext8 = await src(page, "exterior");
  const int8 = await src(page, "interior");
  const appliances8 = await src(page, "appliances");
  const bath8 = await src(page, "bathroom");
  await page.getByTestId("upgrade-9-foot-ceiling").click();
  await expect(page.getByTestId("configurator")).toHaveAttribute("data-ceiling", "9");
  expect(await src(page, "exterior")).not.toBe(ext8);
  expect(await src(page, "interior")).not.toBe(int8);
  expect(await src(page, "appliances")).toBe(appliances8);
  expect(await src(page, "bathroom")).toBe(bath8);
  await page.getByTestId("upgrade-no-upgrade").click();
  expect(await src(page, "exterior")).toBe(ext8);

  // Floorplan + mirror toggles.
  const elevation = await src(page, "model");
  await page.getByTestId("toggle-floorplan").click();
  const plan = await src(page, "model");
  expect(plan).not.toBe(elevation);
  await page.getByTestId("toggle-mirror").click();
  expect(await src(page, "model")).not.toBe(plan);
  await expect(page).toHaveURL(/viewMode=floorplan/);
  await page.screenshot({ path: `${SHOTS}/customer-manzanita-floorplan.png` });
});

test("old design.actonadu.com links still open the right configuration", async ({ page }) => {
  await blockThirdParties(page);
  await page.goto(
    "/design?series=investor&model=manzanita-i448-a1&viewMode=elevation&exterior=HalfMoonBayCoastali-448-A-1&interior=VillaNoir-i-448A-1&appliances=UpgradeVillaNoirinvestor&upgrades=9-footCeilingVillaNoiri-448&bathroom=VillaNoirShower",
  );
  await expect(page).toHaveURL(/exterior=half-moon-bay-coastal/);
  await expect(page).toHaveURL(/interior=villa-noir/);
  await expect(page).toHaveURL(/appliances=lifestyle/);
  await expect(page).toHaveURL(/upgrades=9-foot-ceiling/);
  await expect(page).toHaveURL(/bathroom=shower-pan/);
});

test("customers outside every region keep browsing without prices", async ({ page }) => {
  await blockThirdParties(page);
  await page.goto("/design?series=signature&model=nutmeg-s498-a1");
  await expect(page.getByTestId("configurator")).toBeVisible();
  const res = await setLocation(page, "Fresno");
  expect(res.status).toBe("outside");
  await page.reload();
  await expect(page.getByTestId("price-card")).toHaveAttribute("data-priced", "false");
  await page.getByTestId("price-card").click();
  await expect(page.getByTestId("outside-area")).toContainText("outside our current service area");
  await page.getByRole("button", { name: "Keep exploring" }).click();
  await page.getByTestId("option-with-porch").click();
  await expect(page).toHaveURL(/modelOption=with-porch/);
});

test("mobile layout stacks each step", async ({ page }) => {
  await blockThirdParties(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/design?series=signature&model=nutmeg-s498-a1");
  await expect(page.getByTestId("configurator")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/customer-mobile.png` });
});

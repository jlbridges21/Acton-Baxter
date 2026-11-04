import { describe, expect, it } from "vitest";
import { applyChanges } from "@/lib/configurator/catalog-ops";
import { classifyFilename } from "@/lib/configurator/filename-classifier";
import { ghlPrefillQuery, isGhlOrigin, parseGhlMessage } from "@/lib/configurator/ghl-messages";
import {
  applyBulkAdjust,
  computeQuote,
  convertPriceMode,
  monthlyPayment,
  priceInRegion,
  setRegionAmount,
} from "@/lib/configurator/pricing";
import { buildPublicCatalog } from "@/lib/configurator/public-catalog";
import { isAnonymousConfiguratorPath, isConfiguratorHost } from "@/lib/configurator/public-paths";
import { cityKey, findCityConflicts, regionForCity } from "@/lib/configurator/regions";
import {
  modelHeroAssetId,
  requiredSlots,
  resolveStepImage,
  slotKey,
} from "@/lib/configurator/render";
import {
  carrySelection,
  defaultSelection,
  parseDeepLink,
  selectionFromDeepLink,
  stepsForModel,
  toggleUpgrade,
} from "@/lib/configurator/selection";
import { planPublish } from "@/lib/configurator/store";
import { validateCatalog, validateModel } from "@/lib/configurator/validate";
import type { Price } from "@/lib/configurator/types";
import { isAnonymousPublicPath } from "@/lib/public-paths";
import { fixtureCatalog, getModel } from "./configurator-fixture";

describe("configurator steps", () => {
  it("skips Model Options for models without options and keeps the fixed order", () => {
    const c = fixtureCatalog();
    expect(stepsForModel(getModel(c, "manzanita-i448-a1"))).toEqual([
      "model",
      "exterior",
      "interior",
      "appliances",
      "upgrades",
      "bathroom",
      "quote",
    ]);
    expect(stepsForModel(getModel(c, "cypress-s748-b1"))).toEqual([
      "model",
      "options",
      "exterior",
      "interior",
      "appliances",
      "upgrades",
      "bathroom",
      "quote",
    ]);
  });
});

describe("rendering dependencies", () => {
  const c = fixtureCatalog();
  const m = getModel(c, "manzanita-i448-a1");
  const base = defaultSelection(m);
  const key = (step: Parameters<typeof resolveStepImage>[2], sel = base) => {
    const id = resolveStepImage(m, sel, step).assetId;
    return Object.entries(m.renders).find(([, v]) => v === id)?.[0];
  };

  it("uses the Kitchen rendering for the interior step", () => {
    expect(key("interior")).toBe(
      slotKey({ type: "int", styleId: base.interiorId!, role: "kitchen", ceiling: "8" }),
    );
  });

  it("9-ft ceilings switch exterior and interior renderings, even for earlier steps", () => {
    const nine = { ...base, upgradeIds: ["9-foot-ceiling"] };
    expect(key("exterior", nine)).toBe(
      slotKey({ type: "ext", styleId: base.exteriorId!, variant: "standard", ceiling: "9" }),
    );
    expect(key("interior", nine)).toBe(
      slotKey({ type: "int", styleId: base.interiorId!, role: "kitchen", ceiling: "9" }),
    );
    expect(key("model", nine)).toContain("|9");
    // Removing the upgrade restores 8-ft renderings.
    expect(key("exterior", base)).toContain("|8");
  });

  it("never changes appliance or bathroom renderings with ceiling height", () => {
    const nine = { ...base, upgradeIds: ["9-foot-ceiling"] };
    expect(key("appliances", nine)).toBe(key("appliances", base));
    expect(key("bathroom", nine)).toBe(key("bathroom", base));
  });

  it("maps appliance packages to Appliance Base / Appliance Mid", () => {
    expect(key("appliances", { ...base, applianceId: "lifestyle" })).toContain("|appliance_base|");
    expect(key("appliances", { ...base, applianceId: "premium" })).toContain("|appliance_mid|");
  });

  it("uses Lighting Dusk Uplights for the lighting upgrade, never Lighting Dusk", () => {
    const lit = key("upgrades", { ...base, upgradeIds: ["lighting-upgrade"] });
    expect(lit).toContain("|lighting_dusk_uplights|");
    expect(key("upgrades", base)).toContain("|lighting_daytime|");
    expect(requiredSlots(m).some((r) => r.key.includes("|lighting_dusk|"))).toBe(false);
  });

  it("uses porch exteriors when With Porch is selected", () => {
    const cy = getModel(c, "cypress-s748-b1");
    const sel = { ...defaultSelection(cy), optionId: "with-porch" };
    const id = resolveStepImage(cy, sel, "exterior").assetId;
    expect(Object.entries(cy.renders).find(([, v]) => v === id)?.[0]).toContain("|porch|");
  });

  it("never substitutes an image unless the 8-ft fallback is explicitly enabled", () => {
    const copy = structuredClone(m);
    delete copy.renders[
      slotKey({ type: "ext", styleId: base.exteriorId!, variant: "standard", ceiling: "9" })
    ];
    const nine = { ...base, upgradeIds: ["9-foot-ceiling"] };
    expect(resolveStepImage(copy, nine, "exterior").assetId).toBeNull();
    copy.ceilingFallback = true;
    const fb = resolveStepImage(copy, nine, "exterior");
    expect(fb.usedFallback).toBe(true);
    expect(fb.assetId).toBe(
      copy.renders[
        slotKey({ type: "ext", styleId: base.exteriorId!, variant: "standard", ceiling: "8" })
      ],
    );
  });

  it("picks a hero image from the default exterior", () => {
    expect(modelHeroAssetId(m)).toBe(
      m.renders[
        slotKey({ type: "ext", styleId: base.exteriorId!, variant: "standard", ceiling: "8" })
      ],
    );
  });
});

describe("selection", () => {
  it("keeps compatible choices across a model change and resets only the rest", () => {
    const c = fixtureCatalog();
    const manz = getModel(c, "manzanita-i448-a1");
    const cy = getModel(c, "cypress-s748-b1");
    const prev = {
      ...defaultSelection(manz),
      exteriorId: "santa-barbara-spanish",
      interiorId: "villa-noir",
      applianceId: "premium",
      upgradeIds: ["9-foot-ceiling"],
      bathroomId: "shower-pan",
    };
    const next = carrySelection(manz, prev, cy);
    expect(next.exteriorId).toBe("santa-barbara-spanish");
    expect(next.interiorId).toBe("villa-noir");
    expect(next.applianceId).toBe("premium");
    expect(next.bathroomId).toBe("shower-pan");
    // Cypress has no 9-ft upgrade: falls back to the "No Upgrade" default.
    expect(next.upgradeIds).toEqual(["no-upgrade"]);
    expect(next.optionId).toBe("standard");
  });

  it("single-select upgrades replace each other; multi-select combines; No Upgrade clears", () => {
    const m = getModel(fixtureCatalog(), "manzanita-i448-a1");
    expect(toggleUpgrade(m, ["no-upgrade"], "lighting-upgrade", "single")).toEqual([
      "lighting-upgrade",
    ]);
    expect(toggleUpgrade(m, ["lighting-upgrade"], "9-foot-ceiling", "single")).toEqual([
      "9-foot-ceiling",
    ]);
    expect(toggleUpgrade(m, ["lighting-upgrade"], "9-foot-ceiling", "multiple")).toEqual([
      "lighting-upgrade",
      "9-foot-ceiling",
    ]);
    expect(
      toggleUpgrade(m, ["lighting-upgrade", "9-foot-ceiling"], "no-upgrade", "multiple"),
    ).toEqual(["no-upgrade"]);
  });

  it("reads old design.actonadu.com deep links through legacy aliases", () => {
    const m = getModel(fixtureCatalog(), "manzanita-i448-a1");
    const link = parseDeepLink(
      new URLSearchParams(
        "series=investor&model=manzanita-i448-a1&exterior=HalfMoonBayCoastali-448-A-1&interior=CaliforniaCoastal-i-448A-1&upgrades=CaliforniaCoastalMidTiei-448&bathroom=CaliforniaCoastalShower&viewMode=floorplan",
      ),
    );
    expect(link.viewMode).toBe("floorplan");
    const sel = selectionFromDeepLink(m, link);
    expect(sel).toMatchObject({
      exteriorId: "half-moon-bay-coastal",
      interiorId: "california-coastal",
      upgradeIds: ["9-foot-ceiling"],
      bathroomId: "shower-pan",
    });
  });

  it("ignores unknown deep-link values instead of breaking", () => {
    const m = getModel(fixtureCatalog(), "manzanita-i448-a1");
    const sel = selectionFromDeepLink(
      m,
      parseDeepLink(new URLSearchParams("exterior=nope&appliances=zzz")),
    );
    expect(sel).toEqual(defaultSelection(m));
  });
});

describe("pricing", () => {
  const regions = fixtureCatalog().regions;
  it("supports explicit and base + adjustment prices", () => {
    const adjusted: Price = {
      mode: "adjusted",
      base: 1000,
      adjustKind: "percent",
      regions: { "bay-area": 10, sacramento: null },
      needsReview: false,
    };
    expect(priceInRegion(adjusted, "bay-area")).toBe(1100);
    expect(priceInRegion(adjusted, "sacramento")).toBe(1000);
    const explicit = convertPriceMode(adjusted, "explicit", regions);
    expect(explicit.regions).toEqual({ "bay-area": 1100, sacramento: 1000 });
    const back = convertPriceMode(explicit, "adjusted", regions);
    expect(priceInRegion(back, "bay-area")).toBe(1100);
    expect(priceInRegion(setRegionAmount(back, "sacramento", 1500), "sacramento")).toBe(1500);
  });

  it("applies bulk dollar and percent changes", () => {
    expect(applyBulkAdjust(1000, { kind: "add", amount: 250 })).toBe(1250);
    expect(applyBulkAdjust(1000, { kind: "percent", percent: -10 })).toBe(900);
    expect(applyBulkAdjust(null, { kind: "add", amount: 5 })).toBeNull();
    expect(applyBulkAdjust(null, { kind: "set", amount: 5 })).toBe(5);
  });

  it("sums regional model and option prices", () => {
    const c = fixtureCatalog();
    const cy = getModel(c, "cypress-s748-b1");
    const sel = {
      ...defaultSelection(cy),
      optionId: "with-porch",
      exteriorId: "santa-barbara-spanish",
    };
    expect(computeQuote(c, cy, sel, "bay-area")?.total).toBe(475000 + 6700 + 19500);
    expect(computeQuote(c, cy, sel, "sacramento")?.total).toBe(455000 + 6700 + 19500);
  });

  it("returns no quote (no price shown) when any selected price is missing", () => {
    const c = fixtureCatalog();
    const cy = getModel(c, "cypress-s748-b1");
    cy.exteriors[0]!.price = { ...cy.exteriors[0]!.price, regions: { "bay-area": 0 } };
    expect(
      computeQuote(
        c,
        cy,
        { ...defaultSelection(cy), exteriorId: cy.exteriors[0]!.styleId },
        "sacramento",
      ),
    ).toBeNull();
  });

  it("matches the live site's financing estimate (6% / 30 years)", () => {
    const f = { enabled: true, annualRatePct: 6, termMonths: 360, disclaimer: "", linkUrl: "" };
    expect(monthlyPayment(316000, f)).toBe(1895);
    expect(monthlyPayment(475000, f)).toBe(2848);
  });
});

describe("regions", () => {
  it("matches by city name and state, not ZIP", () => {
    const { regions } = fixtureCatalog();
    expect(regionForCity(regions, { name: "san jose", state: "California" })?.id).toBe("bay-area");
    expect(regionForCity(regions, { name: "Fresno", state: "CA" })).toBeNull();
    expect(cityKey({ name: "St. Helena", state: "CA" })).toBe(
      cityKey({ name: "Saint Helena", state: "ca" }),
    );
  });

  it("rejects a city in two regions", () => {
    const c = fixtureCatalog();
    const sac = c.regions[1]!;
    const result = applyChanges(c, [
      {
        op: "put",
        collection: "regions",
        value: { ...sac, cities: [...sac.cities, { name: "San Jose", state: "CA" }] },
        expectedRev: sac.rev,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.join(" ")).toMatch(/San Jose can only belong to one region/);
    expect(findCityConflicts(c.regions)).toHaveLength(0);
  });
});

describe("draft changes", () => {
  it("detects concurrent edits by revision", () => {
    const c = fixtureCatalog();
    const m = c.models[0]!;
    const ok = applyChanges(c, [
      { op: "put", collection: "models", value: { ...m, name: "Renamed" }, expectedRev: m.rev },
    ]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const stale = applyChanges(ok.catalog, [
      { op: "put", collection: "models", value: { ...m, name: "Other" }, expectedRev: m.rev },
    ]);
    expect(stale.ok).toBe(false);
  });

  it("blocks deleting a style a model still uses", () => {
    const c = fixtureCatalog();
    const result = applyChanges(c, [
      { op: "delete", collection: "styles", id: "villa-noir", expectedRev: 1 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("removes a deleted region's prices", () => {
    const c = fixtureCatalog();
    const result = applyChanges(c, [
      { op: "delete", collection: "regions", id: "sacramento", expectedRev: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(Object.keys(result.catalog.models[0]!.basePrice.regions)).toEqual(["bay-area"]);
  });
});

describe("publishing safeguards", () => {
  it("a fully priced and rendered model is ready", () => {
    const c = fixtureCatalog();
    expect(
      validateModel(c, getModel(c, "cypress-s748-b1")).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });

  it("blocks unreviewed and $0 starting prices, and names missing renderings precisely", () => {
    const c = fixtureCatalog();
    const cy = getModel(c, "cypress-s748-b1");
    cy.basePrice = {
      ...cy.basePrice,
      needsReview: true,
      regions: { "bay-area": 0, sacramento: 455000 },
    };
    delete cy.renders[
      slotKey({ type: "ext", styleId: "santa-barbara-spanish", variant: "porch", ceiling: "8" })
    ];
    const messages = validateModel(c, cy).map((i) => i.message);
    expect(messages).toContain("Cypress s748 B1's starting price has not been reviewed.");
    expect(messages.some((m) => m.includes("$0 starting price"))).toBe(true);
    expect(messages).toContain(
      "Missing 8-foot Santa Barbara Spanish exterior rendering for Cypress s748 B1 with Porch.",
    );
  });

  it("allows an intentional, reviewed $0 option", () => {
    const c = fixtureCatalog();
    const m = getModel(c, "manzanita-i448-a1");
    expect(m.bathrooms[0]!.price.regions["bay-area"]).toBe(0);
    expect(
      validateModel(c, m).filter((i) => i.code === "price_review" || i.code === "price_missing"),
    ).toEqual([]);
  });

  it("keeps the previously published version of a model that is not ready", () => {
    const live = fixtureCatalog();
    const draft = structuredClone(live);
    const broken = getModel(draft, "cypress-s748-b1");
    broken.name = "Cypress (draft)";
    broken.basePrice = { ...broken.basePrice, needsReview: true };
    const plan = planPublish(draft, live);
    expect(plan.summary.keptPreviousModels.map((k) => k.name)).toEqual(["Cypress (draft)"]);
    expect(plan.catalog.models.find((m) => m.id === broken.id)?.name).toBe("Cypress s748 B1");
    expect(plan.summary.publishedModels).toEqual(["Manzanita i448 A1"]);
    // Never published before → stays off.
    const first = planPublish(draft, null);
    expect(first.catalog.models.find((m) => m.id === broken.id)?.status).toBe("inactive");
  });

  it("city conflicts block publishing entirely", () => {
    const c = fixtureCatalog();
    c.regions[1]!.cities.push({ name: "San Jose", state: "CA" });
    expect(validateCatalog(c).some((i) => i.code === "city_conflict")).toBe(true);
    expect(planPublish(c, null).globalErrors.length).toBeGreaterThan(0);
  });
});

describe("public payload", () => {
  it("contains no prices before the customer's location is verified", () => {
    const c = fixtureCatalog();
    const pub = buildPublicCatalog(c, 1, () => ({ display: "/d.jpg", thumb: "/t.jpg" }));
    const json = JSON.stringify(pub);
    for (const amount of ["316000", "475000", "455000", "6700", "19500", "4600"])
      expect(json).not.toContain(amount);
    expect(pub.models.every((m) => Object.keys(m.basePrice.regions).length === 0)).toBe(true);
    expect(pub.regionsForPreview).toBeUndefined();
  });

  it("omits hidden models and disabled options", () => {
    const c = fixtureCatalog();
    c.models[1]!.status = "inactive";
    c.models[0]!.bathrooms[1]!.enabled = false;
    const pub = buildPublicCatalog(c, 1, () => null);
    expect(pub.models.map((m) => m.slug)).toEqual(["manzanita-i448-a1"]);
    expect(pub.models[0]!.bathrooms.map((b) => b.id)).toEqual(["bathtub"]);
  });
});

describe("GoHighLevel messages", () => {
  it("reads the sticky-contact message GHL posts after a submit", () => {
    const data = [
      "set-sticky-contacts",
      "_ud",
      JSON.stringify({
        full_name: "Pat Lee",
        email: "pat@example.com",
        address1: "1 Main St",
        city: "San Jose",
        state: "CA",
        postal_code: "95112",
        customer_id: "abc123",
      }),
      "loc",
      "fp",
    ];
    const msg = parseGhlMessage(data);
    expect(msg.type).toBe("submitted");
    if (msg.type === "submitted")
      expect(msg.submission).toMatchObject({
        firstName: "Pat",
        lastName: "Lee",
        city: "San Jose",
        postalCode: "95112",
        contactId: "abc123",
      });
  });

  it("ignores unrelated messages the legacy site mistook for submits", () => {
    expect(parseGhlMessage(["iframeLoaded"]).type).toBe("other");
    expect(parseGhlMessage("formLoaded").type).toBe("other");
    expect(parseGhlMessage("[iFrameSizer]inline-x:812:400:resize")).toEqual({
      type: "resize",
      height: 812,
    });
  });

  it("checks origins and builds the same prefill keys as before", () => {
    expect(isGhlOrigin("https://api.leadconnectorhq.com")).toBe(true);
    expect(isGhlOrigin("https://link.msgsndr.com")).toBe(true);
    expect(isGhlOrigin("https://evil.example.com")).toBe(false);
    const q = new URLSearchParams(
      ghlPrefillQuery({ firstName: "Pat", phone: "+1555", address: "1 Main" }),
    );
    expect(q.get("phoneNumber")).toBe("+1555");
    expect(q.get("full_address")).toBe("1 Main");
    expect(q.get("prefill")).toBe("true");
  });
});

describe("filename detection", () => {
  const styles = fixtureCatalog().styles.map((s) => ({ id: s.id, name: s.name, kind: s.kind }));
  it("recognizes Acton's rendering names, including 9-ft, porch and typos", () => {
    expect(
      classifyFilename(
        "05-Investor Series i-448-A-2 (BD-1) (BA-1) Half Moon Bay Coastal - 9-1.jpg",
        styles,
      ),
    ).toMatchObject({ kind: "exterior", styleId: "half-moon-bay-coastal", ceiling: "9" });
    expect(
      classifyFilename("10-Signature Series S-748-B-1 (P) Santa Barabara Spanish.jpg", styles),
    ).toMatchObject({
      kind: "exterior",
      styleId: "santa-barbara-spanish",
      variant: "porch",
      confidence: "medium",
    });
    expect(
      classifyFilename(
        "07-Signature Series S-658-A (BD-1) (BA-1) Vila Noir - Lighting Dusk Uplight.jpg",
        styles,
      ),
    ).toMatchObject({ kind: "interior", styleId: "villa-noir", role: "lighting_dusk_uplights" });
    expect(classifyFilename("01-x California Coastal - Lighting Dusk.jpg", styles).role).toBe(
      "lighting_dusk",
    );
    expect(
      classifyFilename("Investor Series - Plan i-448-A-1 (BD-1) (BA-1) (REV)_3k.jpg", styles),
    ).toMatchObject({ kind: "floorplan", mirror: true });
    expect(classifyFilename("IMG_2231.jpg", styles).kind).toBe("unknown");
  });
});

describe("public routes", () => {
  it("only the customer page and its API are public", () => {
    expect(isAnonymousConfiguratorPath("/design")).toBe(true);
    expect(isAnonymousConfiguratorPath("/design/anything")).toBe(true);
    expect(isAnonymousConfiguratorPath("/api/public/configurator/quote")).toBe(true);
    expect(isAnonymousConfiguratorPath("/designs")).toBe(false);
    expect(isAnonymousConfiguratorPath("/configurator")).toBe(false);
    expect(isAnonymousPublicPath("/api/admin/configurator/draft")).toBe(false);
    expect(isAnonymousPublicPath("/design")).toBe(true);
    expect(isConfiguratorHost("design.actonadu.com")).toBe(true);
    expect(isConfiguratorHost("baxter.actonadu.com")).toBe(false);
  });
});

import { emptyCatalog, newModel } from "@/lib/configurator/defaults";
import { flatPrice } from "@/lib/configurator/pricing";
import { slotKey, type Slot } from "@/lib/configurator/render";
import type { Catalog, Model } from "@/lib/configurator/types";

let n = 0;
/** Deterministic fake asset ids (uuid-shaped). */
export function fakeAssetId(): string {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * Two-region catalog with an Investor model (8/9-ft, no options) and a Signature model
 * (Standard / With Porch), fully priced and rendered unless told otherwise.
 */
export function fixtureCatalog(): Catalog {
  const c = emptyCatalog();
  c.series = [
    { id: "investor", slug: "investor", name: "Investor Series", sortOrder: 0, rev: 1 },
    { id: "signature", slug: "signature", name: "Signature Series", sortOrder: 1, rev: 1 },
  ];
  c.styles = [
    {
      id: "half-moon-bay-coastal",
      kind: "exterior",
      name: "Half Moon Bay Coastal",
      description: "",
      detailsAssetId: null,
      sortOrder: 0,
      archived: false,
      rev: 1,
    },
    {
      id: "santa-barbara-spanish",
      kind: "exterior",
      name: "Santa Barbara Spanish",
      description: "",
      detailsAssetId: null,
      sortOrder: 1,
      archived: false,
      rev: 1,
    },
    {
      id: "california-coastal",
      kind: "interior",
      name: "California Coastal",
      description: "",
      detailsAssetId: null,
      sortOrder: 0,
      archived: false,
      rev: 1,
    },
    {
      id: "villa-noir",
      kind: "interior",
      name: "Villa Noir",
      description: "",
      detailsAssetId: null,
      sortOrder: 1,
      archived: false,
      rev: 1,
    },
  ];
  c.regions = [
    {
      id: "bay-area",
      name: "Bay Area",
      color: "#22c55e",
      cities: [
        { name: "San Jose", state: "CA" },
        { name: "Sunnyvale", state: "CA" },
      ],
      sortOrder: 0,
      rev: 1,
    },
    {
      id: "sacramento",
      name: "Sacramento",
      color: "#3b82f6",
      cities: [{ name: "Sacramento", state: "CA" }],
      sortOrder: 1,
      rev: 1,
    },
  ];
  const regions = c.regions.map((r) => r.id);

  const manzanita = newModel(
    { name: "Manzanita i448 A1", seriesId: "investor", beds: 1, baths: 1, sqft: 448 },
    c,
  );
  manzanita.slug = "manzanita-i448-a1";
  manzanita.status = "active";
  manzanita.upgrades = [
    {
      id: "no-upgrade",
      name: "No Upgrade",
      lines: [],
      effect: "none",
      enabled: true,
      isDefault: true,
      sortOrder: 0,
      price: flatPrice(0, regions),
    },
    {
      id: "9-foot-ceiling",
      name: "9-foot Ceiling",
      lines: [],
      effect: "ceiling_9ft",
      enabled: true,
      isDefault: false,
      sortOrder: 1,
      price: flatPrice(6000, regions),
    },
    {
      id: "lighting-upgrade",
      name: "Lighting Upgrade",
      lines: [],
      effect: "lighting",
      enabled: true,
      isDefault: false,
      sortOrder: 2,
      price: flatPrice(1500, regions),
    },
  ];
  manzanita.bathrooms = [
    {
      id: "bathtub",
      name: "Bathtub",
      lines: [],
      enabled: true,
      isDefault: true,
      sortOrder: 0,
      price: flatPrice(0, regions),
    },
    {
      id: "shower-pan",
      name: "Shower Pan",
      lines: [],
      enabled: true,
      isDefault: false,
      sortOrder: 1,
      price: flatPrice(4600, regions),
    },
  ];
  manzanita.legacyAliases = [
    { value: "manzanita-i448-a1", kind: "model", ref: manzanita.id },
    { value: "HalfMoonBayCoastali-448-A-1", kind: "exterior", ref: "half-moon-bay-coastal" },
    { value: "CaliforniaCoastal-i-448A-1", kind: "interior", ref: "california-coastal" },
    { value: "CaliforniaCoastalMidTiei-448", kind: "upgrade", ref: "9-foot-ceiling" },
    { value: "CaliforniaCoastalShower", kind: "bathroom", ref: "shower-pan" },
  ];

  const cypress = newModel(
    {
      name: "Cypress s748 B1",
      seriesId: "signature",
      beds: 2,
      baths: 2,
      sqft: 748,
      withPorchOption: true,
    },
    { ...c, models: [manzanita] },
  );
  cypress.slug = "cypress-s748-b1";
  cypress.status = "active";

  for (const model of [manzanita, cypress]) {
    priceEverything(model, regions);
    fillRenders(model);
    model.floorplans = { standard: fakeAssetId(), mirror: fakeAssetId() };
  }
  manzanita.basePrice = flatPrice(316000, regions);
  cypress.basePrice = {
    ...flatPrice(475000, regions),
    regions: { "bay-area": 475000, sacramento: 455000 },
  };
  cypress.exteriors = cypress.exteriors.map((u) =>
    u.styleId === "santa-barbara-spanish" ? { ...u, price: flatPrice(19500, regions) } : u,
  );
  cypress.options = cypress.options.map((o) =>
    o.exteriorVariant === "porch" ? { ...o, price: flatPrice(6700, regions) } : o,
  );

  c.models = [manzanita, cypress];
  return c;
}

function priceEverything(model: Model, regions: string[]) {
  model.basePrice = flatPrice(300000, regions);
  for (const list of [
    model.options,
    model.exteriors,
    model.interiors,
    model.appliances,
    model.upgrades,
    model.bathrooms,
  ])
    for (const item of list)
      item.price = { ...item.price, ...flatPrice(item.price.regions[regions[0]!] ?? 0, regions) };
}

/** Assign a distinct fake asset to every slot (both heights, both variants, all roles). */
export function fillRenders(model: Model) {
  const set = (slot: Slot) => (model.renders[slotKey(slot)] = fakeAssetId());
  const variants = model.options.length
    ? (["standard", "porch"] as const)
    : (["standard"] as const);
  for (const u of model.exteriors)
    for (const v of variants)
      for (const ceiling of ["8", "9"] as const)
        set({ type: "ext", styleId: u.styleId, variant: v, ceiling });
  for (const u of model.interiors) {
    for (const role of [
      "kitchen",
      "lighting_daytime",
      "appliance_base",
      "appliance_mid",
      "lighting_dusk_uplights",
      "lighting_dusk",
      "ambiance",
    ] as const)
      for (const ceiling of ["8", "9"] as const)
        set({ type: "int", styleId: u.styleId, role, ceiling });
    for (const b of model.bathrooms) set({ type: "bath", styleId: u.styleId, bathroomId: b.id });
  }
}

export function getModel(c: Catalog, slug: string): Model {
  const m = c.models.find((x) => x.slug === slug);
  if (!m) throw new Error(`fixture model ${slug} missing`);
  return m;
}

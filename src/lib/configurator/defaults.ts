/**
 * Defaults and factories for new catalog entities. Shared by the admin UI, the server
 * and the import script, so it only imports pure modules.
 */

import { emptyPrice } from "./pricing";
import type {
  AppliancePackage,
  BathroomOption,
  Catalog,
  CatalogSettings,
  Model,
  ModelOption,
  Region,
  Series,
  SharedStyle,
  StyleKind,
  StyleUse,
  Upgrade,
} from "./types";
import { CATALOG_SCHEMA_VERSION } from "./types";

export const DEFAULT_SETTINGS: CatalogSettings = {
  financing: {
    enabled: true,
    annualRatePct: 6,
    termMonths: 360,
    disclaimer: "For accurate price estimate please provide your location",
    linkUrl: "",
  },
  upgradeSelection: "single",
  quoteFormId: "p1swLQWD4mVI7APiGzFp",
  locationFormId: "pV3Gf1zaZHLuCTipKGKZ",
  canibuildEnabled: true,
  homeUrl: "https://actonadu.com/",
  rev: 1,
};

/** GHL form used by the Save button on the existing site. */
export const SAVE_FORM_ID = "1xhDrNtf1yDpbl6eS9gC";

/** Publishable Can I Build search-widget token used by the existing site (client-side by design). */
export const CANIBUILD_WIDGET_TOKEN = "61765dc9-fe4c-41e2-97dc-ae5ff730a1e0";

export function emptyCatalog(): Catalog {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, financing: { ...DEFAULT_SETTINGS.financing } },
    series: [],
    styles: [],
    regions: [],
    models: [],
  };
}

/** Lowercase URL-safe slug. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** `base`, or `base-2`, `base-3`… whichever is not in `taken`. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const root = base || "item";
  if (!set.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
}

export function newSeries(name: string, catalog: Catalog): Series {
  const id = uniqueId(
    slugify(name) || "series",
    catalog.series.map((s) => s.id),
  );
  return { id, slug: id, name, sortOrder: catalog.series.length, rev: 0 };
}

export function newStyle(kind: StyleKind, name: string, catalog: Catalog): SharedStyle {
  return {
    id: uniqueId(
      slugify(name) || kind,
      catalog.styles.map((s) => s.id),
    ),
    kind,
    name,
    description: "",
    detailsAssetId: null,
    sortOrder: catalog.styles.filter((s) => s.kind === kind).length,
    archived: false,
    rev: 0,
  };
}

export function newRegion(name: string, catalog: Catalog, color: string): Region {
  return {
    id: uniqueId(
      slugify(name) || "region",
      catalog.regions.map((r) => r.id),
    ),
    name,
    color,
    cities: [],
    sortOrder: catalog.regions.length,
    rev: 0,
  };
}

export function newStyleUse(styleId: string, sortOrder: number, isDefault = false): StyleUse {
  return { styleId, enabled: true, isDefault, sortOrder, price: emptyPrice() };
}

export function newModelOption(name: string, existing: ModelOption[]): ModelOption {
  return {
    id: uniqueId(
      slugify(name) || "option",
      existing.map((o) => o.id),
    ),
    name,
    exteriorVariant: /porch/i.test(name) ? "porch" : "standard",
    enabled: true,
    isDefault: existing.length === 0,
    sortOrder: existing.length,
    price: emptyPrice(),
  };
}

export function newAppliance(name: string, existing: AppliancePackage[]): AppliancePackage {
  return {
    id: uniqueId(
      slugify(name) || "appliances",
      existing.map((a) => a.id),
    ),
    name,
    lines: [],
    renderRole: existing.some((a) => a.renderRole === "appliance_base")
      ? "appliance_mid"
      : "appliance_base",
    enabled: true,
    isDefault: existing.length === 0,
    sortOrder: existing.length,
    price: emptyPrice(),
  };
}

export function newUpgrade(name: string, existing: Upgrade[]): Upgrade {
  const effect = /9.?(foot|ft)/i.test(name)
    ? "ceiling_9ft"
    : /light/i.test(name)
      ? "lighting"
      : "other";
  return {
    id: uniqueId(
      slugify(name) || "upgrade",
      existing.map((u) => u.id),
    ),
    name,
    lines: [],
    effect,
    enabled: true,
    isDefault: false,
    sortOrder: existing.length,
    price: emptyPrice(),
  };
}

export function newBathroom(name: string, existing: BathroomOption[]): BathroomOption {
  return {
    id: uniqueId(
      slugify(name) || "bathroom",
      existing.map((b) => b.id),
    ),
    name,
    lines: [],
    enabled: true,
    isDefault: existing.length === 0,
    sortOrder: existing.length,
    price: emptyPrice(),
  };
}

export type NewModelInput = {
  name: string;
  seriesId: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  /** Shared styles to offer; defaults to every non-archived style. */
  exteriorStyleIds?: string[];
  interiorStyleIds?: string[];
  withPorchOption?: boolean;
};

/**
 * A new model that inherits the shared style library and every region (regions are global,
 * so a model's prices automatically have a column for each one). Appliances, upgrades and
 * bathrooms start from the most common setup so the admin edits rather than rebuilds.
 */
export function newModel(input: NewModelInput, catalog: Catalog): Model {
  const id = uniqueId(
    slugify(input.name) || "model",
    catalog.models.map((m) => m.id),
  );
  const slug = uniqueId(
    id,
    catalog.models.map((m) => m.slug.toLowerCase()),
  );
  const pick = (kind: StyleKind, ids?: string[]) =>
    catalog.styles
      .filter((s) => s.kind === kind && !s.archived && (!ids || ids.includes(s.id)))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s, i) => newStyleUse(s.id, i, i === 0));

  const options: ModelOption[] = [];
  if (input.withPorchOption) {
    const standard = newModelOption("Standard", options);
    options.push(standard);
    options.push({ ...newModelOption("With Porch", options), exteriorVariant: "porch" });
  }

  const appliances: AppliancePackage[] = [];
  appliances.push(newAppliance("Lifestyle", appliances));
  appliances.push(newAppliance("Premium", appliances));

  const upgrades: Upgrade[] = [
    {
      ...newUpgrade("No Upgrade", []),
      effect: "none",
      isDefault: true,
      lines: ["No upgrades selected"],
    },
  ];
  upgrades.push(newUpgrade("Lighting Upgrade", upgrades));

  const bathrooms: BathroomOption[] = [];
  bathrooms.push(newBathroom("Shower Pan", bathrooms));

  return {
    id,
    slug,
    name: input.name,
    seriesId: input.seriesId,
    status: "inactive",
    sortOrder: catalog.models.length,
    beds: input.beds,
    baths: input.baths,
    sqft: input.sqft,
    description: "",
    canibuildDesignName: input.name,
    preApproved: false,
    preApprovedTitle: "This plan saves time and money by being pre-approved",
    preApprovedCities: [],
    basePrice: emptyPrice(),
    floorplans: { standard: null, mirror: null },
    options,
    exteriors: pick("exterior", input.exteriorStyleIds),
    interiors: pick("interior", input.interiorStyleIds),
    appliances,
    upgrades,
    bathrooms,
    renders: {},
    ceilingFallback: false,
    legacyAliases: [],
    rev: 0,
  };
}

/** Deep copy of a model with a new id/slug/name. Renders and prices are copied too. */
export function duplicateModel(source: Model, name: string, catalog: Catalog): Model {
  const copy: Model = JSON.parse(JSON.stringify(source));
  const id = uniqueId(
    slugify(name) || `${source.id}-copy`,
    catalog.models.map((m) => m.id),
  );
  return {
    ...copy,
    id,
    slug: uniqueId(
      id,
      catalog.models.map((m) => m.slug.toLowerCase()),
    ),
    name,
    status: "inactive",
    sortOrder: catalog.models.length,
    legacyAliases: [],
    rev: 0,
  };
}

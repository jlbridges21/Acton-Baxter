/**
 * Acton ADU Configurator — catalog domain types.
 *
 * The whole configurator (series, shared styles, regions, models with their options,
 * renderings and prices) is one versioned document. Admins edit the *draft* document;
 * publishing freezes a copy as an immutable *release* that the public configurator reads.
 * Prices live in exactly one place (the `Price` on each item), so the per-style
 * "Pricing by Region" tab and the bulk pricing grid edit the same values.
 *
 * Pure types only: this file is shared by server code, client components and the
 * import script, so it must not import anything.
 */

export const CATALOG_SCHEMA_VERSION = 1;

export type CeilingHeight = "8" | "9";
export const CEILING_HEIGHTS: readonly CeilingHeight[] = ["8", "9"];

/** Exterior rendering variant chosen by a Model Option (e.g. "With Porch"). */
export type ExteriorVariant = "standard" | "porch";
export const EXTERIOR_VARIANTS: readonly ExteriorVariant[] = ["standard", "porch"];

export type StyleKind = "exterior" | "interior";

/** The seven renderings that exist for each interior style and ceiling height. */
export type InteriorRole =
  | "kitchen"
  | "lighting_daytime"
  | "appliance_base"
  | "appliance_mid"
  | "lighting_dusk_uplights"
  | "lighting_dusk"
  | "ambiance";

export const INTERIOR_ROLES: readonly InteriorRole[] = [
  "kitchen",
  "lighting_daytime",
  "appliance_base",
  "appliance_mid",
  "lighting_dusk_uplights",
  "lighting_dusk",
  "ambiance",
];

export type ApplianceRenderRole = "appliance_base" | "appliance_mid";

/** What an upgrade does to the renderings. */
export type UpgradeEffect = "none" | "ceiling_9ft" | "lighting" | "other";

export type PriceMode = "explicit" | "adjusted";
export type AdjustKind = "amount" | "percent";

/**
 * A regional price.
 * - `explicit`: `regions[regionId]` is the price in that region (null = not set yet).
 * - `adjusted`: `base` plus `regions[regionId]` as a dollar or percent adjustment
 *   (null adjustment = no adjustment).
 * `needsReview` marks imported or placeholder values that an admin has not confirmed.
 */
export type Price = {
  mode: PriceMode;
  base: number | null;
  adjustKind: AdjustKind;
  regions: Record<string, number | null>;
  needsReview: boolean;
};

export type CityRef = { name: string; state: string };

export type Region = {
  id: string;
  name: string;
  color: string;
  cities: CityRef[];
  sortOrder: number;
  rev: number;
};

export type Series = {
  id: string;
  /** URL value, e.g. `investor`. */
  slug: string;
  name: string;
  sortOrder: number;
  rev: number;
};

/** A style shared across models (e.g. "California Coastal"). Renders and prices are per model. */
export type SharedStyle = {
  id: string;
  kind: StyleKind;
  name: string;
  description: string;
  /** "Style details" board shown with the interior style toggle. */
  detailsAssetId: string | null;
  sortOrder: number;
  archived: boolean;
  rev: number;
};

export type ModelOption = {
  id: string;
  name: string;
  exteriorVariant: ExteriorVariant;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  price: Price;
};

/** A shared style assigned to a model, with that model's own default, order and price. */
export type StyleUse = {
  styleId: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  price: Price;
};

export type AppliancePackage = {
  id: string;
  name: string;
  lines: string[];
  renderRole: ApplianceRenderRole;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  price: Price;
};

export type Upgrade = {
  id: string;
  name: string;
  lines: string[];
  effect: UpgradeEffect;
  enabled: boolean;
  /** The "No Upgrade" card. Selecting it clears every other upgrade. */
  isDefault: boolean;
  sortOrder: number;
  price: Price;
};

/** A bathroom type (e.g. "Shower Pan"). Customers see "<Interior style> <name>". */
export type BathroomOption = {
  id: string;
  name: string;
  lines: string[];
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  price: Price;
};

export type LegacyAliasKind =
  "model" | "option" | "exterior" | "interior" | "appliance" | "upgrade" | "bathroom";

/** Maps a value from an old design.actonadu.com deep link to an item on this model. */
export type LegacyAlias = { value: string; kind: LegacyAliasKind; ref: string };

export type ModelStatus = "active" | "inactive";

export type Model = {
  id: string;
  /** URL value used in `?model=`. */
  slug: string;
  name: string;
  seriesId: string;
  /** `active` models appear in the customer configurator once published. */
  status: ModelStatus;
  sortOrder: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  description: string;
  canibuildDesignName: string;
  preApproved: boolean;
  preApprovedTitle: string;
  preApprovedCities: string[];
  basePrice: Price;
  floorplans: { standard: string | null; mirror: string | null };
  options: ModelOption[];
  exteriors: StyleUse[];
  interiors: StyleUse[];
  appliances: AppliancePackage[];
  upgrades: Upgrade[];
  bathrooms: BathroomOption[];
  /** Render slot key (see render.ts) → asset id. */
  renders: Record<string, string>;
  /**
   * When a 9-ft rendering is missing, show the 8-ft one instead. Off by default;
   * an admin turns it on knowingly so the gap is never hidden silently.
   */
  ceilingFallback: boolean;
  legacyAliases: LegacyAlias[];
  rev: number;
};

export type FinancingSettings = {
  enabled: boolean;
  annualRatePct: number;
  termMonths: number;
  /** Tooltip text next to the monthly estimate. */
  disclaimer: string;
  /** Target of the "Financing" link. */
  linkUrl: string;
};

export type UpgradeSelectionMode = "single" | "multiple";

export type CatalogSettings = {
  financing: FinancingSettings;
  upgradeSelection: UpgradeSelectionMode;
  quoteFormId: string;
  locationFormId: string;
  canibuildEnabled: boolean;
  homeUrl: string;
  rev: number;
};

export type Catalog = {
  schemaVersion: number;
  settings: CatalogSettings;
  series: Series[];
  styles: SharedStyle[];
  regions: Region[];
  models: Model[];
};

/** Collections that can be edited entity-by-entity. */
export type CatalogCollection = "series" | "styles" | "regions" | "models";

export type CatalogChange =
  | { op: "put"; collection: "series"; value: Series; expectedRev: number | null }
  | { op: "put"; collection: "styles"; value: SharedStyle; expectedRev: number | null }
  | { op: "put"; collection: "regions"; value: Region; expectedRev: number | null }
  | { op: "put"; collection: "models"; value: Model; expectedRev: number | null }
  | { op: "delete"; collection: CatalogCollection; id: string; expectedRev: number | null }
  | { op: "settings"; value: CatalogSettings; expectedRev: number | null };

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetSource = "local_import" | "legacy_site" | "upload";

export type AssetKindHint =
  "exterior" | "interior" | "bathroom" | "floorplan" | "details" | "other";

/** What the importer (or an admin) believes an image shows. */
export type AssetClassification = {
  kind: AssetKindHint;
  modelId: string | null;
  styleId: string | null;
  role: InteriorRole | null;
  ceiling: CeilingHeight | null;
  variant: ExteriorVariant | null;
  mirror: boolean | null;
  bathroomName: string | null;
  confidence: "high" | "medium" | "low";
  notes: string[];
};

export type Asset = {
  id: string;
  displayPath: string;
  thumbPath: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  sha256: string;
  originalName: string;
  source: AssetSource;
  /** Where the image came from: local folder path, legacy URL, or uploader. */
  provenance: string;
  classification: AssetClassification | null;
  createdAt: string;
};

/** Asset reference embedded in public payloads. */
export type PublicAssetRef = { display: string; thumb: string };

// ---------------------------------------------------------------------------
// Customer selection
// ---------------------------------------------------------------------------

export type StepId =
  "model" | "options" | "exterior" | "interior" | "appliances" | "upgrades" | "bathroom" | "quote";

export type Selection = {
  modelId: string;
  optionId: string | null;
  exteriorId: string | null;
  interiorId: string | null;
  applianceId: string | null;
  upgradeIds: string[];
  bathroomId: string | null;
};

export type ViewMode = "elevation" | "floorplan";

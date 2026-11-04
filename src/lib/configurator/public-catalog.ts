/**
 * The customer-facing payload. Built from a release (or, for admin preview, the draft).
 *
 * Prices are stripped: every `Price` becomes an empty placeholder, so no gated price can be
 * read from the page, its markup or this API before the customer's location is verified.
 * Prices are served separately by the quote endpoint, per model, for a verified region.
 */

import { modelHeroAssetId } from "./render";
import { CANIBUILD_WIDGET_TOKEN, SAVE_FORM_ID } from "./defaults";
import type { Catalog, Model, Price, PublicAssetRef } from "./types";

export type AssetUrlMap = Record<string, PublicAssetRef>;

export type PublicModel = Model & { seriesSlug: string; heroAssetId: string | null };

export type PublicCatalog = {
  /** Release version, or "draft" for admin preview. */
  version: number | "draft";
  settings: {
    financingEnabled: boolean;
    financingDisclaimer: string;
    financingLinkUrl: string;
    upgradeSelection: Catalog["settings"]["upgradeSelection"];
    quoteFormId: string;
    locationFormId: string;
    saveFormId: string;
    canibuildEnabled: boolean;
    canibuildToken: string;
    homeUrl: string;
  };
  series: { id: string; slug: string; name: string }[];
  styles: {
    id: string;
    kind: "exterior" | "interior";
    name: string;
    description: string;
    detailsAssetId: string | null;
  }[];
  models: PublicModel[];
  assets: AssetUrlMap;
  /** Admin draft preview only: lets the preview bar price as a chosen region. */
  regionsForPreview?: { id: string; name: string }[];
};

const NO_PRICE: Price = {
  mode: "explicit",
  base: null,
  adjustKind: "amount",
  regions: {},
  needsReview: false,
};

function strip<T extends { price: Price; enabled: boolean }>(items: T[]): T[] {
  return items.filter((i) => i.enabled).map((i) => ({ ...i, price: NO_PRICE }));
}

export function toPublicModel(model: Model, seriesSlug: string): PublicModel {
  return {
    ...model,
    basePrice: NO_PRICE,
    options: strip(model.options),
    exteriors: strip(model.exteriors),
    interiors: strip(model.interiors),
    appliances: strip(model.appliances),
    upgrades: strip(model.upgrades),
    bathrooms: strip(model.bathrooms),
    preApprovedCities: model.preApproved ? model.preApprovedCities : [],
    seriesSlug,
    heroAssetId: modelHeroAssetId(model),
  };
}

export function buildPublicCatalog(
  catalog: Catalog,
  version: number | "draft",
  assetUrl: (assetId: string) => PublicAssetRef | null,
): PublicCatalog {
  const seriesById = new Map(catalog.series.map((s) => [s.id, s]));
  const models = catalog.models
    .filter((m) => m.status === "active" && seriesById.has(m.seriesId))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => toPublicModel(m, seriesById.get(m.seriesId)!.slug));

  const usedStyleIds = new Set(
    models.flatMap((m) => [...m.exteriors, ...m.interiors].map((u) => u.styleId)),
  );
  const styles = catalog.styles
    .filter((s) => usedStyleIds.has(s.id))
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      description: s.description,
      detailsAssetId: s.detailsAssetId,
    }));

  const assets: AssetUrlMap = {};
  const addAsset = (id: string | null) => {
    if (!id || assets[id]) return;
    const ref = assetUrl(id);
    if (ref) assets[id] = ref;
  };
  for (const model of models) {
    Object.values(model.renders).forEach(addAsset);
    addAsset(model.floorplans.standard);
    addAsset(model.floorplans.mirror);
  }
  for (const style of styles) addAsset(style.detailsAssetId);

  const s = catalog.settings;
  return {
    version,
    settings: {
      financingEnabled: s.financing.enabled,
      financingDisclaimer: s.financing.disclaimer,
      financingLinkUrl: s.financing.linkUrl,
      upgradeSelection: s.upgradeSelection,
      quoteFormId: s.quoteFormId,
      locationFormId: s.locationFormId,
      saveFormId: SAVE_FORM_ID,
      canibuildEnabled: s.canibuildEnabled,
      canibuildToken: CANIBUILD_WIDGET_TOKEN,
      homeUrl: s.homeUrl,
    },
    series: catalog.series
      .filter((se) => models.some((m) => m.seriesId === se.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((se) => ({ id: se.id, slug: se.slug, name: se.name })),
    styles,
    models,
    assets,
    ...(version === "draft"
      ? { regionsForPreview: catalog.regions.map((r) => ({ id: r.id, name: r.name })) }
      : {}),
  };
}

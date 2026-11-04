/**
 * Server loaders shared by configurator pages and route handlers.
 */

import "server-only";

import { assetRef } from "./asset-storage";
import { buildPublicCatalog, type PublicCatalog } from "./public-catalog";
import {
  getAssetsByIds,
  getCurrentRelease,
  getDraft,
  listAssets,
  listReleases,
  planPublish,
  type ReleaseSummary,
} from "./store";
import { validateCatalog, type Issue } from "./validate";
import type { Asset, Catalog } from "./types";

export type AdminAsset = Asset & { thumbUrl: string; displayUrl: string };

export function toAdminAsset(asset: Asset): AdminAsset {
  const ref = assetRef(asset);
  return { ...asset, thumbUrl: ref.thumb, displayUrl: ref.display };
}

function draftAssetIds(catalog: Catalog): string[] {
  const ids: string[] = [];
  for (const m of catalog.models) {
    ids.push(...Object.values(m.renders));
    if (m.floorplans.standard) ids.push(m.floorplans.standard);
    if (m.floorplans.mirror) ids.push(m.floorplans.mirror);
  }
  for (const s of catalog.styles) if (s.detailsAssetId) ids.push(s.detailsAssetId);
  return ids;
}

/** Customer payload from the live release, or the draft for an admin preview. */
export async function loadPublicCatalog(options: {
  preview: boolean;
}): Promise<PublicCatalog | null> {
  if (options.preview) {
    const draft = await getDraft();
    const assets = await getAssetsByIds(draftAssetIds(draft.catalog));
    return buildPublicCatalog(draft.catalog, "draft", (id) => {
      const a = assets.get(id);
      return a ? assetRef(a) : null;
    });
  }
  const release = await getCurrentRelease();
  if (!release) return null;
  return buildPublicCatalog(release.snapshot.catalog, release.version, (id) => {
    const a = release.snapshot.assets[id];
    return a ? assetRef(a) : null;
  });
}

/** Catalog used for pricing: live release, or the draft in admin preview. */
export async function loadPricingCatalog(options: { preview: boolean }): Promise<Catalog | null> {
  if (options.preview) return (await getDraft()).catalog;
  return (await getCurrentRelease())?.snapshot.catalog ?? null;
}

export type AdminWorkspaceData = {
  catalog: Catalog;
  revision: number;
  updatedAt: string;
  assets: AdminAsset[];
  issues: Issue[];
  live: { version: number; publishedAt: string; catalog: Catalog } | null;
  releases: ReleaseSummary[];
};

export async function loadAdminWorkspace(): Promise<AdminWorkspaceData> {
  const [draft, assets, live, releases] = await Promise.all([
    getDraft(),
    listAssets(),
    getCurrentRelease({ fresh: true }),
    listReleases(),
  ]);
  return {
    catalog: draft.catalog,
    revision: draft.revision,
    updatedAt: draft.updatedAt,
    assets: assets.map(toAdminAsset),
    issues: validateCatalog(draft.catalog),
    live: live
      ? { version: live.version, publishedAt: live.publishedAt, catalog: live.snapshot.catalog }
      : null,
    releases,
  };
}

export async function previewPublishPlan() {
  const [draft, live] = await Promise.all([getDraft(), getCurrentRelease({ fresh: true })]);
  return planPublish(draft.catalog, live?.snapshot.catalog ?? null);
}

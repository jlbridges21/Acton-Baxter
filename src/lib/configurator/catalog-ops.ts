/**
 * Applying admin changes to the draft catalog. Entity-level revisions let two admins edit
 * different models at the same time; editing the same entity concurrently is reported as a
 * conflict instead of silently overwriting someone's work.
 */

import { cityKey, findCityConflicts } from "./regions";
import type { Catalog, CatalogChange, CatalogCollection, Model, Region } from "./types";

export type ChangeConflict = {
  collection: CatalogCollection | "settings";
  id: string;
  message: string;
};

export type ApplyResult =
  { ok: true; catalog: Catalog } | { ok: false; conflicts: ChangeConflict[]; errors: string[] };

type Entity = { id: string; rev: number };

function collectionLabel(c: CatalogCollection): string {
  return { series: "series", styles: "style", regions: "region", models: "model" }[c];
}

export function applyChanges(current: Catalog, changes: CatalogChange[]): ApplyResult {
  const catalog: Catalog = structuredClone(current);
  const conflicts: ChangeConflict[] = [];
  const errors: string[] = [];

  for (const change of changes) {
    if (change.op === "settings") {
      if (change.expectedRev !== null && change.expectedRev !== catalog.settings.rev) {
        conflicts.push({
          collection: "settings",
          id: "settings",
          message: "Settings were changed by someone else.",
        });
        continue;
      }
      catalog.settings = { ...change.value, rev: catalog.settings.rev + 1 };
      continue;
    }

    const list = catalog[change.collection] as Entity[];
    const id = change.op === "put" ? change.value.id : change.id;
    const index = list.findIndex((e) => e.id === id);
    const existing = index >= 0 ? list[index] : undefined;
    const label = collectionLabel(change.collection);

    if (change.op === "delete") {
      if (!existing) continue;
      if (change.expectedRev !== null && existing.rev !== change.expectedRev) {
        conflicts.push({
          collection: change.collection,
          id,
          message: `This ${label} was changed by someone else.`,
        });
        continue;
      }
      const blocker = deleteBlocker(catalog, change.collection, id);
      if (blocker) {
        errors.push(blocker);
        continue;
      }
      list.splice(index, 1);
      if (change.collection === "regions") removeRegionPrices(catalog, id);
      continue;
    }

    if (existing && change.expectedRev === null) {
      conflicts.push({
        collection: change.collection,
        id,
        message: `A ${label} with this id already exists.`,
      });
      continue;
    }
    if (existing && change.expectedRev !== existing.rev) {
      conflicts.push({
        collection: change.collection,
        id,
        message: `This ${label} was changed by someone else.`,
      });
      continue;
    }
    if (!existing && change.expectedRev !== null) {
      conflicts.push({
        collection: change.collection,
        id,
        message: `This ${label} was deleted by someone else.`,
      });
      continue;
    }
    const next = { ...change.value, rev: (existing?.rev ?? 0) + 1 } as Entity;
    if (existing) list[index] = next;
    else list.push(next);
  }

  errors.push(...referenceErrors(catalog));
  for (const conflict of findCityConflicts(catalog.regions)) {
    const names = conflict.regionIds.map(
      (rid) => catalog.regions.find((r) => r.id === rid)?.name ?? rid,
    );
    errors.push(
      `${conflict.city.name} can only belong to one region (found in ${names.join(" and ")}).`,
    );
  }

  if (conflicts.length || errors.length) return { ok: false, conflicts, errors };
  return { ok: true, catalog };
}

function deleteBlocker(catalog: Catalog, collection: CatalogCollection, id: string): string | null {
  if (collection === "styles") {
    const users = catalog.models.filter((m) =>
      [...m.exteriors, ...m.interiors].some((u) => u.styleId === id),
    );
    if (users.length)
      return `This style is used by ${users.map((m) => m.name).join(", ")}. Remove it from those models or archive it instead.`;
  }
  if (collection === "series") {
    const users = catalog.models.filter((m) => m.seriesId === id);
    if (users.length)
      return `This series still has models (${users.map((m) => m.name).join(", ")}).`;
  }
  return null;
}

function removeRegionPrices(catalog: Catalog, regionId: string): void {
  const strip = (price: { regions: Record<string, number | null> }) => {
    delete price.regions[regionId];
  };
  for (const model of catalog.models) {
    strip(model.basePrice);
    for (const item of [
      ...model.options,
      ...model.exteriors,
      ...model.interiors,
      ...model.appliances,
      ...model.upgrades,
      ...model.bathrooms,
    ])
      strip(item.price);
  }
}

function referenceErrors(catalog: Catalog): string[] {
  const errors: string[] = [];
  const styles = new Map(catalog.styles.map((s) => [s.id, s]));
  const series = new Set(catalog.series.map((s) => s.id));
  for (const model of catalog.models) {
    if (!series.has(model.seriesId))
      errors.push(`${model.name} refers to a series that does not exist.`);
    for (const use of model.exteriors)
      if (styles.get(use.styleId)?.kind !== "exterior")
        errors.push(`${model.name} refers to an unknown exterior style.`);
    for (const use of model.interiors)
      if (styles.get(use.styleId)?.kind !== "interior")
        errors.push(`${model.name} refers to an unknown interior style.`);
    for (const list of [model.options, model.appliances, model.upgrades, model.bathrooms]) {
      const ids = list.map((i) => i.id);
      if (new Set(ids).size !== ids.length)
        errors.push(`${model.name} has two items with the same id.`);
    }
  }
  return [...new Set(errors)];
}

// ---------------------------------------------------------------------------
// Client-side helpers for building change lists
// ---------------------------------------------------------------------------

export function putModel(model: Model, original: Model | undefined): CatalogChange {
  return {
    op: "put",
    collection: "models",
    value: model,
    expectedRev: original ? original.rev : null,
  };
}

export function putRegion(region: Region, original: Region | undefined): CatalogChange {
  return {
    op: "put",
    collection: "regions",
    value: region,
    expectedRev: original ? original.rev : null,
  };
}

/** Add a city to a region unless another region owns it. Returns the owning region on conflict. */
export function addCityToRegion(
  regions: Region[],
  regionId: string,
  city: { name: string; state: string },
): { regions: Region[]; conflict: Region | null } {
  const key = cityKey(city);
  const owner = regions.find((r) => r.cities.some((c) => cityKey(c) === key));
  if (owner && owner.id !== regionId) return { regions, conflict: owner };
  if (owner) return { regions, conflict: null };
  return {
    regions: regions.map((r) => (r.id === regionId ? { ...r, cities: [...r.cities, city] } : r)),
    conflict: null,
  };
}

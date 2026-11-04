/**
 * Readiness checks. The admin dashboard, model workspace and Publish dialog all use
 * these, so "what's missing" is described the same way everywhere.
 *
 * - `error` blocks publishing (the public configurator would show a broken image,
 *   a wrong price, or no price where one is expected).
 * - `warning` is shown but does not block.
 */

import { priceInRegion } from "./pricing";
import { findCityConflicts } from "./regions";
import { requiredSlots, resolveSlot, ROLE_LABELS, type Slot } from "./render";
import type { Catalog, Model, Price, Region } from "./types";

export type IssueArea = "images" | "pricing" | "setup" | "regions";

export type Issue = {
  severity: "error" | "warning";
  area: IssueArea;
  code: string;
  message: string;
  modelId: string | null;
  /** Workspace tab that fixes it. */
  tab:
    | "overview"
    | "options"
    | "exteriors"
    | "interiors"
    | "appliances"
    | "upgrades"
    | "bathrooms"
    | "pricing"
    | "images"
    | null;
  slotKey?: string;
};

function variantLabel(model: Model, variant: string): string {
  if (model.options.filter((o) => o.enabled).length === 0) return "";
  const option = model.options.find((o) => o.enabled && o.exteriorVariant === variant);
  if (!option) return "";
  if (variant === "standard") return ` (${option.name})`;
  return ` with ${option.name.replace(/^with\s+/i, "")}`;
}

export function describeSlot(catalog: Catalog, model: Model, slot: Slot): string {
  const style = catalog.styles.find((s) => s.id === slot.styleId)?.name ?? "Unknown style";
  if (slot.type === "ext") {
    return `${slot.ceiling}-foot ${style} exterior rendering for ${model.name}${variantLabel(model, slot.variant)}`;
  }
  if (slot.type === "int") {
    return `${slot.ceiling}-foot ${style} ${ROLE_LABELS[slot.role]} rendering for ${model.name}`;
  }
  const bath = model.bathrooms.find((b) => b.id === slot.bathroomId)?.name ?? "bathroom";
  return `${style} ${bath} bathroom rendering for ${model.name}`;
}

function enabledItems(model: Model) {
  return [
    ...model.options
      .filter((o) => o.enabled)
      .map((o) => ({ label: `Model option “${o.name}”`, price: o.price, tab: "options" as const })),
    ...model.appliances
      .filter((a) => a.enabled)
      .map((a) => ({
        label: `Appliance package “${a.name}”`,
        price: a.price,
        tab: "appliances" as const,
      })),
    ...model.upgrades
      .filter((u) => u.enabled)
      .map((u) => ({ label: `Upgrade “${u.name}”`, price: u.price, tab: "upgrades" as const })),
    ...model.bathrooms
      .filter((b) => b.enabled)
      .map((b) => ({ label: `Bathroom “${b.name}”`, price: b.price, tab: "bathrooms" as const })),
  ];
}

function styleItems(catalog: Catalog, model: Model) {
  const name = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? "Unknown style";
  return [
    ...model.exteriors
      .filter((u) => u.enabled)
      .map((u) => ({
        label: `Exterior “${name(u.styleId)}”`,
        price: u.price,
        tab: "exteriors" as const,
      })),
    ...model.interiors
      .filter((u) => u.enabled)
      .map((u) => ({
        label: `Interior “${name(u.styleId)}”`,
        price: u.price,
        tab: "interiors" as const,
      })),
  ];
}

function missingRegions(price: Price, regions: Region[]): Region[] {
  return regions.filter((r) => priceInRegion(price, r.id) === null);
}

function regionList(regions: Region[]): string {
  const names = regions.map((r) => r.name);
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
    : names.join(", ");
}

export function validateModel(catalog: Catalog, model: Model): Issue[] {
  const issues: Issue[] = [];
  const add = (issue: Omit<Issue, "modelId">) => issues.push({ ...issue, modelId: model.id });
  const regions = catalog.regions;

  // --- Setup ---------------------------------------------------------------
  if (!model.name.trim())
    add({
      severity: "error",
      area: "setup",
      code: "name",
      message: "Model needs a name.",
      tab: "overview",
    });
  if (!model.slug.trim())
    add({
      severity: "error",
      area: "setup",
      code: "slug",
      message: `${model.name} needs a web address name.`,
      tab: "overview",
    });
  if (!catalog.series.some((s) => s.id === model.seriesId))
    add({
      severity: "error",
      area: "setup",
      code: "series",
      message: `${model.name} is not assigned to a series.`,
      tab: "overview",
    });
  if (model.exteriors.filter((u) => u.enabled).length === 0)
    add({
      severity: "error",
      area: "setup",
      code: "no_exteriors",
      message: `${model.name} has no exterior styles turned on.`,
      tab: "exteriors",
    });
  if (model.interiors.filter((u) => u.enabled).length === 0)
    add({
      severity: "error",
      area: "setup",
      code: "no_interiors",
      message: `${model.name} has no interior styles turned on.`,
      tab: "interiors",
    });
  if (model.appliances.filter((a) => a.enabled).length === 0)
    add({
      severity: "warning",
      area: "setup",
      code: "no_appliances",
      message: `${model.name} has no appliance packages, so the Appliances step will be empty.`,
      tab: "appliances",
    });
  if (model.bathrooms.filter((b) => b.enabled).length === 0)
    add({
      severity: "warning",
      area: "setup",
      code: "no_bathrooms",
      message: `${model.name} has no bathroom options, so the Bathroom step will be empty.`,
      tab: "bathrooms",
    });
  if (!model.floorplans.standard)
    add({
      severity: "warning",
      area: "images",
      code: "floorplan",
      message: `${model.name} has no floorplan image, so the Floorplan toggle will be hidden.`,
      tab: "images",
    });
  if (model.floorplans.standard && !model.floorplans.mirror)
    add({
      severity: "warning",
      area: "images",
      code: "floorplan_mirror",
      message: `${model.name} has no mirrored floorplan, so the Mirror model toggle will be hidden.`,
      tab: "images",
    });

  const lists = [
    {
      label: "model option",
      items: model.options.filter((o) => o.enabled),
      tab: "options" as const,
    },
    {
      label: "appliance package",
      items: model.appliances.filter((a) => a.enabled),
      tab: "appliances" as const,
    },
    {
      label: "bathroom",
      items: model.bathrooms.filter((b) => b.enabled),
      tab: "bathrooms" as const,
    },
    {
      label: "exterior style",
      items: model.exteriors.filter((u) => u.enabled),
      tab: "exteriors" as const,
    },
    {
      label: "interior style",
      items: model.interiors.filter((u) => u.enabled),
      tab: "interiors" as const,
    },
  ];
  for (const list of lists) {
    const defaults = list.items.filter((i) => i.isDefault).length;
    if (list.items.length > 0 && defaults !== 1)
      add({
        severity: "warning",
        area: "setup",
        code: `default_${list.tab}`,
        message:
          defaults === 0
            ? `${model.name}: no default ${list.label} is chosen; the first one will be preselected.`
            : `${model.name}: more than one default ${list.label}; the first one will be preselected.`,
        tab: list.tab,
      });
  }

  for (const style of [...model.exteriors, ...model.interiors]) {
    const shared = catalog.styles.find((s) => s.id === style.styleId);
    if (!shared)
      add({
        severity: "error",
        area: "setup",
        code: "unknown_style",
        message: `${model.name} uses a style that no longer exists.`,
        tab: "exteriors",
      });
    else if (shared.archived && style.enabled)
      add({
        severity: "warning",
        area: "setup",
        code: "archived_style",
        message: `${model.name} still offers the archived style “${shared.name}”.`,
        tab: shared.kind === "exterior" ? "exteriors" : "interiors",
      });
  }

  // --- Images --------------------------------------------------------------
  for (const req of requiredSlots(model, catalog.settings.upgradeSelection)) {
    const resolved = resolveSlot(model, req.slot);
    const tab =
      req.slot.type === "ext" ? "exteriors" : req.slot.type === "bath" ? "bathrooms" : "interiors";
    if (!resolved.assetId) {
      add({
        severity: "error",
        area: "images",
        code: "missing_render",
        message: `Missing ${describeSlot(catalog, model, req.slot)}.`,
        tab,
        slotKey: req.key,
      });
    } else if (resolved.usedFallback) {
      add({
        severity: "warning",
        area: "images",
        code: "fallback_render",
        message: `Using the 8-foot image for the ${describeSlot(catalog, model, req.slot)}.`,
        tab,
        slotKey: req.key,
      });
    }
  }

  // --- Pricing -------------------------------------------------------------
  if (regions.length === 0) {
    add({
      severity: "error",
      area: "pricing",
      code: "no_regions",
      message: "No pricing regions exist yet.",
      tab: "pricing",
    });
  } else {
    const baseMissing = missingRegions(model.basePrice, regions);
    if (baseMissing.length)
      add({
        severity: "error",
        area: "pricing",
        code: "base_missing",
        message: `${model.name} has no starting price for ${regionList(baseMissing)}.`,
        tab: "pricing",
      });
    const zeroBase = regions.filter((r) => priceInRegion(model.basePrice, r.id) === 0);
    if (zeroBase.length)
      add({
        severity: "error",
        area: "pricing",
        code: "base_zero",
        message: `${model.name} has a $0 starting price in ${regionList(zeroBase)}.`,
        tab: "pricing",
      });
    if (model.basePrice.needsReview)
      add({
        severity: "error",
        area: "pricing",
        code: "base_review",
        message: `${model.name}'s starting price has not been reviewed.`,
        tab: "pricing",
      });

    for (const item of [...enabledItems(model), ...styleItems(catalog, model)]) {
      const missing = missingRegions(item.price, regions);
      if (missing.length)
        add({
          severity: "error",
          area: "pricing",
          code: "price_missing",
          message: `${model.name}: ${item.label} has no price for ${regionList(missing)}.`,
          tab: item.tab,
        });
      if (item.price.needsReview)
        add({
          severity: "error",
          area: "pricing",
          code: "price_review",
          message: `${model.name}: ${item.label} price has not been reviewed.`,
          tab: item.tab,
        });
    }
  }
  return issues;
}

export function validateCatalog(catalog: Catalog): Issue[] {
  const issues: Issue[] = [];
  for (const conflict of findCityConflicts(catalog.regions)) {
    const names = conflict.regionIds.map(
      (id) => catalog.regions.find((r) => r.id === id)?.name ?? id,
    );
    issues.push({
      severity: "error",
      area: "regions",
      code: "city_conflict",
      message: `${conflict.city.name}, ${conflict.city.state} is in more than one region (${names.join(", ")}).`,
      modelId: null,
      tab: null,
    });
  }
  for (const region of catalog.regions) {
    if (region.cities.length === 0)
      issues.push({
        severity: "warning",
        area: "regions",
        code: "empty_region",
        message: `Region “${region.name}” has no cities, so no customer can be matched to it.`,
        modelId: null,
        tab: null,
      });
  }
  const slugs = new Map<string, string>();
  for (const model of catalog.models) {
    const key = model.slug.toLowerCase();
    if (slugs.has(key))
      issues.push({
        severity: "error",
        area: "setup",
        code: "duplicate_slug",
        message: `${model.name} and ${slugs.get(key)} share the web address “${model.slug}”.`,
        modelId: model.id,
        tab: "overview",
      });
    slugs.set(key, model.name);
  }
  if (!catalog.models.some((m) => m.status === "active"))
    issues.push({
      severity: "error",
      area: "setup",
      code: "no_active_models",
      message: "No models are turned on for customers.",
      modelId: null,
      tab: null,
    });
  for (const model of catalog.models) {
    if (model.status !== "active") continue;
    issues.push(...validateModel(catalog, model));
  }
  return issues;
}

export function blockingIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity === "error");
}

export type ModelReadiness = {
  images: { required: number; present: number };
  pricing: { required: number; complete: number; needsReview: number };
  errors: number;
  warnings: number;
};

export function modelReadiness(catalog: Catalog, model: Model): ModelReadiness {
  const slots = requiredSlots(model, catalog.settings.upgradeSelection);
  const present = slots.filter((s) => resolveSlot(model, s.slot).assetId).length;
  const prices = [
    model.basePrice,
    ...[...enabledItems(model), ...styleItems(catalog, model)].map((i) => i.price),
  ];
  const complete = prices.filter((p) => missingRegions(p, catalog.regions).length === 0).length;
  const needsReview = prices.filter((p) => p.needsReview).length;
  const issues = validateModel(catalog, model);
  return {
    images: { required: slots.length, present },
    pricing: { required: prices.length, complete, needsReview },
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}

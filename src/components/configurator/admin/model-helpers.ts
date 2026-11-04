"use client";

import { slotKey, type Slot } from "@/lib/configurator/render";
import type { AdminAsset } from "@/lib/configurator/server";
import type { AssetClassification, Model } from "@/lib/configurator/types";

export type ModelTab =
  | "overview"
  | "options"
  | "exteriors"
  | "interiors"
  | "appliances"
  | "upgrades"
  | "bathrooms"
  | "pricing"
  | "images"
  | "preview";

export const MODEL_TABS: { id: ModelTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "options", label: "Model Options" },
  { id: "exteriors", label: "Exteriors" },
  { id: "interiors", label: "Interiors" },
  { id: "appliances", label: "Appliances" },
  { id: "upgrades", label: "Upgrades" },
  { id: "bathrooms", label: "Bathrooms" },
  { id: "pricing", label: "Pricing" },
  { id: "images", label: "Images" },
  { id: "preview", label: "Preview" },
];

export function classificationForSlot(
  model: Model,
  slot: Slot,
  bathroomName?: string,
): AssetClassification {
  return {
    kind: slot.type === "ext" ? "exterior" : slot.type === "int" ? "interior" : "bathroom",
    modelId: model.id,
    styleId: slot.styleId,
    role: slot.type === "int" ? slot.role : null,
    ceiling: slot.type === "bath" ? null : slot.ceiling,
    variant: slot.type === "ext" ? slot.variant : null,
    mirror: null,
    bathroomName: slot.type === "bath" ? (bathroomName ?? null) : null,
    confidence: "high",
    notes: ["Assigned by an admin"],
  };
}

/** Rank library images for a slot: same model/style/role/height first. */
export function rankForSlot(model: Model, slot: Slot) {
  return (asset: AdminAsset): number => {
    const c = asset.classification;
    if (!c) return 0;
    let score = 0;
    if (c.modelId === model.id) score += 2;
    if (c.styleId === slot.styleId) score += 2;
    if (slot.type === "ext" && c.kind === "exterior")
      score += 1 + (c.variant === slot.variant ? 1 : 0) + (c.ceiling === slot.ceiling ? 1 : 0);
    if (slot.type === "int" && c.kind === "interior")
      score += (c.role === slot.role ? 2 : 0) + (c.ceiling === slot.ceiling ? 1 : 0);
    if (slot.type === "bath" && c.kind === "bathroom") score += 2;
    return score;
  };
}

export function setRender(model: Model, slot: Slot, assetId: string | null): Model {
  const renders = { ...model.renders };
  const key = slotKey(slot);
  if (assetId) renders[key] = assetId;
  else delete renders[key];
  return { ...model, renders };
}

export function moveItem<T extends { sortOrder: number }>(
  items: T[],
  index: number,
  delta: -1 | 1,
): T[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const target = index + delta;
  if (target < 0 || target >= sorted.length) return items;
  [sorted[index], sorted[target]] = [sorted[target]!, sorted[index]!];
  return sorted.map((item, i) => ({ ...item, sortOrder: i }));
}

/** Make exactly one item the default. */
export function setDefault<T extends { isDefault: boolean }>(
  items: T[],
  match: (item: T) => boolean,
): T[] {
  return items.map((item) => ({ ...item, isDefault: match(item) }));
}

/**
 * Rendering dependencies, in one place.
 *
 * Every image a customer can see is a *slot* on a model:
 *   ext|<exteriorStyleId>|<variant>|<ceiling>    exterior elevation
 *   int|<interiorStyleId>|<role>|<ceiling>       interior rendering
 *   bath|<interiorStyleId>|<bathroomId>          bathroom rendering
 * Floorplans are stored on `model.floorplans`.
 *
 * `resolveStepImage` turns a selection into the slot for a step. UI components never
 * decide which image to show themselves, so cross-step dependencies (porch, 9-ft
 * ceilings, lighting upgrade, interior style) always stay consistent — including when
 * a customer goes back and changes an earlier choice.
 */

import type {
  CeilingHeight,
  ExteriorVariant,
  InteriorRole,
  Model,
  Selection,
  StepId,
  Upgrade,
} from "./types";

export type ExteriorSlot = {
  type: "ext";
  styleId: string;
  variant: ExteriorVariant;
  ceiling: CeilingHeight;
};
export type InteriorSlot = {
  type: "int";
  styleId: string;
  role: InteriorRole;
  ceiling: CeilingHeight;
};
export type BathroomSlot = { type: "bath"; styleId: string; bathroomId: string };
export type Slot = ExteriorSlot | InteriorSlot | BathroomSlot;

export function slotKey(slot: Slot): string {
  switch (slot.type) {
    case "ext":
      return `ext|${slot.styleId}|${slot.variant}|${slot.ceiling}`;
    case "int":
      return `int|${slot.styleId}|${slot.role}|${slot.ceiling}`;
    case "bath":
      return `bath|${slot.styleId}|${slot.bathroomId}`;
  }
}

export function parseSlotKey(key: string): Slot | null {
  const parts = key.split("|");
  if (parts[0] === "ext" && parts.length === 4) {
    const [, styleId, variant, ceiling] = parts;
    if (!styleId || !isVariant(variant) || !isCeiling(ceiling)) return null;
    return { type: "ext", styleId, variant, ceiling };
  }
  if (parts[0] === "int" && parts.length === 4) {
    const [, styleId, role, ceiling] = parts;
    if (!styleId || !isRole(role) || !isCeiling(ceiling)) return null;
    return { type: "int", styleId, role, ceiling };
  }
  if (parts[0] === "bath" && parts.length === 3) {
    const [, styleId, bathroomId] = parts;
    if (!styleId || !bathroomId) return null;
    return { type: "bath", styleId, bathroomId };
  }
  return null;
}

function isVariant(v: string | undefined): v is ExteriorVariant {
  return v === "standard" || v === "porch";
}
function isCeiling(v: string | undefined): v is CeilingHeight {
  return v === "8" || v === "9";
}
const ROLES = new Set<string>([
  "kitchen",
  "lighting_daytime",
  "appliance_base",
  "appliance_mid",
  "lighting_dusk_uplights",
  "lighting_dusk",
  "ambiance",
]);
function isRole(v: string | undefined): v is InteriorRole {
  return typeof v === "string" && ROLES.has(v);
}

export const ROLE_LABELS: Record<InteriorRole, string> = {
  kitchen: "Kitchen",
  lighting_daytime: "Lighting Daytime",
  appliance_base: "Appliance Base",
  appliance_mid: "Appliance Mid",
  lighting_dusk_uplights: "Lighting Dusk Uplights",
  lighting_dusk: "Lighting Dusk",
  ambiance: "Ambiance",
};

export const ROLE_USAGE: Record<InteriorRole, string> = {
  kitchen: "Shown when this interior style is selected",
  lighting_daytime: "Upgrades step without the lighting upgrade",
  appliance_base: "Appliance package using the base rendering",
  appliance_mid: "Appliance package using the mid rendering",
  lighting_dusk_uplights: "Lighting Upgrade",
  lighting_dusk: "Not used by the customer flow",
  ambiance: "Not used by the customer flow",
};

// ---------------------------------------------------------------------------
// Selection-derived context
// ---------------------------------------------------------------------------

function enabledUpgrades(model: Model, selection: Selection): Upgrade[] {
  const chosen = new Set(selection.upgradeIds);
  return model.upgrades.filter((u) => u.enabled && chosen.has(u.id));
}

export function selectedCeiling(model: Model, selection: Selection): CeilingHeight {
  return enabledUpgrades(model, selection).some((u) => u.effect === "ceiling_9ft") ? "9" : "8";
}

export function hasLightingUpgrade(model: Model, selection: Selection): boolean {
  return enabledUpgrades(model, selection).some((u) => u.effect === "lighting");
}

export function selectedVariant(model: Model, selection: Selection): ExteriorVariant {
  const option = model.options.find((o) => o.id === selection.optionId && o.enabled);
  return option?.exteriorVariant ?? "standard";
}

/** Variants a model can render (one per enabled model option, or just "standard"). */
export function modelVariants(model: Model): ExteriorVariant[] {
  const variants = new Set<ExteriorVariant>();
  for (const option of model.options) if (option.enabled) variants.add(option.exteriorVariant);
  if (variants.size === 0) variants.add("standard");
  return [...variants];
}

export function modelSupportsNineFoot(model: Model): boolean {
  return model.upgrades.some((u) => u.enabled && u.effect === "ceiling_9ft");
}

export function modelHasLightingUpgrade(model: Model): boolean {
  return model.upgrades.some((u) => u.enabled && u.effect === "lighting");
}

export function modelCeilings(model: Model): CeilingHeight[] {
  return modelSupportsNineFoot(model) ? ["8", "9"] : ["8"];
}

function defaultStyleId(uses: Model["exteriors"]): string | null {
  const enabled = uses.filter((u) => u.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
  return (enabled.find((u) => u.isDefault) ?? enabled[0])?.styleId ?? null;
}

// ---------------------------------------------------------------------------
// Step → slot
// ---------------------------------------------------------------------------

/**
 * Which slot a step shows for the current selection. Returns null when the step has no
 * rendering (e.g. the quote form) or the selection is incomplete.
 *
 * Rules (from the existing configurator and Acton's rendering spec):
 * - Model / Model Options / Exterior steps: the exterior for the chosen style, porch
 *   variant and ceiling height.
 * - Interior step: the Kitchen rendering of the chosen interior at the chosen height.
 * - Appliances step: Appliance Base or Appliance Mid of the chosen interior. Ceiling height
 *   never changes appliance renderings, so this always uses the 8-ft image.
 * - Upgrades step: Lighting Dusk Uplights when the lighting upgrade is selected, otherwise
 *   Lighting Daytime — at the chosen ceiling height. (Never "Lighting Dusk".)
 * - Bathroom step: the bathroom rendering for the chosen interior and bathroom.
 *   Ceiling height never changes it.
 */
export function slotForStep(model: Model, selection: Selection, step: StepId): Slot | null {
  const ceiling = selectedCeiling(model, selection);
  const variant = selectedVariant(model, selection);
  const exteriorId = selection.exteriorId ?? defaultStyleId(model.exteriors);
  const interiorId = selection.interiorId ?? defaultStyleId(model.interiors);

  switch (step) {
    case "model":
    case "options":
    case "exterior":
    case "quote":
      return exteriorId ? { type: "ext", styleId: exteriorId, variant, ceiling } : null;
    case "interior":
      return interiorId ? { type: "int", styleId: interiorId, role: "kitchen", ceiling } : null;
    case "appliances": {
      if (!interiorId) return null;
      const pkg = model.appliances.find((a) => a.id === selection.applianceId && a.enabled);
      return {
        type: "int",
        styleId: interiorId,
        role: pkg?.renderRole ?? "appliance_base",
        ceiling: "8",
      };
    }
    case "upgrades": {
      if (!interiorId) return null;
      const role: InteriorRole = hasLightingUpgrade(model, selection)
        ? "lighting_dusk_uplights"
        : "lighting_daytime";
      return { type: "int", styleId: interiorId, role, ceiling };
    }
    case "bathroom":
      return interiorId && selection.bathroomId
        ? { type: "bath", styleId: interiorId, bathroomId: selection.bathroomId }
        : null;
  }
}

export type ResolvedImage = {
  assetId: string | null;
  slot: Slot | null;
  /** True when an 8-ft image stands in for a missing 9-ft one (model.ceilingFallback). */
  usedFallback: boolean;
};

/** Look up a slot, applying the model's explicit 9-ft → 8-ft fallback when enabled. */
export function resolveSlot(model: Model, slot: Slot | null): ResolvedImage {
  if (!slot) return { assetId: null, slot: null, usedFallback: false };
  const direct = model.renders[slotKey(slot)];
  if (direct) return { assetId: direct, slot, usedFallback: false };
  if (model.ceilingFallback && slot.type !== "bath" && slot.ceiling === "9") {
    const eight = model.renders[slotKey({ ...slot, ceiling: "8" })];
    if (eight) return { assetId: eight, slot, usedFallback: true };
  }
  return { assetId: null, slot, usedFallback: false };
}

export function resolveStepImage(model: Model, selection: Selection, step: StepId): ResolvedImage {
  return resolveSlot(model, slotForStep(model, selection, step));
}

/** Image for model cards / thumbnails: default exterior, standard variant, 8-ft. */
export function modelHeroAssetId(model: Model): string | null {
  const styleId = defaultStyleId(model.exteriors);
  if (styleId) {
    for (const variant of ["standard", "porch"] as const) {
      const id = model.renders[slotKey({ type: "ext", styleId, variant, ceiling: "8" })];
      if (id) return id;
    }
  }
  const anyExterior = Object.entries(model.renders).find(([k]) => k.startsWith("ext|"));
  return anyExterior?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Coverage: which slots a model needs before it can be published
// ---------------------------------------------------------------------------

export type RequiredSlot = {
  slot: Slot;
  key: string;
  /** Why the customer flow needs it. */
  usage: string;
};

/**
 * Every rendering the customer flow can request for this model, given its enabled
 * options. Multi-select upgrades add the 9-ft + lighting combination.
 */
export function requiredSlots(
  model: Model,
  upgradeSelection: "single" | "multiple" = "single",
): RequiredSlot[] {
  const out: RequiredSlot[] = [];
  const push = (slot: Slot, usage: string) => out.push({ slot, key: slotKey(slot), usage });
  const variants = modelVariants(model);
  const ceilings = modelCeilings(model);
  const exteriors = model.exteriors.filter((u) => u.enabled).map((u) => u.styleId);
  const interiors = model.interiors.filter((u) => u.enabled).map((u) => u.styleId);
  const lighting = modelHasLightingUpgrade(model);

  for (const styleId of exteriors)
    for (const variant of variants)
      for (const ceiling of ceilings) push({ type: "ext", styleId, variant, ceiling }, "Exterior");

  const applianceRoles = new Set(
    model.appliances.filter((a) => a.enabled).map((a) => a.renderRole),
  );
  const bathrooms = model.bathrooms.filter((b) => b.enabled);
  const hasUpgradesStep = model.upgrades.some((u) => u.enabled);

  for (const styleId of interiors) {
    for (const ceiling of ceilings)
      push({ type: "int", styleId, role: "kitchen", ceiling }, "Interior style");
    for (const role of applianceRoles)
      push({ type: "int", styleId, role, ceiling: "8" }, "Appliances");
    if (hasUpgradesStep) {
      for (const ceiling of ceilings)
        push({ type: "int", styleId, role: "lighting_daytime", ceiling }, "Upgrades");
      if (lighting) {
        push(
          { type: "int", styleId, role: "lighting_dusk_uplights", ceiling: "8" },
          "Lighting upgrade",
        );
        if (upgradeSelection === "multiple" && ceilings.includes("9"))
          push(
            { type: "int", styleId, role: "lighting_dusk_uplights", ceiling: "9" },
            "Lighting upgrade with 9-ft ceilings",
          );
      }
    }
    for (const b of bathrooms) push({ type: "bath", styleId, bathroomId: b.id }, "Bathroom");
  }
  return out;
}

/**
 * Customer selection rules: step sequence, defaults, carrying choices across a model
 * change, and reading/writing deep links (including old design.actonadu.com links).
 */

import type {
  CatalogSettings,
  LegacyAlias,
  LegacyAliasKind,
  Model,
  Selection,
  StepId,
  ViewMode,
} from "./types";

type Orderable = { enabled: boolean; isDefault: boolean; sortOrder: number };

export function sortedEnabled<T extends Orderable>(items: T[]): T[] {
  return items.filter((i) => i.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
}

function pickDefault<T extends Orderable>(items: T[]): T | null {
  const enabled = sortedEnabled(items);
  return enabled.find((i) => i.isDefault) ?? enabled[0] ?? null;
}

/** The Model Options step only appears for models that have enabled options. */
export function hasModelOptionsStep(model: Model): boolean {
  return model.options.some((o) => o.enabled);
}

export function stepsForModel(model: Model): StepId[] {
  const steps: StepId[] = ["model"];
  if (hasModelOptionsStep(model)) steps.push("options");
  steps.push("exterior", "interior");
  if (model.appliances.some((a) => a.enabled)) steps.push("appliances");
  if (model.upgrades.some((u) => u.enabled)) steps.push("upgrades");
  if (model.bathrooms.some((b) => b.enabled)) steps.push("bathroom");
  steps.push("quote");
  return steps;
}

export const STEP_TITLES: Record<StepId, string> = {
  model: "Choose a Model",
  options: "Model options",
  exterior: "Exterior Styles",
  interior: "Interior Style",
  appliances: "Appliances",
  upgrades: "Upgrades",
  bathroom: "Bathroom",
  quote: "Get in Touch",
};

export function defaultUpgradeIds(model: Model): string[] {
  const none = sortedEnabled(model.upgrades).find((u) => u.isDefault);
  return none ? [none.id] : [];
}

export function defaultSelection(model: Model): Selection {
  return {
    modelId: model.id,
    optionId: pickDefault(model.options)?.id ?? null,
    exteriorId: pickDefault(model.exteriors)?.styleId ?? null,
    interiorId: pickDefault(model.interiors)?.styleId ?? null,
    applianceId: pickDefault(model.appliances)?.id ?? null,
    upgradeIds: defaultUpgradeIds(model),
    bathroomId: pickDefault(model.bathrooms)?.id ?? null,
  };
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Selection for `next` that keeps every choice from `prev` the new model also offers
 * (same shared style, same porch variant, same appliance tier, same upgrade effect,
 * same bathroom type) and falls back to the new model's default otherwise.
 */
export function carrySelection(prevModel: Model, prev: Selection, next: Model): Selection {
  const base = defaultSelection(next);
  const options = sortedEnabled(next.options);
  const prevOption = prevModel.options.find((o) => o.id === prev.optionId);
  const option =
    (prevOption &&
      (options.find((o) => norm(o.name) === norm(prevOption.name)) ??
        options.find((o) => o.exteriorVariant === prevOption.exteriorVariant))) ??
    null;

  const has = (uses: Model["exteriors"], id: string | null) =>
    id !== null && uses.some((u) => u.enabled && u.styleId === id);

  const prevAppliance = prevModel.appliances.find((a) => a.id === prev.applianceId);
  const appliances = sortedEnabled(next.appliances);
  const appliance =
    (prevAppliance &&
      (appliances.find((a) => norm(a.name) === norm(prevAppliance.name)) ??
        appliances.find((a) => a.renderRole === prevAppliance.renderRole))) ??
    null;

  const upgrades = sortedEnabled(next.upgrades);
  const carried: string[] = [];
  for (const id of prev.upgradeIds) {
    const old = prevModel.upgrades.find((u) => u.id === id);
    if (!old) continue;
    const match =
      upgrades.find((u) => norm(u.name) === norm(old.name)) ??
      (old.effect !== "other"
        ? upgrades.find((u) => u.effect === old.effect && u.isDefault === old.isDefault)
        : undefined);
    if (match && !carried.includes(match.id)) carried.push(match.id);
  }

  const prevBath = prevModel.bathrooms.find((b) => b.id === prev.bathroomId);
  const bathroom = prevBath
    ? sortedEnabled(next.bathrooms).find((b) => norm(b.name) === norm(prevBath.name))
    : null;

  return {
    modelId: next.id,
    optionId: option?.id ?? base.optionId,
    exteriorId: has(next.exteriors, prev.exteriorId) ? prev.exteriorId : base.exteriorId,
    interiorId: has(next.interiors, prev.interiorId) ? prev.interiorId : base.interiorId,
    applianceId: appliance?.id ?? base.applianceId,
    upgradeIds: carried.length ? carried : base.upgradeIds,
    bathroomId: bathroom?.id ?? base.bathroomId,
  };
}

/**
 * Toggle an upgrade card. "No Upgrade" (the default card) clears the others. In single mode
 * one card is selected at a time; in multiple mode cards combine (e.g. 9-ft + lighting).
 */
export function toggleUpgrade(
  model: Model,
  current: string[],
  upgradeId: string,
  mode: CatalogSettings["upgradeSelection"],
): string[] {
  const upgrade = model.upgrades.find((u) => u.id === upgradeId && u.enabled);
  if (!upgrade) return current;
  const none = defaultUpgradeIds(model);
  if (upgrade.isDefault) return none;
  if (mode === "single") return [upgrade.id];
  const withoutNone = current.filter((id) => !none.includes(id));
  const next = withoutNone.includes(upgrade.id)
    ? withoutNone.filter((id) => id !== upgrade.id)
    : [...withoutNone, upgrade.id];
  return next.length ? next : none;
}

/** Keep only ids that are valid for the model; fill gaps with defaults. */
export function sanitizeSelection(model: Model, selection: Partial<Selection>): Selection {
  const d = defaultSelection(model);
  const ok = <T extends Orderable & { id: string }>(items: T[], id: string | null | undefined) =>
    id && items.some((i) => i.enabled && i.id === id) ? id : null;
  const okStyle = (uses: Model["exteriors"], id: string | null | undefined) =>
    id && uses.some((u) => u.enabled && u.styleId === id) ? id : null;
  const upgrades = (selection.upgradeIds ?? []).filter((id) =>
    model.upgrades.some((u) => u.enabled && u.id === id),
  );
  return {
    modelId: model.id,
    optionId: ok(model.options, selection.optionId) ?? d.optionId,
    exteriorId: okStyle(model.exteriors, selection.exteriorId) ?? d.exteriorId,
    interiorId: okStyle(model.interiors, selection.interiorId) ?? d.interiorId,
    applianceId: ok(model.appliances, selection.applianceId) ?? d.applianceId,
    upgradeIds: upgrades.length ? upgrades : d.upgradeIds,
    bathroomId: ok(model.bathrooms, selection.bathroomId) ?? d.bathroomId,
  };
}

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

export type DeepLink = {
  series: string | null;
  model: string | null;
  viewMode: ViewMode;
  modelOption: string | null;
  exterior: string | null;
  interior: string | null;
  appliances: string | null;
  upgrades: string | null;
  bathroom: string | null;
};

export function parseDeepLink(params: URLSearchParams): DeepLink {
  const get = (k: string) => {
    const v = params.get(k);
    return v && v.trim() ? v.trim() : null;
  };
  return {
    series: get("series"),
    model: get("model"),
    viewMode: get("viewMode") === "floorplan" ? "floorplan" : "elevation",
    modelOption: get("modelOption"),
    exterior: get("exterior"),
    interior: get("interior"),
    appliances: get("appliances"),
    upgrades: get("upgrades"),
    bathroom: get("bathroom"),
  };
}

function aliasRef(aliases: LegacyAlias[], kind: LegacyAliasKind, value: string): string | null {
  const v = value.toLowerCase();
  return aliases.find((a) => a.kind === kind && a.value.toLowerCase() === v)?.ref ?? null;
}

/** Find a model by its slug or an old design.actonadu.com model value (case-insensitive). */
export function findModelByLinkValue<T extends Pick<Model, "slug" | "legacyAliases">>(
  models: T[],
  value: string | null,
): T | null {
  if (!value) return null;
  const v = value.toLowerCase();
  return (
    models.find((m) => m.slug.toLowerCase() === v) ??
    models.find((m) =>
      m.legacyAliases.some((a) => a.kind === "model" && a.value.toLowerCase() === v),
    ) ??
    null
  );
}

/** Selection from a deep link. Accepts current ids and legacy option values. */
export function selectionFromDeepLink(model: Model, link: DeepLink): Selection {
  const resolve = (kind: LegacyAliasKind, value: string | null, direct: (v: string) => boolean) => {
    if (!value) return null;
    if (direct(value)) return value;
    return aliasRef(model.legacyAliases, kind, value);
  };
  const upgradeIds = (link.upgrades ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => resolve("upgrade", v, (x) => model.upgrades.some((u) => u.id === x)))
    .filter((v): v is string => v !== null);

  return sanitizeSelection(model, {
    optionId: resolve("option", link.modelOption, (v) => model.options.some((o) => o.id === v)),
    exteriorId: resolve("exterior", link.exterior, (v) =>
      model.exteriors.some((u) => u.styleId === v),
    ),
    interiorId: resolve("interior", link.interior, (v) =>
      model.interiors.some((u) => u.styleId === v),
    ),
    applianceId: resolve("appliance", link.appliances, (v) =>
      model.appliances.some((a) => a.id === v),
    ),
    upgradeIds,
    bathroomId: resolve("bathroom", link.bathroom, (v) => model.bathrooms.some((b) => b.id === v)),
  });
}

export function deepLinkParams(
  seriesSlug: string,
  model: Model,
  selection: Selection,
  viewMode: ViewMode,
): URLSearchParams {
  const p = new URLSearchParams();
  p.set("series", seriesSlug);
  p.set("model", model.slug);
  p.set("viewMode", viewMode);
  if (selection.optionId) p.set("modelOption", selection.optionId);
  if (selection.exteriorId) p.set("exterior", selection.exteriorId);
  if (selection.interiorId) p.set("interior", selection.interiorId);
  if (selection.applianceId) p.set("appliances", selection.applianceId);
  if (selection.upgradeIds.length) p.set("upgrades", selection.upgradeIds.join(","));
  if (selection.bathroomId) p.set("bathroom", selection.bathroomId);
  return p;
}

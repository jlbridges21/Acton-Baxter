/**
 * Regional pricing. Pure functions shared by the admin editors, the bulk grid,
 * validation and the public quote endpoint.
 */

import type { Catalog, FinancingSettings, Model, Price, Region, Selection } from "./types";

export function emptyPrice(needsReview = false): Price {
  return { mode: "explicit", base: null, adjustKind: "amount", regions: {}, needsReview };
}

/** A price that is the same amount in every region. */
export function flatPrice(amount: number, regionIds: string[], needsReview = false): Price {
  return {
    mode: "explicit",
    base: null,
    adjustKind: "amount",
    regions: Object.fromEntries(regionIds.map((id) => [id, amount])),
    needsReview,
  };
}

/**
 * Effective price in a region, rounded to whole dollars.
 * Returns null when the price is not set for that region.
 */
export function priceInRegion(price: Price, regionId: string): number | null {
  const value = price.regions[regionId];
  if (price.mode === "explicit") {
    return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
  }
  if (price.base === null || !Number.isFinite(price.base)) return null;
  const adjust = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const total =
    price.adjustKind === "percent" ? price.base * (1 + adjust / 100) : price.base + adjust;
  return Math.round(total);
}

export function isPriceComplete(price: Price, regions: Region[]): boolean {
  return regions.every((r) => priceInRegion(price, r.id) !== null);
}

/** Convert a price between modes while keeping each region's effective amount. */
export function convertPriceMode(price: Price, mode: Price["mode"], regions: Region[]): Price {
  if (price.mode === mode) return price;
  if (mode === "explicit") {
    return {
      ...price,
      mode,
      base: null,
      regions: Object.fromEntries(regions.map((r) => [r.id, priceInRegion(price, r.id)])),
    };
  }
  const amounts = regions
    .map((r) => priceInRegion(price, r.id))
    .filter((v): v is number => v !== null);
  const base = amounts.length ? Math.min(...amounts) : 0;
  return {
    ...price,
    mode,
    base,
    adjustKind: "amount",
    regions: Object.fromEntries(
      regions.map((r) => {
        const v = priceInRegion(price, r.id);
        return [r.id, v === null ? null : v - base];
      }),
    ),
  };
}

/** Set the effective amount for one region regardless of mode. */
export function setRegionAmount(price: Price, regionId: string, amount: number | null): Price {
  if (price.mode === "explicit")
    return { ...price, regions: { ...price.regions, [regionId]: amount } };
  if (amount === null) return { ...price, regions: { ...price.regions, [regionId]: null } };
  const base = price.base ?? 0;
  const adjust =
    price.adjustKind === "percent" ? (base === 0 ? 0 : (amount / base - 1) * 100) : amount - base;
  return {
    ...price,
    base,
    regions: { ...price.regions, [regionId]: Math.round(adjust * 100) / 100 },
  };
}

export type BulkAdjust =
  | { kind: "set"; amount: number }
  | { kind: "add"; amount: number }
  | { kind: "percent"; percent: number };

export function applyBulkAdjust(current: number | null, adjust: BulkAdjust): number | null {
  switch (adjust.kind) {
    case "set":
      return Math.round(adjust.amount);
    case "add":
      return current === null ? null : Math.round(current + adjust.amount);
    case "percent":
      return current === null ? null : Math.round(current * (1 + adjust.percent / 100));
  }
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export type QuoteLine = { step: string; label: string; amount: number };

export type Quote = {
  regionId: string;
  base: number;
  lines: QuoteLine[];
  total: number;
  monthly: number | null;
};

/** Monthly payment for a fully financed amount (standard amortization). */
export function monthlyPayment(total: number, financing: FinancingSettings): number | null {
  if (!financing.enabled || financing.termMonths <= 0) return null;
  const r = financing.annualRatePct / 100 / 12;
  if (r === 0) return Math.round(total / financing.termMonths);
  return Math.round((total * r) / (1 - Math.pow(1 + r, -financing.termMonths)));
}

/** Prices of every customer-selectable item of a model in a region, keyed by item id. */
export type ModelPriceSheet = {
  base: number | null;
  options: Record<string, number | null>;
  exteriors: Record<string, number | null>;
  interiors: Record<string, number | null>;
  appliances: Record<string, number | null>;
  upgrades: Record<string, number | null>;
  bathrooms: Record<string, number | null>;
};

export function modelPriceSheet(model: Model, regionId: string): ModelPriceSheet {
  const map = <T extends { price: Price }>(items: T[], key: (item: T) => string) =>
    Object.fromEntries(items.map((item) => [key(item), priceInRegion(item.price, regionId)]));
  return {
    base: priceInRegion(model.basePrice, regionId),
    options: map(
      model.options.filter((o) => o.enabled),
      (o) => o.id,
    ),
    exteriors: map(
      model.exteriors.filter((u) => u.enabled),
      (u) => u.styleId,
    ),
    interiors: map(
      model.interiors.filter((u) => u.enabled),
      (u) => u.styleId,
    ),
    appliances: map(
      model.appliances.filter((a) => a.enabled),
      (a) => a.id,
    ),
    upgrades: map(
      model.upgrades.filter((u) => u.enabled),
      (u) => u.id,
    ),
    bathrooms: map(
      model.bathrooms.filter((b) => b.enabled),
      (b) => b.id,
    ),
  };
}

/**
 * Total for a selection from a model's price sheet. Returns null when any selected item has
 * no price — the customer then sees no price rather than a wrong one.
 */
export function quoteFromSheet(
  model: Model,
  sheet: ModelPriceSheet,
  selection: Selection,
  financing: Pick<FinancingSettings, "enabled" | "annualRatePct" | "termMonths">,
  styleName: (styleId: string) => string,
  regionId = "",
): Quote | null {
  if (sheet.base === null) return null;
  const lines: QuoteLine[] = [];
  const add = (step: string, label: string, amount: number | null | undefined): boolean => {
    if (amount === null || amount === undefined) return false;
    lines.push({ step, label, amount });
    return true;
  };

  if (selection.optionId) {
    const o = model.options.find((x) => x.id === selection.optionId);
    if (o && !add("options", o.name, sheet.options[o.id])) return null;
  }
  if (
    selection.exteriorId &&
    !add("exterior", styleName(selection.exteriorId), sheet.exteriors[selection.exteriorId])
  )
    return null;
  if (
    selection.interiorId &&
    !add("interior", styleName(selection.interiorId), sheet.interiors[selection.interiorId])
  )
    return null;
  if (selection.applianceId) {
    const a = model.appliances.find((x) => x.id === selection.applianceId);
    if (a && !add("appliances", a.name, sheet.appliances[a.id])) return null;
  }
  for (const id of selection.upgradeIds) {
    const u = model.upgrades.find((x) => x.id === id);
    if (u && !add("upgrades", u.name, sheet.upgrades[u.id])) return null;
  }
  if (selection.bathroomId) {
    const b = model.bathrooms.find((x) => x.id === selection.bathroomId);
    if (b && !add("bathroom", b.name, sheet.bathrooms[b.id])) return null;
  }

  const total = sheet.base + lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    regionId,
    base: sheet.base,
    lines,
    total,
    monthly: monthlyPayment(total, { ...financing, disclaimer: "", linkUrl: "" }),
  };
}

/** Total for a selection in a region, straight from the catalog. */
export function computeQuote(
  catalog: Catalog,
  model: Model,
  selection: Selection,
  regionId: string,
): Quote | null {
  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;
  return quoteFromSheet(
    model,
    modelPriceSheet(model, regionId),
    selection,
    catalog.settings.financing,
    styleName,
    regionId,
  );
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Card label like the existing configurator: "+$6,700", "+$0", "-$500". */
export function formatDelta(amount: number): string {
  return `${amount < 0 ? "-" : "+"}${formatUsd(Math.abs(amount))}`;
}

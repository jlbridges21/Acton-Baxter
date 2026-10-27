/**
 * Cost items as a reporting source.
 *
 * Every cached JobTread cost item becomes exactly one row. Its place in the catalog is resolved
 * through the synced cost-group hierarchy (jt_cost_groups) by stable ids, never by names:
 *
 *   root group (a Product Library model, a shared library, or a job budget)
 *     → section (first level, e.g. "Exterior Package Options", "Windows")
 *       → … → option group (e.g. "Exterior Package Options") → option ("Hayward Modern")
 *         → item
 *
 * Model attributes are looked up many-to-one from the root, so aggregating item rows never
 * double counts. Amounts are JobTread's values; derived percentages are labeled as derived.
 */

import { applyValueMappings, type MatchType } from "./mappings-core";
import type { Row } from "./compute";

export type CostGroupCacheRow = {
  id: string;
  name: string | null;
  parent_id: string | null;
  job_id: string | null;
};

export type CostItemCacheRow = {
  id: string;
  scope: "job" | "catalog";
  job_id: string | null;
  cost_group_id: string | null;
  cost_group_name: string | null;
  name: string | null;
  description: string | null;
  quantity: number | string | null;
  unit_cost: number | string | null;
  unit_price: number | string | null;
  cost: number | string | null;
  price: number | string | null;
  cost_code_name: string | null;
  cost_type_name: string | null;
  unit_name?: string | null;
  source_cost_item_id?: string | null;
  is_taxable?: boolean | null;
  synced_at: string;
};

export type ModelRef = { id: string; name: string; series: string | null; region: string | null };

export type Rule = { match_type: MatchType; pattern: string; value: string; priority: number };

export type ItemContext = {
  groups: Map<string, CostGroupCacheRow>;
  /** Root group id → model, for roots that are Product Library models. */
  models: Map<string, ModelRef>;
  jobs: Map<string, { name: string; number: string | null }>;
  optionRules: Rule[];
};

export const NO_SELLING_PRICE = "No selling price in JobTread";
export const PRICE_EQUALS_COST = "Price equals cost (no markup)";
export const PRICED = "Priced in JobTread";

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Option groups: by default any group whose name ends in "Options" (Acton's convention, e.g.
 * "Exterior Package Options"). Admin rules (bi_value_mappings kind "option_group") can add
 * groups ("include") or exclude them ("exclude"); the first matching rule wins.
 */
export function isOptionGroup(name: string | null, rules: Rule[]): boolean {
  if (!name) return false;
  const include = applyValueMappings(name, rules);
  if (include === "exclude") return false;
  if (include === "include") return true;
  return /\boptions$/i.test(name.trim());
}

/** Root-first ancestor chain for a group id (cycle- and depth-safe). */
export function groupChain(
  groups: Map<string, CostGroupCacheRow>,
  id: string | null,
): CostGroupCacheRow[] {
  const chain: CostGroupCacheRow[] = [];
  const seen = new Set<string>();
  let g = id ? groups.get(id) : undefined;
  while (g && !seen.has(g.id) && chain.length < 30) {
    seen.add(g.id);
    chain.unshift(g);
    g = g.parent_id ? groups.get(g.parent_id) : undefined;
  }
  return chain;
}

export function costItemRow(item: CostItemCacheRow, ctx: ItemContext): Row {
  // Fall back to the item's immediate group when the hierarchy isn't synced yet.
  const known = item.cost_group_id ? ctx.groups.get(item.cost_group_id) : undefined;
  const chain = known
    ? groupChain(ctx.groups, item.cost_group_id)
    : item.cost_group_id
      ? [{ id: item.cost_group_id, name: item.cost_group_name, parent_id: null, job_id: null }]
      : [];
  const root = chain[0] ?? null;
  const model = root ? (ctx.models.get(root.id) ?? null) : null;
  const optionIndex = chain.map((g) => isOptionGroup(g.name, ctx.optionRules)).lastIndexOf(true);
  const optionGroup = optionIndex >= 0 ? chain[optionIndex]! : null;
  const option = optionIndex >= 0 ? (chain[optionIndex + 1] ?? null) : null;
  const job = item.job_id ? ctx.jobs.get(item.job_id) : undefined;
  const cost = num(item.cost);
  const price = num(item.price);
  const context = item.job_id
    ? "Job budget"
    : !item.cost_group_id
      ? "Item library"
      : model
        ? "Product Library model"
        : known
          ? "Other catalog group"
          : "Group not synced";
  return {
    id: item.id,
    "item.id": item.id,
    "item.name": item.name,
    "item.description": item.description,
    "item.context": context,
    "item.model": model?.name ?? null,
    "item.modelId": model?.id ?? null,
    "item.modelSeries": model?.series ?? null,
    "item.modelRegion": model?.region ?? null,
    "item.rootGroup": root?.name ?? null,
    "item.section": chain.length > 1 ? chain[1]!.name : null,
    "item.group": item.cost_group_name ?? known?.name ?? null,
    "item.groupPath": chain.length ? chain.map((g) => g.name ?? "?").join(" › ") : null,
    "item.optionGroup": optionGroup?.name ?? null,
    "item.option": option?.name ?? null,
    "item.costCode": item.cost_code_name,
    "item.costType": item.cost_type_name,
    "item.unit": item.unit_name ?? null,
    "item.quantity": num(item.quantity),
    "item.unitCost": num(item.unit_cost),
    "item.unitPrice": num(item.unit_price),
    "item.cost": cost,
    "item.price": price,
    "item.markupPct": cost && price !== null ? round2(((price - cost) / cost) * 100) : null,
    "item.marginPct": price && cost !== null ? round2(((price - cost) / price) * 100) : null,
    "item.priceStatus":
      price === null
        ? NO_SELLING_PRICE
        : cost !== null && price === cost
          ? PRICE_EQUALS_COST
          : PRICED,
    "item.job": job?.name ?? null,
    "item.jobId": item.job_id,
    "item.jobNumber": job?.number ?? null,
    "item.taxable": item.is_taxable ?? null,
    "item.sourceItemId": item.source_cost_item_id ?? null,
    "item.syncedAt": item.synced_at,
  };
}

/** Option groups found under each root (model) — for model.optionGroups / model.optionCount. */
export function optionGroupsByRoot(
  groups: Map<string, CostGroupCacheRow>,
  rules: Rule[],
): Map<string, { groups: Set<string>; options: number }> {
  const children = new Map<string, number>();
  for (const g of groups.values())
    if (g.parent_id) children.set(g.parent_id, (children.get(g.parent_id) ?? 0) + 1);
  const out = new Map<string, { groups: Set<string>; options: number }>();
  for (const g of groups.values()) {
    if (!isOptionGroup(g.name, rules)) continue;
    const root = groupChain(groups, g.id)[0];
    if (!root || root.id === g.id) continue;
    const entry = out.get(root.id) ?? { groups: new Set<string>(), options: 0 };
    entry.groups.add(g.name!);
    entry.options += children.get(g.id) ?? 0;
    out.set(root.id, entry);
  }
  return out;
}

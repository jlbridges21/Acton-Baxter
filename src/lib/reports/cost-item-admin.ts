/**
 * Admin view of the cost-item reporting source (Reports → Data settings → Cost items):
 * freshness, fields, relationships, model ↔ budget associations, option groups (and whether
 * option prices vary by model), unmapped groups, rules, and a row preview. Read-only except
 * for the model-scope / option-group rules, which only change how Baxter classifies groups.
 */

import "server-only";

import type { Row } from "./compute";
import { agentDb } from "@/lib/agents/store";
import { NO_SELLING_PRICE } from "./cost-items";
import { getDatasetFreshness } from "./data-health";
import { assessFreshness } from "./dependencies";
import { isProductModel, loadCatalogContext, loadModelScopeRules } from "./engine";
import { ITEM_FIELDS } from "./fields";
import { listValueMappings } from "./mappings";
import { SOURCE_REGISTRY } from "./sources";

const n = (v: unknown) => (typeof v === "number" ? v : null);
/** "Saratoga Country Side" and "Saratoga Countryside" compare equal. */
const looseName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type ModelSummary = {
  id: string;
  name: string;
  isModel: boolean;
  region: string | null;
  items: number;
  sections: number;
  optionGroups: string[];
  options: number;
  unpriced: number;
  totalCost: number | null;
  totalPrice: number | null;
};

/** Option name → per-model totals; flags whether the totals differ between models. */
export function optionPriceAnalysis(items: Row[]) {
  const byOption = new Map<string, Map<string, { cost: number | null; price: number | null }>>();
  for (const r of items) {
    const option = r["item.option"] as string | null;
    const model = r["item.model"] as string | null;
    if (!option || !model) continue;
    const perModel = byOption.get(option) ?? new Map();
    const t = perModel.get(model) ?? { cost: 0, price: 0 };
    const cost = n(r["item.cost"]);
    const price = n(r["item.price"]);
    t.cost = t.cost === null || cost === null ? null : t.cost + cost;
    t.price = t.price === null || price === null ? null : t.price + price;
    perModel.set(model, t);
    byOption.set(option, perModel);
  }
  return [...byOption.entries()]
    .map(([option, perModel]) => {
      const prices = [...perModel.values()].map((t) => t.price);
      const distinct = new Set(prices.map((p) => (p === null ? "null" : Math.round(p))));
      const known = prices.filter((p): p is number => p !== null);
      return {
        option,
        models: perModel.size,
        variesByModel: distinct.size > 1,
        minPrice: known.length ? Math.round(Math.min(...known) * 100) / 100 : null,
        maxPrice: known.length ? Math.round(Math.max(...known) * 100) / 100 : null,
        modelsMissingPrice: prices.filter((p) => p === null).length,
      };
    })
    .sort((a, b) => a.option.localeCompare(b.option));
}

/** Option names that differ only in spacing/punctuation (likely the same option). */
export function nameVariants(names: string[]): string[][] {
  const groups = new Map<string, Set<string>>();
  for (const name of names) {
    const k = looseName(name);
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k)!.add(name);
  }
  return [...groups.values()].filter((g) => g.size > 1).map((g) => [...g].sort());
}

export async function getCostItemAdminOverview(input: { model?: string; search?: string } = {}) {
  const [context, freshness, scopeRules, optionRules, topGroups] = await Promise.all([
    loadCatalogContext(),
    getDatasetFreshness().catch(() => []),
    loadModelScopeRules(),
    listValueMappings("option_group").catch(() => []),
    agentDb().select<{ id: string; name: string; description: string | null }>(
      "jt_catalog_models",
      { filters: [{ col: "removed_at", op: "is_null" }], limit: 5000 },
    ),
  ]);
  const items = context.items();
  const byContext = new Map<string, number>();
  for (const r of items)
    byContext.set(String(r["item.context"]), (byContext.get(String(r["item.context"])) ?? 0) + 1);

  const modelRows = new Map(context.modelRows.map((m) => [m.id, m]));
  const perRoot = new Map<string, Row[]>();
  for (const r of items) {
    const id = r["item.modelId"] as string | null;
    if (!id) continue;
    if (!perRoot.has(id)) perRoot.set(id, []);
    perRoot.get(id)!.push(r);
  }
  const models: ModelSummary[] = topGroups
    .map((g) => {
      const rows = perRoot.get(g.id) ?? [];
      const m = modelRows.get(g.id);
      const sum = (key: string) =>
        rows.some((r) => r[key] === null)
          ? null
          : Math.round(rows.reduce((t, r) => t + (n(r[key]) ?? 0), 0) * 100) / 100;
      return {
        id: g.id,
        name: g.name,
        isModel: isProductModel(g, scopeRules),
        region: (m?.["model.region"] as string | null) ?? null,
        items: rows.length,
        sections: new Set(rows.map((r) => r["item.section"]).filter(Boolean)).size,
        optionGroups: (m?.["model.optionGroups"] as string[] | undefined) ?? [],
        options: Number(m?.["model.optionCount"] ?? 0),
        unpriced: rows.filter((r) => r["item.priceStatus"] === NO_SELLING_PRICE).length,
        totalCost: rows.length ? sum("item.cost") : null,
        totalPrice: rows.length ? sum("item.price") : null,
      };
    })
    .sort((a, b) => Number(b.isModel) - Number(a.isModel) || a.name.localeCompare(b.name));

  const otherRoots = new Map<string, number>();
  for (const r of items)
    if (r["item.context"] === "Other catalog group")
      otherRoots.set(
        String(r["item.rootGroup"]),
        (otherRoots.get(String(r["item.rootGroup"])) ?? 0) + 1,
      );

  const modelOptionItems = items.filter((r) => r["item.context"] === "Product Library model");
  const options = optionPriceAnalysis(modelOptionItems);
  const optionGroups = new Map<string, Set<string>>();
  for (const r of modelOptionItems) {
    const g = r["item.optionGroup"] as string | null;
    if (!g) continue;
    if (!optionGroups.has(g)) optionGroups.set(g, new Set());
    optionGroups.get(g)!.add(String(r["item.modelId"]));
  }

  const q = input.search?.trim().toLowerCase();
  const preview = items
    .filter(
      (r) =>
        (!input.model || r["item.modelId"] === input.model) &&
        (!q || `${r["item.name"]} ${r["item.groupPath"]}`.toLowerCase().includes(q)),
    )
    .slice(0, 25);

  return {
    source: {
      id: "cost_items",
      label: SOURCE_REGISTRY.cost_items.label,
      grain: SOURCE_REGISTRY.cost_items.grain,
      relationships: SOURCE_REGISTRY.cost_items.relationships,
      notes: SOURCE_REGISTRY.cost_items.notes,
    },
    freshness: SOURCE_REGISTRY.cost_items.syncEntities.map((e) => {
      const f = freshness.find((x) => x.key === e);
      return f
        ? { dataset: e, label: f.label, lastSuccessAt: f.lastSuccessAt, ...assessFreshness(f) }
        : { dataset: e, label: e, lastSuccessAt: null, level: "never", message: null };
    }),
    fields: ITEM_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      category: f.category,
      origin: f.origin,
    })),
    counts: {
      items: items.length,
      byContext: Object.fromEntries(byContext),
      models: models.filter((m) => m.isModel).length,
      topLevelGroups: models.length,
    },
    models,
    otherRoots: [...otherRoots.entries()].map(([name, count]) => ({ name, items: count })),
    optionGroups: [...optionGroups.entries()].map(([name, ids]) => ({ name, models: ids.size })),
    options,
    optionNameVariants: nameVariants(options.map((o) => o.option)),
    rules: {
      modelScope: scopeRules.map((r) => ({
        id: (r as { id?: string }).id ?? null,
        matchType: r.match_type,
        pattern: r.pattern,
        value: r.value,
      })),
      optionGroup: optionRules.map((r) => ({
        id: r.id,
        matchType: r.match_type,
        pattern: r.pattern,
        value: r.value,
      })),
    },
    preview: preview.map((r) =>
      Object.fromEntries(
        [
          "id",
          "item.model",
          "item.groupPath",
          "item.name",
          "item.quantity",
          "item.unit",
          "item.unitCost",
          "item.unitPrice",
          "item.cost",
          "item.price",
          "item.priceStatus",
        ].map((k) => [k, r[k] ?? null]),
      ),
    ),
  };
}

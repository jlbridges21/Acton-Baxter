"use client";

/**
 * /reports/settings/cost-items (admins): the Cost items report source — freshness, fields,
 * relationships, model ↔ budget associations, option groups and whether option prices vary by
 * model, groups that aren't models, classification rules, regions, and a row preview.
 * Rules only change how Baxter classifies JobTread groups; nothing is written to JobTread.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Trash2 } from "lucide-react";
import {
  aiFetch,
  errorMessage,
  formatRelative,
  Notice,
  Pill,
  selectClass,
  useLoad,
} from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { RelatedFieldsAdmin } from "./related-fields-admin";
import { cn } from "@/lib/utils";

type Rule = { id: string | null; matchType: string; pattern: string; value: string };
type Model = {
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
type Overview = {
  source: {
    label: string;
    grain: string;
    relationships: Array<{ to: string; cardinality: string; via: string; description: string }>;
    notes: string[];
  };
  freshness: Array<{
    dataset: string;
    label: string;
    lastSuccessAt: string | null;
    level: string;
    message: string | null;
  }>;
  fields: Array<{ key: string; label: string; type: string; category: string; origin: string }>;
  counts: {
    items: number;
    byContext: Record<string, number>;
    models: number;
    topLevelGroups: number;
  };
  models: Model[];
  otherRoots: Array<{ name: string; items: number }>;
  optionGroups: Array<{ name: string; models: number }>;
  options: Array<{
    option: string;
    models: number;
    variesByModel: boolean;
    minPrice: number | null;
    maxPrice: number | null;
    modelsMissingPrice: number;
  }>;
  optionNameVariants: string[][];
  rules: { modelScope: Rule[]; optionGroup: Rule[] };
  preview: Array<Record<string, string | number | null>>;
};

const money = (v: number | null | string | undefined) =>
  typeof v === "number"
    ? v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "—";

const card = "rounded-lg border border-[var(--acton-border)] bg-white p-5";

export function CostItemsAdmin() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [region, setRegion] = useState("");
  const [previewModel, setPreviewModel] = useState("");
  const [previewSearch, setPreviewSearch] = useState("");
  const [optionRule, setOptionRule] = useState({ pattern: "", value: "include" });

  const load = useCallback(async (q = "") => {
    try {
      setData(await aiFetch<Overview>(`/api/reports/admin/cost-items${q}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(useCallback(() => load(), [load]));

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const rule = (body: Record<string, unknown>) =>
    run(async () =>
      setData(
        await aiFetch<Overview>("/api/reports/admin/cost-items", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
    );
  const deleteRule = (id: string) =>
    run(async () =>
      setData(
        await aiFetch<Overview>(`/api/reports/admin/cost-items?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      ),
    );
  const assignRegion = () =>
    run(async () => {
      const names = data!.models.filter((m) => selected.has(m.id)).map((m) => m.name);
      for (const name of names)
        await aiFetch("/api/reports/admin/mappings", {
          method: "POST",
          body: JSON.stringify({
            kind: "region",
            sourceField: "model.name",
            matchType: "exact",
            pattern: name,
            value: region.trim(),
          }),
        });
      setSelected(new Set());
      await load();
    }, `Region “${region.trim()}” assigned to ${selected.size} model(s).`);

  const previewQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (previewModel) p.set("model", previewModel);
    if (previewSearch.trim()) p.set("search", previewSearch.trim());
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [previewModel, previewSearch]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports/settings"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Data settings
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-[var(--acton-navy)]">
          <Boxes className="h-5 w-5" aria-hidden /> Cost items & Product Library
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
          The cost-item report source, how items link to models and options, and the rules that
          decide which JobTread groups count as models or option groups.
        </p>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {!data && !error ? <p className="text-sm text-[var(--acton-muted)]">Loading…</p> : null}
      {data ? (
        <>
          <section className={card}>
            <h2 className="font-semibold text-[var(--acton-navy)]">Source</h2>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">
              {data.source.grain} {data.counts.items.toLocaleString()} items ·{" "}
              {Object.entries(data.counts.byContext)
                .map(([k, v]) => `${k}: ${v.toLocaleString()}`)
                .join(" · ")}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {data.freshness.map((f) => (
                <li key={f.dataset}>
                  <Pill
                    className={
                      f.level === "fresh"
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-900"
                    }
                  >
                    {f.label}: {f.lastSuccessAt ? formatRelative(f.lastSuccessAt) : "never synced"}
                  </Pill>
                </li>
              ))}
            </ul>
            {data.freshness.some((f) => f.message) ? (
              <Notice tone="warning" className="mt-3">
                {data.freshness
                  .map((f) => f.message)
                  .filter(Boolean)
                  .join(" ")}
              </Notice>
            ) : null}
            <h3 className="mt-4 text-sm font-semibold text-[var(--acton-navy)]">Relationships</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-[var(--acton-muted)]">
              {data.source.relationships.map((r) => (
                <li key={`${r.to}-${r.via}`}>
                  {r.cardinality} → {r.to} via <code>{r.via}</code>: {r.description}
                </li>
              ))}
            </ul>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-semibold text-[var(--acton-navy)]">
                {data.fields.length} fields
              </summary>
              <ul className="mt-2 grid gap-1 md:grid-cols-2">
                {data.fields.map((f) => (
                  <li key={f.key} className="text-xs">
                    <code>{f.key}</code> · {f.label} · {f.type}
                    {f.category === "financial" ? " · financial" : ""}
                    <span className="block text-[var(--acton-muted)]">{f.origin}</span>
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section className={card}>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="font-semibold text-[var(--acton-navy)]">Models and their budgets</h2>
                <p className="mt-1 text-sm text-[var(--acton-muted)]">
                  {data.counts.models} of {data.counts.topLevelGroups} top-level catalog groups
                  count as Product Library models. Totals are summed from each model&apos;s cost
                  items; blank when any line lacks a value.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  aria-label="Region to assign"
                  value={region}
                  maxLength={120}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="Region (e.g. Bay Area)"
                  className="h-9 w-44 rounded-md border border-[var(--acton-border)] px-3 text-sm"
                />
                <Button
                  size="sm"
                  disabled={busy || !selected.size || !region.trim()}
                  onClick={() => void assignRegion()}
                >
                  Assign to {selected.size || ""} selected
                </Button>
              </div>
            </div>
            <div className="mt-3 max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-[var(--acton-muted)]">
                  <tr>
                    <th className="py-2 pr-2">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="py-2 pr-3 font-semibold">Group</th>
                    <th className="py-2 pr-3 font-semibold">Counts as</th>
                    <th className="py-2 pr-3 font-semibold">Region</th>
                    <th className="py-2 pr-3 text-right font-semibold">Items</th>
                    <th className="py-2 pr-3 font-semibold">Option groups</th>
                    <th className="py-2 pr-3 text-right font-semibold">Unpriced</th>
                    <th className="py-2 pr-3 text-right font-semibold">Total cost</th>
                    <th className="py-2 text-right font-semibold">Total price</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => (
                    <tr key={m.id} className="border-t border-[var(--acton-gray-100)]">
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${m.name}`}
                          checked={selected.has(m.id)}
                          disabled={!m.isModel}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(m.id);
                            else next.delete(m.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="py-1.5 pr-3 font-medium text-[var(--acton-navy)]">{m.name}</td>
                      <td className="py-1.5 pr-3">
                        <button
                          type="button"
                          disabled={busy}
                          title="Change with a model rule"
                          onClick={() =>
                            void rule({
                              kind: "model_scope",
                              matchType: "exact",
                              pattern: m.name,
                              value: m.isModel ? "exclude" : "include",
                            })
                          }
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-semibold",
                            m.isModel
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-slate-100 text-slate-700",
                          )}
                        >
                          {m.isModel ? "Model" : "Not a model"}
                        </button>
                      </td>
                      <td className="py-1.5 pr-3 text-xs">
                        {m.region ?? <span className="text-[var(--acton-muted)]">unmapped</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{m.items}</td>
                      <td className="py-1.5 pr-3 text-xs">
                        {m.optionGroups.length
                          ? `${m.optionGroups.join(", ")} (${m.options})`
                          : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-3 text-right tabular-nums",
                          m.unpriced ? "text-amber-800" : "",
                        )}
                      >
                        {m.unpriced}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(m.totalCost)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(m.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className={card}>
              <h2 className="font-semibold text-[var(--acton-navy)]">Options</h2>
              <p className="mt-1 text-sm text-[var(--acton-muted)]">
                {data.optionGroups.map((g) => `${g.name} in ${g.models} models`).join(" · ") ||
                  "No option groups found."}
              </p>
              {data.optionNameVariants.length ? (
                <Notice tone="warning" className="mt-3">
                  Option names that differ only in spelling (fix in JobTread to combine them):{" "}
                  {data.optionNameVariants.map((v) => v.join(" / ")).join("; ")}
                </Notice>
              ) : null}
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs text-[var(--acton-muted)]">
                  <tr>
                    <th className="py-1.5 pr-3 font-semibold">Option</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Models</th>
                    <th className="py-1.5 pr-3 font-semibold">Price by model</th>
                    <th className="py-1.5 text-right font-semibold">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {data.options.map((o) => (
                    <tr key={o.option} className="border-t border-[var(--acton-gray-100)]">
                      <td className="py-1.5 pr-3">{o.option}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{o.models}</td>
                      <td className="py-1.5 pr-3 text-xs">
                        {o.variesByModel ? "Varies" : "Same"}
                        {o.modelsMissingPrice ? ` · ${o.modelsMissingPrice} missing price` : ""}
                      </td>
                      <td className="py-1.5 text-right text-xs tabular-nums">
                        {money(o.minPrice)} – {money(o.maxPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={card}>
              <h2 className="font-semibold text-[var(--acton-navy)]">
                Groups that aren&apos;t models
              </h2>
              <ul className="mt-2 text-sm">
                {data.otherRoots.map((r) => (
                  <li key={r.name} className="flex justify-between py-0.5">
                    <span>{r.name}</span>
                    <span className="text-[var(--acton-muted)] tabular-nums">{r.items} items</span>
                  </li>
                ))}
                <li className="flex justify-between py-0.5">
                  <span>Item library (no group)</span>
                  <span className="text-[var(--acton-muted)] tabular-nums">
                    {data.counts.byContext["Item library"] ?? 0} items
                  </span>
                </li>
              </ul>
              <h3 className="mt-4 text-sm font-semibold text-[var(--acton-navy)]">Rules</h3>
              <p className="text-xs text-[var(--acton-muted)]">
                Option groups default to groups named “… Options”.
              </p>
              <ul className="mt-2 divide-y divide-[var(--acton-gray-100)] text-sm">
                {[
                  ...data.rules.modelScope.map((r) => ({ ...r, kind: "Model" })),
                  ...data.rules.optionGroup.map((r) => ({ ...r, kind: "Option group" })),
                ].map((r) => (
                  <li
                    key={`${r.kind}-${r.pattern}`}
                    className="flex items-center justify-between py-1"
                  >
                    <span>
                      {r.kind}: name {r.matchType} <code>{r.pattern}</code> → {r.value}
                    </span>
                    {r.id ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteRule(r.id!)}
                        className="rounded p-1 text-[var(--acton-muted)] hover:bg-red-50 hover:text-red-700"
                        aria-label={`Delete rule ${r.pattern}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <form
                className="mt-3 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rule({
                    kind: "option_group",
                    matchType: "exact",
                    pattern: optionRule.pattern,
                    value: optionRule.value,
                  }).then(() => setOptionRule({ pattern: "", value: "include" }));
                }}
              >
                <input
                  aria-label="Group name"
                  required
                  maxLength={120}
                  value={optionRule.pattern}
                  onChange={(e) => setOptionRule({ ...optionRule, pattern: e.target.value })}
                  placeholder="Group name"
                  className="h-9 w-48 rounded-md border border-[var(--acton-border)] px-3 text-sm"
                />
                <div className="w-40">
                  <select
                    aria-label="Rule effect"
                    className={`${selectClass} h-9`}
                    value={optionRule.value}
                    onChange={(e) => setOptionRule({ ...optionRule, value: e.target.value })}
                  >
                    <option value="include">Is an option group</option>
                    <option value="exclude">Not an option group</option>
                  </select>
                </div>
                <Button size="sm" type="submit" disabled={busy}>
                  Add rule
                </Button>
              </form>
            </div>
          </section>

          <RelatedFieldsAdmin className={card} />

          <section className={card}>
            <h2 className="font-semibold text-[var(--acton-navy)]">Preview rows</h2>
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => load(previewQuery));
              }}
            >
              <div className="w-64">
                <select
                  aria-label="Preview model"
                  className={`${selectClass} h-9`}
                  value={previewModel}
                  onChange={(e) => setPreviewModel(e.target.value)}
                >
                  <option value="">All items</option>
                  {data.models
                    .filter((m) => m.isModel)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>
              <input
                aria-label="Search items"
                value={previewSearch}
                maxLength={80}
                onChange={(e) => setPreviewSearch(e.target.value)}
                placeholder="Search item or group path"
                className="h-9 w-64 rounded-md border border-[var(--acton-border)] px-3 text-sm"
              />
              <Button size="sm" variant="secondary" type="submit" disabled={busy}>
                Preview
              </Button>
            </form>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="text-left text-[var(--acton-muted)]">
                  <tr>
                    {[
                      "Model",
                      "Group path",
                      "Item",
                      "Qty",
                      "Unit",
                      "Unit cost",
                      "Unit price",
                      "Cost",
                      "Price",
                      "Price status",
                    ].map((h) => (
                      <th key={h} className="py-1.5 pr-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.preview.map((r) => (
                    <tr key={String(r.id)} className="border-t border-[var(--acton-gray-100)]">
                      <td className="py-1 pr-3">{r["item.model"] ?? "—"}</td>
                      <td className="py-1 pr-3">{r["item.groupPath"] ?? "—"}</td>
                      <td className="py-1 pr-3">{r["item.name"]}</td>
                      <td className="py-1 pr-3 tabular-nums">{r["item.quantity"] ?? "—"}</td>
                      <td className="py-1 pr-3">{r["item.unit"] ?? "—"}</td>
                      <td className="py-1 pr-3 tabular-nums">{money(r["item.unitCost"])}</td>
                      <td className="py-1 pr-3 tabular-nums">{money(r["item.unitPrice"])}</td>
                      <td className="py-1 pr-3 tabular-nums">{money(r["item.cost"])}</td>
                      <td className="py-1 pr-3 tabular-nums">{money(r["item.price"])}</td>
                      <td className="py-1">{r["item.priceStatus"]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Bulk pricing: every model or option price × every region in one grid. Type to edit,
 * arrow keys / Enter to move, paste a block from a spreadsheet, select rows and apply a
 * dollar or percent change, copy one region's prices to others. Edits go into the same
 * working copy as the style editors; one Save stores them.
 */

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  applyBulkAdjust,
  priceInRegion,
  setRegionAmount,
  type BulkAdjust,
} from "@/lib/configurator/pricing";
import type { Catalog, Model, Price } from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { PageHeader } from "./admin-shell";
import { MoneyInput, Panel, TextInput, formatMoney, inputClass, parseMoney } from "./admin-ui";
import { Segmented } from "./dashboard";

type Category =
  "base" | "options" | "exteriors" | "interiors" | "appliances" | "upgrades" | "bathrooms";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "base", label: "Starting prices" },
  { value: "options", label: "Model options" },
  { value: "exteriors", label: "Exteriors" },
  { value: "interiors", label: "Interiors" },
  { value: "appliances", label: "Appliances" },
  { value: "upgrades", label: "Upgrades" },
  { value: "bathrooms", label: "Bathrooms" },
];

type Row = {
  id: string;
  modelId: string;
  modelName: string;
  label: string;
  price: Price;
  savedPrice: Price | null;
};

function rowsFor(catalog: Catalog, saved: Catalog, category: Category): Row[] {
  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;
  const rows: Row[] = [];
  for (const model of [...catalog.models].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const savedModel = saved.models.find((m) => m.id === model.id);
    if (category === "base") {
      rows.push({
        id: `${model.id}::base`,
        modelId: model.id,
        modelName: model.name,
        label: "Starting price",
        price: model.basePrice,
        savedPrice: savedModel?.basePrice ?? null,
      });
      continue;
    }
    if (category === "exteriors" || category === "interiors") {
      for (const u of [...model[category]].sort((a, b) => a.sortOrder - b.sortOrder)) {
        rows.push({
          id: `${model.id}::${u.styleId}`,
          modelId: model.id,
          modelName: model.name,
          label: styleName(u.styleId) + (u.enabled ? "" : " (off)"),
          price: u.price,
          savedPrice: savedModel?.[category].find((x) => x.styleId === u.styleId)?.price ?? null,
        });
      }
      continue;
    }
    for (const item of [...model[category]].sort((a, b) => a.sortOrder - b.sortOrder)) {
      rows.push({
        id: `${model.id}::${item.id}`,
        modelId: model.id,
        modelName: model.name,
        label: item.name + (item.enabled ? "" : " (off)"),
        price: item.price,
        savedPrice:
          (savedModel?.[category] as { id: string; price: Price }[] | undefined)?.find(
            (x) => x.id === item.id,
          )?.price ?? null,
      });
    }
  }
  return rows;
}

function writePrice(model: Model, category: Category, itemId: string, price: Price): Model {
  if (category === "base") return { ...model, basePrice: price };
  if (category === "exteriors" || category === "interiors")
    return {
      ...model,
      [category]: model[category].map((u) => (u.styleId === itemId ? { ...u, price } : u)),
    };
  return {
    ...model,
    [category]: (model[category] as { id: string; price: Price }[]).map((x) =>
      x.id === itemId ? { ...x, price } : x,
    ),
  };
}

export function PricingGrid() {
  const { catalog, saved, updateCatalog } = useAdmin();
  const params = useSearchParams();
  const [category, setCategory] = useState<Category>("base");
  const [seriesId, setSeriesId] = useState("all");
  const [modelId, setModelId] = useState("all");
  const [reviewOnly, setReviewOnly] = useState(params.get("review") === "1");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [regionSel, setRegionSel] = useState<Set<string>>(new Set());
  const [adjustKind, setAdjustKind] = useState<BulkAdjust["kind"]>("add");
  const [adjustValue, setAdjustValue] = useState<number | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const regions = catalog.regions;

  const rows = useMemo(
    () =>
      rowsFor(catalog, saved, category)
        .filter(
          (r) =>
            seriesId === "all" ||
            catalog.models.find((m) => m.id === r.modelId)?.seriesId === seriesId,
        )
        .filter((r) => modelId === "all" || r.modelId === modelId)
        .filter((r) => !reviewOnly || r.price.needsReview)
        .filter(
          (r) => !query || `${r.modelName} ${r.label}`.toLowerCase().includes(query.toLowerCase()),
        ),
    [catalog, saved, category, seriesId, modelId, reviewOnly, query],
  );

  /** Apply `fn` to each targeted row's price in one undoable change. */
  const editRows = (ids: Set<string> | string[], fn: (price: Price) => Price) => {
    const targets = new Set(ids);
    updateCatalog((c) => ({
      ...c,
      models: c.models.map((m) => {
        let next = m;
        for (const row of rowsFor(c, saved, category)) {
          if (row.modelId !== m.id || !targets.has(row.id)) continue;
          next = writePrice(next, category, row.id.split("::")[1]!, fn(row.price));
        }
        return next;
      }),
    }));
  };

  const setCell = (rowId: string, regionId: string, value: number | null) =>
    editRows([rowId], (p) => setRegionAmount(p, regionId, value));

  const targetRows = selected.size
    ? [...selected].filter((id) => rows.some((r) => r.id === id))
    : rows.map((r) => r.id);
  const targetRegions = regionSel.size ? regions.filter((r) => regionSel.has(r.id)) : regions;

  const focusCell = (row: number, col: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-cell="${row}:${col}"]`);
    el?.focus();
  };

  const onPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    rowIndex: number,
    colIndex: number,
  ) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const grid = text
      .replace(/\r/g, "")
      .split("\n")
      .filter((line, i, all) => line !== "" || i < all.length - 1)
      .map((line) => line.split("\t"));
    updateCatalog((c) => {
      let models = c.models;
      grid.forEach((cells, dr) => {
        const row = rows[rowIndex + dr];
        if (!row) return;
        cells.forEach((cell, dc) => {
          const region = regions[colIndex + dc];
          if (!region) return;
          const value = parseMoney(cell);
          models = models.map((m) => {
            if (m.id !== row.modelId) return m;
            const current = rowsFor({ ...c, models }, saved, category).find(
              (r) => r.id === row.id,
            )!;
            return writePrice(
              m,
              category,
              row.id.split("::")[1]!,
              setRegionAmount(current.price, region.id, value),
            );
          });
        });
      });
      return { ...c, models };
    });
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="mx-auto max-w-[1500px] p-6">
      <PageHeader
        title="Pricing"
        description="Every regional price in one place. Prices are customer-facing only after you publish."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={category}
          onChange={(v) => (setCategory(v as Category), setSelected(new Set()))}
          options={CATEGORIES}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className={cn(inputClass, "w-auto")}
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
          aria-label="Series"
        >
          <option value="all">All series</option>
          {catalog.series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className={cn(inputClass, "w-auto")}
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          aria-label="Model"
        >
          <option value="all">All models</option>
          {catalog.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <TextInput
          placeholder="Filter rows"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-48"
          aria-label="Filter rows"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewOnly}
            onChange={(e) => setReviewOnly(e.target.checked)}
          />{" "}
          Needs review only
        </label>
      </div>

      <Panel className="mb-4">
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="bulk-toolbar">
          <span className="font-semibold text-[var(--acton-navy)]">
            {selected.size ? `${targetRows.length} selected rows` : `All ${rows.length} rows`} ×{" "}
            {regionSel.size ? `${targetRegions.length} regions` : "all regions"}
          </span>
          <select
            className={cn(inputClass, "h-9 w-auto")}
            value={adjustKind}
            onChange={(e) => setAdjustKind(e.target.value as BulkAdjust["kind"])}
            aria-label="Adjustment"
          >
            <option value="add">Add / subtract $</option>
            <option value="percent">Change by %</option>
            <option value="set">Set to $</option>
          </select>
          <MoneyInput
            value={adjustValue}
            onChange={setAdjustValue}
            prefix={adjustKind === "percent" ? "%" : "$"}
            className="w-32"
            ariaLabel="Adjustment amount"
            testId="bulk-amount"
          />
          <button
            type="button"
            disabled={adjustValue === null}
            data-testid="bulk-apply"
            onClick={() => {
              if (adjustValue === null) return;
              const adj: BulkAdjust =
                adjustKind === "percent"
                  ? { kind: "percent", percent: adjustValue }
                  : { kind: adjustKind, amount: adjustValue };
              editRows(targetRows, (p) =>
                targetRegions.reduce(
                  (acc, r) =>
                    setRegionAmount(acc, r.id, applyBulkAdjust(priceInRegion(acc, r.id), adj)),
                  p,
                ),
              );
            }}
            className="h-9 rounded-md bg-[var(--acton-navy)] px-3 font-semibold text-white disabled:opacity-50"
          >
            Apply
          </button>
          <span className="mx-1 h-6 w-px bg-[var(--acton-border)]" />
          <select
            className={cn(inputClass, "h-9 w-auto")}
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            aria-label="Copy from region"
          >
            <option value="">Copy prices from region…</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!copyFrom}
            onClick={() =>
              editRows(targetRows, (p) =>
                targetRegions
                  .filter((r) => r.id !== copyFrom)
                  .reduce((acc, r) => setRegionAmount(acc, r.id, priceInRegion(p, copyFrom)), p),
              )
            }
            className="h-9 rounded-md border border-[var(--acton-border)] px-3 font-semibold disabled:opacity-50"
          >
            Copy to {regionSel.size ? "selected" : "all other"} regions
          </button>
          <span className="mx-1 h-6 w-px bg-[var(--acton-border)]" />
          <button
            type="button"
            onClick={() => editRows(targetRows, (p) => ({ ...p, needsReview: false }))}
            className="h-9 rounded-md border border-emerald-300 bg-emerald-50 px-3 font-semibold text-emerald-900"
            data-testid="bulk-review"
          >
            Mark reviewed
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--acton-muted)]">
          Tip: click a price and paste a block copied from Excel or Google Sheets. Arrow keys and
          Enter move between cells.
        </p>
      </Panel>

      <div className="overflow-x-auto rounded-xl border border-[var(--acton-border)] bg-white shadow-sm">
        <table className="w-full text-sm" data-testid="pricing-grid">
          <thead className="sticky top-0 z-10 bg-[var(--acton-gray-50)]">
            <tr className="text-left text-xs text-[var(--acton-muted)]">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                  }
                />
              </th>
              <th className="px-3 py-2 font-semibold">Model</th>
              <th className="px-3 py-2 font-semibold">Item</th>
              {regions.map((r) => (
                <th key={r.id} className="px-2 py-2 font-semibold">
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={regionSel.has(r.id)}
                      onChange={() =>
                        setRegionSel((s) => {
                          const n = new Set(s);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        })
                      }
                    />
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
                    {r.name}
                  </label>
                </th>
              ))}
              <th className="px-3 py-2 font-semibold">Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={row.id}
                className={cn(
                  "border-t border-[var(--acton-border)]",
                  selected.has(row.id)
                    ? "bg-sky-50"
                    : row.price.needsReview
                      ? "bg-amber-50/60"
                      : "",
                )}
              >
                <td className="px-3 py-1">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.modelName} ${row.label}`}
                    checked={selected.has(row.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(row.id)) n.delete(row.id);
                        else n.add(row.id);
                        return n;
                      })
                    }
                  />
                </td>
                <td className="px-3 py-1 whitespace-nowrap text-[var(--acton-muted)]">
                  {ri === 0 || rows[ri - 1]!.modelId !== row.modelId ? row.modelName : ""}
                </td>
                <td className="px-3 py-1 font-medium whitespace-nowrap text-[var(--acton-navy)]">
                  {row.label}
                </td>
                {regions.map((r, ci) => {
                  const value = priceInRegion(row.price, r.id);
                  const before = row.savedPrice ? priceInRegion(row.savedPrice, r.id) : null;
                  const changed = row.savedPrice === null || before !== value;
                  return (
                    <td key={r.id} className="px-1 py-1">
                      <GridCell
                        value={value}
                        changed={changed}
                        cellId={`${ri}:${ci}`}
                        label={`${row.modelName} ${row.label} ${r.name}`}
                        onCommit={(v) => setCell(row.id, r.id, v)}
                        onMove={(dr, dc) => focusCell(ri + dr, ci + dc)}
                        onPaste={(e) => onPaste(e, ri, ci)}
                      />
                    </td>
                  );
                })}
                <td className="px-3 py-1 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${row.modelName} ${row.label} reviewed`}
                    checked={!row.price.needsReview}
                    onChange={(e) =>
                      editRows([row.id], (p) => ({ ...p, needsReview: !e.target.checked }))
                    }
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={regions.length + 4}
                  className="p-8 text-center text-[var(--acton-muted)]"
                >
                  No prices match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GridCell({
  value,
  changed,
  cellId,
  label,
  onCommit,
  onMove,
  onPaste,
}: {
  value: number | null;
  changed: boolean;
  cellId: string;
  label: string;
  onCommit: (v: number | null) => void;
  onMove: (dr: number, dc: number) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const next = parseMoney(draft);
      if (next !== value) onCommit(next);
    }
    setDraft(null);
  };
  return (
    <input
      data-cell={cellId}
      aria-label={label}
      inputMode="decimal"
      value={draft ?? (value === null ? "" : `$${formatMoney(value)}`)}
      placeholder="—"
      onFocus={(e) => {
        setDraft(value === null ? "" : String(value));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onPaste={onPaste}
      onKeyDown={(e) => {
        const move = (dr: number, dc: number) => {
          e.preventDefault();
          commit();
          onMove(dr, dc);
        };
        if (e.key === "Enter" || e.key === "ArrowDown") move(1, 0);
        else if (e.key === "ArrowUp") move(-1, 0);
        else if (e.key === "Tab") move(0, e.shiftKey ? -1 : 1);
        else if (
          e.key === "ArrowRight" &&
          (e.target as HTMLInputElement).selectionEnd ===
            (e.target as HTMLInputElement).value.length
        )
          move(0, 1);
        else if (e.key === "ArrowLeft" && (e.target as HTMLInputElement).selectionStart === 0)
          move(0, -1);
        else if (e.key === "Escape") {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        "h-9 w-32 rounded border px-2 text-right tabular-nums focus:border-[var(--acton-navy)] focus:ring-1 focus:ring-[var(--acton-navy)] focus:outline-none",
        value === null
          ? "border-red-200 bg-red-50/40"
          : changed
            ? "border-sky-300 bg-sky-50"
            : "border-transparent hover:border-[var(--acton-border)]",
      )}
    />
  );
}

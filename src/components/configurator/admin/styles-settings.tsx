"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { newStyle, newStyleUse } from "@/lib/configurator/defaults";
import { slotKey } from "@/lib/configurator/render";
import type { CatalogSettings, SharedStyle, StyleKind } from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { PageHeader } from "./admin-shell";
import { Field, ImageSlot, Panel, Pill, TextInput, Thumb, Toggle, inputClass } from "./admin-ui";
import { primarySlot } from "./style-tabs";

export function StylesPage() {
  const { catalog } = useAdmin();
  const [kind, setKind] = useState<StyleKind>("exterior");
  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Shared styles"
        description="Styles are defined once and offered on any model. Each model keeps its own renderings, default and prices for the style."
      />
      <div className="mb-4 inline-flex rounded-lg border border-[var(--acton-border)] bg-white p-0.5 text-sm">
        {(["exterior", "interior"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              "rounded-md px-4 py-1.5 font-semibold",
              kind === k ? "bg-[var(--acton-navy)] text-white" : "text-[var(--acton-navy)]",
            )}
          >
            {k === "exterior" ? "Exterior styles" : "Interior styles"} (
            {catalog.styles.filter((s) => s.kind === k).length})
          </button>
        ))}
      </div>
      <StyleLibrary kind={kind} />
    </div>
  );
}

function StyleLibrary({ kind }: { kind: StyleKind }) {
  const { catalog, putStyle, updateStyle, updateCatalog, assetById } = useAdmin();
  const [name, setName] = useState("");
  const styles = catalog.styles
    .filter((s) => s.kind === kind)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const key = kind === "exterior" ? "exteriors" : "interiors";

  const addToAll = (style: SharedStyle, seriesId: string | "all") =>
    updateCatalog((c) => ({
      ...c,
      models: c.models.map((m) =>
        (seriesId === "all" || m.seriesId === seriesId) &&
        !m[key].some((u) => u.styleId === style.id)
          ? { ...m, [key]: [...m[key], newStyleUse(style.id, m[key].length)] }
          : m,
      ),
    }));

  return (
    <>
      <Panel className="mb-4">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            putStyle(newStyle(kind, name.trim(), catalog));
            setName("");
          }}
        >
          <TextInput
            placeholder={`New ${kind} style name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-sm"
            aria-label="New style name"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="inline-flex h-10 items-center gap-1 rounded-md bg-[var(--acton-navy)] px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Create style
          </button>
          <span className="text-xs text-[var(--acton-muted)]">
            After creating it, add it to models below and upload each model&apos;s renderings.
          </span>
        </form>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {styles.map((style) => {
          const users = catalog.models.filter((m) => m[key].some((u) => u.styleId === style.id));
          const sample = users
            .map((m) => m.renders[slotKey(primarySlot(m, kind, style.id))])
            .find(Boolean);
          return (
            <div
              key={style.id}
              className={cn(
                "overflow-hidden rounded-xl border bg-white shadow-sm",
                style.archived ? "border-dashed opacity-70" : "border-[var(--acton-border)]",
              )}
              data-testid={`shared-style-${style.id}`}
            >
              <Thumb asset={assetById.get(sample ?? "")} className="aspect-[16/9] w-full" />
              <div className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <TextInput
                    value={style.name}
                    onChange={(e) => updateStyle(style.id, (s) => ({ ...s, name: e.target.value }))}
                    className="font-semibold"
                    aria-label="Style name"
                  />
                  {style.archived ? <Pill tone="gray">Archived</Pill> : null}
                </div>
                <p className="text-xs text-[var(--acton-muted)]">
                  Renaming updates every model that offers this style.
                </p>
                <textarea
                  className={cn(inputClass, "h-16 py-2")}
                  placeholder="Description (optional)"
                  value={style.description}
                  onChange={(e) =>
                    updateStyle(style.id, (s) => ({ ...s, description: e.target.value }))
                  }
                />
                {kind === "interior" ? (
                  <div className="max-w-[220px]">
                    <ImageSlot
                      label="Style details board"
                      sublabel="Shown with the “Style details” toggle"
                      assetId={style.detailsAssetId}
                      onChange={(id) =>
                        updateStyle(style.id, (s) => ({ ...s, detailsAssetId: id }))
                      }
                      classification={{
                        kind: "details",
                        modelId: null,
                        styleId: style.id,
                        role: null,
                        ceiling: null,
                        variant: null,
                        mirror: null,
                        bathroomName: null,
                        confidence: "high",
                        notes: [],
                      }}
                      suggest={(a) =>
                        (a.classification?.kind === "details" ? 2 : 0) +
                        (a.classification?.styleId === style.id ? 3 : 0)
                      }
                    />
                  </div>
                ) : null}
                <div className="text-sm">
                  <p className="font-semibold text-[var(--acton-navy)]">
                    Offered on {users.length} model{users.length === 1 ? "" : "s"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {users.map((m) => (
                      <Link
                        key={m.id}
                        href={`/configurator/models/${m.id}?tab=${key}`}
                        className="rounded-full bg-[var(--acton-gray-100)] px-2 py-0.5 text-xs text-[var(--acton-navy)] hover:bg-gray-200"
                      >
                        {m.name}
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--acton-border)] pt-3">
                  <select
                    className={cn(inputClass, "h-8 w-auto text-xs")}
                    value=""
                    onChange={(e) => e.target.value && addToAll(style, e.target.value)}
                    aria-label="Add to models"
                  >
                    <option value="">Add to models…</option>
                    <option value="all">All models</option>
                    {catalog.series.map((s) => (
                      <option key={s.id} value={s.id}>
                        All {s.name} models
                      </option>
                    ))}
                  </select>
                  <Toggle
                    checked={!style.archived}
                    onChange={(v) => updateStyle(style.id, (s) => ({ ...s, archived: !v }))}
                    label="Available"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { catalog, updateSettings, updateSeries } = useAdmin();
  const s = catalog.settings;
  const set = (patch: Partial<CatalogSettings>) => updateSettings((x) => ({ ...x, ...patch }));
  const setFinancing = (patch: Partial<CatalogSettings["financing"]>) =>
    updateSettings((x) => ({ ...x, financing: { ...x.financing, ...patch } }));
  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="Settings"
        description="Configurator-wide behavior. Changes publish with the next release."
      />
      <div className="space-y-5">
        <Panel
          title="Financing estimate"
          description="The “As little as … per month” figure: a fully financed amortized payment of the configured total."
        >
          <Toggle
            checked={s.financing.enabled}
            onChange={(v) => setFinancing({ enabled: v })}
            label="Show monthly estimate"
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Annual rate (%)" hint="Live site: 6%">
              <TextInput
                type="number"
                step="0.01"
                value={s.financing.annualRatePct}
                onChange={(e) => setFinancing({ annualRatePct: Number(e.target.value) })}
              />
            </Field>
            <Field label="Term (months)" hint="Live site: 360 (30 years)">
              <TextInput
                type="number"
                value={s.financing.termMonths}
                onChange={(e) => setFinancing({ termMonths: Number(e.target.value) })}
              />
            </Field>
            <Field label="Financing link (optional)">
              <TextInput
                placeholder="https://…"
                value={s.financing.linkUrl}
                onChange={(e) => setFinancing({ linkUrl: e.target.value })}
              />
            </Field>
            <Field label="Price card tooltip" className="sm:col-span-3">
              <TextInput
                value={s.financing.disclaimer}
                onChange={(e) => setFinancing({ disclaimer: e.target.value })}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Upgrades">
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="radio"
                checked={s.upgradeSelection === "single"}
                onChange={() => set({ upgradeSelection: "single" })}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">One upgrade at a time</span> — matches the current
                site (No Upgrade, 9-foot Ceiling or Lighting Upgrade).
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                checked={s.upgradeSelection === "multiple"}
                onChange={() => set({ upgradeSelection: "multiple" })}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">Combine upgrades</span> — customers can choose
                9-foot ceilings and lighting together. Requires the 9-ft Lighting Dusk Uplights
                renderings.
              </span>
            </label>
          </div>
        </Panel>

        <Panel title="Series">
          <div className="space-y-2">
            {catalog.series.map((se) => (
              <div key={se.id} className="grid grid-cols-[1fr_200px] gap-3">
                <TextInput
                  value={se.name}
                  onChange={(e) =>
                    updateSeries((list) =>
                      list.map((x) => (x.id === se.id ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  aria-label="Series name"
                />
                <TextInput
                  value={se.slug}
                  disabled
                  title="Used in links (?series=)"
                  aria-label="Series link value"
                />
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Integrations"
          description="These connect to existing GoHighLevel workflows and Can I Build. Change only if those teams ask."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Free quote form (GHL)" hint="Live site: p1swLQWD4mVI7APiGzFp">
              <TextInput
                value={s.quoteFormId}
                onChange={(e) => set({ quoteFormId: e.target.value.trim() })}
              />
            </Field>
            <Field label="Location / pricing form (GHL)" hint="Live site: pV3Gf1zaZHLuCTipKGKZ">
              <TextInput
                value={s.locationFormId}
                onChange={(e) => set({ locationFormId: e.target.value.trim() })}
              />
            </Field>
            <Field label="“Back to home” link">
              <TextInput
                value={s.homeUrl}
                onChange={(e) => set({ homeUrl: e.target.value.trim() })}
              />
            </Field>
            <div className="pt-6">
              <Toggle
                checked={s.canibuildEnabled}
                onChange={(v) => set({ canibuildEnabled: v })}
                label="Show Can I Build property search"
              />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

"use client";

import { ArrowDown, ArrowUp, ExternalLink, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { newStyle, newStyleUse } from "@/lib/configurator/defaults";
import { INTERIOR_ROLES } from "@/lib/configurator/types";
import {
  modelCeilings,
  modelHasLightingUpgrade,
  modelVariants,
  requiredSlots,
  ROLE_LABELS,
  ROLE_USAGE,
  slotKey,
  type Slot,
} from "@/lib/configurator/render";
import type { Model, StyleKind, StyleUse } from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import {
  ImageSlot,
  Panel,
  Pill,
  RegionPriceEditor,
  TextInput,
  Thumb,
  Toggle,
  priceSummary,
} from "./admin-ui";
import {
  classificationForSlot,
  moveItem,
  rankForSlot,
  setDefault,
  setRender,
} from "./model-helpers";

const VARIANT_LABEL = { standard: "Standard", porch: "With porch" } as const;

export function primarySlot(model: Model, kind: StyleKind, styleId: string): Slot {
  return kind === "exterior"
    ? { type: "ext", styleId, variant: modelVariants(model)[0] ?? "standard", ceiling: "8" }
    : { type: "int", styleId, role: "kitchen", ceiling: "8" };
}

export function StylesTab({ model, kind }: { model: Model; kind: StyleKind }) {
  const { catalog, updateModel, assetById, putStyle } = useAdmin();
  const key = kind === "exterior" ? "exteriors" : "interiors";
  const uses = [...model[key]].sort((a, b) => a.sortOrder - b.sortOrder);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const required = new Set(
    requiredSlots(model, catalog.settings.upgradeSelection).map((r) => r.key),
  );
  const available = catalog.styles.filter(
    (s) => s.kind === kind && !s.archived && !uses.some((u) => u.styleId === s.id),
  );
  const setUses = (next: StyleUse[]) => updateModel(model.id, (m) => ({ ...m, [key]: next }));
  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;

  const missingFor = (styleId: string) =>
    [...required].filter(
      (k) =>
        k.split("|")[1] === styleId &&
        k.startsWith(kind === "exterior" ? "ext|" : "int|") &&
        !model.renders[k],
    ).length;

  return (
    <Panel
      title={kind === "exterior" ? "Exterior Styles" : "Interior Styles"}
      description={
        kind === "exterior"
          ? "Shared styles with this model's own renderings and prices. Click a style to manage its images and Pricing by Region."
          : "Shared styles with this model's own renderings and prices. The Kitchen rendering is shown when a customer picks the style."
      }
      actions={
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex h-9 items-center gap-1 rounded-md bg-[var(--acton-navy)] px-3 text-sm font-semibold text-white"
          data-testid={`add-${kind}`}
        >
          <Plus className="h-4 w-4" /> Add style
        </button>
      }
    >
      {adding ? (
        <div className="mb-4 rounded-lg border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-3">
          <p className="mb-2 text-sm font-semibold text-[var(--acton-navy)]">
            Add a shared style to {model.name}
          </p>
          <div className="flex flex-wrap gap-2">
            {available.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setUses([...uses, newStyleUse(s.id, uses.length, uses.length === 0)]);
                  setEditing(s.id);
                  setAdding(false);
                }}
                className="rounded-full border border-[var(--acton-border)] bg-white px-3 py-1 text-sm hover:border-[var(--acton-navy)]"
              >
                + {s.name}
              </button>
            ))}
            {available.length === 0 ? (
              <span className="text-sm text-[var(--acton-muted)]">
                Every shared style is already on this model.
              </span>
            ) : null}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              const style = newStyle(kind, newName.trim(), catalog);
              putStyle(style);
              setUses([...uses, newStyleUse(style.id, uses.length, uses.length === 0)]);
              setNewName("");
              setAdding(false);
              setEditing(style.id);
            }}
          >
            <TextInput
              placeholder="Or create a new shared style…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="max-w-xs"
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="h-10 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm font-semibold disabled:opacity-50"
            >
              Create
            </button>
          </form>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {uses.map((u, i) => {
          const slot = primarySlot(model, kind, u.styleId);
          const missing = missingFor(u.styleId);
          return (
            <div
              key={u.styleId}
              className={cn(
                "overflow-hidden rounded-xl border bg-white shadow-sm",
                u.enabled ? "border-[var(--acton-border)]" : "border-dashed opacity-70",
              )}
              data-testid={`style-card-${u.styleId}`}
            >
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => setEditing(u.styleId)}
              >
                <div className="relative">
                  <Thumb
                    asset={assetById.get(model.renders[slotKey(slot)] ?? "")}
                    className="aspect-[16/10] w-full"
                  />
                  <div className="absolute top-2 left-2 flex gap-1">
                    {u.isDefault ? <Pill tone="blue">Default</Pill> : null}
                    {!u.enabled ? <Pill tone="gray">Off</Pill> : null}
                  </div>
                  {missing ? (
                    <span className="absolute top-2 right-2">
                      <Pill tone="red">{missing} missing</Pill>
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-2 px-3 pt-2">
                  <span className="font-semibold text-[var(--acton-navy)]">
                    {styleName(u.styleId)}
                  </span>
                  <span className="text-sm text-[var(--acton-muted)] tabular-nums">
                    {priceSummary(u.price, catalog.regions)}
                  </span>
                </div>
              </button>
              <div className="flex items-center justify-between px-3 py-2">
                <Toggle
                  checked={u.enabled}
                  onChange={(v) =>
                    setUses(uses.map((x) => (x.styleId === u.styleId ? { ...x, enabled: v } : x)))
                  }
                  label="Offered"
                />
                <div className="flex items-center gap-1">
                  {u.price.needsReview ? <Pill tone="amber">Price review</Pill> : null}
                  <button
                    type="button"
                    aria-label="Move earlier"
                    disabled={i === 0}
                    onClick={() => setUses(moveItem(uses, i, -1))}
                    className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move later"
                    disabled={i === uses.length - 1}
                    onClick={() => setUses(moveItem(uses, i, 1))}
                    className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editing ? (
        <StyleEditor model={model} kind={kind} styleId={editing} onClose={() => setEditing(null)} />
      ) : null}
    </Panel>
  );
}

/** Slide-over editor for one style on one model: images, defaults and Pricing by Region together. */
function StyleEditor({
  model,
  kind,
  styleId,
  onClose,
}: {
  model: Model;
  kind: StyleKind;
  styleId: string;
  onClose: () => void;
}) {
  const { catalog, updateModel, assetById } = useAdmin();
  const key = kind === "exterior" ? "exteriors" : "interiors";
  const use = model[key].find((u) => u.styleId === styleId);
  const style = catalog.styles.find((s) => s.id === styleId);
  const [tab, setTab] = useState<"details" | "images" | "pricing">("images");
  if (!use || !style) return null;
  const required = new Set(
    requiredSlots(model, catalog.settings.upgradeSelection).map((r) => r.key),
  );
  const ceilings = modelCeilings(model);
  const variants = modelVariants(model);
  const update = (patch: Partial<StyleUse>) =>
    updateModel(model.id, (m) => ({
      ...m,
      [key]: m[key].map((u) => (u.styleId === styleId ? { ...u, ...patch } : u)),
    }));
  const primary = primarySlot(model, kind, styleId);
  const primaryAsset = assetById.get(model.renders[slotKey(primary)] ?? "");
  const usedIn = catalog.models
    .filter((m) => m.id !== model.id && m[key].some((u) => u.styleId === styleId))
    .map((m) => m.name);

  const slotProps = (slot: Slot, label: string, sublabel: string) => ({
    label,
    sublabel,
    assetId: model.renders[slotKey(slot)] ?? null,
    onChange: (id: string | null) => updateModel(model.id, (m) => setRender(m, slot, id)),
    classification: classificationForSlot(model, slot),
    suggest: rankForSlot(model, slot),
    required: required.has(slotKey(slot)),
    fallbackAssetId:
      model.ceilingFallback && slot.type !== "bath" && slot.ceiling === "9"
        ? (model.renders[slotKey({ ...slot, ceiling: "8" })] ?? null)
        : null,
  });

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl"
        role="dialog"
        aria-label={`Edit ${style.name}`}
        data-testid="style-editor"
      >
        <div className="flex items-start gap-4 border-b border-[var(--acton-border)] p-5">
          <Thumb asset={primaryAsset} className="h-20 w-32 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
              {kind === "exterior" ? "Exterior style" : "Interior style"} · {model.name}
            </p>
            <h2 className="text-2xl font-bold text-[var(--acton-navy)]">{style.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <Toggle
                checked={use.enabled}
                onChange={(v) => update({ enabled: v })}
                label="Offered on this model"
              />
              <Toggle
                checked={use.isDefault}
                onChange={(v) =>
                  v &&
                  updateModel(model.id, (m) => ({
                    ...m,
                    [key]: setDefault(m[key], (u) => u.styleId === styleId),
                  }))
                }
                label="Preselected (default)"
              />
              <a
                href={`/design?preview=draft&model=${encodeURIComponent(model.slug)}&${kind}=${styleId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-[#0088FF] hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Preview
              </a>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex gap-1 border-b border-[var(--acton-border)] px-5">
          {(
            [
              ["images", "Images"],
              ["pricing", "Pricing by Region"],
              ["details", "Details"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "border-b-2 px-3 py-2.5 text-sm font-semibold",
                tab === id
                  ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
                  : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "images" ? (
            kind === "exterior" ? (
              <div>
                <p className="mb-3 text-sm text-[var(--acton-muted)]">
                  The customer sees the rendering matching their porch choice
                  {ceilings.length > 1 ? " and ceiling height" : ""}. Drop an image on a slot, or
                  pick one from the library.
                </p>
                <div
                  className={cn(
                    "grid gap-3",
                    variants.length * ceilings.length > 2 ? "sm:grid-cols-2" : "sm:grid-cols-2",
                  )}
                >
                  {variants.flatMap((variant) =>
                    ceilings.map((ceiling) => (
                      <ImageSlot
                        key={`${variant}-${ceiling}`}
                        testId={`slot-ext-${variant}-${ceiling}`}
                        {...slotProps(
                          { type: "ext", styleId, variant, ceiling },
                          `${ceiling}-ft ceilings`,
                          variants.length > 1 ? VARIANT_LABEL[variant] : "Exterior",
                        )}
                      />
                    )),
                  )}
                </div>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-sm text-[var(--acton-muted)]">
                  Seven renderings per ceiling height. Slots marked red are shown to customers and
                  still missing.
                  {modelHasLightingUpgrade(model)
                    ? " Lighting Upgrade uses Lighting Dusk Uplights (not Lighting Dusk)."
                    : ""}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-xs text-[var(--acton-muted)]">
                        <th className="w-48 pb-2 font-semibold">Rendering</th>
                        {ceilings.map((c) => (
                          <th key={c} className="pb-2 font-semibold">
                            {c}-ft ceilings
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {INTERIOR_ROLES.map((role) => (
                        <tr key={role} className="align-top">
                          <td className="py-2 pr-3">
                            <p className="text-sm font-semibold text-[var(--acton-navy)]">
                              {ROLE_LABELS[role]}
                            </p>
                            <p className="text-xs text-[var(--acton-muted)]">{ROLE_USAGE[role]}</p>
                          </td>
                          {ceilings.map((ceiling) => (
                            <td key={ceiling} className="w-64 py-2 pr-3">
                              <ImageSlot
                                testId={`slot-int-${role}-${ceiling}`}
                                {...slotProps(
                                  { type: "int", styleId, role, ceiling },
                                  ROLE_LABELS[role],
                                  `${ceiling}-ft`,
                                )}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          ) : null}
          {tab === "pricing" ? (
            <RegionPriceEditor
              price={use.price}
              regions={catalog.regions}
              onChange={(price) => update({ price })}
              label={`${style.name} on ${model.name}`}
              allowZeroNote
              testId="style-price"
            />
          ) : null}
          {tab === "details" ? (
            <div className="space-y-4 text-sm">
              <p>
                <span className="font-semibold text-[var(--acton-navy)]">Shared style.</span> The
                name{style.kind === "interior" ? " and Style details board" : ""} are shared by
                every model that offers it; renderings, default and prices above belong to{" "}
                {model.name} only.{" "}
                <Link
                  href="/configurator/styles"
                  className="font-semibold text-[#0088FF] hover:underline"
                >
                  Edit the shared style
                </Link>
              </p>
              <p className="text-[var(--acton-muted)]">
                Also offered on: {usedIn.length ? usedIn.join(", ") : "no other models"}.
              </p>
              {style.kind === "interior" && style.detailsAssetId ? (
                <div>
                  <p className="mb-1 font-semibold text-[var(--acton-navy)]">Style details board</p>
                  <Thumb asset={assetById.get(style.detailsAssetId)} className="w-64 rounded-lg" />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  updateModel(model.id, (m) => ({
                    ...m,
                    [key]: m[key].filter((u) => u.styleId !== styleId),
                  }));
                  onClose();
                }}
                className="rounded-md border border-red-200 px-3 py-2 font-semibold text-red-700 hover:bg-red-50"
              >
                Remove {style.name} from {model.name}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

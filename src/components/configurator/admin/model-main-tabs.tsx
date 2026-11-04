"use client";

/* eslint-disable @next/next/no-img-element -- local object-URL previews */

import { CheckCircle2, ExternalLink, Loader2, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { classifyFilename } from "@/lib/configurator/filename-classifier";
import {
  computeQuote,
  formatUsd,
  priceInRegion,
  setRegionAmount,
} from "@/lib/configurator/pricing";
import {
  modelCeilings,
  modelSupportsNineFoot,
  modelVariants,
  requiredSlots,
  resolveSlot,
  ROLE_LABELS,
  slotKey,
  type Slot,
} from "@/lib/configurator/render";
import { defaultSelection } from "@/lib/configurator/selection";
import { describeSlot, validateModel, type Issue } from "@/lib/configurator/validate";
import {
  INTERIOR_ROLES,
  type AssetClassification,
  type CeilingHeight,
  type InteriorRole,
  type Model,
  type Price,
} from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import {
  Field,
  ImageSlot,
  IssueList,
  MoneyInput,
  Panel,
  Pill,
  TextInput,
  Thumb,
  Toggle,
  inputClass,
} from "./admin-ui";
import { classificationForSlot, rankForSlot, setRender, type ModelTab } from "./model-helpers";

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function OverviewTab({ model, onTab }: { model: Model; onTab: (tab: ModelTab) => void }) {
  const { catalog, updateModel, deleteModel } = useAdmin();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const issues = validateModel(catalog, model);
  const patch = (p: Partial<Model>) => updateModel(model.id, (m) => ({ ...m, ...p }));
  const slugTaken = catalog.models.some(
    (m) => m.id !== model.id && m.slug.toLowerCase() === model.slug.toLowerCase(),
  );
  const counts: { tab: ModelTab; label: string; n: number }[] = [
    { tab: "options", label: "Model Options", n: model.options.filter((o) => o.enabled).length },
    {
      tab: "exteriors",
      label: "Exterior Styles",
      n: model.exteriors.filter((u) => u.enabled).length,
    },
    {
      tab: "interiors",
      label: "Interior Styles",
      n: model.interiors.filter((u) => u.enabled).length,
    },
    { tab: "appliances", label: "Appliances", n: model.appliances.filter((a) => a.enabled).length },
    { tab: "upgrades", label: "Upgrades", n: model.upgrades.filter((u) => u.enabled).length },
    { tab: "bathrooms", label: "Bathrooms", n: model.bathrooms.filter((b) => b.enabled).length },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Panel
          title="Basic info"
          actions={
            <Toggle
              checked={model.status === "active"}
              onChange={(v) => patch({ status: v ? "active" : "inactive" })}
              label="Show to customers"
              testId="model-active"
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Model name">
              <TextInput
                value={model.name}
                onChange={(e) => patch({ name: e.target.value })}
                data-testid="model-name"
              />
            </Field>
            <Field label="Series">
              <select
                className={inputClass}
                value={model.seriesId}
                onChange={(e) => patch({ seriesId: e.target.value })}
              >
                {catalog.series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-3 sm:col-span-2">
              <Field label="Bedrooms">
                <TextInput
                  type="number"
                  min={0}
                  value={model.beds ?? ""}
                  onChange={(e) =>
                    patch({ beds: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Bathrooms">
                <TextInput
                  type="number"
                  min={0}
                  step={0.5}
                  value={model.baths ?? ""}
                  onChange={(e) =>
                    patch({ baths: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Square feet">
                <TextInput
                  type="number"
                  min={0}
                  value={model.sqft ?? ""}
                  onChange={(e) =>
                    patch({ sqft: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <Field
              label="Web address"
              hint={
                slugTaken ? (
                  <span className="text-red-700">Another model already uses this address.</span>
                ) : (
                  `design.actonadu.com/?model=${model.slug}`
                )
              }
            >
              <TextInput
                value={model.slug}
                onChange={(e) => patch({ slug: e.target.value.replace(/[^A-Za-z0-9-]/g, "-") })}
              />
            </Field>
            <Field
              label="Can I Build design name"
              hint="Passed to the property check so Can I Build can match this plan."
            >
              <TextInput
                value={model.canibuildDesignName}
                onChange={(e) => patch({ canibuildDesignName: e.target.value })}
              />
            </Field>
            <Field label="Description (internal notes)" className="sm:col-span-2">
              <textarea
                className={cn(inputClass, "h-20 py-2")}
                value={model.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-4 rounded-lg bg-[var(--acton-gray-50)] p-3">
            <Toggle
              checked={model.preApproved}
              onChange={(v) => patch({ preApproved: v })}
              label="Show the “Pre-approved” badge"
            />
            {model.preApproved ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Badge tooltip">
                  <TextInput
                    value={model.preApprovedTitle}
                    onChange={(e) => patch({ preApprovedTitle: e.target.value })}
                  />
                </Field>
                <Field label="Pre-approved cities" hint="Comma separated">
                  <TextInput
                    value={model.preApprovedCities.join(", ")}
                    onChange={(e) =>
                      patch({
                        preApprovedCities: e.target.value
                          .split(",")
                          .map((c) => c.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Floorplans"
          description="Shown with the Floorplan toggle on the first step. The mirrored plan is shown with “Mirror model”."
        >
          <div className="grid max-w-xl grid-cols-2 gap-3">
            {(["standard", "mirror"] as const).map((which) => (
              <ImageSlot
                key={which}
                label={which === "standard" ? "Floorplan" : "Mirrored floorplan"}
                assetId={model.floorplans[which]}
                onChange={(id) =>
                  updateModel(model.id, (m) => ({
                    ...m,
                    floorplans: { ...m.floorplans, [which]: id },
                  }))
                }
                classification={{
                  kind: "floorplan",
                  modelId: model.id,
                  styleId: null,
                  role: null,
                  ceiling: null,
                  variant: null,
                  mirror: which === "mirror",
                  bathroomName: null,
                  confidence: "high",
                  notes: ["Assigned by an admin"],
                }}
                suggest={(a) =>
                  (a.classification?.kind === "floorplan" ? 2 : 0) +
                  (a.classification?.modelId === model.id ? 2 : 0) +
                  (a.classification?.mirror === (which === "mirror") ? 1 : 0)
                }
                testId={`floorplan-${which}`}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Configurator sections">
          <div className="grid gap-3 sm:grid-cols-3">
            {counts.map((c) => (
              <button
                key={c.tab}
                type="button"
                onClick={() => onTab(c.tab)}
                className="rounded-lg border border-[var(--acton-border)] p-3 text-left hover:border-[var(--acton-navy)]"
              >
                <p className="font-semibold text-[var(--acton-navy)]">{c.label}</p>
                <p className="text-sm text-[var(--acton-muted)]">
                  {c.n === 0 && c.tab === "options" ? "None — step skipped" : `${c.n} offered`}
                </p>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel
          title="Readiness"
          description={
            issues.length ? "Fix these before this model's draft can go live." : undefined
          }
        >
          <IssueList issues={issues} onFix={(i: Issue) => i.tab && onTab(i.tab)} />
        </Panel>
        <Panel title="Danger zone">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" /> Delete model from draft
          </button>
          <p className="mt-2 text-xs text-[var(--acton-muted)]">
            Prefer “Show to customers” off to hide a model. A deleted model disappears from the live
            site at the next publish.
          </p>
        </Panel>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteModel(model.id);
          router.push("/configurator/models");
        }}
        title={`Delete ${model.name}?`}
        description="The model, its options, prices and image assignments are removed from the draft. Images stay in the media library."
        confirmLabel="Delete"
        destructive
        requireTypedPhrase={model.name}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing (this model)
// ---------------------------------------------------------------------------

type PriceRow = {
  key: string;
  group: string;
  label: string;
  price: Price;
  set: (p: Price) => void;
};

export function ModelPricingTab({ model }: { model: Model }) {
  const { catalog, updateModel } = useAdmin();
  const regions = catalog.regions;
  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");

  const rows: PriceRow[] = [
    {
      key: "base",
      group: "Model",
      label: "Starting price",
      price: model.basePrice,
      set: (p) => updateModel(model.id, (m) => ({ ...m, basePrice: p })),
    },
    ...(
      [
        ["options", "Model options"],
        ["appliances", "Appliances"],
        ["upgrades", "Upgrades"],
        ["bathrooms", "Bathrooms"],
      ] as const
    ).flatMap(([k, group]) =>
      [...model[k]]
        .filter((i) => i.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          key: `${k}:${item.id}`,
          group,
          label: item.name,
          price: item.price,
          set: (p: Price) =>
            updateModel(model.id, (m) => ({
              ...m,
              [k]: (m[k] as { id: string }[]).map((x) =>
                x.id === item.id ? { ...x, price: p } : x,
              ),
            })),
        })),
    ),
    ...(
      [
        ["exteriors", "Exterior styles"],
        ["interiors", "Interior styles"],
      ] as const
    ).flatMap(([k, group]) =>
      [...model[k]]
        .filter((u) => u.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((u) => ({
          key: `${k}:${u.styleId}`,
          group,
          label: styleName(u.styleId),
          price: u.price,
          set: (p: Price) =>
            updateModel(model.id, (m) => ({
              ...m,
              [k]: m[k].map((x) => (x.styleId === u.styleId ? { ...x, price: p } : x)),
            })),
        })),
    ),
  ];

  const review = rows.filter((r) => r.price.needsReview).length;
  const selection = defaultSelection(model);
  const quote = regionId ? computeQuote(catalog, model, selection, regionId) : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
      <Panel
        title="Pricing by Region"
        description="Every price for this model in one place. These are the same values as each style's Pricing by Region tab and the bulk pricing grid."
        actions={
          review ? (
            <button
              type="button"
              onClick={() =>
                rows.forEach(
                  (r) => r.price.needsReview && r.set({ ...r.price, needsReview: false }),
                )
              }
              className="h-9 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900"
              data-testid="mark-all-reviewed"
            >
              Mark all {review} as reviewed
            </button>
          ) : (
            <Pill tone="green">All prices reviewed</Pill>
          )
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--acton-border)] text-left text-xs text-[var(--acton-muted)]">
                <th className="py-2 pr-3 font-semibold">Item</th>
                {regions.map((r) => (
                  <th key={r.id} className="px-2 py-2 font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
                      {r.name}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2 font-semibold">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b border-[var(--acton-border)]",
                    row.price.needsReview ? "bg-amber-50/50" : "",
                  )}
                >
                  <td className="py-1.5 pr-3">
                    {i === 0 || rows[i - 1]!.group !== row.group ? (
                      <p className="text-[10px] font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                        {row.group}
                      </p>
                    ) : null}
                    <p className="font-medium text-[var(--acton-navy)]">{row.label}</p>
                  </td>
                  {regions.map((r) => (
                    <td key={r.id} className="w-40 px-2 py-1.5">
                      <MoneyInput
                        value={priceInRegion(row.price, r.id)}
                        onChange={(v) => row.set(setRegionAmount(row.price, r.id, v))}
                        placeholder="Not set"
                        ariaLabel={`${row.label} in ${r.name}`}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${row.label} reviewed`}
                      checked={!row.price.needsReview}
                      onChange={(e) => row.set({ ...row.price, needsReview: !e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title="Customer total preview"
        description="Starting price with this model's default choices."
      >
        <select
          className={inputClass}
          value={regionId}
          onChange={(e) => setRegionId(e.target.value)}
          aria-label="Region"
        >
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {quote ? (
          <div className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Starting price</span>
              <span className="tabular-nums">{formatUsd(quote.base)}</span>
            </div>
            {quote.lines.map((l, i) => (
              <div key={i} className="flex justify-between text-[var(--acton-muted)]">
                <span>{l.label}</span>
                <span className="tabular-nums">
                  {l.amount >= 0 ? "+" : ""}
                  {formatUsd(l.amount)}
                </span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t border-[var(--acton-border)] pt-2 text-base font-bold text-[var(--acton-navy)]">
              <span>Starting at</span>
              <span className="tabular-nums" data-testid="preview-total">
                {formatUsd(quote.total)}
              </span>
            </div>
            {quote.monthly !== null ? (
              <p className="text-right text-xs text-[var(--acton-muted)]">
                As little as {formatUsd(quote.monthly)}/mo with financing
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-amber-800">
            Some prices are missing for this region, so customers would see no price.
          </p>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Images: coverage matrix + smart batch upload
// ---------------------------------------------------------------------------

export function ImagesTab({ model }: { model: Model }) {
  const { catalog, updateModel, assetById } = useAdmin();
  const [slotDialog, setSlotDialog] = useState<Slot | null>(null);
  const [batch, setBatch] = useState<File[] | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const required = requiredSlots(model, catalog.settings.upgradeSelection);
  const requiredKeys = new Set(required.map((r) => r.key));
  const missing = required.filter((r) => !resolveSlot(model, r.slot).assetId);
  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;
  const ceilings = modelCeilings(model);
  const variants = modelVariants(model);
  const exteriors = model.exteriors
    .filter((u) => u.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const interiors = model.interiors
    .filter((u) => u.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const bathrooms = model.bathrooms.filter((b) => b.enabled);

  const cell = (slot: Slot, cellKey: string) => {
    const key = slotKey(slot);
    const resolved = resolveSlot(model, slot);
    const isRequired = requiredKeys.has(key);
    if (onlyMissing && (resolved.assetId || !isRequired))
      return <td key={cellKey} className="p-1" />;
    return (
      <td key={cellKey} className="p-1">
        <button
          type="button"
          onClick={() => setSlotDialog(slot)}
          title={describeSlot(catalog, model, slot)}
          className={cn(
            "relative block h-12 w-20 overflow-hidden rounded border",
            resolved.assetId
              ? resolved.usedFallback
                ? "border-amber-400"
                : "border-emerald-300"
              : isRequired
                ? "border-red-300 bg-red-50"
                : "border-dashed border-gray-200 bg-gray-50",
          )}
        >
          {resolved.assetId ? (
            <Thumb
              asset={assetById.get(resolved.assetId)}
              className={cn("h-full w-full", resolved.usedFallback ? "opacity-60 grayscale" : "")}
            />
          ) : (
            <span className="text-[10px] text-red-500">{isRequired ? "Missing" : "Optional"}</span>
          )}
        </button>
      </td>
    );
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Rendering coverage"
        description={`${required.length - missing.length} of ${required.length} renderings the customer flow can show are in place. Click any cell to upload or choose an image.`}
        actions={
          <>
            <Toggle checked={onlyMissing} onChange={setOnlyMissing} label="Only missing" />
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-[var(--acton-navy)] px-3 text-sm font-semibold text-white">
              <Upload className="h-4 w-4" /> Upload a batch
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => (
                  e.target.files?.length ? setBatch([...e.target.files]) : null,
                  (e.target.value = "")
                )}
              />
            </label>
          </>
        }
      >
        {modelSupportsNineFoot(model) ? (
          <div className="mb-4 rounded-lg bg-[var(--acton-gray-50)] p-3">
            <Toggle
              checked={model.ceilingFallback}
              onChange={(v) => updateModel(model.id, (m) => ({ ...m, ceilingFallback: v }))}
              label="When a 9-ft rendering is missing, show the 8-ft one"
            />
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Off by default so missing 9-ft images are never hidden. Turn on only if showing the
              8-ft image is acceptable; each case still shows as a warning.
            </p>
          </div>
        ) : null}

        <h3 className="mb-2 text-sm font-semibold text-[var(--acton-navy)]">Exteriors</h3>
        <div className="mb-5 overflow-x-auto">
          <table>
            <thead>
              <tr className="text-left text-[11px] text-[var(--acton-muted)]">
                <th className="pr-3 font-semibold">Style</th>
                {variants.flatMap((v) =>
                  ceilings.map((c) => (
                    <th
                      key={`${v}${c}`}
                      className="px-1 font-semibold"
                    >{`${variants.length > 1 ? (v === "porch" ? "Porch " : "Std ") : ""}${c} ft`}</th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {exteriors.map((u) => (
                <tr key={u.styleId}>
                  <td className="pr-3 text-sm whitespace-nowrap">{styleName(u.styleId)}</td>
                  {variants.flatMap((variant) =>
                    ceilings.map((ceiling) =>
                      cell(
                        { type: "ext", styleId: u.styleId, variant, ceiling },
                        `${variant}${ceiling}`,
                      ),
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mb-2 text-sm font-semibold text-[var(--acton-navy)]">Interiors</h3>
        <div className="mb-5 overflow-x-auto">
          <table>
            <thead>
              <tr className="text-left text-[11px] text-[var(--acton-muted)]">
                <th className="pr-3 font-semibold">Style</th>
                {INTERIOR_ROLES.flatMap((role) =>
                  ceilings.map((c) => (
                    <th
                      key={`${role}${c}`}
                      className="px-1 font-semibold whitespace-nowrap"
                    >{`${ROLE_LABELS[role].replace("Lighting ", "")} ${c}′`}</th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {interiors.map((u) => (
                <tr key={u.styleId}>
                  <td className="pr-3 text-sm whitespace-nowrap">{styleName(u.styleId)}</td>
                  {INTERIOR_ROLES.flatMap((role) =>
                    ceilings.map((ceiling) =>
                      cell({ type: "int", styleId: u.styleId, role, ceiling }, `${role}${ceiling}`),
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {bathrooms.length ? (
          <>
            <h3 className="mb-2 text-sm font-semibold text-[var(--acton-navy)]">Bathrooms</h3>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr className="text-left text-[11px] text-[var(--acton-muted)]">
                    <th className="pr-3 font-semibold">Interior style</th>
                    {bathrooms.map((b) => (
                      <th key={b.id} className="px-1 font-semibold">
                        {b.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {interiors.map((u) => (
                    <tr key={u.styleId}>
                      <td className="pr-3 text-sm whitespace-nowrap">{styleName(u.styleId)}</td>
                      {bathrooms.map((b) =>
                        cell({ type: "bath", styleId: u.styleId, bathroomId: b.id }, b.id),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Panel>

      {missing.length ? (
        <Panel title={`Missing renderings (${missing.length})`}>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {missing.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  className="text-left text-[var(--acton-navy)] hover:underline"
                  onClick={() => setSlotDialog(m.slot)}
                >
                  {describeSlot(catalog, model, m.slot)}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {slotDialog ? (
        <Dialog open onClose={() => setSlotDialog(null)}>
          <DialogHeader>
            <DialogTitle>{describeSlot(catalog, model, slotDialog)}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <ImageSlot
              label={
                slotDialog.type === "int"
                  ? ROLE_LABELS[slotDialog.role]
                  : slotDialog.type === "ext"
                    ? `${slotDialog.ceiling}-ft exterior`
                    : "Bathroom"
              }
              sublabel={styleName(slotDialog.styleId)}
              assetId={model.renders[slotKey(slotDialog)] ?? null}
              onChange={(id) => updateModel(model.id, (m) => setRender(m, slotDialog, id))}
              classification={classificationForSlot(
                model,
                slotDialog,
                slotDialog.type === "bath"
                  ? model.bathrooms.find((b) => b.id === slotDialog.bathroomId)?.name
                  : undefined,
              )}
              suggest={rankForSlot(model, slotDialog)}
              required={requiredKeys.has(slotKey(slotDialog))}
            />
          </DialogBody>
        </Dialog>
      ) : null}

      {batch ? (
        <BatchUploadDialog model={model} files={batch} onClose={() => setBatch(null)} />
      ) : null}
    </div>
  );
}

type BatchRow = {
  file: File;
  url: string;
  kind: "exterior" | "interior" | "bathroom" | "floorplan" | "skip";
  styleId: string;
  role: InteriorRole;
  ceiling: CeilingHeight;
  variant: "standard" | "porch";
  mirror: boolean;
  bathroomId: string;
  reason: string;
  confidence: "high" | "medium" | "low";
};

/** Drop many renderings at once; file names are read to suggest where each goes. */
export function BatchUploadDialog({
  model,
  files,
  onClose,
}: {
  model: Model;
  files: File[];
  onClose: () => void;
}) {
  const { catalog, uploadImage, updateModel } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const styles = catalog.styles.map((s) => ({ id: s.id, name: s.name, kind: s.kind }));
  const [rows, setRows] = useState<BatchRow[]>(() =>
    files.map((file) => {
      const g = classifyFilename(file.name, styles);
      const bathroom =
        model.bathrooms.find((b) =>
          g.bathroomHint === "tub" ? /tub/i.test(b.name) : /shower/i.test(b.name),
        ) ?? model.bathrooms[0];
      return {
        file,
        url: URL.createObjectURL(file),
        kind: g.kind === "unknown" ? "skip" : g.kind,
        styleId: g.styleId ?? "",
        role: g.role ?? "kitchen",
        ceiling: g.ceiling,
        variant: g.variant,
        mirror: g.mirror,
        bathroomId: bathroom?.id ?? "",
        reason: g.reason,
        confidence: g.confidence,
      };
    }),
  );
  const update = (i: number, patch: Partial<BatchRow>) =>
    setRows((list) => list.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const ready = rows.filter((r) => r.kind !== "skip" && (r.kind === "floorplan" || r.styleId));

  const run = async () => {
    setBusy(true);
    const failed: string[] = [];
    let count = 0;
    for (const row of ready) {
      const slot: Slot | null =
        row.kind === "exterior"
          ? { type: "ext", styleId: row.styleId, variant: row.variant, ceiling: row.ceiling }
          : row.kind === "interior"
            ? { type: "int", styleId: row.styleId, role: row.role, ceiling: row.ceiling }
            : row.kind === "bathroom" && row.bathroomId
              ? { type: "bath", styleId: row.styleId, bathroomId: row.bathroomId }
              : null;
      const classification: AssetClassification = slot
        ? classificationForSlot(
            model,
            slot,
            model.bathrooms.find((b) => b.id === row.bathroomId)?.name,
          )
        : {
            kind: "floorplan",
            modelId: model.id,
            styleId: null,
            role: null,
            ceiling: null,
            variant: null,
            mirror: row.mirror,
            bathroomName: null,
            confidence: "high",
            notes: ["Batch upload"],
          };
      try {
        const asset = await uploadImage(row.file, classification);
        if (slot) updateModel(model.id, (m) => setRender(m, slot, asset.id));
        else
          updateModel(model.id, (m) => ({
            ...m,
            floorplans: { ...m.floorplans, [row.mirror ? "mirror" : "standard"]: asset.id },
          }));
        count++;
        setDone(count);
      } catch (e) {
        failed.push(`${row.file.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setErrors(failed);
    setBusy(false);
    if (failed.length === 0) onClose();
  };

  const ext = catalog.styles.filter((s) => s.kind === "exterior");
  const int = catalog.styles.filter((s) => s.kind === "interior");
  const select = "h-8 rounded border border-[var(--acton-border)] px-1 text-xs";

  return (
    <Dialog open onClose={() => !busy && onClose()} size="lg">
      <DialogHeader>
        <DialogTitle>
          Upload {files.length} images to {model.name}
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p className="mb-3 text-sm text-[var(--acton-muted)]">
          We read each file name to suggest where it goes. Check the suggestions, adjust anything
          that looks wrong, then upload. Nothing is assigned until you confirm.
        </p>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <div
              key={i}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-lg border p-2",
                r.kind === "skip"
                  ? "border-dashed opacity-60"
                  : r.confidence === "high"
                    ? "border-emerald-200"
                    : "border-amber-200",
              )}
            >
              <img src={r.url} alt="" className="h-12 w-20 rounded object-cover" />
              <div className="w-44 min-w-0">
                <p className="truncate text-xs font-semibold" title={r.file.name}>
                  {r.file.name}
                </p>
                <p className="truncate text-[11px] text-[var(--acton-muted)]">{r.reason}</p>
              </div>
              <select
                className={select}
                value={r.kind}
                onChange={(e) => update(i, { kind: e.target.value as BatchRow["kind"] })}
              >
                <option value="exterior">Exterior</option>
                <option value="interior">Interior</option>
                <option value="bathroom">Bathroom</option>
                <option value="floorplan">Floorplan</option>
                <option value="skip">Skip</option>
              </select>
              {r.kind === "exterior" || r.kind === "interior" || r.kind === "bathroom" ? (
                <select
                  className={select}
                  value={r.styleId}
                  onChange={(e) => update(i, { styleId: e.target.value })}
                >
                  <option value="">Choose style…</option>
                  {(r.kind === "exterior" ? ext : int).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {r.kind === "interior" ? (
                <select
                  className={select}
                  value={r.role}
                  onChange={(e) => update(i, { role: e.target.value as InteriorRole })}
                >
                  {INTERIOR_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              ) : null}
              {r.kind === "exterior" && modelVariants(model).length > 1 ? (
                <select
                  className={select}
                  value={r.variant}
                  onChange={(e) => update(i, { variant: e.target.value as BatchRow["variant"] })}
                >
                  <option value="standard">Standard</option>
                  <option value="porch">Porch</option>
                </select>
              ) : null}
              {(r.kind === "exterior" || r.kind === "interior") && modelSupportsNineFoot(model) ? (
                <select
                  className={select}
                  value={r.ceiling}
                  onChange={(e) => update(i, { ceiling: e.target.value as CeilingHeight })}
                >
                  <option value="8">8 ft</option>
                  <option value="9">9 ft</option>
                </select>
              ) : null}
              {r.kind === "bathroom" ? (
                <select
                  className={select}
                  value={r.bathroomId}
                  onChange={(e) => update(i, { bathroomId: e.target.value })}
                >
                  {model.bathrooms.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {r.kind === "floorplan" ? (
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={r.mirror}
                    onChange={(e) => update(i, { mirror: e.target.checked })}
                  />{" "}
                  Mirrored
                </label>
              ) : null}
            </div>
          ))}
        </div>
        {errors.length ? <p className="mt-2 text-sm text-red-700">{errors.join(" · ")}</p> : null}
      </DialogBody>
      <DialogFooter>
        <span className="mr-auto text-sm text-[var(--acton-muted)]">
          {busy ? `Uploaded ${done} of ${ready.length}…` : `${ready.length} ready to upload`}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="h-10 rounded-md px-4 text-sm font-semibold text-[var(--acton-muted)] hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || ready.length === 0}
          onClick={() => void run()}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}{" "}
          Upload &amp; assign
        </button>
      </DialogFooter>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export function PreviewTab({ model }: { model: Model }) {
  const { catalog, dirtyCount } = useAdmin();
  const issues = useMemo(() => validateModel(catalog, model), [catalog, model]);
  const url = `/design?preview=draft&model=${encodeURIComponent(model.slug)}`;
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-4">
      <Panel
        title="Customer preview"
        description={
          dirtyCount
            ? "Save the draft to see your latest changes here."
            : "This is the real customer configurator using your saved draft. Customers still see the published version."
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setKey((k) => k + 1)}
              className="h-9 rounded-md border border-[var(--acton-border)] px-3 text-sm font-semibold"
            >
              Reload
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-md bg-[var(--acton-navy)] px-3 text-sm font-semibold text-white"
            >
              <ExternalLink className="h-4 w-4" /> Open full screen
            </a>
          </>
        }
      >
        <div className="overflow-hidden rounded-lg border border-[var(--acton-border)]">
          <iframe
            key={key}
            src={url}
            title={`${model.name} preview`}
            className="h-[720px] w-full"
            data-testid="model-preview-frame"
          />
        </div>
      </Panel>
      <Panel title="Publishing checks">
        <IssueList issues={issues} />
        {model.status !== "active" ? (
          <p className="mt-2 text-sm text-amber-800">
            This model is hidden from customers. Turn on “Show to customers” on the Overview tab to
            publish it.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

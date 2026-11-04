"use client";

import { Check, ExternalLink, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { newModel } from "@/lib/configurator/defaults";
import { priceInRegion, setRegionAmount } from "@/lib/configurator/pricing";
import { requiredSlots, resolveSlot } from "@/lib/configurator/render";
import type { Model } from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { PageHeader } from "./admin-shell";
import { Field, MoneyInput, Panel, TextInput, Toggle, inputClass } from "./admin-ui";
import { BatchUploadDialog } from "./model-main-tabs";

const STEPS = ["Basics", "Options & styles", "Renderings", "Pricing", "Preview & publish"];

export function NewModelWizard() {
  const { catalog, putModel, updateModel, save, saving, dirtyCount } = useAdmin();
  const [step, setStep] = useState(0);
  const [modelId, setModelId] = useState<string | null>(null);
  const [basics, setBasics] = useState({
    name: "",
    seriesId: catalog.series[0]?.id ?? "",
    beds: "",
    baths: "",
    sqft: "",
  });
  const [porch, setPorch] = useState(false);
  const [exteriors, setExteriors] = useState<string[]>(
    catalog.styles.filter((s) => s.kind === "exterior" && !s.archived).map((s) => s.id),
  );
  const [interiors, setInteriors] = useState<string[]>(
    catalog.styles.filter((s) => s.kind === "interior" && !s.archived).map((s) => s.id),
  );
  const [template, setTemplate] = useState<string>(
    catalog.models.find((m) => m.seriesId === basics.seriesId)?.id ?? "",
  );
  const [batch, setBatch] = useState<File[] | null>(null);
  const model = modelId ? catalog.models.find((m) => m.id === modelId) : null;

  const create = () => {
    const created = newModel(
      {
        name: basics.name.trim(),
        seriesId: basics.seriesId,
        beds: basics.beds ? Number(basics.beds) : null,
        baths: basics.baths ? Number(basics.baths) : null,
        sqft: basics.sqft ? Number(basics.sqft) : null,
        exteriorStyleIds: exteriors,
        interiorStyleIds: interiors,
        withPorchOption: porch,
      },
      catalog,
    );
    const source = catalog.models.find((m) => m.id === template);
    const finalModel: Model = source
      ? {
          ...created,
          // Reuse the template's appliance packages, upgrades and bathrooms (with prices to review).
          appliances: structuredClone(source.appliances).map((a) => ({
            ...a,
            price: { ...a.price, needsReview: true },
          })),
          upgrades: structuredClone(source.upgrades).map((u) => ({
            ...u,
            price: { ...u.price, needsReview: true },
          })),
          bathrooms: structuredClone(source.bathrooms).map((b) => ({
            ...b,
            price: { ...b.price, needsReview: true },
          })),
          exteriors: created.exteriors.map((u) => {
            const t = source.exteriors.find((x) => x.styleId === u.styleId);
            return t ? { ...u, price: { ...t.price, needsReview: true } } : u;
          }),
          interiors: created.interiors.map((u) => {
            const t = source.interiors.find((x) => x.styleId === u.styleId);
            return t ? { ...u, price: { ...t.price, needsReview: true } } : u;
          }),
        }
      : created;
    putModel(finalModel);
    setModelId(finalModel.id);
    setStep(2);
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        title="Add a model"
        description="A guided setup. You can change anything later from the model's workspace."
        back={{ href: "/configurator/models", label: "Models" }}
      />
      <ol className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold",
              i === step
                ? "bg-[var(--acton-navy)] text-white"
                : i < step
                  ? "bg-emerald-100 text-emerald-900"
                  : "bg-white text-[var(--acton-muted)] ring-1 ring-[var(--acton-border)]",
            )}
          >
            {i < step ? <Check className="h-4 w-4" /> : <span>{i + 1}</span>}
            {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Panel title="Basic information">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Model name" hint="As customers see it, e.g. “Manzanita i448 A1”">
              <TextInput
                value={basics.name}
                onChange={(e) => setBasics({ ...basics, name: e.target.value })}
                autoFocus
                data-testid="wizard-name"
              />
            </Field>
            <Field label="Series">
              <select
                className={inputClass}
                value={basics.seriesId}
                onChange={(e) => setBasics({ ...basics, seriesId: e.target.value })}
              >
                {catalog.series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bedrooms">
              <TextInput
                type="number"
                min={0}
                value={basics.beds}
                onChange={(e) => setBasics({ ...basics, beds: e.target.value })}
              />
            </Field>
            <Field label="Bathrooms">
              <TextInput
                type="number"
                min={0}
                step={0.5}
                value={basics.baths}
                onChange={(e) => setBasics({ ...basics, baths: e.target.value })}
              />
            </Field>
            <Field label="Square feet">
              <TextInput
                type="number"
                min={0}
                value={basics.sqft}
                onChange={(e) => setBasics({ ...basics, sqft: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={!basics.name.trim() || !basics.seriesId}
              onClick={() => setStep(1)}
              className="h-10 rounded-md bg-[var(--acton-navy)] px-5 text-sm font-semibold text-white disabled:opacity-50"
              data-testid="wizard-next"
            >
              Next
            </button>
          </div>
        </Panel>
      ) : null}

      {step === 1 ? (
        <Panel title="Options and styles">
          <div className="space-y-5">
            <div>
              <Toggle
                checked={porch}
                onChange={setPorch}
                label="Offer “Standard” and “With Porch” model options"
              />
              <p className="mt-1 text-xs text-[var(--acton-muted)]">
                Without options, customers skip straight to Exterior Styles.
              </p>
            </div>
            <Field
              label="Start appliances, upgrades, bathrooms and style prices from"
              hint="Copied as a starting point and marked “needs review”."
            >
              <select
                className={inputClass}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                <option value="">Defaults (Lifestyle/Premium, Lighting Upgrade, Shower Pan)</option>
                {catalog.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            {(["exterior", "interior"] as const).map((kind) => {
              const selected = kind === "exterior" ? exteriors : interiors;
              const setSelected = kind === "exterior" ? setExteriors : setInteriors;
              return (
                <div key={kind}>
                  <p className="mb-2 text-sm font-semibold text-[var(--acton-navy)]">
                    {kind === "exterior" ? "Exterior styles" : "Interior styles"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {catalog.styles
                      .filter((s) => s.kind === kind && !s.archived)
                      .map((s) => {
                        const on = selected.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() =>
                              setSelected(
                                on ? selected.filter((x) => x !== s.id) : [...selected, s.id],
                              )
                            }
                            className={cn(
                              "rounded-full px-3 py-1 text-sm ring-1",
                              on
                                ? "bg-sky-50 text-sky-900 ring-sky-300"
                                : "bg-white text-[var(--acton-muted)] ring-[var(--acton-border)]",
                            )}
                          >
                            {on ? "✓ " : ""}
                            {s.name}
                          </button>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="h-10 rounded-md px-4 text-sm font-semibold text-[var(--acton-muted)] hover:bg-gray-100"
            >
              Back
            </button>
            <button
              type="button"
              onClick={create}
              disabled={!exteriors.length || !interiors.length}
              className="h-10 rounded-md bg-[var(--acton-navy)] px-5 text-sm font-semibold text-white disabled:opacity-50"
              data-testid="wizard-create"
            >
              Create model
            </button>
          </div>
        </Panel>
      ) : null}

      {step === 2 && model ? (
        <Panel
          title="Renderings"
          description="Drop all of this model's renderings at once. File names are read to suggest where each image goes, and you confirm before anything is assigned."
        >
          {(() => {
            const req = requiredSlots(model, catalog.settings.upgradeSelection);
            const have = req.filter((r) => resolveSlot(model, r.slot).assetId).length;
            return (
              <p className="mb-4 text-sm">
                {have} of {req.length} renderings in place.
              </p>
            );
          })()}
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--acton-border)] p-10 text-center hover:border-[var(--acton-navy)]">
            <Upload className="h-8 w-8 text-[var(--acton-muted)]" />
            <span className="font-semibold text-[var(--acton-navy)]">
              Choose renderings, floorplans and bathroom images
            </span>
            <span className="text-xs text-[var(--acton-muted)]">JPG, PNG or WEBP</span>
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
          <p className="mt-3 text-xs text-[var(--acton-muted)]">
            You can also add images one slot at a time later from the model&apos;s Exteriors,
            Interiors, Bathrooms and Images tabs.
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="h-10 rounded-md bg-[var(--acton-navy)] px-5 text-sm font-semibold text-white"
            >
              Next: pricing
            </button>
          </div>
          {batch ? (
            <BatchUploadDialog model={model} files={batch} onClose={() => setBatch(null)} />
          ) : null}
        </Panel>
      ) : null}

      {step === 3 && model ? (
        <Panel
          title="Starting price by region"
          description="Option and style prices can be adjusted on the model's Pricing tab or in the bulk pricing grid."
        >
          <div className="max-w-md space-y-2">
            {catalog.regions.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_180px] items-center gap-3">
                <span className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
                  {r.name}
                </span>
                <MoneyInput
                  value={priceInRegion(model.basePrice, r.id)}
                  onChange={(v) =>
                    updateModel(model.id, (m) => ({
                      ...m,
                      basePrice: { ...setRegionAmount(m.basePrice, r.id, v), needsReview: false },
                    }))
                  }
                  placeholder="Not set"
                  ariaLabel={`Starting price in ${r.name}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="h-10 rounded-md px-4 text-sm font-semibold text-[var(--acton-muted)] hover:bg-gray-100"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void save().then((ok) => ok && setStep(4))}
              disabled={saving}
              className="h-10 rounded-md bg-[var(--acton-navy)] px-5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save draft &amp; continue
            </button>
          </div>
        </Panel>
      ) : null}

      {step === 4 && model ? (
        <Panel title={`${model.name} is saved as a draft`}>
          <p className="text-sm">
            It is hidden from customers until you turn on “Show to customers” and publish. Next
            steps:
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={`/design?preview=draft&model=${encodeURIComponent(model.slug)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--acton-border)] px-4 text-sm font-semibold"
            >
              <ExternalLink className="h-4 w-4" /> Preview as a customer
            </a>
            <Link
              href={`/configurator/models/${model.id}`}
              className="inline-flex h-10 items-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
            >
              Open workspace
            </Link>
            <Link
              href="/configurator/publish"
              className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] px-4 text-sm font-semibold"
            >
              Review &amp; publish
            </Link>
          </div>
          {dirtyCount ? (
            <p className="mt-3 text-sm text-amber-800">You have unsaved changes.</p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

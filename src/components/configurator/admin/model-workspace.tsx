"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { modelHeroAssetId } from "@/lib/configurator/render";
import { validateModel } from "@/lib/configurator/validate";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { Pill, Thumb } from "./admin-ui";
import { STATUS_PILL, useModelStatus } from "./dashboard";
import { MODEL_TABS, type ModelTab } from "./model-helpers";
import { AppliancesTab, BathroomsTab, OptionsTab, UpgradesTab } from "./model-item-tabs";
import { ImagesTab, ModelPricingTab, OverviewTab, PreviewTab } from "./model-main-tabs";
import { StylesTab } from "./style-tabs";

export function ModelWorkspace({ modelId }: { modelId: string }) {
  const { catalog, assetById } = useAdmin();
  const statusOf = useModelStatus();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (MODEL_TABS.find((t) => t.id === params.get("tab"))?.id ?? "overview") as ModelTab;
  const model = catalog.models.find((m) => m.id === modelId);

  if (!model) {
    return (
      <div className="p-10 text-center">
        <p className="text-lg font-semibold text-[var(--acton-navy)]">
          This model is not in the draft.
        </p>
        <Link
          href="/configurator/models"
          className="mt-2 inline-block text-sm font-semibold text-[#0088FF] hover:underline"
        >
          Back to models
        </Link>
      </div>
    );
  }

  const setTab = (next: ModelTab) => router.replace(`${pathname}?tab=${next}`, { scroll: false });
  const issues = validateModel(catalog, model);
  const tabErrors = (t: ModelTab) =>
    issues.filter((i) => i.severity === "error" && i.tab === t).length;
  const status = STATUS_PILL[statusOf(model)];
  const series = catalog.series.find((s) => s.id === model.seriesId);

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <Link
        href="/configurator/models"
        className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
      >
        ← Models
      </Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-4">
        <Thumb
          asset={assetById.get(modelHeroAssetId(model) ?? "")}
          className="h-20 w-36 rounded-lg"
          alt={model.name}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className="text-2xl font-bold text-[var(--acton-navy)]"
              data-testid="workspace-title"
            >
              {model.name}
            </h1>
            <Pill tone={status.tone}>{status.text}</Pill>
            {model.status !== "active" ? <Pill tone="gray">Hidden from customers</Pill> : null}
          </div>
          <p className="text-sm text-[var(--acton-muted)]">
            {series?.name ?? "No series"} · {model.beds ?? "?"} Bed · {model.baths ?? "?"} Bath ·{" "}
            {model.sqft ?? "?"} sq ft
          </p>
        </div>
        <a
          href={`/design?preview=draft&model=${encodeURIComponent(model.slug)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-gray-50"
        >
          <ExternalLink className="h-4 w-4" /> Preview configurator
        </a>
      </div>

      <div
        className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--acton-border)]"
        role="tablist"
      >
        {MODEL_TABS.map((t) => {
          const errors = tabErrors(t.id);
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap",
                tab === t.id
                  ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
                  : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
              )}
            >
              {t.label}
              {errors ? (
                <span className="rounded-full bg-red-100 px-1.5 text-[11px] text-red-700">
                  {errors}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? <OverviewTab model={model} onTab={setTab} /> : null}
      {tab === "options" ? <OptionsTab model={model} /> : null}
      {tab === "exteriors" ? <StylesTab model={model} kind="exterior" /> : null}
      {tab === "interiors" ? <StylesTab model={model} kind="interior" /> : null}
      {tab === "appliances" ? <AppliancesTab model={model} /> : null}
      {tab === "upgrades" ? <UpgradesTab model={model} /> : null}
      {tab === "bathrooms" ? <BathroomsTab model={model} /> : null}
      {tab === "pricing" ? <ModelPricingTab model={model} /> : null}
      {tab === "images" ? <ImagesTab model={model} /> : null}
      {tab === "preview" ? <PreviewTab model={model} /> : null}
    </div>
  );
}

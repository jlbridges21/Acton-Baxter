"use client";

import {
  Copy,
  ExternalLink,
  Image as ImageIcon,
  MapPin,
  Palette,
  Plus,
  Search,
  Table2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { duplicateModel } from "@/lib/configurator/defaults";
import { modelHeroAssetId } from "@/lib/configurator/render";
import { modelReadiness } from "@/lib/configurator/validate";
import type { Model } from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { PageHeader } from "./admin-shell";
import { Pill, TextInput, Thumb } from "./admin-ui";

function stripRev<T extends { rev: number }>(value: T): Omit<T, "rev"> {
  const { rev: _rev, ...rest } = value;
  return rest;
}

export function useModelStatus() {
  const { live } = useAdmin();
  return (model: Model): "live" | "changed" | "unpublished" | "off" => {
    const liveModel = live?.catalog.models.find((m) => m.id === model.id && m.status === "active");
    if (model.status !== "active") return liveModel ? "changed" : "off";
    if (!liveModel) return "unpublished";
    return JSON.stringify(stripRev(liveModel)) === JSON.stringify(stripRev(model))
      ? "live"
      : "changed";
  };
}

export const STATUS_PILL = {
  live: { tone: "green" as const, text: "Live" },
  changed: { tone: "blue" as const, text: "Draft changes" },
  unpublished: { tone: "amber" as const, text: "Not published" },
  off: { tone: "gray" as const, text: "Hidden" },
};

export function Dashboard({ focus = "dashboard" }: { focus?: "dashboard" | "models" }) {
  const { catalog, assetById, issues, live } = useAdmin();
  const statusOf = useModelStatus();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState<string>("all");
  const [filter, setFilter] = useState<"all" | "attention" | "live" | "unpublished">("all");
  const [duplicating, setDuplicating] = useState<Model | null>(null);

  const readiness = useMemo(
    () => new Map(catalog.models.map((m) => [m.id, modelReadiness(catalog, m)])),
    [catalog],
  );
  const models = catalog.models
    .filter((m) => series === "all" || m.seriesId === series)
    .filter((m) => !query || m.name.toLowerCase().includes(query.toLowerCase()))
    .filter((m) => {
      const r = readiness.get(m.id)!;
      if (filter === "attention") return r.errors > 0;
      if (filter === "live") return statusOf(m) === "live";
      if (filter === "unpublished") return statusOf(m) !== "live";
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const totals = useMemo(() => {
    let required = 0;
    let present = 0;
    let review = 0;
    for (const r of readiness.values()) {
      required += r.images.required;
      present += r.images.present;
      review += r.pricing.needsReview;
    }
    return { required, present, review };
  }, [readiness]);
  const blocking = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title={focus === "models" ? "Models" : "Configurator"}
        description={
          focus === "models"
            ? "Every ADU model in the customer configurator."
            : "Manage models, renderings, styles and regional pricing. Changes stay in draft until you publish."
        }
        actions={
          <>
            <a
              href="/design?preview=draft"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-gray-50"
            >
              <ExternalLink className="h-4 w-4" /> Preview configurator
            </a>
            <Link
              href="/configurator/models/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)]"
              data-testid="add-model"
            >
              <Plus className="h-4 w-4" /> Add model
            </Link>
          </>
        }
      />

      {focus === "dashboard" ? (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Models live"
              value={`${catalog.models.filter((m) => statusOf(m) === "live").length} / ${catalog.models.length}`}
              sub={
                live
                  ? `Version ${live.version} · ${new Date(live.publishedAt).toLocaleDateString()}`
                  : "Nothing published yet"
              }
            />
            <Stat
              label="Renderings"
              value={`${totals.required ? Math.round((totals.present / totals.required) * 100) : 0}%`}
              sub={`${totals.present} of ${totals.required} needed images`}
              href="/configurator/media"
            />
            <Stat
              label="Prices to review"
              value={String(totals.review)}
              sub="Imported or placeholder prices"
              href="/configurator/pricing?review=1"
              tone={totals.review ? "amber" : "green"}
            />
            <Stat
              label="Blocking issues"
              value={String(blocking)}
              sub={blocking ? "Fix before these models can publish" : "Ready to publish"}
              href="/configurator/publish"
              tone={blocking ? "red" : "green"}
            />
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickLink
              href="/configurator/pricing"
              icon={Table2}
              title="Bulk pricing"
              text="Edit every price across regions in one grid"
            />
            <QuickLink
              href="/configurator/regions"
              icon={MapPin}
              title="Regions"
              text={`${catalog.regions.length} region${catalog.regions.length === 1 ? "" : "s"} · ${catalog.regions.reduce((n, r) => n + r.cities.length, 0)} cities`}
            />
            <QuickLink
              href="/configurator/styles"
              icon={Palette}
              title="Shared styles"
              text={`${catalog.styles.filter((s) => s.kind === "exterior").length} exteriors · ${catalog.styles.filter((s) => s.kind === "interior").length} interiors`}
            />
            <QuickLink
              href="/configurator/media"
              icon={ImageIcon}
              title="Media & import"
              text="Image library, missing renderings, import report"
            />
          </div>
        </>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--acton-muted)]" />
          <TextInput
            placeholder="Search models"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            aria-label="Search models"
          />
        </div>
        <Segmented
          value={series}
          onChange={setSeries}
          options={[
            { value: "all", label: "All series" },
            ...catalog.series.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { value: "all", label: "All" },
            { value: "attention", label: "Needs attention" },
            { value: "live", label: "Live" },
            { value: "unpublished", label: "Unpublished changes" },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="model-grid">
        {models.map((m) => {
          const r = readiness.get(m.id)!;
          const status = STATUS_PILL[statusOf(m)];
          const imagePct = r.images.required
            ? Math.round((r.images.present / r.images.required) * 100)
            : 0;
          const pricePct = r.pricing.required
            ? Math.round(((r.pricing.complete - r.pricing.needsReview) / r.pricing.required) * 100)
            : 0;
          return (
            <div
              key={m.id}
              className="overflow-hidden rounded-xl border border-[var(--acton-border)] bg-white shadow-sm"
              data-testid={`model-card-${m.id}`}
            >
              <Link href={`/configurator/models/${m.id}`} className="block">
                <div className="relative">
                  <Thumb
                    asset={assetById.get(modelHeroAssetId(m) ?? "")}
                    className="aspect-[16/9] w-full"
                    alt={m.name}
                  />
                  <span className="absolute top-2 left-2">
                    <Pill tone={status.tone}>{status.text}</Pill>
                  </span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--acton-navy)]">{m.name}</p>
                      <p className="text-xs text-[var(--acton-muted)]">
                        {catalog.series.find((s) => s.id === m.seriesId)?.name ?? "No series"} ·{" "}
                        {m.beds ?? "?"} bed · {m.baths ?? "?"} bath · {m.sqft ?? "?"} sq ft
                      </p>
                    </div>
                    {r.errors > 0 ? (
                      <Pill tone="red">{r.errors} to fix</Pill>
                    ) : (
                      <Pill tone="green">Ready</Pill>
                    )}
                  </div>
                  <Meter
                    label="Renderings"
                    pct={imagePct}
                    detail={`${r.images.present}/${r.images.required}`}
                  />
                  <Meter
                    label="Pricing"
                    pct={pricePct}
                    detail={
                      r.pricing.needsReview ? `${r.pricing.needsReview} to review` : "Complete"
                    }
                  />
                </div>
              </Link>
              <div className="flex border-t border-[var(--acton-border)] text-sm">
                <Link
                  href={`/configurator/models/${m.id}`}
                  className="flex-1 py-2 text-center font-semibold text-[var(--acton-navy)] hover:bg-gray-50"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={() => setDuplicating(m)}
                  className="flex flex-1 items-center justify-center gap-1 border-l border-[var(--acton-border)] py-2 font-semibold text-[var(--acton-navy)] hover:bg-gray-50"
                >
                  <Copy className="h-3.5 w-3.5" /> Duplicate
                </button>
                <a
                  href={`/design?preview=draft&model=${encodeURIComponent(m.slug)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-1 border-l border-[var(--acton-border)] py-2 font-semibold text-[var(--acton-navy)] hover:bg-gray-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Preview
                </a>
              </div>
            </div>
          );
        })}
        {models.length === 0 ? (
          <p className="col-span-full rounded-xl border border-dashed border-[var(--acton-border)] p-10 text-center text-sm text-[var(--acton-muted)]">
            No models match these filters.
          </p>
        ) : null}
      </div>

      {duplicating ? (
        <DuplicateDialog
          model={duplicating}
          onClose={() => setDuplicating(null)}
          onDone={(id) => {
            setDuplicating(null);
            router.push(`/configurator/models/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

function DuplicateDialog({
  model,
  onClose,
  onDone,
}: {
  model: Model;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { catalog, putModel } = useAdmin();
  const [name, setName] = useState(`${model.name} copy`);
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Duplicate {model.name}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p className="mb-3 text-sm text-[var(--acton-muted)]">
          The copy keeps every option, style, rendering and price. It starts hidden from customers
          so you can adjust it first.
        </p>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New model name"
          autoFocus
        />
      </DialogBody>
      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-md px-4 text-sm font-semibold text-[var(--acton-muted)] hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            const copy = duplicateModel(model, name.trim(), catalog);
            putModel(copy);
            onDone(copy.id);
          }}
          className="h-10 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Duplicate
        </button>
      </DialogFooter>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  href?: string;
  tone?: "red" | "amber" | "green";
}) {
  const body = (
    <div
      className={cn(
        "h-full rounded-xl border bg-white p-4 shadow-sm",
        tone === "red"
          ? "border-red-200"
          : tone === "amber"
            ? "border-amber-200"
            : "border-[var(--acton-border)]",
      )}
    >
      <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "red"
            ? "text-red-700"
            : tone === "amber"
              ? "text-amber-700"
              : "text-[var(--acton-navy)]",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-[var(--acton-muted)]">{sub}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  text,
}: {
  href: string;
  icon: typeof Table2;
  title: string;
  text: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-xl border border-[var(--acton-border)] bg-white p-4 shadow-sm hover:border-[var(--acton-navy)]"
    >
      <span className="rounded-lg bg-[var(--acton-gray-50)] p-2">
        <Icon className="h-5 w-5 text-[var(--acton-navy)]" />
      </span>
      <span>
        <span className="block font-semibold text-[var(--acton-navy)]">{title}</span>
        <span className="block text-xs text-[var(--acton-muted)]">{text}</span>
      </span>
    </Link>
  );
}

function Meter({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-[var(--acton-muted)]">{label}</span>
        <span className="font-medium text-[var(--acton-navy)]">{detail}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100">
        <div
          className={cn(
            "h-1.5 rounded-full",
            pct >= 100 ? "bg-emerald-500" : pct >= 75 ? "bg-sky-500" : "bg-amber-500",
          )}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--acton-border)] bg-white p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 font-medium whitespace-nowrap",
            value === o.value
              ? "bg-[var(--acton-navy)] text-white"
              : "text-[var(--acton-navy)] hover:bg-gray-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

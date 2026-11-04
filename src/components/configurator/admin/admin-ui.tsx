"use client";

/* eslint-disable @next/next/no-img-element -- admin thumbnails come from storage/CDN */

import {
  AlertTriangle,
  CheckCircle2,
  ImageOff,
  ImagePlus,
  Loader2,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { convertPriceMode, priceInRegion, setRegionAmount } from "@/lib/configurator/pricing";
import type { AdminAsset } from "@/lib/configurator/server";
import type { AssetClassification, Price, Region } from "@/lib/configurator/types";
import type { Issue } from "@/lib/configurator/validate";
import { useAdmin } from "./admin-context";

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-[var(--acton-border)] bg-white p-5 shadow-sm",
        className,
      )}
    >
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? (
              <h2 className="text-lg font-semibold text-[var(--acton-navy)]">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-sm text-[var(--acton-muted)]">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-sm font-semibold text-[var(--acton-navy)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[var(--acton-muted)]">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-navy)] focus:border-[var(--acton-navy)] focus:outline-none focus:ring-1 focus:ring-[var(--acton-navy)]";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 text-sm",
        disabled ? "opacity-50" : "cursor-pointer",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-[#0088FF]" : "bg-gray-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
      {label ? <span className="text-[var(--acton-navy)]">{label}</span> : null}
    </label>
  );
}

export function Pill({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red" | "gray" | "blue";
  children: ReactNode;
}) {
  const tones = {
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    red: "bg-red-50 text-red-800 ring-red-200",
    gray: "bg-gray-100 text-gray-700 ring-gray-200",
    blue: "bg-sky-50 text-sky-800 ring-sky-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export function formatMoney(value: number | null): string {
  return value === null ? "" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function MoneyInput({
  value,
  onChange,
  placeholder,
  prefix = "$",
  className,
  testId,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  prefix?: string;
  className?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-[var(--acton-muted)]">
        {prefix}
      </span>
      <input
        inputMode="decimal"
        aria-label={ariaLabel}
        data-testid={testId}
        className={cn(inputClass, "pl-6 text-right tabular-nums")}
        placeholder={placeholder ?? "—"}
        value={draft ?? formatMoney(value)}
        onFocus={(e) => {
          setDraft(value === null ? "" : String(value));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) onChange(parseMoney(draft));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}

/**
 * Pricing by Region for one item. Edits the item's single Price — the same value the bulk
 * pricing grid shows.
 */
export function RegionPriceEditor({
  price,
  regions,
  onChange,
  label,
  allowZeroNote,
  testId,
}: {
  price: Price;
  regions: Region[];
  onChange: (p: Price) => void;
  label?: string;
  allowZeroNote?: boolean;
  testId?: string;
}) {
  const [bulk, setBulk] = useState<number | null>(null);
  if (regions.length === 0) {
    return (
      <p className="text-sm text-[var(--acton-muted)]">
        Add a pricing region first (Pricing &amp; Regions → Regions).
      </p>
    );
  }
  return (
    <div data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {label ? (
          <span className="text-sm font-semibold text-[var(--acton-navy)]">{label}</span>
        ) : null}
        <div className="inline-flex rounded-lg border border-[var(--acton-border)] p-0.5 text-xs">
          {(
            [
              ["explicit", "Price per region"],
              ["adjusted", "Base + adjustments"],
            ] as const
          ).map(([mode, text]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(convertPriceMode(price, mode, regions))}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium",
                price.mode === mode
                  ? "bg-[var(--acton-navy)] text-white"
                  : "text-[var(--acton-navy)] hover:bg-gray-50",
              )}
            >
              {text}
            </button>
          ))}
        </div>
        {price.needsReview ? (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            <input
              type="checkbox"
              checked={false}
              onChange={() => onChange({ ...price, needsReview: false })}
              data-testid={testId ? `${testId}-review` : undefined}
            />
            Needs review — mark as reviewed
          </label>
        ) : (
          <Pill tone="green">
            <CheckCircle2 className="h-3 w-3" /> Reviewed
          </Pill>
        )}
      </div>

      {price.mode === "adjusted" ? (
        <div className="mb-3 grid max-w-md grid-cols-[auto_1fr_auto] items-center gap-2">
          <span className="text-sm text-[var(--acton-muted)]">Base price</span>
          <MoneyInput
            value={price.base}
            onChange={(v) => onChange({ ...price, base: v })}
            ariaLabel="Base price"
          />
          <div className="inline-flex rounded-md border border-[var(--acton-border)] text-xs">
            {(["amount", "percent"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onChange({ ...price, adjustKind: k })}
                className={cn(
                  "px-2 py-1",
                  price.adjustKind === k ? "bg-gray-100 font-semibold" : "",
                )}
              >
                {k === "amount" ? "± $" : "± %"}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--acton-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Region</th>
              <th className="px-3 py-2 font-semibold">
                {price.mode === "explicit"
                  ? "Price"
                  : price.adjustKind === "percent"
                    ? "Adjustment (%)"
                    : "Adjustment ($)"}
              </th>
              {price.mode === "adjusted" ? (
                <th className="px-3 py-2 text-right font-semibold">Customer price</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {regions.map((r) => {
              const effective = priceInRegion(price, r.id);
              const raw = price.regions[r.id] ?? null;
              return (
                <tr key={r.id} className="border-t border-[var(--acton-border)]">
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
                      {r.name}
                    </span>
                  </td>
                  <td className="w-44 px-3 py-1.5">
                    <MoneyInput
                      value={raw}
                      prefix={
                        price.mode === "adjusted" && price.adjustKind === "percent" ? "%" : "$"
                      }
                      placeholder={price.mode === "explicit" ? "Not set" : "0"}
                      onChange={(v) =>
                        onChange({ ...price, regions: { ...price.regions, [r.id]: v } })
                      }
                      ariaLabel={`${r.name} price`}
                      testId={testId ? `${testId}-${r.id}` : undefined}
                    />
                  </td>
                  {price.mode === "adjusted" ? (
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {effective === null ? "—" : `$${effective.toLocaleString()}`}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {regions.length > 1 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--acton-muted)]">
          <span>Set every region to</span>
          <MoneyInput
            value={bulk}
            onChange={setBulk}
            className="w-32"
            ariaLabel="Amount for all regions"
          />
          <button
            type="button"
            className="rounded-md border border-[var(--acton-border)] px-2 py-1 font-medium text-[var(--acton-navy)] hover:bg-gray-50"
            onClick={() => {
              if (bulk === null) return;
              let next = price;
              for (const r of regions) next = setRegionAmount(next, r.id, bulk);
              onChange(next);
            }}
          >
            Apply
          </button>
        </div>
      ) : null}
      {allowZeroNote ? (
        <p className="mt-2 text-xs text-[var(--acton-muted)]">
          $0 is fine for included options — mark it reviewed so it can publish.
        </p>
      ) : null}
    </div>
  );
}

/** "+$1,500 · Bay Area" summary for cards. */
export function priceSummary(price: Price, regions: Region[]): string {
  const values = regions.map((r) => priceInRegion(price, r.id));
  const set = values.filter((v): v is number => v !== null);
  if (set.length === 0) return "No price";
  const min = Math.min(...set);
  const max = Math.max(...set);
  const fmt = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString()}`;
  const range = min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
  return set.length < values.length ? `${range} (incomplete)` : range;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export function Thumb({
  asset,
  className,
  alt,
}: {
  asset: AdminAsset | null | undefined;
  className?: string;
  alt?: string;
}) {
  if (!asset) {
    return (
      <div className={cn("flex items-center justify-center bg-gray-100 text-gray-400", className)}>
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={asset.thumbUrl}
      alt={alt ?? asset.originalName}
      loading="lazy"
      className={cn("object-cover", className)}
    />
  );
}

/**
 * One rendering slot: shows the image, accepts a dropped/uploaded file, or lets the admin
 * pick an existing image from the library.
 */
export function ImageSlot({
  label,
  sublabel,
  assetId,
  onChange,
  classification,
  suggest,
  required,
  fallbackAssetId,
  testId,
}: {
  label: string;
  sublabel?: string;
  assetId: string | null;
  onChange: (assetId: string | null) => void;
  classification: AssetClassification;
  suggest?: (asset: AdminAsset) => number;
  required?: boolean;
  fallbackAssetId?: string | null;
  testId?: string;
}) {
  const { assetById, uploadImage } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const asset = assetId ? assetById.get(assetId) : null;
  const fallback = !asset && fallbackAssetId ? assetById.get(fallbackAssetId) : null;

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImage(file, classification);
      onChange(uploaded.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid={testId}
      data-filled={asset ? "true" : "false"}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void upload(file);
      }}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-white",
        over
          ? "border-[#0088FF] ring-2 ring-[#0088FF]/30"
          : asset
            ? "border-[var(--acton-border)]"
            : required
              ? "border-dashed border-red-300"
              : "border-dashed border-[var(--acton-border)]",
      )}
    >
      <div className="relative aspect-[16/10] w-full">
        {asset ? (
          <Thumb asset={asset} className="h-full w-full" />
        ) : fallback ? (
          <>
            <Thumb asset={fallback} className="h-full w-full opacity-50 grayscale" />
            <span className="absolute inset-x-0 top-1 text-center text-[10px] font-semibold text-amber-800">
              Using 8-ft image
            </span>
          </>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-[var(--acton-muted)] hover:bg-gray-50"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImagePlus className={cn("h-5 w-5", required ? "text-red-400" : "")} />
            )}
            <span>{busy ? "Uploading…" : required ? "Missing — drop image" : "Drop image"}</span>
          </button>
        )}
        {asset ? (
          <div className="absolute inset-0 hidden items-center justify-center gap-1 bg-black/40 group-hover:flex">
            <button
              type="button"
              className="rounded bg-white px-2 py-1 text-xs font-semibold"
              onClick={() => fileRef.current?.click()}
            >
              Replace
            </button>
            <button
              type="button"
              className="rounded bg-white px-2 py-1 text-xs font-semibold"
              onClick={() => setPicking(true)}
            >
              Library
            </button>
            <button
              type="button"
              aria-label="Remove image"
              className="rounded bg-white p-1"
              onClick={() => onChange(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-[var(--acton-navy)]">{label}</p>
          {sublabel ? (
            <p className="truncate text-[11px] text-[var(--acton-muted)]">{sublabel}</p>
          ) : null}
        </div>
        {!asset ? (
          <button
            type="button"
            className="shrink-0 text-[11px] font-semibold text-[#0088FF] hover:underline"
            onClick={() => setPicking(true)}
          >
            Library
          </button>
        ) : null}
      </div>
      {error ? <p className="px-2 pb-2 text-[11px] text-red-700">{error}</p> : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {picking ? (
        <AssetPickerDialog
          title={`Choose image · ${label}`}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            onChange(id);
            setPicking(false);
          }}
          rank={suggest}
        />
      ) : null}
    </div>
  );
}

export function AssetPickerDialog({
  title,
  onClose,
  onPick,
  rank,
}: {
  title: string;
  onClose: () => void;
  onPick: (assetId: string) => void;
  rank?: (asset: AdminAsset) => number;
}) {
  const { assets } = useAdmin();
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter(
        (a) =>
          !q || a.originalName.toLowerCase().includes(q) || a.provenance.toLowerCase().includes(q),
      )
      .map((a) => ({ a, score: rank ? rank(a) : 0 }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 120);
  }, [assets, query, rank]);
  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="relative mb-3">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--acton-muted)]" />
          <TextInput
            autoFocus
            placeholder="Search file names"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {rank ? (
          <p className="mb-2 text-xs text-[var(--acton-muted)]">
            Best matches for this slot are shown first.
          </p>
        ) : null}
        <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
          {list.map(({ a, score }) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a.id)}
              className="overflow-hidden rounded-lg border border-[var(--acton-border)] text-left hover:ring-2 hover:ring-[#0088FF]"
            >
              <Thumb asset={a} className="aspect-[16/10] w-full" />
              <p
                className="truncate px-2 py-1 text-[11px] text-[var(--acton-navy)]"
                title={a.originalName}
              >
                {score >= 3 ? "★ " : ""}
                {a.originalName}
              </p>
            </button>
          ))}
          {list.length === 0 ? (
            <p className="col-span-full py-8 text-center text-sm text-[var(--acton-muted)]">
              No images match.
            </p>
          ) : null}
        </div>
      </DialogBody>
    </Dialog>
  );
}

export function UploadButton({
  onFiles,
  label = "Upload images",
  multiple = true,
}: {
  onFiles: (files: File[]) => void;
  label?: string;
  multiple?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm font-semibold text-[var(--acton-navy)] hover:bg-gray-50"
      >
        <Upload className="h-4 w-4" /> {label}
      </button>
      <input
        ref={ref}
        type="file"
        multiple={multiple}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export function IssueList({
  issues,
  onFix,
  limit = 8,
}: {
  issues: Issue[];
  onFix?: (issue: Issue) => void;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> Everything needed to publish is in place.
      </p>
    );
  }
  const shown = expanded ? issues : issues.slice(0, limit);
  return (
    <div>
      <ul className="space-y-1.5">
        {shown.map((issue, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <AlertTriangle
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                issue.severity === "error" ? "text-red-600" : "text-amber-500",
              )}
            />
            <span className="flex-1 text-[var(--acton-navy)]">{issue.message}</span>
            {onFix && issue.tab ? (
              <button
                type="button"
                className="shrink-0 text-xs font-semibold text-[#0088FF] hover:underline"
                onClick={() => onFix(issue)}
              >
                Fix
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {issues.length > limit ? (
        <button
          type="button"
          className="mt-2 text-xs font-semibold text-[#0088FF] hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show fewer" : `Show all ${issues.length}`}
        </button>
      ) : null}
    </div>
  );
}
